-- =========================================================
-- LumaAnime — v3 : confidentialité, administration, succès, compte, traductions
-- À exécuter une fois dans Supabase : SQL Editor → New query → Run.
-- Nécessite le script précédent (premium-coins.sql). Peut être relancé sans risque.
-- =========================================================

-- ---------- Nouveau nom : les nouvelles clés commencent par « LUM » (les clés « MYA » restent valables) ----------
create or replace function public.generate_key_code() returns text
language plpgsql set search_path = public, extensions as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(16);
  result text := 'LUM';
  i integer;
begin
  for i in 0..15 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return result;
end $$;
revoke execute on function public.generate_key_code() from public, anon, authenticated;

-- ---------- Nouvelles colonnes ----------
alter table public.profiles add column if not exists best_streak integer not null default 0;
alter table public.profiles add column if not exists pseudo_changed_at timestamptz;
update public.profiles set best_streak = greatest(best_streak, streak);

-- ---------- Confidentialité ----------
-- Avant ce script, n'importe quel visiteur pouvait lire l'e-mail, les listes et le solde de tous les membres.
-- Désormais, seules les colonnes publiques sont lisibles ; chacun lit sa propre fiche via get_my_profile().
revoke select on public.profiles from anon, authenticated;
grant select (id, pseudo, role, premium, premium_tier, premium_until, avatar_url, banner_url, joined_at,
              public_profile, theme_preset, color, color_dim, color_light) on public.profiles to anon, authenticated;

-- Le pseudo ne se modifie plus directement : il passe par change_pseudo() (7 jours entre deux changements).
revoke update on public.profiles from anon, authenticated;
grant update (avatar_url, banner_url, theme_preset, color, color_dim, color_light,
              public_profile, watchlist, favorites, continue_watching) on public.profiles to authenticated;

create or replace function public.get_my_profile() returns jsonb
language sql security definer stable set search_path = public as $$
  select to_jsonb(p) from public.profiles p where p.id = auth.uid();
$$;

