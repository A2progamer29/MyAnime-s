-- =========================================================
-- LumaAnime — v14 : épisodes multi-langues et multi-lecteurs
-- À exécuter une fois dans Supabase → SQL Editor, APRÈS v13. Idempotent (relançable sans risque).
-- Structure : Anime → Saison → Épisode → Version linguistique → Lecteur (provider) → Source.
-- Les vidéos restent chez les lecteurs (VOE, Vidmoly…) : la base ne garde que les références.
-- Les anciens épisodes (v7, une seule adresse vidéo) sont conservés et migrés en sources « à vérifier »
-- (langue inconnue) : l'admin précise la langue en un clic, rien n'est inventé.
-- =========================================================

-- ---------------------------------------------------------
-- Langues et libellés (VF, VOSTFR…) : extensibles sans changer le code
-- ---------------------------------------------------------
create table if not exists public.languages (
  code text primary key check (code ~ '^[a-z]{2,3}$'),
  name_fr text not null check (char_length(name_fr) between 1 and 60),
  sort integer not null default 100
);
insert into public.languages (code, name_fr, sort) values
  ('ja', 'japonais', 10), ('fr', 'français', 20), ('en', 'anglais', 30), ('es', 'espagnol', 40),
  ('de', 'allemand', 50), ('it', 'italien', 60), ('pt', 'portugais', 70), ('nl', 'néerlandais', 80),
  ('ko', 'coréen', 90), ('zh', 'chinois', 100), ('und', 'indéterminée', 998), ('mul', 'plusieurs pistes', 999)
on conflict (code) do nothing;

create table if not exists public.language_labels (
  code text primary key check (code ~ '^[A-Z0-9]{2,12}$'),
  name_fr text not null check (char_length(name_fr) between 1 and 60),
  sort integer not null default 100,
  active boolean not null default true
);
insert into public.language_labels (code, name_fr, sort) values
  ('VOSTFR', 'VOSTFR', 10), ('VF', 'VF', 20), ('VO', 'VO', 30), ('VOSTEN', 'VOSTEN', 40), ('VOSTES', 'VOSTES', 50),
  ('VOSTDE', 'VOSTDE', 60), ('VOSTIT', 'VOSTIT', 70), ('VOSTPT', 'VOSTPT', 80), ('VOSTNL', 'VOSTNL', 90), ('AUTRE', 'Autre', 999)
on conflict (code) do nothing;

-- Une règle relie une combinaison (audio, sous-titres) à un libellé. La règle la plus précise l'emporte.
create table if not exists public.language_label_rules (
  id integer generated always as identity primary key,
  label_code text not null references public.language_labels(code) on update cascade on delete cascade,
  audio_kind text check (audio_kind in ('original', 'dub')),
  audio_lang text references public.languages(code),
  subtitle text not null check (subtitle in ('none', 'any', 'lang')),
  subtitle_lang text references public.languages(code),
  check ((subtitle = 'lang') = (subtitle_lang is not null))
);
create unique index if not exists language_label_rules_unique on public.language_label_rules
  (coalesce(audio_kind, '*'), coalesce(audio_lang, '*'), subtitle, coalesce(subtitle_lang, '*'));

do $$ begin
  if not exists (select 1 from public.language_label_rules) then
    insert into public.language_label_rules (label_code, audio_kind, audio_lang, subtitle, subtitle_lang) values
      ('VO', 'original', null, 'none', null),
      ('VOSTFR', 'original', null, 'lang', 'fr'), ('VOSTEN', 'original', null, 'lang', 'en'),
      ('VOSTES', 'original', null, 'lang', 'es'), ('VOSTDE', 'original', null, 'lang', 'de'),
      ('VOSTIT', 'original', null, 'lang', 'it'), ('VOSTPT', 'original', null, 'lang', 'pt'),
      ('VOSTNL', 'original', null, 'lang', 'nl'),
      ('VF', 'dub', 'fr', 'none', null), ('VF', 'dub', 'fr', 'lang', 'fr');
  end if;
end $$;

-- Libellé calculé (jamais stocké) : modifier une règle met l'affichage à jour partout.
create or replace function public.language_label(p_audio_kind text, p_audio_lang text, p_subtitle_kind text, p_subtitle_lang text)
returns text language sql stable set search_path = public, pg_temp as $$
  select case when p_audio_lang in ('und', 'mul') then 'AUTRE' else coalesce((
    select r.label_code
      from public.language_label_rules r
      join public.language_labels l on l.code = r.label_code and l.active
     where (r.audio_kind is null or r.audio_kind = p_audio_kind)
       and (r.audio_lang is null or r.audio_lang = p_audio_lang)
       and case r.subtitle
             when 'none' then coalesce(p_subtitle_kind, 'none') = 'none'
             when 'any' then true
             else coalesce(p_subtitle_kind, 'none') <> 'none' and r.subtitle_lang = p_subtitle_lang
           end
     order by (r.audio_kind is not null)::int + 2 * (r.audio_lang is not null)::int
              + case r.subtitle when 'lang' then 2 when 'none' then 1 else 0 end desc, l.sort
     limit 1), 'AUTRE') end;
$$;

