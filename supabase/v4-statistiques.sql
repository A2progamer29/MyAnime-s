create table if not exists public.stat_presence (
  session_id uuid primary key,
  page text,
  last_seen timestamptz not null default now()
);

create table if not exists public.stat_site_daily (
  day date primary key,
  page_views bigint not null default 0,
  visitors bigint not null default 0
);

create table if not exists public.stat_title_daily (
  anime_id integer not null,
  day date not null,
  views bigint not null default 0,
  primary key (anime_id, day)
);

create table if not exists public.stat_titles (
  anime_id integer primary key,
  title text,
  total_views bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.stat_seen (
  session_id uuid not null,
  day date not null,
  anime_id integer not null default 0,
  primary key (session_id, day, anime_id)
);

create index if not exists stat_presence_last_seen on public.stat_presence (last_seen);
create index if not exists stat_titles_total on public.stat_titles (total_views desc);
create index if not exists stat_seen_day on public.stat_seen (day);

alter table public.stat_presence enable row level security;
alter table public.stat_site_daily enable row level security;
alter table public.stat_title_daily enable row level security;
alter table public.stat_titles enable row level security;
alter table public.stat_seen enable row level security;

revoke all on public.stat_presence, public.stat_site_daily, public.stat_title_daily, public.stat_titles, public.stat_seen from anon, authenticated;

create or replace function public.track_visit(p_session uuid, p_page text, p_new_page boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_day date := (now() at time zone 'Europe/Paris')::date;
  v_new integer;
begin
  if p_session is null then return; end if;
  insert into public.stat_presence (session_id, page, last_seen)
  values (p_session, left(coalesce(p_page, ''), 40), now())
  on conflict (session_id) do update set page = excluded.page, last_seen = now();

  if coalesce(p_new_page, false) then
    insert into public.stat_seen (session_id, day, anime_id) values (p_session, v_day, 0) on conflict do nothing;
    get diagnostics v_new = row_count;
    insert into public.stat_site_daily (day, page_views, visitors) values (v_day, 1, v_new)
    on conflict (day) do update set page_views = stat_site_daily.page_views + 1, visitors = stat_site_daily.visitors + v_new;
  end if;

  if random() < 0.02 then
    delete from public.stat_presence where last_seen < now() - interval '1 day';
    delete from public.stat_seen where day < v_day - 1;
  end if;
end $$;

create or replace function public.track_title_view(p_session uuid, p_anime integer, p_title text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_day date := (now() at time zone 'Europe/Paris')::date;
  v_new integer;
begin
  if p_session is null or p_anime is null or p_anime <= 0 then return; end if;
  insert into public.stat_seen (session_id, day, anime_id) values (p_session, v_day, p_anime) on conflict do nothing;
  get diagnostics v_new = row_count;
  if v_new = 0 then return; end if;
  insert into public.stat_title_daily (anime_id, day, views) values (p_anime, v_day, 1)
  on conflict (anime_id, day) do update set views = stat_title_daily.views + 1;
  insert into public.stat_titles (anime_id, title, total_views) values (p_anime, left(coalesce(p_title, ''), 200), 1)
  on conflict (anime_id) do update set total_views = stat_titles.total_views + 1,
    title = coalesce(nullif(left(excluded.title, 200), ''), stat_titles.title), updated_at = now();
end $$;

create or replace function public.top_viewed(p_limit integer) returns jsonb
language sql security definer stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', anime_id, 'views', total_views) order by total_views desc, updated_at desc), '[]'::jsonb)
  from (select anime_id, total_views, updated_at from public.stat_titles where total_views > 0
        order by total_views desc, updated_at desc limit least(greatest(coalesce(p_limit, 10), 1), 50)) t;
$$;

create or replace function public.admin_site_stats() returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_day date := (now() at time zone 'Europe/Paris')::date;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'active_now', (select count(*) from public.stat_presence where last_seen > now() - interval '2 minutes'),
    'active_pages', (select coalesce(jsonb_agg(jsonb_build_object('page', page, 'count', n) order by n desc), '[]'::jsonb)
      from (select coalesce(nullif(page, ''), 'autre') as page, count(*) as n from public.stat_presence
            where last_seen > now() - interval '2 minutes' group by 1) p),
    'views_today', (select coalesce(sum(page_views), 0) from public.stat_site_daily where day = v_day),
    'visitors_today', (select coalesce(sum(visitors), 0) from public.stat_site_daily where day = v_day),
    'views_7d', (select coalesce(sum(page_views), 0) from public.stat_site_daily where day > v_day - 7),
    'views_30d', (select coalesce(sum(page_views), 0) from public.stat_site_daily where day > v_day - 30),
    'views_total', (select coalesce(sum(page_views), 0) from public.stat_site_daily),
    'title_views_total', (select coalesce(sum(total_views), 0) from public.stat_titles),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'views', coalesce(s.page_views, 0), 'visitors', coalesce(s.visitors, 0)) order by d), '[]'::jsonb)
      from generate_series(v_day - 13, v_day, interval '1 day') d
      left join public.stat_site_daily s on s.day = d::date),
    'titles', (select coalesce(jsonb_agg(jsonb_build_object('id', t.anime_id, 'title', t.title, 'total', t.total_views,
        'today', coalesce(x.today, 0), 'week', coalesce(x.week, 0)) order by t.total_views desc), '[]'::jsonb)
      from (select * from public.stat_titles order by total_views desc limit 200) t
      left join (select anime_id, sum(views) filter (where day = v_day) as today, sum(views) filter (where day > v_day - 7) as week
                 from public.stat_title_daily where day > v_day - 7 group by anime_id) x on x.anime_id = t.anime_id)
  );
end $$;

revoke execute on function public.track_visit(uuid, text, boolean) from public;
revoke execute on function public.track_title_view(uuid, integer, text) from public;
revoke execute on function public.top_viewed(integer) from public;
revoke execute on function public.admin_site_stats() from public;
grant execute on function public.track_visit(uuid, text, boolean) to anon, authenticated;
grant execute on function public.track_title_view(uuid, integer, text) to anon, authenticated;
grant execute on function public.top_viewed(integer) to anon, authenticated;
grant execute on function public.admin_site_stats() to authenticated;
