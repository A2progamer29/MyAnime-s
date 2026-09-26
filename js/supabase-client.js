/* =========================================================
   LumaAnime — supabase-client.js
   Client Supabase : compte, profil, listes, uploads, admin
   ========================================================= */

var sb = (window.supabase && typeof SUPABASE_URL !== 'undefined')
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

var SERVICE_DOWN_MESSAGE = 'Le service de comptes est injoignable pour le moment. Réessaie dans quelques minutes.';

function normalizeProfile(row) {
  if (!row) return null;
  var tier = row.premium_tier || (row.premium ? 'legacy' : null);
  var until = row.premium_until || null;
  return {
    id: row.id,
    pseudo: row.pseudo,
    email: row.email,
    role: row.role,
    premium: !!tier && (!until || new Date(until).getTime() > Date.now()),
    premiumTier: tier,
    premiumSince: row.premium_since || null,
    premiumUntil: until,
    coins: row.coins || 0,
    streak: row.streak || 0,
    bestStreak: Math.max(row.best_streak || 0, row.streak || 0),
    pseudoChangedAt: row.pseudo_changed_at || null,
    lastDaily: row.last_daily || null,
    achievements: row.achievements || [],
    avatarUrl: row.avatar_url,
    bannerUrl: row.banner_url,
    joinedAt: row.joined_at ? new Date(row.joined_at).getTime() : null,
    watchlist: row.watchlist || [],
    favorites: row.favorites || [],
    continueWatching: row.continue_watching || [],
    settings: {
      themePreset: row.theme_preset,
      color: row.color,
      colorDim: row.color_dim,
      colorLight: row.color_light,
      publicProfile: !!row.public_profile
    }
  };
}

// Le rôle vient uniquement de la base : la vraie protection doit être assurée par les règles RLS de Supabase
function isAdmin(user) {
  return !!user && user.role === 'admin';
}

/* ---- Utilisateur courant (mis en cache pendant la page) ---- */
var currentUserPromise = null;

function invalidateUser() {
  currentUserPromise = null;
}

// Sa propre fiche passe par une fonction serveur : les colonnes privées ne sont plus lisibles directement
async function fetchProfile(id) {
  var res = await sb.rpc('get_my_profile');
  if (res.error && String(res.error.message || '').indexOf('get_my_profile') !== -1) {
    res = await sb.from('profiles').select('*').eq('id', id).maybeSingle();
  }
  if (res.error) console.error('Lecture du profil :', res.error);
  return res.error || !res.data ? null : normalizeProfile(res.data);
}

// Recrée la fiche profil si elle manque (le rôle reste la valeur par défaut de la base)
async function ensureProfile(authUser) {
  var pseudo = (authUser.user_metadata && authUser.user_metadata.pseudo) || authUser.email.split('@')[0];
  var res = await sb.from('profiles').upsert({ id: authUser.id, pseudo: pseudo, email: authUser.email }, { onConflict: 'id', ignoreDuplicates: true });
  if (res.error) { console.error('Création de la fiche profil :', res.error); return null; }
  return fetchProfile(authUser.id);
}

async function loadCurrentUser() {
  if (!sb) return null;
  try {
    var res = await sb.auth.getSession();
    var session = res.data && res.data.session;
    if (!session) return null;
    return (await fetchProfile(session.user.id)) || (await ensureProfile(session.user));
  } catch (err) {
    console.error('Session :', err);
    return null;
  }
}

function getCurrentUser(options) {
  if (!currentUserPromise || (options && options.fresh)) currentUserPromise = loadCurrentUser();
  return currentUserPromise;
}