-- ---------------------------------------------------------
-- Animes présents sur LumaAnime (cache minimal d'AniList : uniquement les titres du site,
-- jamais un miroir du catalogue — conditions d'utilisation d'AniList)
-- ---------------------------------------------------------
create table if not exists public.anime (
  anilist_id integer primary key check (anilist_id between 1 and 10000000),
  id_mal integer check (id_mal between 1 and 10000000),
  title_display text not null default '' check (char_length(title_display) <= 300),
  title_romaji text check (char_length(title_romaji) <= 300),
  title_english text check (char_length(title_english) <= 300),
  title_native text check (char_length(title_native) <= 300),
  synonyms text[] not null default '{}' check (cardinality(synonyms) <= 60),
  cover text check (cover ~ '^https://s4\.anilist\.co/[^\s"<>]+$'),
  banner text check (banner ~ '^https://s4\.anilist\.co/[^\s"<>]+$'),
  format text check (format ~ '^[A-Z_]{1,20}$'),
  status text check (status in ('FINISHED', 'RELEASING', 'NOT_YET_RELEASED', 'CANCELLED', 'HIATUS')),
  episodes integer check (episodes between 0 and 5000),
  duration_min integer check (duration_min between 1 and 1440),
  season text check (season in ('WINTER', 'SPRING', 'SUMMER', 'FALL')),
  season_year integer check (season_year between 1900 and 2200),
  genres text[] not null default '{}' check (cardinality(genres) <= 30),
  country_of_origin text check (country_of_origin ~ '^[A-Z]{2}$'),
  original_lang text references public.languages(code),
  original_lang_source text not null default 'auto' check (original_lang_source in ('auto', 'admin')),
  is_adult boolean not null default false,
  next_airing_episode integer check (next_airing_episode between 0 and 5000),
  next_airing_at timestamptz,
  anilist_updated_at timestamptz,
  last_synced_at timestamptz,
  sync_requested_at timestamptz,
  sync_error text check (char_length(sync_error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.anime_relations (
  from_id integer not null references public.anime(anilist_id) on delete cascade,
  to_id integer not null check (to_id between 1 and 10000000),
  relation text not null check (relation ~ '^[A-Z_]{2,20}$'),
  to_format text check (to_format ~ '^[A-Z_]{1,20}$'),
  to_title text check (char_length(to_title) <= 300),
  primary key (from_id, to_id, relation)
);

-- Saison N d'une série ↔ fiche AniList réelle (AniList publie souvent chaque saison comme une fiche distincte)
create table if not exists public.seasons (
  anilist_id integer not null references public.anime(anilist_id) on delete cascade,
  number integer not null check (number between 0 and 99),
  media_anilist_id integer check (media_anilist_id between 1 and 10000000),
  title text not null default '' check (char_length(title) <= 200),
  episode_offset integer not null default 0 check (episode_offset between 0 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (anilist_id, number)
);
create unique index if not exists seasons_media_unique on public.seasons (media_anilist_id) where media_anilist_id is not null;

-- ---------------------------------------------------------
-- Épisodes : évolution NON destructive de la table v7
-- ---------------------------------------------------------
alter table public.episodes alter column video_url drop not null;
alter table public.episodes drop constraint if exists episodes_season_check;
do $$ begin
  alter table public.episodes add constraint episodes_season_range check (season between 0 and 99);
exception when duplicate_object then null; end $$;
alter table public.episodes add column if not exists kind text not null default 'episode';
alter table public.episodes add column if not exists published boolean not null default true;
alter table public.episodes add column if not exists aired_at timestamptz;
-- Accès anticipé : jusqu'à cette date, seuls les membres Premium peuvent lire l'épisode
alter table public.episodes add column if not exists premium_until timestamptz;
do $$ begin
  alter table public.episodes add constraint episodes_kind check (kind in ('episode', 'special', 'ova', 'ona', 'movie', 'recap'));
exception when duplicate_object then null; end $$;
create index if not exists episodes_by_anime on public.episodes (anilist_id, season, number);

-- ---------------------------------------------------------
-- Lecteurs (providers) : configuration modifiable dans l'admin (priorité, hôtes autorisés, format)
-- ---------------------------------------------------------
create table if not exists public.providers (
  key text primary key check (key ~ '^[a-z0-9_]{2,30}$'),
  name text not null check (char_length(name) between 1 and 40),
  kind text not null check (kind in ('embed', 'direct')),
  priority integer not null default 0 check (priority between -1000 and 1000),
  active boolean not null default true,
  hosts text[] not null default '{}' check (cardinality(hosts) <= 20),
  embed_template text check (embed_template ~ '^https://[a-z0-9.-]+/[^\s"''<>\\]*\{id\}[^\s"''<>\\]*$'),
  id_pattern text check (char_length(id_pattern) <= 200),
  sandbox boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.providers (key, name, kind, priority, active, hosts, embed_template, id_pattern, sandbox) values
  ('lumaanime', 'LumaAnime', 'direct', 100, true, '{}', null, null, false),
  ('voe', 'VOE', 'embed', 30, true, '{voe.sx}', 'https://voe.sx/e/{id}', '^[A-Za-z0-9]{8,16}$', true),
  ('vidmoly', 'Vidmoly', 'embed', 20, true, '{vidmoly.to,vidmoly.me}', null, null, true)
on conflict (key) do nothing;

-- ---------------------------------------------------------
-- Sources : une version linguistique d'un épisode chez un lecteur
-- ---------------------------------------------------------
create table if not exists public.episode_sources (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes(id) on delete cascade,
  provider_key text not null references public.providers(key) on update cascade,
  provider_video_id text check (provider_video_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  embed_url text check (char_length(embed_url) <= 600 and embed_url ~ '^https://[^\s"''<>\\]+$'),
  audio_lang text not null references public.languages(code),
  audio_kind text not null check (audio_kind in ('original', 'dub')),
  subtitle_lang text references public.languages(code),
  subtitle_kind text not null default 'none' check (subtitle_kind in ('none', 'hard', 'soft')),
  lang_key text generated always as (audio_kind || ':' || audio_lang || '/' || subtitle_kind || ':' || coalesce(subtitle_lang, '')) stored,
  needs_review boolean not null default false,
  review_reason text check (char_length(review_reason) <= 200),
  lang_origin text not null default 'admin' check (lang_origin in ('admin', 'legacy')),
  status text not null default 'ready' check (status in ('pending', 'uploading', 'processing', 'ready', 'failed', 'disabled')),
  published boolean not null default true,
  publish_requested boolean not null default true,
  priority integer check (priority between -1000 and 1000),
  rights_basis text not null check (rights_basis in ('own', 'licensed', 'public_domain', 'cc_license')),
  rights_note text not null default '' check (char_length(rights_note) <= 500),
  last_error text check (char_length(last_error) <= 1000),
  last_checked_at timestamptz,
  reports integer not null default 0 check (reports >= 0),
  last_report_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((subtitle_kind = 'none') = (subtitle_lang is null)),
  check (audio_lang not in ('und', 'mul') or needs_review),
  check (not (published and needs_review)),
  check (status <> 'ready' or embed_url is not null)
);
alter table public.episode_sources add column if not exists publish_requested boolean not null default true;
create index if not exists episode_sources_by_episode on public.episode_sources (episode_id);
-- Pas deux sources actives pour la même version linguistique chez le même lecteur
create unique index if not exists episode_sources_one_active on public.episode_sources (episode_id, provider_key, lang_key)
  where status <> 'disabled';

create table if not exists public.source_reports (
  source_id uuid not null references public.episode_sources(id) on delete cascade,
  reporter text not null check (char_length(reporter) between 3 and 80),
  day date not null,
  primary key (source_id, reporter, day)
);

create table if not exists public.episode_tombstones (
  anilist_id integer not null,
  season integer not null,
  number integer not null,
  deleted_at timestamptz not null default now(),
  primary key (anilist_id, season, number)
);

create table if not exists public.sync_state (
  key text primary key check (key ~ '^[a-z0-9_:.-]{1,60}$'),
  last_started_at timestamptz,
  last_success_at timestamptz,
  last_error text check (char_length(last_error) <= 500),
  info jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.sync_state add column if not exists running_since timestamptz;

-- Langue d'origine déduite du pays d'origine AniList (l'admin peut la fixer lui-même)
create or replace function public.lang_from_country(p_country text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case upper(coalesce(p_country, ''))
    when 'JP' then 'ja' when 'KR' then 'ko' when 'CN' then 'zh' when 'TW' then 'zh'
    when 'FR' then 'fr' when 'US' then 'en' when 'GB' then 'en' else null end;
$$;

-- ---------------------------------------------------------
-- Garde-fou des sources : lecteur connu, adresse sur un hôte autorisé, pas de fichier attaché à deux
-- épisodes, langues cohérentes (un doublage n'est jamais dans la langue d'origine, une VO l'est toujours),
-- source ambiguë = « à vérifier » et jamais publiée.
-- ---------------------------------------------------------
create or replace function public.source_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p public.providers;
  v_anime integer;
  v_adult boolean;
  v_orig text;
  v_host text;
  v_soft boolean := current_setting('luma.revalidate', true) = '1';
begin
  select * into p from public.providers where key = new.provider_key;
  if not found then raise exception 'provider_unknown'; end if;
  select e.anilist_id into v_anime from public.episodes e where e.id = new.episode_id;
  select a.is_adult, a.original_lang into v_adult, v_orig from public.anime a where a.anilist_id = v_anime;
  if coalesce(v_adult, false) then raise exception 'adult_forbidden'; end if;

  if new.provider_video_id is not null then
    if p.id_pattern is not null and new.provider_video_id !~ p.id_pattern then raise exception 'video_id_format'; end if;
    if p.embed_template is not null then new.embed_url := replace(p.embed_template, '{id}', new.provider_video_id); end if;
  end if;
  if new.embed_url is not null and (tg_op = 'INSERT' or new.embed_url is distinct from old.embed_url
                                    or new.provider_key is distinct from old.provider_key) then
    if new.embed_url !~ '^https://[^\s"''<>\\]+$' then raise exception 'embed_scheme'; end if;
    v_host := lower(substring(new.embed_url from '^https://([^/?#]+)'));
    if v_host is null or v_host ~ '[@:]' then raise exception 'embed_host'; end if;
    if (p.kind = 'embed' or cardinality(p.hosts) > 0) and not (v_host = any (p.hosts)) then raise exception 'embed_host'; end if;
  end if;

  if new.lang_origin <> 'legacy' then
    if new.provider_video_id is not null and exists (
         select 1 from public.episode_sources s
          where s.provider_key = new.provider_key and s.provider_video_id = new.provider_video_id
            and s.episode_id <> new.episode_id and s.id <> new.id) then
      raise exception 'duplicate_video';
    end if;
    if new.embed_url is not null and exists (
         select 1 from public.episode_sources s
          where s.provider_key = new.provider_key and s.episode_id <> new.episode_id and s.id <> new.id
            and lower(regexp_replace(regexp_replace(s.embed_url, '[?#].*$', ''), '^https://[^/]+', ''))
              = lower(regexp_replace(regexp_replace(new.embed_url, '[?#].*$', ''), '^https://[^/]+', ''))) then
      raise exception 'duplicate_video';
    end if;
  end if;

  if (new.subtitle_kind = 'none') <> (new.subtitle_lang is null) then raise exception 'subtitle_invalid'; end if;

  if new.audio_lang in ('und', 'mul') then
    new.needs_review := true;
    new.review_reason := coalesce(new.review_reason, 'langue_audio_inconnue');
  elsif v_orig is null then
    if new.lang_origin = 'admin' and not v_soft then raise exception 'original_lang_unknown'; end if;
    new.needs_review := true;
    new.review_reason := 'langue_origine_inconnue';
  elsif (new.audio_kind = 'original' and new.audio_lang <> v_orig) or (new.audio_kind = 'dub' and new.audio_lang = v_orig) then
    if new.lang_origin = 'admin' and not v_soft then raise exception 'lang_mismatch'; end if;
    new.needs_review := true;
    new.review_reason := 'lang_mismatch';
  elsif new.subtitle_kind <> 'none' and new.subtitle_lang = new.audio_lang then
    new.needs_review := true;
    new.review_reason := 'st_meme_langue';
  elsif new.lang_origin = 'admin' then
    new.needs_review := false;
    new.review_reason := null;
  end if;

  -- Publiée = publication demandée par l'admin ET source valide : une source qui redevient valide
  -- (ex. langue d'origine précisée) se republie d'elle-même, une source « à vérifier » jamais.
  new.published := new.publish_requested and not new.needs_review;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists source_guard on public.episode_sources;
create trigger source_guard before insert or update on public.episode_sources
  for each row execute function public.source_guard();

-- ---------------------------------------------------------
-- Migration des épisodes v7 (relançable) : chaque ancienne adresse devient une source « LumaAnime »
-- à vérifier (langue inconnue), non publiée tant que l'admin n'a pas précisé la langue.
-- ---------------------------------------------------------
insert into public.anime (anilist_id, title_display)
select anilist_id, left(max(anime_title), 300) from public.episodes group by anilist_id
on conflict (anilist_id) do nothing;

insert into public.seasons (anilist_id, number, media_anilist_id)
select distinct e.anilist_id, e.season, case when e.season = 1 then e.anilist_id end
  from public.episodes e
 where not exists (select 1 from public.seasons s where s.anilist_id = e.anilist_id and s.number = e.season)
   and (e.season <> 1 or not exists (select 1 from public.seasons s2 where s2.media_anilist_id = e.anilist_id))
on conflict do nothing;
insert into public.seasons (anilist_id, number)
select distinct e.anilist_id, e.season from public.episodes e
on conflict do nothing;

insert into public.episode_sources (episode_id, provider_key, embed_url, audio_lang, audio_kind, subtitle_kind,
  needs_review, review_reason, lang_origin, status, published, publish_requested, rights_basis, rights_note)
select e.id, 'lumaanime', e.video_url, 'und', 'original', 'none', true, 'langue_inconnue_v7', 'legacy', 'ready', false, false,
       'own', 'Migré depuis l''ancien système d''épisodes (v7)'
  from public.episodes e
 where e.video_url is not null and e.video_url ~* '^https://[a-z0-9.-]+(/[^\s"''<>\\]*)?$' and char_length(e.video_url) <= 600
   and not exists (select 1 from public.episode_sources s where s.episode_id = e.id and s.lang_origin = 'legacy');
-- Adresse v7 atypique (port, identifiants, caractère spécial) : source créée en échec, à corriger par l'admin
insert into public.episode_sources (episode_id, provider_key, embed_url, audio_lang, audio_kind, subtitle_kind,
  needs_review, review_reason, lang_origin, status, published, publish_requested, rights_basis, rights_note, last_error)
select e.id, 'lumaanime', null, 'und', 'original', 'none', true, 'langue_inconnue_v7', 'legacy', 'failed', false, false,
       'own', 'Migré depuis l''ancien système d''épisodes (v7)',
       left('Ancienne adresse refusée (format non accepté), à ressaisir : ' || e.video_url, 1000)
  from public.episodes e
 where e.video_url is not null and (e.video_url !~* '^https://[a-z0-9.-]+(/[^\s"''<>\\]*)?$' or char_length(e.video_url) > 600)
   and not exists (select 1 from public.episode_sources s where s.episode_id = e.id and s.lang_origin = 'legacy');

do $$ begin
  alter table public.episodes add constraint episodes_anime_fk foreign key (anilist_id)
    references public.anime(anilist_id) on delete cascade not valid;
exception when duplicate_object then null; end $$;
alter table public.episodes validate constraint episodes_anime_fk;

-- ---------------------------------------------------------
-- Droits : aucun accès direct aux nouvelles tables pour les visiteurs ; tout passe par des fonctions.
-- La table episodes n'est plus lisible directement que pour les épisodes publiés.
-- ---------------------------------------------------------
alter table public.languages enable row level security;
alter table public.language_labels enable row level security;
alter table public.language_label_rules enable row level security;
alter table public.anime enable row level security;
alter table public.anime_relations enable row level security;
alter table public.seasons enable row level security;
alter table public.providers enable row level security;
alter table public.episode_sources enable row level security;
alter table public.source_reports enable row level security;
alter table public.sync_state enable row level security;
alter table public.episode_tombstones enable row level security;
revoke all on public.languages, public.language_labels, public.language_label_rules, public.anime, public.anime_relations,
  public.seasons, public.providers, public.episode_sources, public.source_reports, public.sync_state, public.episode_tombstones from anon, authenticated;

drop policy if exists "episodes_lecture_publique" on public.episodes;
create policy "episodes_lecture_publique" on public.episodes for select to anon, authenticated using (published or public.is_admin());
-- Toute lecture passe par les fonctions publiques (contrôle des sources, de l'accès anticipé et des adultes) :
-- plus aucun accès direct à la table, ni aux anciennes adresses vidéo v7 qu'elle contient.
revoke all on public.episodes from anon, authenticated;

-- ---------------------------------------------------------
-- Lecture publique
-- ---------------------------------------------------------
create or replace function public.viewer_is_premium() returns boolean
language sql security definer stable set search_path = public, pg_temp as $$
  select coalesce((select p.premium_tier is not null and (p.premium_until is null or p.premium_until > now())
                     from public.profiles p where p.id = auth.uid()), false);
$$;
create or replace function public.playable_source(s public.episode_sources, p public.providers) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select s.published and s.status = 'ready' and not s.needs_review and p.active and s.embed_url is not null
     and ((p.kind = 'direct' and cardinality(p.hosts) = 0)
          or lower(substring(s.embed_url from '^https://([^/?#]+)')) = any (p.hosts));
$$;

-- Liste des épisodes jouables d'un anime, groupés par saison, avec les libellés disponibles.
create or replace function public.public_episode_list(p_anilist integer) returns jsonb
language plpgsql security definer stable set search_path = public, pg_temp as $$
declare
  v_adult boolean;
  v_premium boolean := public.viewer_is_premium();
begin
  select is_adult into v_adult from public.anime where anilist_id = p_anilist;
  if coalesce(v_adult, true) then return jsonb_build_object('ok', true, 'anilist_id', p_anilist, 'seasons', '[]'::jsonb); end if;
  return jsonb_build_object('ok', true, 'anilist_id', p_anilist, 'seasons', coalesce((
    select jsonb_agg(jsonb_build_object('number', se.number, 'title', coalesce(nullif(se.title, ''), (select title_display from public.anime where anilist_id = se.media_anilist_id), ''),
                                        'episodes', se.eps) order by (se.number = 0), se.number)
      from (
        select s.number, s.title, s.media_anilist_id, (
          select jsonb_agg(jsonb_build_object('season', e.season, 'number', e.number, 'kind', e.kind, 'title', e.title,
                                              'duration_sec', e.duration_sec, 'labels', lab.labels,
                                              'premium_until', case when e.premium_until > now() and not v_premium then e.premium_until end) order by e.number)
            from public.episodes e
            cross join lateral (
              select jsonb_agg(x.code order by x.sort) as labels from (
                select distinct l.code, l.sort
                  from public.episode_sources src
                  join public.providers pr on pr.key = src.provider_key
                  join public.language_labels l on l.code = public.language_label(src.audio_kind, src.audio_lang, src.subtitle_kind, src.subtitle_lang)
                 where src.episode_id = e.id and public.playable_source(src, pr)) x
            ) lab
           where e.anilist_id = p_anilist and e.season = s.number and e.published and lab.labels is not null
        ) as eps
        from public.seasons s where s.anilist_id = p_anilist
      ) se where se.eps is not null), '[]'::jsonb));
end $$;

-- Un épisode à lire : ses langues disponibles, et pour chacune les lecteurs triés par priorité.
create or replace function public.public_episode_playback(p_anilist integer, p_season integer, p_number integer) returns jsonb
language plpgsql security definer stable set search_path = public, pg_temp as $$
declare
  e public.episodes;
  v_langs jsonb;
  v_prev jsonb;
  v_next jsonb;
begin
  if exists (select 1 from public.anime where anilist_id = p_anilist and is_adult) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select * into e from public.episodes
   where anilist_id = p_anilist and season = p_season and number = p_number and published;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if e.premium_until > now() and not public.viewer_is_premium() then
    return jsonb_build_object('ok', false, 'reason', 'premium_only', 'until', e.premium_until,
      'episode', jsonb_build_object('season', e.season, 'number', e.number, 'kind', e.kind, 'title', e.title));
  end if;

  select jsonb_agg(jsonb_build_object('code', g.code, 'name', g.name_fr, 'sources', g.sources) order by g.sort) into v_langs
    from (
      select l.code, l.name_fr, l.sort,
             jsonb_agg(jsonb_build_object('id', s.id, 'provider', p.key, 'provider_name', p.name, 'kind', p.kind,
                                          'url', s.embed_url, 'subtitle_kind', s.subtitle_kind, 'sandbox', p.sandbox, 'hosts', to_jsonb(p.hosts))
                       order by coalesce(s.priority, p.priority) desc, s.updated_at desc) as sources
        from public.episode_sources s
        join public.providers p on p.key = s.provider_key
        join public.language_labels l on l.code = public.language_label(s.audio_kind, s.audio_lang, s.subtitle_kind, s.subtitle_lang)
       where s.episode_id = e.id and public.playable_source(s, p)
       group by l.code, l.name_fr, l.sort
    ) g;
  if v_langs is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  with playable as (
    select x.season, x.number, x.kind from public.episodes x
     where x.anilist_id = p_anilist and x.published
       and exists (select 1 from public.episode_sources s join public.providers p on p.key = s.provider_key
                    where s.episode_id = x.id and public.playable_source(s, p))
  )
  select (select jsonb_build_object('season', season, 'number', number, 'kind', kind) from playable
           where ((season = 0)::int, season, number) < ((e.season = 0)::int, e.season, e.number)
           order by (season = 0) desc, season desc, number desc limit 1),
         (select jsonb_build_object('season', season, 'number', number, 'kind', kind) from playable
           where ((season = 0)::int, season, number) > ((e.season = 0)::int, e.season, e.number)
           order by (season = 0), season, number limit 1)
    into v_prev, v_next;

  return jsonb_build_object('ok', true,
    'episode', jsonb_build_object('season', e.season, 'number', e.number, 'kind', e.kind, 'title', e.title, 'duration_sec', e.duration_sec,
                                  'premium_until', case when e.premium_until > now() then e.premium_until end),
    'prev', v_prev, 'next', v_next, 'languages', v_langs);
end $$;

-- Aperçu réservé aux administrateurs (bouton « Tester ») : même format que la lecture publique, mais
-- avec les sources non publiées ou « à vérifier » (jamais les sources désactivées), sans contrôle Premium.
create or replace function public.admin_episode_playback(p_anilist integer, p_season integer, p_number integer) returns jsonb
language plpgsql security definer stable set search_path = public, pg_temp as $$
declare
  e public.episodes;
  v_langs jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into e from public.episodes where anilist_id = p_anilist and season = p_season and number = p_number;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select jsonb_agg(jsonb_build_object('code', g.code, 'name', g.name_fr, 'sources', g.sources) order by g.sort) into v_langs
    from (
      select l.code, l.name_fr, l.sort,
             jsonb_agg(jsonb_build_object('id', s.id, 'provider', p.key, 'provider_name', p.name, 'kind', p.kind,
                                          'url', s.embed_url, 'subtitle_kind', s.subtitle_kind, 'sandbox', p.sandbox, 'hosts', to_jsonb(p.hosts),
                                          'published', s.published, 'needs_review', s.needs_review, 'status', s.status)
                       order by coalesce(s.priority, p.priority) desc, s.updated_at desc) as sources
        from public.episode_sources s
        join public.providers p on p.key = s.provider_key
        join public.language_labels l on l.code = public.language_label(s.audio_kind, s.audio_lang, s.subtitle_kind, s.subtitle_lang)
       where s.episode_id = e.id and s.status <> 'disabled' and s.embed_url is not null
       group by l.code, l.name_fr, l.sort
    ) g;
  if v_langs is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'preview', true,
    'episode', jsonb_build_object('season', e.season, 'number', e.number, 'kind', e.kind, 'title', e.title, 'duration_sec', e.duration_sec,
                                  'premium_until', e.premium_until),
    'prev', null, 'next', null, 'languages', v_langs);
end $$;

-- Disponibilité pour une liste d'animes (bouton « Regarder », badges de langue). Un identifiant qui
-- correspond à la saison N d'une autre série renvoie cette série et ce numéro de saison.
create or replace function public.public_available_animes(p_ids integer[]) returns jsonb
language sql security definer stable set search_path = public, pg_temp as $$
  with asked as (
    select distinct t.id from (select unnest(p_ids) as id limit 100) t where cardinality(p_ids) <= 1000
  ), target as (
    select a.id as asked, coalesce(s.anilist_id, a.id) as root, s.number as season
      from asked a
      left join public.seasons s on s.media_anilist_id = a.id and s.anilist_id <> a.id
  ), eps as (
    select t.asked, t.root, t.season, e.season as ep_season, e.number, l.code, l.sort
      from target t
      join public.anime an on an.anilist_id = t.root and not an.is_adult
      join public.episodes e on e.anilist_id = t.root and e.published and (t.season is null or e.season = t.season)
      join public.episode_sources src on src.episode_id = e.id
      join public.providers pr on pr.key = src.provider_key
      join public.language_labels l on l.code = public.language_label(src.audio_kind, src.audio_lang, src.subtitle_kind, src.subtitle_lang)
     where public.playable_source(src, pr)
  )
  select coalesce(jsonb_agg(r), '[]'::jsonb) from (
    select x.asked as anilist_id, x.root, x.season,
           (select jsonb_agg(distinct_l.code order by distinct_l.sort) from (select distinct code, sort from eps where eps.asked = x.asked) distinct_l) as labels,
           (select jsonb_object_agg(c.code, c.n) from (select code, count(distinct (ep_season, number)) as n from eps where eps.asked = x.asked group by code) c) as counts,
           (select count(distinct (ep_season, number)) from eps where eps.asked = x.asked) as total,
           (select jsonb_build_object('season', f.ep_season, 'number', f.number) from eps f where f.asked = x.asked
             order by (f.ep_season = 0), f.ep_season, f.number limit 1) as first
      from (select distinct asked, root, season from eps) x
  ) r;
$$;

-- ---------------------------------------------------------
-- Signalement d'un lecteur cassé (par le Worker, limité par visiteur)
-- ---------------------------------------------------------
create or replace function public.svc_report_source(p_reporter text, p_source uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_new integer;
begin
  if p_reporter is null or char_length(p_reporter) not between 3 and 80 then return jsonb_build_object('ok', false, 'reason', 'missing_voter'); end if;
  if not exists (select 1 from public.episode_sources s join public.providers p on p.key = s.provider_key
                  where s.id = p_source and public.playable_source(s, p)) then
    return jsonb_build_object('ok', false, 'reason', 'source_not_found');
  end if;
  insert into public.source_reports (source_id, reporter, day)
  values (p_source, p_reporter, (now() at time zone 'Europe/Paris')::date) on conflict do nothing;
  get diagnostics v_new = row_count;
  if v_new > 0 then
    update public.episode_sources set reports = reports + 1, last_report_at = now() where id = p_source;
  end if;
  if random() < 0.02 then delete from public.source_reports where day < (now() at time zone 'Europe/Paris')::date - 30; end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------
-- Administration (réservée à is_admin(), réponses {ok:false, reason} traduites côté site)
-- ---------------------------------------------------------
create or replace function public.admin_episode_overview(p_search text, p_filter text, p_offset integer, p_limit integer) returns jsonb
language plpgsql security definer stable set search_path = public, pg_temp as $$
declare
  v_search text := lower(btrim(coalesce(p_search, '')));
  v_filter text := coalesce(p_filter, 'all');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_items jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  with ids as (
    select a.anilist_id, a.title_display from public.anime a
     where not exists (select 1 from public.seasons s where s.media_anilist_id = a.anilist_id and s.anilist_id <> a.anilist_id)
       and (v_search = '' or a.anilist_id::text = v_search
            or position(v_search in lower(a.title_display)) > 0
            or position(v_search in lower(coalesce(a.title_romaji, ''))) > 0
            or position(v_search in lower(coalesce(a.title_english, ''))) > 0
            or exists (select 1 from unnest(a.synonyms) syn where position(v_search in lower(syn)) > 0))
       and case v_filter
             when 'review' then exists (select 1 from public.episodes e join public.episode_sources s on s.episode_id = e.id
                                         where e.anilist_id = a.anilist_id and s.needs_review)
             when 'failed' then exists (select 1 from public.episodes e join public.episode_sources s on s.episode_id = e.id
                                         where e.anilist_id = a.anilist_id and s.status = 'failed')
             when 'reports' then exists (select 1 from public.episodes e join public.episode_sources s on s.episode_id = e.id
                                          where e.anilist_id = a.anilist_id and s.reports > 0 and s.status <> 'disabled')
             when 'missing' then exists (select 1 from public.episodes e where e.anilist_id = a.anilist_id
                                          and not exists (select 1 from public.episode_sources s where s.episode_id = e.id and s.status <> 'disabled'))
             else true end
  ), page as (
    select an.* from public.anime an join ids on ids.anilist_id = an.anilist_id
     order by lower(an.title_display), an.anilist_id offset v_offset limit v_limit
  )
  select (select count(*) from ids),
         (select jsonb_agg(jsonb_build_object('anilist_id', a.anilist_id, 'title', a.title_display, 'cover', a.cover,
             'status', a.status, 'episodes_total', a.episodes, 'next_airing_episode', a.next_airing_episode,
             'original_lang', a.original_lang, 'last_synced_at', a.last_synced_at, 'sync_error', a.sync_error,
             'episode_count', c.episode_count, 'missing', c.missing, 'ready', c.ready, 'failed', c.failed,
             'review', c.review, 'reports', c.reports) order by lower(a.title_display), a.anilist_id)
            from page a
            cross join lateral (
              select count(distinct e.id) as episode_count,
                     count(distinct e.id) filter (where not exists (select 1 from public.episode_sources x where x.episode_id = e.id and x.status <> 'disabled')) as missing,
                     count(s.id) filter (where s.status = 'ready' and s.published) as ready,
                     count(s.id) filter (where s.status = 'failed') as failed,
                     count(s.id) filter (where s.needs_review) as review,
                     coalesce(sum(s.reports) filter (where s.status <> 'disabled'), 0) as reports
                from public.episodes e left join public.episode_sources s on s.episode_id = e.id
               where e.anilist_id = a.anilist_id
            ) c)
    into v_total, v_items;
  return jsonb_build_object('ok', true, 'total', v_total, 'items', coalesce(v_items, '[]'::jsonb));
end $$;

create or replace function public.admin_episode_tree(p_anilist integer) returns jsonb
language plpgsql security definer stable set search_path = public, pg_temp as $$
declare a public.anime;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into a from public.anime where anilist_id = p_anilist;
  if not found then return jsonb_build_object('ok', false, 'reason', 'anime_unknown'); end if;
  return jsonb_build_object('ok', true,
    'anime', to_jsonb(a),
    'relations', coalesce((select jsonb_agg(jsonb_build_object('to_id', r.to_id, 'relation', r.relation, 'format', r.to_format, 'title', r.to_title,
        'mapped_season', (select s.number from public.seasons s where s.anilist_id = p_anilist and s.media_anilist_id = r.to_id))
        order by r.relation, r.to_id) from public.anime_relations r where r.from_id = p_anilist), '[]'::jsonb),
    'seasons', coalesce((select jsonb_agg(jsonb_build_object(
        'number', s.number, 'media_anilist_id', s.media_anilist_id, 'title', s.title, 'episode_offset', s.episode_offset,
        'media', (select jsonb_build_object('title', m.title_display, 'status', m.status, 'episodes', m.episodes,
                    'next_airing_episode', m.next_airing_episode, 'last_synced_at', m.last_synced_at)
                    from public.anime m where m.anilist_id = s.media_anilist_id),
        'episodes', coalesce((select jsonb_agg(jsonb_build_object(
            'id', e.id, 'season', e.season, 'number', e.number, 'kind', e.kind, 'title', e.title, 'duration_sec', e.duration_sec,
            'published', e.published, 'premium_until', e.premium_until, 'legacy_url', e.video_url,
            'sources', coalesce((select jsonb_agg(jsonb_build_object(
                'id', src.id, 'provider', src.provider_key, 'provider_name', pr.name, 'provider_video_id', src.provider_video_id,
                'url', src.embed_url, 'audio_lang', src.audio_lang, 'audio_kind', src.audio_kind,
                'subtitle_lang', src.subtitle_lang, 'subtitle_kind', src.subtitle_kind,
                'label', public.language_label(src.audio_kind, src.audio_lang, src.subtitle_kind, src.subtitle_lang),
                'status', src.status, 'published', src.published, 'publish_requested', src.publish_requested, 'playable', public.playable_source(src, pr),
                'needs_review', src.needs_review, 'review_reason', src.review_reason, 'lang_origin', src.lang_origin,
                'priority', src.priority, 'rights_basis', src.rights_basis, 'rights_note', src.rights_note,
                'last_error', src.last_error, 'last_checked_at', src.last_checked_at, 'reports', src.reports,
                'last_report_at', src.last_report_at, 'updated_at', src.updated_at)
                order by public.language_label(src.audio_kind, src.audio_lang, src.subtitle_kind, src.subtitle_lang), coalesce(src.priority, pr.priority) desc)
              from public.episode_sources src join public.providers pr on pr.key = src.provider_key
             where src.episode_id = e.id), '[]'::jsonb))
            order by e.number) from public.episodes e where e.anilist_id = p_anilist and e.season = s.number), '[]'::jsonb))
        order by (s.number = 0), s.number) from public.seasons s where s.anilist_id = p_anilist), '[]'::jsonb));
end $$;

-- Ajout ou mise à jour d'un anime à partir des données AniList lues par le navigateur de l'admin.
-- Crée la saison 1, détecte un changement de titre, et (option) crée les épisodes déjà diffusés
-- qui manquent (sans source : invisibles pour le public tant qu'aucune source n'est ajoutée).
create or replace function public.admin_sync_anime(p_data jsonb, p_create_missing boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id integer;
  v_old text;
  v_title text;
  v_country text;
  v_status text;
  v_episodes integer;
  v_next integer;
  v_aired integer;
  v_created integer := 0;
  v_n integer;
  s record;
  r jsonb;
  img text;
  ban text;
  v_old_lang text;
  v_new_lang text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if jsonb_typeof(p_data) <> 'object' or jsonb_typeof(p_data -> 'id') <> 'number' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_anime');
  end if;
  v_id := (p_data ->> 'id')::integer;
  if v_id is null or v_id < 1 or v_id > 10000000 then return jsonb_build_object('ok', false, 'reason', 'invalid_anime'); end if;

  v_title := left(btrim(coalesce(p_data #>> '{title,english}', p_data #>> '{title,romaji}', p_data #>> '{title,native}', '')), 300);
  v_country := upper(nullif(p_data ->> 'countryOfOrigin', ''));
  if v_country !~ '^[A-Z]{2}$' then v_country := null; end if;
  v_status := p_data ->> 'status';
  if v_status not in ('FINISHED', 'RELEASING', 'NOT_YET_RELEASED', 'CANCELLED', 'HIATUS') then v_status := null; end if;
  v_episodes := case when jsonb_typeof(p_data -> 'episodes') = 'number' then least(greatest((p_data ->> 'episodes')::integer, 0), 5000) end;
  v_next := case when jsonb_typeof(p_data #> '{nextAiringEpisode,episode}') = 'number'
                 then least(greatest((p_data #>> '{nextAiringEpisode,episode}')::integer, 0), 5000) end;
  img := p_data #>> '{coverImage,large}';
  if img !~ '^https://s4\.anilist\.co/[^\s"<>]+$' then img := null; end if;
  ban := p_data ->> 'bannerImage';
  if ban !~ '^https://s4\.anilist\.co/[^\s"<>]+$' then ban := null; end if;

  select title_display, original_lang into v_old, v_old_lang from public.anime where anilist_id = v_id;

  insert into public.anime as a (anilist_id, id_mal, title_display, title_romaji, title_english, title_native, synonyms, cover, banner,
    format, status, episodes, duration_min, season, season_year, genres, country_of_origin, original_lang, is_adult,
    next_airing_episode, next_airing_at, anilist_updated_at, last_synced_at, sync_requested_at, sync_error, updated_at)
  values (v_id,
    case when jsonb_typeof(p_data -> 'idMal') = 'number' and (p_data ->> 'idMal')::bigint between 1 and 10000000 then (p_data ->> 'idMal')::integer end,
    v_title,
    left(p_data #>> '{title,romaji}', 300), left(p_data #>> '{title,english}', 300), left(p_data #>> '{title,native}', 300),
    coalesce((select array_agg(left(x, 300)) from (select jsonb_array_elements_text(case when jsonb_typeof(p_data -> 'synonyms') = 'array' then p_data -> 'synonyms' else '[]'::jsonb end) x limit 50) t), '{}'),
    img, ban,
    case when p_data ->> 'format' ~ '^[A-Z_]{1,20}$' then p_data ->> 'format' end,
    v_status, v_episodes,
    case when jsonb_typeof(p_data -> 'duration') = 'number' and (p_data ->> 'duration')::integer between 1 and 1440 then (p_data ->> 'duration')::integer end,
    case when p_data ->> 'season' in ('WINTER', 'SPRING', 'SUMMER', 'FALL') then p_data ->> 'season' end,
    case when jsonb_typeof(p_data -> 'seasonYear') = 'number' and (p_data ->> 'seasonYear')::integer between 1900 and 2200 then (p_data ->> 'seasonYear')::integer end,
    coalesce((select array_agg(left(x, 40)) from (select jsonb_array_elements_text(case when jsonb_typeof(p_data -> 'genres') = 'array' then p_data -> 'genres' else '[]'::jsonb end) x limit 30) t), '{}'),
    v_country, public.lang_from_country(v_country),
    coalesce((p_data ->> 'isAdult')::boolean, false),
    v_next,
    case when jsonb_typeof(p_data #> '{nextAiringEpisode,airingAt}') = 'number' then to_timestamp((p_data #>> '{nextAiringEpisode,airingAt}')::bigint) end,
    case when jsonb_typeof(p_data -> 'updatedAt') = 'number' then to_timestamp((p_data ->> 'updatedAt')::bigint) end,
    now(), null, null, now())
  on conflict (anilist_id) do update set
    id_mal = excluded.id_mal, title_display = case when excluded.title_display <> '' then excluded.title_display else a.title_display end,
    title_romaji = excluded.title_romaji, title_english = excluded.title_english, title_native = excluded.title_native,
    synonyms = (select coalesce(array_agg(t.x), '{}') from (
                  select distinct u.x from (
                    select unnest(excluded.synonyms) x
                    union select a.title_display where a.title_display <> '' and a.title_display <> excluded.title_display) u
                  where u.x is not null and u.x <> '' limit 60) t),
    cover = excluded.cover, banner = excluded.banner, format = excluded.format, status = excluded.status,
    episodes = excluded.episodes, duration_min = excluded.duration_min, season = excluded.season, season_year = excluded.season_year,
    genres = excluded.genres, country_of_origin = excluded.country_of_origin,
    original_lang = case when a.original_lang_source = 'admin' then a.original_lang else excluded.original_lang end,
    is_adult = excluded.is_adult, next_airing_episode = excluded.next_airing_episode, next_airing_at = excluded.next_airing_at,
    anilist_updated_at = excluded.anilist_updated_at, last_synced_at = now(), sync_requested_at = null, sync_error = null, updated_at = now();

  if jsonb_typeof(p_data #> '{relations,edges}') = 'array' then
    delete from public.anime_relations where from_id = v_id;
    for r in select * from jsonb_array_elements(p_data #> '{relations,edges}') limit 100 loop
      if jsonb_typeof(r #> '{node,id}') = 'number' and (r ->> 'relationType') ~ '^[A-Z_]{2,20}$'
         and coalesce(r #>> '{node,type}', 'ANIME') = 'ANIME' then
        insert into public.anime_relations (from_id, to_id, relation, to_format, to_title)
        values (v_id, (r #>> '{node,id}')::integer, r ->> 'relationType',
                case when r #>> '{node,format}' ~ '^[A-Z_]{1,20}$' then r #>> '{node,format}' end,
                left(coalesce(r #>> '{node,title,english}', r #>> '{node,title,romaji}'), 300))
        on conflict do nothing;
      end if;
    end loop;
  end if;

  -- Langue d'origine modifiée par la synchro : les sources de l'anime sont revérifiées (et republiées si valides)
  select original_lang into v_new_lang from public.anime where anilist_id = v_id;
  if v_new_lang is distinct from v_old_lang then
    perform set_config('luma.revalidate', '1', true);
    update public.episode_sources es set updated_at = now()
      from public.episodes ep where ep.id = es.episode_id and ep.anilist_id = v_id;
    perform set_config('luma.revalidate', '0', true);
  end if;

  -- Fiche racine sans saison : elle devient sa propre saison 1 (sauf si elle est déjà la saison d'une autre série)
  if not exists (select 1 from public.seasons where media_anilist_id = v_id)
     and not exists (select 1 from public.seasons where anilist_id = v_id and number = 1) then
    insert into public.seasons (anilist_id, number, media_anilist_id) values (v_id, 1, v_id) on conflict do nothing;
  end if;

  if coalesce(p_create_missing, false) and not coalesce((p_data ->> 'isAdult')::boolean, false) then
    -- En cours sans prochaine diffusion connue : on attend la date (jamais d'épisodes futurs créés)
    v_aired := case when v_status = 'FINISHED' then v_episodes
                    when v_status = 'RELEASING' and v_next is not null then v_next - 1
                    else 0 end;
    v_aired := least(greatest(coalesce(v_aired, 0), 0), 2000);
    for s in select * from public.seasons where media_anilist_id = v_id loop
      for v_n in 1 .. v_aired loop
        continue when exists (select 1 from public.episode_tombstones t
                               where t.anilist_id = s.anilist_id and t.season = s.number and t.number = v_n + s.episode_offset);
        insert into public.episodes (anilist_id, anime_title, season, number, title, kind, published)
        values (s.anilist_id, coalesce((select title_display from public.anime where anilist_id = s.anilist_id), ''), s.number, v_n + s.episode_offset, '', 'episode', true)
        on conflict (anilist_id, season, number) do nothing;
        if found then v_created := v_created + 1; end if;
      end loop;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'anilist_id', v_id, 'created', v_created,
    'title_changed', v_old is not null and v_old <> '' and v_title <> '' and v_old <> v_title);
end $$;

-- Animes à resynchroniser (jamais faits, demandés, en cours de diffusion depuis 6 h, les autres depuis 7 jours)
create or replace function public.admin_animes_to_sync(p_limit integer) returns jsonb
language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'ids', coalesce((
    select jsonb_agg(x.id) from (
      select ids.id from (
        select a.anilist_id as id, a.last_synced_at, a.sync_requested_at, a.status from public.anime a
        union
        select s.media_anilist_id, m.last_synced_at, m.sync_requested_at, m.status
          from public.seasons s left join public.anime m on m.anilist_id = s.media_anilist_id
         where s.media_anilist_id is not null
      ) ids
      where ids.last_synced_at is null or ids.sync_requested_at is not null
         or (ids.status in ('RELEASING', 'NOT_YET_RELEASED') and ids.last_synced_at < now() - interval '6 hours')
         or ids.last_synced_at < now() - interval '7 days'
      order by ids.sync_requested_at nulls last, ids.last_synced_at nulls first
      limit least(greatest(coalesce(p_limit, 50), 1), 500)) x), '[]'::jsonb));
end $$;

-- Fiche introuvable ou refusée par AniList : l'échec est noté pour ne pas la retenter en boucle
create or replace function public.admin_sync_failed(p_anilist integer, p_message text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_anilist is null or p_anilist not between 1 and 10000000 then return jsonb_build_object('ok', false, 'reason', 'invalid_anime'); end if;
  insert into public.anime as a (anilist_id, last_synced_at, sync_error, sync_requested_at)
  values (p_anilist, now(), left(coalesce(p_message, 'échec'), 300), null)
  on conflict (anilist_id) do update set last_synced_at = now(), sync_error = left(coalesce(p_message, 'échec'), 300),
    sync_requested_at = null, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- Début d'un passage de synchro : refusé si un autre passage a commencé il y a moins de 10 minutes
create or replace function public.admin_sync_begin() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  insert into public.sync_state (key) values ('anilist') on conflict (key) do nothing;
  update public.sync_state set running_since = now(), last_started_at = now()
   where key = 'anilist' and (running_since is null or running_since < now() - interval '10 minutes');
  if not found then return jsonb_build_object('ok', false, 'reason', 'sync_running'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_request_sync(p_anilist integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  update public.anime set sync_requested_at = now() where anilist_id = p_anilist;
  return jsonb_build_object('ok', found);
end $$;

create or replace function public.admin_sync_log(p_ok boolean, p_error text, p_info jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  insert into public.sync_state as st (key, last_started_at, last_success_at, last_error, info, updated_at)
  values ('anilist', now(), case when p_ok then now() end, case when not p_ok then left(p_error, 500) end,
          case when jsonb_typeof(p_info) = 'object' then p_info else '{}'::jsonb end, now())
  on conflict (key) do update set last_started_at = coalesce(st.running_since, st.last_started_at, now()), running_since = null,
    last_success_at = case when p_ok then now() else st.last_success_at end,
    last_error = case when p_ok then null else left(p_error, 500) end,
    info = excluded.info, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_sync_status() returns jsonb
language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'state', (select to_jsonb(s) from public.sync_state s where key = 'anilist'));
end $$;

create or replace function public.admin_set_anime_lang(p_anilist integer, p_lang text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_lang is not null and not exists (select 1 from public.languages where code = p_lang and code not in ('und', 'mul')) then
    return jsonb_build_object('ok', false, 'reason', 'language_unknown');
  end if;
  update public.anime set original_lang = coalesce(p_lang, public.lang_from_country(country_of_origin)),
    original_lang_source = case when p_lang is null then 'auto' else 'admin' end,
    updated_at = now() where anilist_id = p_anilist;
  if not found then return jsonb_build_object('ok', false, 'reason', 'anime_unknown'); end if;
  perform set_config('luma.revalidate', '1', true);
  update public.episode_sources s set updated_at = now()
    from public.episodes e where e.id = s.episode_id and e.anilist_id = p_anilist;
  perform set_config('luma.revalidate', '0', true);
  perform public.log_admin(null, 'anime_langue', jsonb_build_object('anilist', p_anilist, 'lang', p_lang));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_upsert_season(p_anilist integer, p_number integer, p_media integer, p_title text, p_offset integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if not exists (select 1 from public.anime where anilist_id = p_anilist) then return jsonb_build_object('ok', false, 'reason', 'anime_unknown'); end if;
  if p_number is null or p_number not between 0 and 99 or coalesce(p_offset, 0) not between 0 and 5000
     or (p_media is not null and p_media not between 1 and 10000000) then
    return jsonb_build_object('ok', false, 'reason', 'season_invalid');
  end if;
  if p_media is not null and p_media <> p_anilist and exists (
       select 1 from public.episodes e join public.episode_sources s on s.episode_id = e.id where e.anilist_id = p_media) then
    return jsonb_build_object('ok', false, 'reason', 'media_has_episodes');
  end if;
  if exists (select 1 from public.seasons where anilist_id = p_anilist and number = p_number and episode_offset <> coalesce(p_offset, 0))
     and exists (select 1 from public.episodes where anilist_id = p_anilist and season = p_number) then
    return jsonb_build_object('ok', false, 'reason', 'season_offset_locked');
  end if;
  -- Une fiche AniList synchronisée seule a reçu sa propre saison 1 et parfois des épisodes vides (sans source) :
  -- elle devient la saison d'une autre série, ces éléments vides sont retirés
  if p_media is not null and p_media <> p_anilist then
    delete from public.episodes where anilist_id = p_media;
    delete from public.seasons where anilist_id = p_media;
  end if;
  begin
    insert into public.seasons (anilist_id, number, media_anilist_id, title, episode_offset)
    values (p_anilist, p_number, p_media, left(coalesce(p_title, ''), 200), coalesce(p_offset, 0))
    on conflict (anilist_id, number) do update set media_anilist_id = excluded.media_anilist_id, title = excluded.title,
      episode_offset = excluded.episode_offset, updated_at = now();
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'media_already_used');
  end;
  perform public.log_admin(null, 'saison', jsonb_build_object('anilist', p_anilist, 'season', p_number, 'media', p_media));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_delete_season(p_anilist integer, p_number integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if exists (select 1 from public.episodes where anilist_id = p_anilist and season = p_number) then
    return jsonb_build_object('ok', false, 'reason', 'season_not_empty');
  end if;
  delete from public.seasons where anilist_id = p_anilist and number = p_number;
  if not found then return jsonb_build_object('ok', false, 'reason', 'season_not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;

drop function if exists public.admin_upsert_episode(uuid, integer, integer, integer, text, text, integer, boolean);
create or replace function public.admin_upsert_episode(p_id uuid, p_anilist integer, p_season integer, p_number integer,
  p_kind text, p_title text, p_duration_sec integer, p_published boolean, p_premium_until timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if not exists (select 1 from public.anime where anilist_id = p_anilist) then return jsonb_build_object('ok', false, 'reason', 'anime_unknown'); end if;
  if p_season is null or p_season not between 0 and 99 or p_number is null or p_number not between 0 and 5000
     or coalesce(p_kind, 'episode') not in ('episode', 'special', 'ova', 'ona', 'movie', 'recap')
     or (p_duration_sec is not null and p_duration_sec not between 1 and 86400) then
    return jsonb_build_object('ok', false, 'reason', 'episode_invalid');
  end if;
  insert into public.seasons (anilist_id, number) values (p_anilist, p_season) on conflict do nothing;
  delete from public.episode_tombstones where anilist_id = p_anilist and season = p_season and number = p_number;
  begin
    if p_id is null then
      insert into public.episodes (anilist_id, anime_title, season, number, title, kind, duration_sec, published, premium_until)
      values (p_anilist, coalesce((select title_display from public.anime where anilist_id = p_anilist), ''), p_season, p_number,
              left(btrim(coalesce(p_title, '')), 200), coalesce(p_kind, 'episode'), p_duration_sec, coalesce(p_published, true), p_premium_until)
      returning id into v_id;
    else
      update public.episodes set anilist_id = p_anilist, season = p_season, number = p_number, title = left(btrim(coalesce(p_title, '')), 200),
        kind = coalesce(p_kind, 'episode'), duration_sec = p_duration_sec, published = coalesce(p_published, true),
        premium_until = p_premium_until
       where id = p_id returning id into v_id;
      if v_id is null then return jsonb_build_object('ok', false, 'reason', 'episode_not_found'); end if;
    end if;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'episode_exists');
  end;
  perform public.log_admin(null, 'episode', jsonb_build_object('anilist', p_anilist, 'season', p_season, 'number', p_number));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.admin_add_episode_range(p_anilist integer, p_season integer, p_from integer, p_to integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_created integer := 0; v_n integer;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if not exists (select 1 from public.anime where anilist_id = p_anilist) then return jsonb_build_object('ok', false, 'reason', 'anime_unknown'); end if;
  if p_season is null or p_season not between 0 and 99 or p_from is null or p_to is null
     or p_from not between 0 and 5000 or p_to not between p_from and least(p_from + 499, 5000) then
    return jsonb_build_object('ok', false, 'reason', 'range_invalid');
  end if;
  insert into public.seasons (anilist_id, number) values (p_anilist, p_season) on conflict do nothing;
  delete from public.episode_tombstones where anilist_id = p_anilist and season = p_season and number between p_from and p_to;
  for v_n in p_from .. p_to loop
    insert into public.episodes (anilist_id, anime_title, season, number, title)
    values (p_anilist, coalesce((select title_display from public.anime where anilist_id = p_anilist), ''), p_season, v_n, '')
    on conflict (anilist_id, season, number) do nothing;
    if found then v_created := v_created + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'created', v_created);
end $$;

create or replace function public.admin_delete_episode(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.episodes;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  delete from public.episodes where id = p_id returning * into e;
  if e.id is null then return jsonb_build_object('ok', false, 'reason', 'episode_not_found'); end if;
  insert into public.episode_tombstones (anilist_id, season, number) values (e.anilist_id, e.season, e.number)
  on conflict do nothing;
  perform public.log_admin(null, 'episode_supprime', jsonb_build_object('anilist', e.anilist_id, 'season', e.season, 'number', e.number));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_upsert_source(p_id uuid, p_episode uuid, p_provider text, p_video_id text, p_url text,
  p_audio_lang text, p_audio_kind text, p_subtitle_lang text, p_subtitle_kind text, p_rights_basis text, p_rights_note text,
  p_priority integer, p_published boolean, p_status text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.episode_sources;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if coalesce(p_status, 'ready') not in ('pending', 'ready', 'failed', 'disabled') then return jsonb_build_object('ok', false, 'reason', 'status_invalid'); end if;
  if nullif(btrim(coalesce(p_video_id, '')), '') is null and nullif(btrim(coalesce(p_url, '')), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'source_empty');
  end if;
  begin
    if p_id is null then
      insert into public.episode_sources (episode_id, provider_key, provider_video_id, embed_url, audio_lang, audio_kind, subtitle_lang,
        subtitle_kind, lang_origin, status, publish_requested, priority, rights_basis, rights_note, created_by)
      values (p_episode, p_provider, nullif(btrim(p_video_id), ''), nullif(btrim(p_url), ''), p_audio_lang, p_audio_kind,
        nullif(p_subtitle_lang, ''), coalesce(p_subtitle_kind, 'none'), 'admin', coalesce(p_status, 'ready'), coalesce(p_published, true),
        p_priority, p_rights_basis, left(coalesce(p_rights_note, ''), 500), auth.uid())
      returning * into s;
    else
      update public.episode_sources set episode_id = coalesce(p_episode, episode_id), provider_key = p_provider,
        provider_video_id = nullif(btrim(p_video_id), ''), embed_url = nullif(btrim(p_url), ''),
        audio_lang = p_audio_lang, audio_kind = p_audio_kind, subtitle_lang = nullif(p_subtitle_lang, ''),
        subtitle_kind = coalesce(p_subtitle_kind, 'none'), lang_origin = 'admin', status = coalesce(p_status, 'ready'),
        publish_requested = coalesce(p_published, true), priority = p_priority, rights_basis = p_rights_basis,
        rights_note = left(coalesce(p_rights_note, ''), 500), last_error = case when coalesce(p_status, 'ready') = 'ready' then null else last_error end,
        reports = case when provider_key is distinct from p_provider or provider_video_id is distinct from nullif(btrim(p_video_id), '')
                         or embed_url is distinct from nullif(btrim(p_url), '') then 0 else reports end
       where id = p_id returning * into s;
      if s.reports = 0 then delete from public.source_reports where source_id = s.id; end if;
      if s.id is null then return jsonb_build_object('ok', false, 'reason', 'source_not_found'); end if;
    end if;
  exception
    when raise_exception then return jsonb_build_object('ok', false, 'reason', sqlerrm);
    when unique_violation then return jsonb_build_object('ok', false, 'reason', 'duplicate_source');
    when foreign_key_violation then return jsonb_build_object('ok', false, 'reason', 'source_invalid');
    when check_violation then return jsonb_build_object('ok', false, 'reason', 'source_invalid');
    when not_null_violation then return jsonb_build_object('ok', false, 'reason', 'source_invalid');
  end;
  perform public.log_admin(null, 'source', jsonb_build_object('source', s.id, 'provider', s.provider_key, 'lang', s.lang_key));
  return jsonb_build_object('ok', true, 'id', s.id, 'url', s.embed_url,
    'label', public.language_label(s.audio_kind, s.audio_lang, s.subtitle_kind, s.subtitle_lang),
    'needs_review', s.needs_review, 'review_reason', s.review_reason, 'published', s.published);
end $$;

create or replace function public.admin_delete_source(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.episode_sources;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  delete from public.episode_sources where id = p_id returning * into s;
  if s.id is null then return jsonb_build_object('ok', false, 'reason', 'source_not_found'); end if;
  perform public.log_admin(null, 'source_supprimee', jsonb_build_object('source', p_id, 'provider', s.provider_key));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_set_source_status(p_id uuid, p_status text, p_published boolean, p_clear_reports boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_status is not null and p_status not in ('pending', 'ready', 'failed', 'disabled') then return jsonb_build_object('ok', false, 'reason', 'status_invalid'); end if;
  if p_status = 'ready' and exists (select 1 from public.episode_sources where id = p_id and embed_url is null) then
    return jsonb_build_object('ok', false, 'reason', 'source_no_url');
  end if;
  begin
    update public.episode_sources set status = coalesce(p_status, status), publish_requested = coalesce(p_published, publish_requested),
      reports = case when coalesce(p_clear_reports, false) then 0 else reports end, last_checked_at = now()
     where id = p_id returning id into v_id;
  exception
    when raise_exception then return jsonb_build_object('ok', false, 'reason', sqlerrm);
    when unique_violation then return jsonb_build_object('ok', false, 'reason', 'duplicate_source');
    when check_violation then return jsonb_build_object('ok', false, 'reason', 'source_invalid');
  end;
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'source_not_found'); end if;
  if coalesce(p_clear_reports, false) then delete from public.source_reports where source_id = p_id; end if;
  return jsonb_build_object('ok', true);
end $$;

-- Précise en une fois la langue des sources « à vérifier » d'un anime (ex. anciens épisodes v7).
drop function if exists public.admin_bulk_qualify(integer, integer, text, text, text, text, text, boolean);
create or replace function public.admin_bulk_qualify(p_anilist integer, p_season integer, p_provider text, p_audio_lang text,
  p_audio_kind text, p_subtitle_lang text, p_subtitle_kind text, p_publish boolean, p_include_admin boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_audio_lang in ('und', 'mul') then return jsonb_build_object('ok', false, 'reason', 'language_unknown'); end if;
  if not exists (select 1 from public.anime where anilist_id = p_anilist and original_lang is not null) then
    return jsonb_build_object('ok', false, 'reason', 'original_lang_unknown');
  end if;
  begin
    update public.episode_sources s set audio_lang = p_audio_lang, audio_kind = p_audio_kind,
      subtitle_lang = nullif(p_subtitle_lang, ''), subtitle_kind = coalesce(p_subtitle_kind, 'none'),
      lang_origin = 'admin', review_reason = null, publish_requested = coalesce(p_publish, true)
      from public.episodes e
     where e.id = s.episode_id and e.anilist_id = p_anilist and (p_season is null or e.season = p_season)
       and (p_provider is null or s.provider_key = p_provider) and s.needs_review
       and (coalesce(p_include_admin, false) or s.lang_origin = 'legacy' or s.audio_lang in ('und', 'mul'));
    get diagnostics v_count = row_count;
  exception
    when raise_exception then return jsonb_build_object('ok', false, 'reason', sqlerrm);
    when unique_violation then return jsonb_build_object('ok', false, 'reason', 'duplicate_source');
    when check_violation then return jsonb_build_object('ok', false, 'reason', 'source_invalid');
    when foreign_key_violation then return jsonb_build_object('ok', false, 'reason', 'language_unknown');
  end;
  perform public.log_admin(null, 'sources_qualifiees', jsonb_build_object('anilist', p_anilist, 'count', v_count));
  return jsonb_build_object('ok', true, 'updated', v_count);
end $$;

create or replace function public.admin_list_providers() returns jsonb
language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((select jsonb_agg(to_jsonb(p) order by p.priority desc, p.name)
    from public.providers p), '[]'::jsonb));
end $$;

create or replace function public.admin_set_provider(p_key text, p_name text, p_kind text, p_priority integer, p_active boolean,
  p_hosts text[], p_template text, p_id_pattern text, p_sandbox boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare h text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_key !~ '^[a-z0-9_]{2,30}$' or char_length(btrim(coalesce(p_name, ''))) not between 1 and 40
     or p_kind not in ('embed', 'direct') or coalesce(p_priority, 0) not between -1000 and 1000
     or cardinality(coalesce(p_hosts, '{}')) > 20 then
    return jsonb_build_object('ok', false, 'reason', 'provider_invalid');
  end if;
  foreach h in array coalesce(p_hosts, '{}') loop
    if h !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then return jsonb_build_object('ok', false, 'reason', 'host_invalid'); end if;
    -- Une iframe du site lui-même pourrait lever son propre bac à sable
    if h = 'lumanime.online' or h like '%.lumanime.online' or h like '%.workers.dev' or h like '%.supabase.co' then
      return jsonb_build_object('ok', false, 'reason', 'host_forbidden');
    end if;
  end loop;
  if p_kind = 'embed' and cardinality(coalesce(p_hosts, '{}')) = 0 then return jsonb_build_object('ok', false, 'reason', 'host_invalid'); end if;
  if p_template is not null and p_template !~ '^https://[a-z0-9.-]+/[^\s"''<>\\]*\{id\}[^\s"''<>\\]*$' then
    return jsonb_build_object('ok', false, 'reason', 'template_invalid');
  end if;
  if p_template is not null and not (lower(substring(p_template from '^https://([^/?#]+)')) = any (coalesce(p_hosts, '{}'))) then
    return jsonb_build_object('ok', false, 'reason', 'template_invalid');
  end if;
  if p_id_pattern is not null then
    if char_length(p_id_pattern) > 200 then return jsonb_build_object('ok', false, 'reason', 'pattern_invalid'); end if;
    begin
      perform '' ~ p_id_pattern;
    exception when invalid_regular_expression then return jsonb_build_object('ok', false, 'reason', 'pattern_invalid');
    end;
  end if;
  insert into public.providers (key, name, kind, priority, active, hosts, embed_template, id_pattern, sandbox, updated_at)
  values (p_key, btrim(p_name), p_kind, coalesce(p_priority, 0), coalesce(p_active, true), coalesce(p_hosts, '{}'),
          nullif(p_template, ''), nullif(p_id_pattern, ''), coalesce(p_sandbox, true), now())
  on conflict (key) do update set name = excluded.name, kind = excluded.kind, priority = excluded.priority, active = excluded.active,
    hosts = excluded.hosts, embed_template = excluded.embed_template, id_pattern = excluded.id_pattern,
    sandbox = excluded.sandbox, updated_at = now();
  perform public.log_admin(null, 'lecteur', jsonb_build_object('key', p_key, 'active', p_active, 'priority', p_priority));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_language_config() returns jsonb
language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  return jsonb_build_object('ok', true,
    'languages', coalesce((select jsonb_agg(to_jsonb(l) order by l.sort, l.code) from public.languages l), '[]'::jsonb),
    'labels', coalesce((select jsonb_agg(to_jsonb(l) order by l.sort, l.code) from public.language_labels l), '[]'::jsonb),
    'rules', coalesce((select jsonb_agg(to_jsonb(r) order by r.label_code, r.id) from public.language_label_rules r), '[]'::jsonb));
end $$;

create or replace function public.admin_add_language(p_code text, p_name text, p_sort integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if lower(coalesce(p_code, '')) !~ '^[a-z]{2,3}$' or char_length(btrim(coalesce(p_name, ''))) not between 1 and 60 then
    return jsonb_build_object('ok', false, 'reason', 'language_invalid');
  end if;
  insert into public.languages (code, name_fr, sort) values (lower(p_code), btrim(p_name), coalesce(p_sort, 100))
  on conflict (code) do update set name_fr = excluded.name_fr, sort = excluded.sort;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_set_label(p_code text, p_name text, p_sort integer, p_active boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if upper(coalesce(p_code, '')) !~ '^[A-Z0-9]{2,12}$' or char_length(btrim(coalesce(p_name, ''))) not between 1 and 60 then
    return jsonb_build_object('ok', false, 'reason', 'label_invalid');
  end if;
  if upper(p_code) = 'AUTRE' and not coalesce(p_active, true) then return jsonb_build_object('ok', false, 'reason', 'label_protected'); end if;
  insert into public.language_labels (code, name_fr, sort, active) values (upper(p_code), btrim(p_name), coalesce(p_sort, 100), coalesce(p_active, true))
  on conflict (code) do update set name_fr = excluded.name_fr, sort = excluded.sort, active = excluded.active;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_add_label_rule(p_label text, p_audio_kind text, p_audio_lang text, p_subtitle text, p_subtitle_lang text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  begin
    insert into public.language_label_rules (label_code, audio_kind, audio_lang, subtitle, subtitle_lang)
    values (upper(p_label), nullif(p_audio_kind, ''), nullif(p_audio_lang, ''), p_subtitle, nullif(p_subtitle_lang, ''));
  exception
    when unique_violation then return jsonb_build_object('ok', false, 'reason', 'rule_exists');
    when check_violation then return jsonb_build_object('ok', false, 'reason', 'rule_invalid');
    when foreign_key_violation then return jsonb_build_object('ok', false, 'reason', 'rule_invalid');
  end;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_delete_label_rule(p_id integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  delete from public.language_label_rules where id = p_id;
  return jsonb_build_object('ok', found);
end $$;

-- ---------------------------------------------------------
-- Droits d'exécution
-- ---------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.language_label(text, text, text, text)', 'public.lang_from_country(text)', 'public.source_guard()',
    'public.playable_source(public.episode_sources, public.providers)',
    'public.public_episode_list(integer)', 'public.public_episode_playback(integer, integer, integer)',
    'public.public_available_animes(integer[])', 'public.svc_report_source(text, uuid)',
    'public.admin_episode_overview(text, text, integer, integer)', 'public.admin_episode_tree(integer)',
    'public.admin_episode_playback(integer, integer, integer)',
    'public.admin_sync_anime(jsonb, boolean)', 'public.admin_animes_to_sync(integer)', 'public.admin_request_sync(integer)',
    'public.admin_sync_log(boolean, text, jsonb)', 'public.admin_sync_status()', 'public.admin_set_anime_lang(integer, text)',
    'public.admin_upsert_season(integer, integer, integer, text, integer)', 'public.admin_delete_season(integer, integer)',
    'public.admin_upsert_episode(uuid, integer, integer, integer, text, text, integer, boolean, timestamptz)',
    'public.viewer_is_premium()',
    'public.admin_add_episode_range(integer, integer, integer, integer)', 'public.admin_delete_episode(uuid)',
    'public.admin_upsert_source(uuid, uuid, text, text, text, text, text, text, text, text, text, integer, boolean, text)',
    'public.admin_delete_source(uuid)', 'public.admin_set_source_status(uuid, text, boolean, boolean)',
    'public.admin_bulk_qualify(integer, integer, text, text, text, text, text, boolean, boolean)',
    'public.admin_sync_failed(integer, text)', 'public.admin_sync_begin()',
    'public.admin_list_providers()', 'public.admin_set_provider(text, text, text, integer, boolean, text[], text, text, boolean)',
    'public.admin_language_config()', 'public.admin_add_language(text, text, integer)',
    'public.admin_set_label(text, text, integer, boolean)', 'public.admin_add_label_rule(text, text, text, text, text)',
    'public.admin_delete_label_rule(integer)']
  loop
    execute 'revoke execute on function ' || f || ' from public, anon, authenticated';
  end loop;
end $$;

grant execute on function public.public_episode_list(integer) to anon, authenticated;
grant execute on function public.public_episode_playback(integer, integer, integer) to anon, authenticated;
grant execute on function public.public_available_animes(integer[]) to anon, authenticated;
grant execute on function public.svc_report_source(text, uuid) to service_role;
grant execute on function public.admin_episode_overview(text, text, integer, integer) to authenticated;
grant execute on function public.admin_episode_tree(integer) to authenticated;
grant execute on function public.admin_episode_playback(integer, integer, integer) to authenticated;
grant execute on function public.admin_sync_anime(jsonb, boolean) to authenticated;
grant execute on function public.admin_animes_to_sync(integer) to authenticated;
grant execute on function public.admin_request_sync(integer) to authenticated;
grant execute on function public.admin_sync_log(boolean, text, jsonb) to authenticated;
grant execute on function public.admin_sync_status() to authenticated;
grant execute on function public.admin_set_anime_lang(integer, text) to authenticated;
grant execute on function public.admin_upsert_season(integer, integer, integer, text, integer) to authenticated;
grant execute on function public.admin_delete_season(integer, integer) to authenticated;
grant execute on function public.admin_upsert_episode(uuid, integer, integer, integer, text, text, integer, boolean, timestamptz) to authenticated;
grant execute on function public.admin_add_episode_range(integer, integer, integer, integer) to authenticated;
grant execute on function public.admin_delete_episode(uuid) to authenticated;
grant execute on function public.admin_upsert_source(uuid, uuid, text, text, text, text, text, text, text, text, text, integer, boolean, text) to authenticated;
grant execute on function public.admin_delete_source(uuid) to authenticated;
grant execute on function public.admin_set_source_status(uuid, text, boolean, boolean) to authenticated;
grant execute on function public.admin_bulk_qualify(integer, integer, text, text, text, text, text, boolean, boolean) to authenticated;
grant execute on function public.admin_sync_failed(integer, text) to authenticated;
grant execute on function public.admin_sync_begin() to authenticated;
grant execute on function public.admin_list_providers() to authenticated;
grant execute on function public.admin_set_provider(text, text, text, integer, boolean, text[], text, text, boolean) to authenticated;
grant execute on function public.admin_language_config() to authenticated;
grant execute on function public.admin_add_language(text, text, integer) to authenticated;
grant execute on function public.admin_set_label(text, text, integer, boolean) to authenticated;
grant execute on function public.admin_add_label_rule(text, text, text, text, text) to authenticated;
grant execute on function public.admin_delete_label_rule(integer) to authenticated;