-- ---------- Journal d'administration ----------
create table if not exists public.admin_log (
  id bigint generated always as identity primary key,
  admin_id uuid references auth.users(id) on delete set null,
  target_id uuid,
  target_label text,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_log enable row level security;
revoke all on public.admin_log from anon, authenticated;

create or replace function public.log_admin(p_target uuid, p_action text, p_details jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.admin_log (admin_id, target_id, target_label, action, details)
  values (auth.uid(), p_target, (select pseudo from public.profiles where id = p_target), p_action, coalesce(p_details, '{}'::jsonb));
end $$;

-- ---------- Traductions françaises des synopsis (écrites par le serveur Cloudflare uniquement) ----------
create table if not exists public.synopsis_fr (
  anilist_id integer primary key,
  text_fr text not null,
  created_at timestamptz not null default now()
);
alter table public.synopsis_fr enable row level security;
revoke all on public.synopsis_fr from anon, authenticated;

-- ---------- Compte : pseudo et e-mail ----------
create or replace function public.pseudo_available(p_pseudo text) returns boolean
language sql security definer stable set search_path = public as $$
  select not exists (select 1 from public.profiles where lower(pseudo) = lower(btrim(coalesce(p_pseudo, ''))) and id is distinct from auth.uid());
$$;

create or replace function public.change_pseudo(p_pseudo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  clean text := regexp_replace(btrim(coalesce(p_pseudo, '')), '\s+', ' ', 'g');
  p public.profiles%rowtype;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'not_authenticated'); end if;
  if char_length(clean) < 3 or char_length(clean) > 20 or clean ~ '[<>"''`\\/@#%&*+=!?;:,(){}\[\]|~^$]' or clean ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok', false, 'reason', 'pseudo_invalid');
  end if;
  select * into p from public.profiles where id = uid for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_authenticated'); end if;
  if p.pseudo = clean then return jsonb_build_object('ok', false, 'reason', 'pseudo_same'); end if;
  if p.pseudo_changed_at is not null and p.pseudo_changed_at > now() - interval '7 days' then
    return jsonb_build_object('ok', false, 'reason', 'pseudo_cooldown', 'next_at', p.pseudo_changed_at + interval '7 days');
  end if;
  if exists (select 1 from public.profiles where lower(pseudo) = lower(clean) and id <> uid) then
    return jsonb_build_object('ok', false, 'reason', 'pseudo_taken');
  end if;
  update public.profiles set pseudo = clean, pseudo_changed_at = now() where id = uid;
  return jsonb_build_object('ok', true, 'pseudo', clean, 'next_at', now() + interval '7 days');
end $$;

-- Quand un membre confirme sa nouvelle adresse e-mail, la fiche profil suit automatiquement.
create or replace function public.sync_profile_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists on_auth_email_change on auth.users;
create trigger on_auth_email_change after update of email on auth.users
  for each row execute function public.sync_profile_email();

-- ---------- Anime Coins : récompense quotidienne (mémorise la meilleure série) ----------
create or replace function public.claim_daily_reward() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'Europe/Paris')::date;
  p public.profiles%rowtype;
  gap integer;
  new_streak integer;
  reward integer;
  bonus integer := 0;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'not_authenticated'); end if;
  select * into p from public.profiles where id = uid for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_authenticated'); end if;
  if p.last_daily = today then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed', 'streak', p.streak, 'coins', p.coins);
  end if;

  gap := case when p.last_daily is null then null else today - p.last_daily end;
  new_streak := case when gap = 1 then p.streak + 1 when gap = 2 then greatest(p.streak, 1) else 1 end;
  reward := least(10 + 2 * (new_streak - 1), 30);
  if new_streak <> p.streak and new_streak % 7 = 0 then bonus := bonus + 50; end if;
  if new_streak <> p.streak and new_streak % 30 = 0 then bonus := bonus + 150; end if;

  update public.profiles
    set coins = coins + reward + bonus, streak = new_streak, best_streak = greatest(best_streak, new_streak), last_daily = today
    where id = uid;
  insert into public.coin_ledger (user_id, amount, reason) values (uid, reward + bonus, 'quotidien');
  return jsonb_build_object('ok', true, 'reward', reward, 'bonus', bonus, 'streak', new_streak, 'coins', p.coins + reward + bonus);
end $$;

-- ---------- Succès ----------
-- Nombre d'animes différents dans une liste (les entrées sans identifiant valide ne comptent pas)
create or replace function public.list_size(p_list jsonb) returns integer
language sql immutable as $$
  select count(distinct coalesce('a' || (e ->> 'anilist_id'), 'm' || (e ->> 'mal_id')))::integer
  from jsonb_array_elements(case when jsonb_typeof(p_list) = 'array' then p_list else '[]'::jsonb end) e
  where coalesce(e ->> 'anilist_id', e ->> 'mal_id') ~ '^[0-9]{1,8}$';
$$;