/* ---- Authentification ---- */
function translateAuthError(error) {
  var msg = String((error && error.message) || '').toLowerCase();
  if (!msg) return 'Une erreur inattendue est survenue. Réessaie.';
  if (msg.indexOf('failed to fetch') !== -1 || msg.indexOf('network') !== -1 || msg.indexOf('fetch') !== -1) return SERVICE_DOWN_MESSAGE;
  if (msg.indexOf('already registered') !== -1 || msg.indexOf('already exists') !== -1) return 'Un compte existe déjà avec cette adresse e-mail. Connecte-toi ou réinitialise ton mot de passe.';
  if (msg.indexOf('invalid login credentials') !== -1) return 'E-mail ou mot de passe incorrect. Vérifie les deux champs puis réessaie.';
  if (msg.indexOf('email not confirmed') !== -1) return 'Ton adresse e-mail n\'est pas encore confirmée. Ouvre le lien reçu par e-mail puis reconnecte-toi.';
  if (msg.indexOf('rate limit') !== -1 || msg.indexOf('security purposes') !== -1 || msg.indexOf('too many') !== -1) return 'Trop de tentatives rapprochées. Patiente quelques minutes avant de réessayer.';
  if (msg.indexOf('different from the old') !== -1) return 'Le nouveau mot de passe doit être différent de l\'ancien.';
  if (msg.indexOf('error sending') !== -1 || (error.status >= 500 && msg.indexOf('email') !== -1)) return 'L\'e-mail n\'a pas pu être envoyé : le service d\'envoi du site rencontre un problème. Réessaie dans quelques minutes.';
  if (msg.indexOf('session missing') !== -1 || msg.indexOf('session_not_found') !== -1 || msg.indexOf('jwt expired') !== -1) return 'Le lien a expiré ou a déjà servi. Redemande un lien de réinitialisation.';
  if (msg.indexOf('otp') !== -1 && msg.indexOf('expired') !== -1) return 'Le lien a expiré. Redemande un lien de réinitialisation.';
  if (msg.indexOf('password') !== -1 && msg.indexOf('characters') !== -1) return 'Le mot de passe est trop court pour le serveur. Utilise au moins 8 caractères.';
  if (msg.indexOf('weak') !== -1) return 'Ce mot de passe est jugé trop faible. Choisis-en un plus long ou moins courant.';
  if (msg.indexOf('invalid') !== -1 && msg.indexOf('email') !== -1) return 'Cette adresse e-mail n\'est pas acceptée. Vérifie qu\'elle est bien écrite.';
  return 'Le serveur a refusé la demande : ' + error.message;
}

async function registerUser(input) {
  if (!sb) return { ok: false, error: SERVICE_DOWN_MESSAGE };
  try {
    var res = await sb.auth.signUp({ email: input.email, password: input.password, options: { data: { pseudo: input.pseudo } } });
    if (res.error) return { ok: false, error: translateAuthError(res.error) };
    if (!res.data.session) return { ok: true, needsConfirmation: true };
    invalidateUser();
    return { ok: true, user: await getCurrentUser() };
  } catch (err) {
    return { ok: false, error: translateAuthError(err) };
  }
}

async function loginUser(email, password) {
  if (!sb) return { ok: false, error: SERVICE_DOWN_MESSAGE };
  try {
    var res = await sb.auth.signInWithPassword({ email: email, password: password });
    if (res.error) return { ok: false, error: translateAuthError(res.error) };
    invalidateUser();
    var user = await getCurrentUser();
    if (!user) return { ok: false, error: 'Connexion réussie, mais ton profil n\'a pas pu être chargé. Réessaie dans un instant.' };
    return { ok: true, user: user };
  } catch (err) {
    return { ok: false, error: translateAuthError(err) };
  }
}

async function logoutUser() {
  try { if (sb) await sb.auth.signOut(); } catch (err) { console.error('Déconnexion :', err); }
  invalidateUser();
  try { localStorage.removeItem('myanimes_theme_cache'); } catch (e) {}
}

async function requestPasswordReset(email) {
  if (!sb) return { ok: false, error: SERVICE_DOWN_MESSAGE };
  try {
    var redirectTo = new URL('mot-de-passe.html', window.location.href).href;
    var res = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectTo });
    if (res.error) return { ok: false, error: translateAuthError(res.error) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: translateAuthError(err) };
  }
}

async function updatePassword(password) {
  if (!sb) return { ok: false, error: SERVICE_DOWN_MESSAGE };
  try {
    var res = await sb.auth.updateUser({ password: password });
    if (res.error) return { ok: false, error: translateAuthError(res.error) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: translateAuthError(err) };
  }
}

/* ---- Réglages (thème, visibilité du profil) ---- */
async function updateSettings(patch) {
  var user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Ta session a expiré. Reconnecte-toi.' };
  var dbPatch = {};
  if ('themePreset' in patch) dbPatch.theme_preset = patch.themePreset;
  if ('color' in patch) dbPatch.color = patch.color;
  if ('colorDim' in patch) dbPatch.color_dim = patch.colorDim;
  if ('colorLight' in patch) dbPatch.color_light = patch.colorLight;
  if ('publicProfile' in patch) dbPatch.public_profile = patch.publicProfile;
  var res = await sb.from('profiles').update(dbPatch).eq('id', user.id).select('id');
  if (res.error || !(res.data && res.data.length)) {
    console.error('Mise à jour des réglages :', res.error);
    return { ok: false, error: 'La modification n\'a pas pu être enregistrée. Réessaie.' };
  }
  Object.keys(patch).forEach(function (k) { user.settings[k] = patch[k]; });
  return { ok: true };
}

/* ---- Upload avatar / bannière (Supabase Storage) ---- */
var STORAGE_EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

// Nom de fichier neutre : Supabase refuse les clés avec accents ou caractères spéciaux
function storagePathFor(userId, file) {
  var fromName = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  var ext = STORAGE_EXTENSIONS[file.type] || fromName || 'img';
  return userId + '/' + Date.now() + '.' + ext;
}

function translateUploadError(error) {
  var msg = String((error && error.message) || '').toLowerCase();
  var status = String((error && (error.statusCode || error.status)) || '');
  if (status === '413' || msg.indexOf('too large') !== -1 || msg.indexOf('maximum allowed size') !== -1) return 'Image refusée par le serveur : elle dépasse la taille autorisée.';
  if (msg.indexOf('mime type') !== -1) return 'Format d\'image refusé par le serveur.';
  if (msg.indexOf('bucket not found') !== -1) return 'Espace de stockage introuvable sur le serveur. Préviens l\'administrateur.';
  if (msg.indexOf('row-level security') !== -1 || msg.indexOf('unauthorized') !== -1 || status === '403') return 'Envoi refusé par les règles d\'accès du serveur. Préviens l\'administrateur.';
  if (msg.indexOf('failed to fetch') !== -1 || msg.indexOf('network') !== -1) return SERVICE_DOWN_MESSAGE;
  return 'L\'envoi a échoué : ' + ((error && error.message) || 'erreur inconnue') + '.';
}

async function uploadProfileImage(bucket, column, file) {
  var user = await getCurrentUser();
  if (!user) return { error: 'Ta session a expiré. Reconnecte-toi puis réessaie.' };
  try {
    var path = storagePathFor(user.id, file);
    var up = await sb.storage.from(bucket).upload(path, file, { contentType: file.type || undefined });
    if (up.error) {
      console.error('Envoi vers « ' + bucket + ' » :', up.error);
      return { error: translateUploadError(up.error) };
    }
    var publicUrl = sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    var patch = {};
    patch[column] = publicUrl;
    var res = await sb.from('profiles').update(patch).eq('id', user.id).select('id');
    if (res.error || !(res.data && res.data.length)) {
      console.error('Mise à jour de « ' + column + ' » :', res.error);
      return { error: 'Image envoyée, mais impossible de l\'enregistrer sur ton profil. Réessaie.' };
    }
    if (column === 'avatar_url') user.avatarUrl = publicUrl;
    if (column === 'banner_url') user.bannerUrl = publicUrl;
    return { url: publicUrl };
  } catch (err) {
    return { error: translateUploadError(err) };
  }
}