-- Catalogue : code, mesure, seuil, récompense, difficulté, ancienneté minimale (jours)
create or replace function public.achievement_rules()
returns table (code text, metric text, threshold integer, reward integer, difficulty text, min_age integer)
language sql immutable as $$
  values
    ('profil_complet',      'profile_images',    1,     50,   'facile',        0),
    ('profil_public',       'public_profile',    1,     20,   'facile',        0),
    ('styliste',            'custom_theme',      1,     20,   'facile',        0),
    ('premiere_watchlist',  'watchlist',         1,     15,   'facile',        0),
    ('collectionneur',      'watchlist',         25,    60,   'moyen',         7),
    ('archiviste',          'watchlist',         100,   150,  'difficile',     30),
    ('bibliotheque',        'watchlist',         300,   350,  'tres_difficile', 90),
    ('coup_de_coeur',       'favorites',         10,    40,   'moyen',         7),
    ('passionne',           'favorites',         50,    150,  'difficile',     30),
    ('pantheon',            'favorites',         150,   350,  'tres_difficile', 90),
    ('serie_7',             'best_streak',       7,     60,   'moyen',         0),
    ('serie_30',            'best_streak',       30,    200,  'difficile',     0),
    ('serie_60',            'best_streak',       60,    350,  'difficile',     0),
    ('serie_100',           'best_streak',       100,   600,  'tres_difficile', 0),
    ('serie_200',           'best_streak',       200,   1000, 'tres_difficile', 0),
    ('serie_365',           'best_streak',       365,   2000, 'legendaire',    0),
    ('fidele_30',           'daily_days',        30,    80,   'moyen',         0),
    ('fidele_100',          'daily_days',        100,   250,  'difficile',     0),
    ('fidele_250',          'daily_days',        250,   500,  'tres_difficile', 0),
    ('fidele_500',          'daily_days',        500,   1200, 'legendaire',    0),
    ('fidele_1000',         'daily_days',        1000,  2500, 'legendaire',    0),
    ('anciennete_3m',       'age_days',          90,    100,  'moyen',         0),
    ('anciennete_6m',       'age_days',          182,   200,  'difficile',     0),
    ('anciennete_1a',       'age_days',          365,   400,  'tres_difficile', 0),
    ('anciennete_2a',       'age_days',          730,   900,  'legendaire',    0),
    ('anciennete_3a',       'age_days',          1095,  1500, 'legendaire',    0),
    ('tirelire',            'coins',             1000,  60,   'moyen',         0),
    ('coffre_fort',         'coins',             5000,  250,  'difficile',     0),
    ('dragon',              'coins',             15000, 800,  'legendaire',    0),
    ('gagne_2500',          'earned',            2500,  120,  'difficile',     0),
    ('gagne_10000',         'earned',            10000, 500,  'tres_difficile', 0),
    ('gagne_25000',         'earned',            25000, 1500, 'legendaire',    0),
    ('premiere_cle',        'keys',              1,     30,   'facile',        0),
    ('cles_5',              'keys',              5,     150,  'difficile',     0),
    ('soutien_actif',       'premium',           1,     100,  'moyen',         0),
    ('mecene',              'lifetime',          1,     500,  'tres_difficile', 0),
    ('economiste',          'bought_with_coins', 1,     200,  'difficile',     0),
    ('economiste_3',        'bought_with_coins', 3,     500,  'tres_difficile', 0),
    ('chasseur_10',         'achievements',      10,    200,  'difficile',     0),
    ('chasseur_20',         'achievements',      20,    600,  'tres_difficile', 0),
    ('chasseur_30',         'achievements',      30,    1200, 'legendaire',    0),
    ('platine',             'achievements',      41,    3000, 'legendaire',    0)
$$;

create or replace function public.achievement_metrics(p_user uuid) returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  p public.profiles%rowtype;
  v_days integer;
  v_earned integer;
  v_keys integer;
  v_bought integer;
begin
  select * into p from public.profiles where id = p_user;
  if not found then return '{}'::jsonb; end if;
  select count(*) into v_days from public.coin_ledger where user_id = p_user and reason = 'quotidien';
  select coalesce(sum(amount), 0) into v_earned from public.coin_ledger
    where user_id = p_user and amount > 0 and reason not like 'succes:%' and reason <> 'admin';
  select count(*) into v_keys from public.premium_keys where redeemed_by = p_user;
  select count(*) into v_bought from public.coin_ledger where user_id = p_user and reason like 'premium:%';
  return jsonb_build_object(
    'profile_images', case when p.avatar_url is not null and p.banner_url is not null then 1 else 0 end,
    'public_profile', case when coalesce(p.public_profile, false) then 1 else 0 end,
    'custom_theme', case when coalesce(p.theme_preset, 'original') <> 'original' then 1 else 0 end,
    'watchlist', public.list_size(to_jsonb(p.watchlist)),
    'favorites', public.list_size(to_jsonb(p.favorites)),
    'best_streak', greatest(p.best_streak, p.streak),
    'daily_days', v_days,
    'age_days', greatest(0, (now()::date - coalesce(p.joined_at::date, now()::date))),
    'coins', p.coins,
    'earned', v_earned,
    'keys', v_keys,
    'premium', case when p.premium_tier is not null and (p.premium_until is null or p.premium_until > now()) then 1 else 0 end,
    'lifetime', case when p.premium_tier = 'soutien_plus' then 1 else 0 end,
    'bought_with_coins', v_bought,
    'achievements', coalesce(array_length(p.achievements, 1), 0)
  );