function uploadAvatar(file) { return uploadProfileImage('avatars', 'avatar_url', file); }
function uploadBanner(file) { return uploadProfileImage('banners', 'banner_url', file); }

/* ---- Thème ---- */
function applyThemeFromUser(user) {
  if (window.MyAnimesTheme) window.MyAnimesTheme.apply(user && user.settings);
}

function cacheThemeForNextLoad(user) {
  try {
    var s = (user && user.settings) || {};
    localStorage.setItem('myanimes_theme_cache', JSON.stringify({
      themePreset: s.themePreset || null,
      color: s.color || null,
      colorDim: s.colorDim || null,
      colorLight: s.colorLight || null
    }));
  } catch (e) {}
}

/* ---- Profil public ---- */
var PUBLIC_PROFILE_COLUMNS = 'id, pseudo, role, premium, premium_tier, premium_until, avatar_url, banner_url, joined_at, public_profile, theme_preset, color, color_dim, color_light';

async function fetchPublicProfile(id) {
  if (!sb) return { status: 'error' };
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return { status: 'not-found' };
  try {
    var res = await sb.from('profiles').select(PUBLIC_PROFILE_COLUMNS).eq('id', id).maybeSingle();
    if (res.error) return { status: 'error' };
    if (!res.data) return { status: 'not-found' };
    if (!res.data.public_profile) return { status: 'private' };
    return { status: 'ok', profile: normalizeProfile(res.data) };
  } catch (err) {
    return { status: 'error' };
  }
}

/* ---- Watchlist / favoris ---- */
// Les anciens éléments n'ont qu'un identifiant MyAnimeList (mal_id), les nouveaux ont aussi celui d'AniList
function sameAnime(a, b) {
  if (a.anilist_id && b.anilist_id) return Number(a.anilist_id) === Number(b.anilist_id);
  return Boolean(a.mal_id && b.mal_id) && Number(a.mal_id) === Number(b.mal_id);
}

async function toggleListItem(field, anime) {
  var user = await getCurrentUser();
  if (!user) return { ok: false, needsLogin: true };
  var dbField = field === 'watchlist' ? 'watchlist' : 'favorites';
  var list = user[field] || [];
  var exists = list.some(function (a) { return sameAnime(a, anime); });
  var updated = exists ? list.filter(function (a) { return !sameAnime(a, anime); }) : list.concat([anime]);
  var patch = {};
  patch[dbField] = updated;
  var res = await sb.from('profiles').update(patch).eq('id', user.id).select('id');
  if (res.error || !(res.data && res.data.length)) {
    console.error('Mise à jour de la liste :', res.error);
    return { ok: false, error: 'La liste n\'a pas pu être mise à jour. Réessaie.' };
  }
  user[field] = updated;
  return { ok: true, added: !exists, list: updated };
}

/* ---- Reprendre la lecture ---- */
function continueKey(item) { return (item.src === 'anilist' ? 'a' : 'm') + Number(item.id); }

function sameContinueEntry(x, entry) {
  return continueKey(x) === continueKey(entry) || (x.src !== 'anilist' && Boolean(entry.malId) && Number(x.id) === Number(entry.malId));
}

async function saveContinueWatching(entry) {
  var user = await getCurrentUser();
  if (!user || !entry.duration || entry.currentTime < 3) return;
  var list = (user.continueWatching || []).filter(function (x) { return !sameContinueEntry(x, entry); });
  if (entry.currentTime / entry.duration <= 0.95) list.unshift(Object.assign({}, entry, { updatedAt: Date.now() }));
  list = list.slice(0, 10);
  var res = await sb.from('profiles').update({ continue_watching: list }).eq('id', user.id);
  if (!res.error) user.continueWatching = list;
}