end $$;

create or replace function public.claim_achievement(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  p public.profiles%rowtype;
  r record;
  m jsonb;
  v integer;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'not_authenticated'); end if;
  select * into p from public.profiles where id = uid for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_authenticated'); end if;
  if p_code = any (p.achievements) then return jsonb_build_object('ok', false, 'reason', 'already_claimed'); end if;
  select * into r from public.achievement_rules() ar where ar.code = p_code;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_met'); end if;

  m := public.achievement_metrics(uid);
  v := coalesce((m ->> r.metric)::integer, 0);
  if v < r.threshold or (m ->> 'age_days')::integer < r.min_age then
    return jsonb_build_object('ok', false, 'reason', 'not_met', 'value', v, 'threshold', r.threshold);
  end if;

  update public.profiles set coins = coins + r.reward, achievements = array_append(achievements, p_code) where id = uid;
  insert into public.coin_ledger (user_id, amount, reason) values (uid, r.reward, 'succes:' || p_code);
  return jsonb_build_object('ok', true, 'reward', r.reward, 'coins', p.coins + r.reward);
end $$;

-- Vue d'ensemble : règles, pourcentage de membres par succès, et progression du membre connecté
create or replace function public.achievements_overview() returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  total integer;
  stats jsonb;
begin
  select count(*) into total from public.profiles;
  select coalesce(jsonb_object_agg(code, n), '{}'::jsonb) into stats
    from (select unnest(achievements) as code, count(*) as n from public.profiles group by 1) s;
  return jsonb_build_object(
    'members', total,
    'stats', stats,
    'metrics', case when auth.uid() is null then null else public.achievement_metrics(auth.uid()) end,
    'rules', (select jsonb_agg(to_jsonb(ar)) from public.achievement_rules() ar)
  );
end $$;

-- ---------- Administration ----------
create or replace function public.admin_stats() returns jsonb
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'members', (select count(*) from public.profiles),
    'new_7d', (select count(*) from public.profiles where joined_at > now() - interval '7 days'),
    'premium_active', (select count(*) from public.profiles where premium_tier is not null and (premium_until is null or premium_until > now())),
    'lifetime', (select count(*) from public.profiles where premium_tier = 'soutien_plus'),
    'coins_total', (select coalesce(sum(coins), 0) from public.profiles),
    'orders_paid', (select count(*) from public.premium_orders where status = 'paid'),
    'revenue', (select coalesce(sum(amount), 0) from public.premium_orders where status = 'paid'),
    'keys_unused', (select count(*) from public.premium_keys where redeemed_at is null and (expires_at is null or expires_at > now()))
  );
end $$;