async function removeContinueWatching(key) {
  var user = await getCurrentUser();
  if (!user) return { ok: false };
  var list = (user.continueWatching || []).filter(function (x) { return continueKey(x) !== key; });
  var res = await sb.from('profiles').update({ continue_watching: list }).eq('id', user.id);
  if (res.error) return { ok: false };
  user.continueWatching = list;
  return { ok: true };
}

/* ---- Fonctions serveur (Premium, Anime Coins, clés) ---- */
var RPC_MESSAGES = {
  not_authenticated: 'Ta session a expiré. Reconnecte-toi puis réessaie.',
  already_claimed: 'Tu as déjà récupéré cette récompense.',
  not_met: "La condition de ce succès n'est pas encore remplie.",
  not_enough: "Tu n'as pas assez d'Anime Coins.",
  already_lifetime: "Tu as déjà Soutien + à vie : rien n'a été utilisé.",
  invalid: "Cette clé n'existe pas. Vérifie chaque caractère : les clés n'utilisent ni O, ni 0, ni I, ni 1.",
  already_used: "Cette clé a déjà été utilisée : chaque clé ne fonctionne qu'une seule fois.",
  expired: 'Cette clé a expiré et ne peut plus être activée.',
  too_many_attempts: "Trop d'essais de clés en une heure. Réessaie plus tard.",
  unknown_tier: "Ce niveau Premium n'existe pas.",
  forbidden: 'Action réservée aux administrateurs.',
  pseudo_invalid: "Ce pseudo contient des caractères non autorisés ou n'a pas la bonne longueur (3 à 20 caractères).",
  pseudo_same: "C'est déjà ton pseudo actuel.",
  pseudo_taken: 'Ce pseudo est déjà utilisé par un autre membre. Choisis-en un autre.',
  pseudo_cooldown: 'Tu as déjà changé de pseudo il y a moins de 7 jours.',
  user_not_found: "Ce compte n'existe plus.",
  days_out_of_range: 'La durée doit être comprise entre 1 et 3 650 jours.',
  amount_out_of_range: 'Le montant doit être différent de 0 et ne pas dépasser 1 000 000.',
  balance_negative: "Le solde du membre ne peut pas devenir négatif.",
  count_out_of_range: 'Le nombre de clés doit être compris entre 1 et 50.',
  coins_out_of_range: "Le nombre d'Anime Coins par clé doit être compris entre 10 et 5 000."
};

async function callRpc(name, args) {
  if (!sb) return { ok: false, error: SERVICE_DOWN_MESSAGE };
  try {
    var res = await sb.rpc(name, args || {});
    if (res.error) {
      console.error('RPC ' + name + ' :', res.error);
      var msg = String(res.error.message || '');
      if (msg.indexOf('Could not find the function') !== -1) return { ok: false, error: "Cette fonction n'est pas encore installée sur le serveur (script SQL à exécuter)." };
      return { ok: false, error: RPC_MESSAGES[msg] || translateAuthError(res.error) };
    }
    var data = res.data;
    if (data && typeof data === 'object' && !Array.isArray(data) && data.ok === false) {
      return Object.assign({}, data, { ok: false, error: RPC_MESSAGES[data.reason] || 'La demande a été refusée par le serveur.' });
    }
    return Array.isArray(data) ? { ok: true, items: data } : Object.assign({ ok: true }, data);
  } catch (err) {
    return { ok: false, error: translateAuthError(err) };
  }
}

async function refreshedUser() {
  invalidateUser();
  return getCurrentUser();
}

function claimDailyReward() { return callRpc('claim_daily_reward'); }
function claimAchievement(code) { return callRpc('claim_achievement', { p_code: code }); }
function buyPremiumWithCoins(tier) { return callRpc('buy_premium_with_coins', { p_tier: tier }); }
function redeemPremiumKey(code) { return callRpc('redeem_key', { p_code: code }); }

async function listMyKeys() {
  var user = await getCurrentUser();
  if (!user) return [];
  var res = await sb.from('premium_keys').select('code, kind, tier, coins, created_at, redeemed_at').eq('buyer_id', user.id).order('created_at', { ascending: false });
  return res.error ? [] : res.data;
}

async function listPendingOrders() {
  var user = await getCurrentUser();
  if (!user) return [];
  var res = await sb.from('premium_orders').select('id, tier, amount, created_at').eq('user_id', user.id).eq('status', 'pending').not('checkout_id', 'is', null).order('created_at', { ascending: false });
  return res.error ? [] : res.data;
}

async function listCoinHistory() {
  var user = await getCurrentUser();
  if (!user) return [];
  var res = await sb.from('coin_ledger').select('amount, reason, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(12);
  return res.error ? [] : res.data;
}

/* ---- Paiement (fonctions Cloudflare, voir functions/api/checkout) ---- */
async function callCheckout(path, payload) {
  if (!sb) return { ok: false, error: SERVICE_DOWN_MESSAGE };
  var session = (await sb.auth.getSession()).data.session;
  if (!session) return { ok: false, error: 'Connecte-toi pour acheter une clé.' };
  try {
    var res = await fetch('/api/checkout/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
      body: JSON.stringify(payload)
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) return Object.assign({ ok: false, status: res.status }, data);
    return Object.assign({ ok: true }, data);
  } catch (err) {
    return { ok: false, error: 'Le service de paiement ne répond pas. Réessaie dans quelques minutes.' };
  }
}

function startCheckout(tier) { return callCheckout('create', { tier: tier }); }
function completeCheckout(orderId) { return callCheckout('complete', { orderId: orderId }); }

/* ---- Compte : pseudo et adresse e-mail ---- */
function changePseudo(pseudo) { return callRpc('change_pseudo', { p_pseudo: pseudo }); }

async function isPseudoAvailable(pseudo) {
  if (!sb) return true;
  var res = await sb.rpc('pseudo_available', { p_pseudo: pseudo });
  return res.error ? true : res.data !== false;
}

// Supabase envoie un lien de confirmation : l'adresse ne change qu'après le clic sur ce lien
async function changeEmail(email) {
  if (!sb) return { ok: false, error: SERVICE_DOWN_MESSAGE };
  try {
    var redirectTo = new URL('parametres.html#compte', window.location.href).href;
    var res = await sb.auth.updateUser({ email: email }, { emailRedirectTo: redirectTo });
    if (res.error) return { ok: false, error: translateAuthError(res.error) };
    return { ok: true, pending: res.data && res.data.user ? res.data.user.new_email || email : email };
  } catch (err) {
    return { ok: false, error: translateAuthError(err) };
  }
}

async function pendingEmailChange() {
  if (!sb) return null;
  var res = await sb.auth.getUser();
  return res.data && res.data.user ? res.data.user.new_email || null : null;
}

/* ---- Succès ---- */
async function achievementsOverview() {
  if (!sb) return { ok: false };
  var res = await sb.rpc('achievements_overview');
  if (res.error || !res.data) return { ok: false };
  return Object.assign({ ok: true }, res.data);
}

/* ---- Administration (fonctions serveur réservées au rôle admin) ---- */
async function adminRead(name) {
  if (!sb) return { ok: false, error: SERVICE_DOWN_MESSAGE };
  var res = await sb.rpc(name);
  if (res.error) {
    var msg = String(res.error.message || '');
    if (msg.indexOf('Could not find the function') !== -1) return { ok: false, error: "Le script SQL v3 n'est pas encore installé sur Supabase." };
    return { ok: false, error: RPC_MESSAGES[msg] || 'Lecture impossible : ' + msg };
  }
  return { ok: true, data: res.data };
}

function adminStats() { return adminRead('admin_stats'); }
function adminListUsers() { return adminRead('admin_list_users'); }
function adminListKeys() { return adminRead('admin_list_keys'); }
function adminListOrders() { return adminRead('admin_list_orders'); }
function adminListLog() { return adminRead('admin_list_log'); }
function setUserRole(id, role) { return callRpc('admin_set_role', { p_user: id, p_role: role }); }
function adminSetPremium(id, tier, days, extend) { return callRpc('admin_set_premium', { p_user: id, p_tier: tier, p_days: days || null, p_extend: !!extend }); }
function adminAdjustCoins(id, delta, note) { return callRpc('admin_adjust_coins', { p_user: id, p_delta: delta, p_note: note || '' }); }
function adminResetStreak(id) { return callRpc('admin_reset_streak', { p_user: id }); }
function adminDeleteUser(id) { return callRpc('admin_delete_user', { p_user: id }); }
function adminRevokeKey(code) { return callRpc('admin_revoke_key', { p_code: code }); }
function adminGenerateKeys(opts) {
  return callRpc('admin_generate_keys', { p_kind: opts.kind, p_tier: opts.tier || null, p_coins: opts.coins || null, p_count: opts.count, p_source: opts.source });
}

// Diagnostic des paiements (route serveur réservée aux administrateurs, aucun paiement créé)
async function adminPaymentStatus() {
  if (!sb) return { ok: false, error: SERVICE_DOWN_MESSAGE };
  var session = (await sb.auth.getSession()).data.session;
  if (!session) return { ok: false, error: 'Ta session a expiré. Reconnecte-toi.' };
  try {
    var res = await fetch('/api/checkout/status', { headers: { Authorization: 'Bearer ' + session.access_token, Accept: 'application/json' } });
    var data = await res.json().catch(function () { return {}; });
    if (res.status === 404) return { ok: false, error: "La route de paiement n'est pas déployée sur ce serveur." };
    if (!res.ok) return { ok: false, error: data.error || 'Erreur HTTP ' + res.status };
    return Object.assign({ ok: true }, data);
  } catch (err) {
    return { ok: false, error: 'Le serveur de paiement ne répond pas.' };
  }
}

/* ---- Statistiques de fréquentation (identifiant de visite aléatoire, sans donnée personnelle) ---- */
var STAT_HEARTBEAT = 60 * 1000;
var statSessionId = (function () {
  try {
    var id = sessionStorage.getItem('lum_visit');
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 3 | 8)).toString(16);
      });
      sessionStorage.setItem('lum_visit', id);
    }
    return id;
  } catch (e) { return null; }
})();

function statPage() { return (document.body && document.body.getAttribute('data-page')) || location.pathname.replace(/^\/|\.html$/g, '') || 'accueil'; }

function trackVisit(newPage) {
  if (!sb || !statSessionId) return;
  sb.rpc('track_visit', { p_session: statSessionId, p_page: statPage(), p_new_page: !!newPage }).then(function () {}, function () {});
}

function trackTitleView(animeId, title) {
  if (!sb || !statSessionId || !Number(animeId)) return;
  sb.rpc('track_title_view', { p_session: statSessionId, p_anime: Number(animeId), p_title: String(title || '') }).then(function () {}, function () {});
}

async function topViewed(limit) {
  if (!sb) return [];
  var res = await sb.rpc('top_viewed', { p_limit: limit || 10 });
  return res.error || !Array.isArray(res.data) ? [] : res.data;
}

function adminSiteStats() { return adminRead('admin_site_stats'); }

(function () {
  if (!sb || !statSessionId) return;
  function start() {
    if (/\/admin(\.html)?$/.test(location.pathname)) return;
    trackVisit(true);
    setInterval(function () { if (!document.hidden) trackVisit(false); }, STAT_HEARTBEAT);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) trackVisit(false); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