create or replace function public.admin_list_users() returns jsonb
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'pseudo', p.pseudo, 'email', coalesce(u.email, p.email), 'role', p.role,
      'premium_tier', case when p.premium_tier is null and coalesce(p.premium, false) then 'legacy' else p.premium_tier end,
      'premium_since', p.premium_since, 'premium_until', p.premium_until,
      'coins', p.coins, 'streak', p.streak, 'best_streak', p.best_streak,
      'achievements', coalesce(array_length(p.achievements, 1), 0),
      'joined_at', p.joined_at, 'last_sign_in_at', u.last_sign_in_at, 'email_confirmed_at', u.email_confirmed_at,
      'avatar_url', p.avatar_url, 'public_profile', p.public_profile
    ) order by p.joined_at desc nulls last)
    from public.profiles p left join auth.users u on u.id = p.id
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_set_premium(p_user uuid, p_tier text, p_days integer, p_extend boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p public.profiles%rowtype;
  active boolean;
  base timestamptz;
  new_until timestamptz;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select * into p from public.profiles where id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'user_not_found'); end if;
  active := p.premium_tier is not null and (p.premium_until is null or p.premium_until > now());

  if p_tier is null or p_tier = 'none' then
    update public.profiles set premium_tier = null, premium_until = null, premium_since = null, premium = false where id = p_user;
    perform public.log_admin(p_user, 'premium_retire', jsonb_build_object('ancien', p.premium_tier));
    return jsonb_build_object('ok', true, 'tier', null);
  elsif p_tier = 'soutien_plus' then
    update public.profiles set premium_tier = 'soutien_plus', premium_until = null, premium = true,
      premium_since = case when active then premium_since else now() end where id = p_user;
    perform public.log_admin(p_user, 'premium_ajoute', jsonb_build_object('niveau', 'soutien_plus'));
    return jsonb_build_object('ok', true, 'tier', 'soutien_plus', 'until', null);
  elsif p_tier = 'soutien' then
    if p_days is null or p_days < 1 or p_days > 3650 then return jsonb_build_object('ok', false, 'reason', 'days_out_of_range'); end if;
    base := case when p_extend and active and p.premium_tier = 'soutien' and p.premium_until > now() then p.premium_until else now() end;
    new_until := base + make_interval(days => p_days);
    update public.profiles set premium_tier = 'soutien', premium_until = new_until, premium = true,
      premium_since = case when active then premium_since else now() end where id = p_user;
    perform public.log_admin(p_user, 'premium_ajoute', jsonb_build_object('niveau', 'soutien', 'jours', p_days, 'prolongation', p_extend, 'fin', new_until));
    return jsonb_build_object('ok', true, 'tier', 'soutien', 'until', new_until);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'unknown_tier');
end $$;

create or replace function public.admin_adjust_coins(p_user uuid, p_delta integer, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p public.profiles%rowtype;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 1000000 then return jsonb_build_object('ok', false, 'reason', 'amount_out_of_range'); end if;
  select * into p from public.profiles where id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'user_not_found'); end if;
  if p.coins + p_delta < 0 then return jsonb_build_object('ok', false, 'reason', 'balance_negative', 'coins', p.coins); end if;
  update public.profiles set coins = coins + p_delta where id = p_user;
  insert into public.coin_ledger (user_id, amount, reason) values (p_user, p_delta, 'admin');
  perform public.log_admin(p_user, 'coins', jsonb_build_object('montant', p_delta, 'note', left(coalesce(p_note, ''), 200)));
  return jsonb_build_object('ok', true, 'coins', p.coins + p_delta);
end $$;

create or replace function public.admin_set_role(p_user uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_role not in ('membre', 'admin') or p_user = auth.uid() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  update public.profiles set role = p_role where id = p_user;
  if found then perform public.log_admin(p_user, 'role', jsonb_build_object('role', p_role)); end if;
  return jsonb_build_object('ok', found);
end $$;

create or replace function public.admin_reset_streak(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  update public.profiles set streak = 0, last_daily = null where id = p_user;
  if found then perform public.log_admin(p_user, 'serie_reinitialisee', '{}'::jsonb); end if;
  return jsonb_build_object('ok', found);
end $$;

-- Supprime le compte complet (connexion + profil). Si Supabase refuse l'accès à auth.users, seul le profil est supprimé.
create or replace function public.admin_delete_user(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  label text;
begin
  if not public.is_admin() or p_user = auth.uid() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  select pseudo into label from public.profiles where id = p_user;
  insert into public.admin_log (admin_id, target_id, target_label, action) values (auth.uid(), p_user, label, 'compte_supprime');
  delete from public.profiles where id = p_user;
  begin
    delete from auth.users where id = p_user;
  exception when insufficient_privilege then
    return jsonb_build_object('ok', true, 'partial', true);
  end;
  return jsonb_build_object('ok', true, 'partial', false);
end $$;

create or replace function public.admin_list_keys() returns jsonb
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', k.code, 'kind', k.kind, 'tier', k.tier, 'coins', k.coins, 'source', k.source,
      'created_at', k.created_at, 'expires_at', k.expires_at, 'redeemed_at', k.redeemed_at,
      'redeemed_by', r.pseudo, 'buyer', b.pseudo
    ) order by k.created_at desc)
    from (select * from public.premium_keys order by created_at desc limit 200) k
    left join public.profiles r on r.id = k.redeemed_by
    left join public.profiles b on b.id = k.buyer_id
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_revoke_key(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  update public.premium_keys set expires_at = now() where code = p_code and redeemed_at is null;
  if found then perform public.log_admin(null, 'cle_annulee', jsonb_build_object('code', p_code)); end if;
  return jsonb_build_object('ok', found);
end $$;

create or replace function public.admin_list_orders() returns jsonb
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id, 'pseudo', p.pseudo, 'tier', o.tier, 'amount', o.amount, 'currency', o.currency,
      'status', o.status, 'created_at', o.created_at, 'paid_at', o.paid_at
    ) order by o.created_at desc)
    from (select * from public.premium_orders order by created_at desc limit 200) o
    left join public.profiles p on p.id = o.user_id
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_list_log() returns jsonb
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'action', l.action, 'target', l.target_label, 'details', l.details, 'created_at', l.created_at, 'admin', a.pseudo
    ) order by l.created_at desc)
    from (select * from public.admin_log order by created_at desc limit 200) l
    left join public.profiles a on a.id = l.admin_id
  ), '[]'::jsonb);
end $$;

-- Les clés générées sont aussi journalisées
create or replace function public.admin_generate_keys(p_kind text, p_tier text, p_coins integer, p_count integer, p_source text)
returns setof text
language plpgsql security definer set search_path = public as $$
declare
  i integer;
  new_code text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_count < 1 or p_count > 50 then raise exception 'count_out_of_range'; end if;
  if p_source not in ('admin', 'evenement') then raise exception 'bad_source'; end if;
  if p_kind = 'coins' and (p_coins is null or p_coins < 10 or p_coins > 5000) then raise exception 'coins_out_of_range'; end if;
  if p_kind = 'premium' and p_tier not in ('soutien', 'soutien_plus') then raise exception 'unknown_tier'; end if;
  for i in 1..p_count loop
    loop
      new_code := public.generate_key_code();
      begin
        insert into public.premium_keys (code, kind, tier, coins, source, created_by)
          values (new_code, p_kind, case when p_kind = 'premium' then p_tier end, case when p_kind = 'coins' then p_coins end, p_source, auth.uid());
        exit;
      exception when unique_violation then
        null;
      end;
    end loop;
    return next new_code;
  end loop;
  perform public.log_admin(null, 'cles_generees', jsonb_build_object('type', p_kind, 'niveau', p_tier, 'coins', p_coins, 'nombre', p_count, 'origine', p_source));
end $$;

-- ---------- Droits d'exécution ----------
revoke execute on function public.log_admin(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.achievement_metrics(uuid) from public, anon, authenticated;
revoke execute on function public.sync_profile_email() from public, anon, authenticated;

revoke execute on function public.get_my_profile() from public, anon;
revoke execute on function public.change_pseudo(text) from public, anon;
revoke execute on function public.admin_stats() from public, anon;
revoke execute on function public.admin_list_users() from public, anon;
revoke execute on function public.admin_set_premium(uuid, text, integer, boolean) from public, anon;
revoke execute on function public.admin_adjust_coins(uuid, integer, text) from public, anon;
revoke execute on function public.admin_reset_streak(uuid) from public, anon;
revoke execute on function public.admin_delete_user(uuid) from public, anon;
revoke execute on function public.admin_list_keys() from public, anon;
revoke execute on function public.admin_revoke_key(text) from public, anon;
revoke execute on function public.admin_list_orders() from public, anon;
revoke execute on function public.admin_list_log() from public, anon;

grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.change_pseudo(text) to authenticated;
grant execute on function public.pseudo_available(text) to anon, authenticated;
grant execute on function public.achievements_overview() to anon, authenticated;
grant execute on function public.admin_stats() to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_set_premium(uuid, text, integer, boolean) to authenticated;
grant execute on function public.admin_adjust_coins(uuid, integer, text) to authenticated;
grant execute on function public.admin_reset_streak(uuid) to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;
grant execute on function public.admin_list_keys() to authenticated;
grant execute on function public.admin_revoke_key(text) to authenticated;
grant execute on function public.admin_list_orders() to authenticated;
grant execute on function public.admin_list_log() to authenticated;
