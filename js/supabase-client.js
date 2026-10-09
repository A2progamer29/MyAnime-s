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
    decorationId: row.decoration_id || null,
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
  var profile = await fetchProfile(authUser.id);
  // Pseudo pris entre l'inscription et la confirmation : le serveur en a attribué un autre, on prévient
  if (profile && profile.pseudo && profile.pseudo.toLowerCase() !== String(pseudo).toLowerCase() && typeof showToast === 'function') {
    showToast('Le pseudo « ' + pseudo + ' » était déjà pris : ton compte s\'appelle « ' + profile.pseudo + ' ». Tu peux le changer dans Paramètres.', 'info');
  }
  return profile;
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
  if (msg.indexOf('email not confirmed') !== -1) return 'Ton adresse e-mail n\'est pas encore confirmée. Saisis le code reçu par e-mail pour activer ton compte.';
  if (msg.indexOf('token') !== -1 && (msg.indexOf('expired') !== -1 || msg.indexOf('invalid') !== -1)) return 'Code incorrect ou expiré. Vérifie les chiffres ou demande un nouveau code.';
  if (msg.indexOf('rate limit') !== -1 || msg.indexOf('security purposes') !== -1 || msg.indexOf('too many') !== -1) return 'Trop de tentatives rapprochées. Patiente quelques minutes avant de réessayer.';
  if (msg.indexOf('different from the old') !== -1) return 'Le nouveau mot de passe doit être différent de l\'ancien.';
  if (msg.indexOf('error sending') !== -1 || (error.status >= 500 && msg.indexOf('email') !== -1)) return 'L\'e-mail n\'a pas pu être envoyé : le service d\'envoi du site rencontre un problème. Réessaie dans quelques minutes.';
  if (msg.indexOf('session missing') !== -1 || msg.indexOf('session_not_found') !== -1 || msg.indexOf('jwt expired') !== -1) return 'Le lien a expiré ou a déjà servi. Redemande un lien de réinitialisation.';
  if (msg.indexOf('otp') !== -1 && msg.indexOf('expired') !== -1) return 'Le lien a expiré. Redemande un lien de réinitialisation.';
  if (msg.indexOf('password') !== -1 && msg.indexOf('characters') !== -1) return 'Le mot de passe est trop court pour le serveur. Utilise au moins 8 caractères.';
  if (msg.indexOf('weak') !== -1) return 'Ce mot de passe est jugé trop faible. Choisis-en un plus long ou moins courant.';
  if (msg.indexOf('invalid') !== -1 && msg.indexOf('email') !== -1) return 'Cette adresse e-mail n\'est pas acceptée. Vérifie qu\'elle est bien écrite.';
  console.error('Refus du serveur :', error.message);
  return 'Le serveur a refusé la demande. Réessaie dans un instant.';
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

async function verifySignupCode(email, code) {
  if (!sb) return { ok: false, error: SERVICE_DOWN_MESSAGE };
  try {
    var res = await sb.auth.verifyOtp({ email: email, token: code, type: 'signup' });
    if (res.error) return { ok: false, error: translateAuthError(res.error) };
    invalidateUser();
    return { ok: true, user: await getCurrentUser() };
  } catch (err) {
    return { ok: false, error: translateAuthError(err) };
  }
}

async function resendSignupCode(email) {
  if (!sb) return { ok: false, error: SERVICE_DOWN_MESSAGE };
  try {
    var res = await sb.auth.resend({ type: 'signup', email: email });
    if (res.error) return { ok: false, error: translateAuthError(res.error) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: translateAuthError(err) };
  }
}

async function loginUser(email, password) {
  if (!sb) return { ok: false, error: SERVICE_DOWN_MESSAGE };
  try {
    var res = await sb.auth.signInWithPassword({ email: email, password: password });
    if (res.error) return { ok: false, error: translateAuthError(res.error), unconfirmed: /email not confirmed/i.test(res.error.message || '') };
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
  console.error('Envoi refusé :', error && error.message);
  return 'L\'envoi a échoué. Réessaie avec une autre image (PNG, JPEG, WebP ou GIF).';
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
    var res = await sb.from('profiles').select(PUBLIC_PROFILE_COLUMNS + ', decoration_id').eq('id', id).maybeSingle();
    if (res.error) res = await sb.from('profiles').select(PUBLIC_PROFILE_COLUMNS).eq('id', id).maybeSingle();
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
    var msg = String((res.error && res.error.message) || '');
    if (/list_daily_limit/.test(msg)) return { ok: false, error: 'Tu as déjà ajouté 150 animes aujourd\'hui à tes listes. Reviens demain pour en ajouter d\'autres.' };
    if (/favorites_max|watchlist_max/.test(msg)) return { ok: false, error: 'Ta liste est pleine (2 000 animes maximum). Retire des titres pour en ajouter.' };
    if (/list_too_large/.test(msg)) return { ok: false, error: RPC_MESSAGES.list_too_large };
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

// entry.embed : lecteur intégré (VOE, Vidmoly…) dont la position n'est pas lisible : on retient seulement l'épisode
async function saveContinueWatching(entry) {
  var user = await getCurrentUser();
  if (!user) return;
  if (!entry.embed && (!entry.duration || entry.currentTime < 3)) return;
  var list = (user.continueWatching || []).filter(function (x) { return !sameContinueEntry(x, entry); });
  if (entry.embed) list.unshift(Object.assign({}, entry, { embed: true, currentTime: 0, duration: 0, updatedAt: Date.now() }));
  else if (entry.currentTime / entry.duration <= 0.95) list.unshift(Object.assign({}, entry, { updatedAt: Date.now() }));
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
  coins_out_of_range: "Le nombre d'Anime Coins par clé doit être compris entre 10 et 5 000.",
  missing_voter: 'Vote impossible : ton navigateur bloque le stockage local. Autorise-le ou connecte-toi.',
  wish_not_found: "Cette proposition n'existe plus.",
  wish_closed: "Les votes sont fermés pour cet anime : il a déjà été traité par l'équipe.",
  rate_limited: 'Trop de votes en peu de temps. Patiente une minute.',
  login_required: 'Connecte-toi pour proposer un anime.',
  invalid_wish: 'Proposition invalide.',
  wish_limit: "Tu as déjà proposé 10 animes aujourd'hui. Reviens demain.",
  invalid_status: 'Statut inconnu.',
  invalid_anime: 'Anime introuvable.',
  too_fast: 'Échange déjà en cours : patiente quelques secondes avant de recommencer.',
  coins_no_lifetime: "Le Premium à vie ne s'échange pas contre des Anime Coins : choisis 30, 60 ou 90 jours.",
  setting_invalid: 'Réglage invalide : vérifie les champs obligatoires.',
  decoration_unavailable: "Cette décoration n'est plus disponible.",
  decoration_owned: 'Tu possèdes déjà cette décoration.',
  decoration_not_owned: "Tu dois d'abord obtenir cette décoration pour l'équiper.",
  decoration_invalid: 'Décoration invalide : nom, image en https:// et prix entre 0 et 3 € (par paliers de 0,50 €) obligatoires.',
  achievement_invalid: 'Succès invalide : nom, statistique et au moins un palier obligatoires.',
  tiers_invalid: 'Paliers invalides : chaque objectif doit être supérieur au précédent et les récompenses positives.',
  badge_invalid: 'Badge invalide : nom obligatoire et image en https:// uniquement.',
  badges_too_many: 'Tu peux afficher 5 badges au maximum.',
  badge_not_owned: "Tu ne peux afficher que les badges que tu as obtenus.",
  owner_protected: 'Le compte propriétaire du site ne peut être modifié que par lui-même.',
  like_daily_limit: "Tu as atteint la limite de 100 j'aime par jour. Reviens demain.",
  list_too_large: 'Ta liste est trop volumineuse. Retire quelques titres puis réessaie.',
  session_expired: 'Ta session a expiré. Reconnecte-toi puis réessaie.',
  goal_over_cap: "Objectif trop élevé : cette statistique est plafonnée (2 000 pour les listes, likes et votes, 500 pour les propositions). Baisse les paliers concernés."
};

async function callRpc(name, args) {
  if (!sb) return { ok: false, error: SERVICE_DOWN_MESSAGE };
  try {
    var res = await sb.rpc(name, args || {});
    if (res.error) {
      console.error('RPC ' + name + ' :', res.error);
      var msg = String(res.error.message || '');
      if (msg.indexOf('Could not find the function') !== -1) return { ok: false, error: "Cette fonction n'est pas encore installée sur le serveur (script SQL à exécuter)." };
      if (res.error.code === '23505') return { ok: false, error: /pseudo/i.test(msg) ? RPC_MESSAGES.pseudo_taken : 'Cet élément existe déjà.' };
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
function buyPremiumDays(days) { return callRpc('buy_premium_days', { p_days: Number(days) }); }
function redeemPremiumKey(code) { return callRpc('redeem_key', { p_code: code }); }

async function listMyKeys() {
  var user = await getCurrentUser();
  if (!user) return [];
  var res = await sb.from('premium_keys').select('code, kind, tier, coins, created_at, redeemed_at').eq('buyer_id', user.id).order('created_at', { ascending: false });
  return res.error ? [] : res.data;
}

async function listMyOrders() {
  var user = await getCurrentUser();
  if (!user || !sb) return null;
  var res = await sb.from('premium_orders').select('id, tier, amount, currency, status, created_at, paid_at, checkout_id').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20);
  return res.error ? null : res.data;
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
function cancelCheckout(orderId) { return callCheckout('cancel', { orderId: orderId }); }

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
var STAT_HEARTBEAT = 3 * 60 * 1000;
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

var statVisitDone = Promise.resolve();

function trackVisit(newPage) {
  if (!sb) return;
  var run = engagePost('visit', { page: statPage(), newPage: !!newPage, sid: statSessionId });
  if (newPage) statVisitDone = run;
}

function trackTitleView(animeId, title) {
  if (!sb || !Number(animeId)) return;
  statVisitDone.then(function () {
    return engagePost('view', { anime: Number(animeId), title: String(title || ''), sid: statSessionId });
  }).then(function () {}, function () {});
}

async function topViewed(limit) {
  if (!sb) return [];
  var res = await sb.rpc('top_viewed', { p_limit: limit || 10 });
  return res.error || !Array.isArray(res.data) ? [] : res.data;
}

function adminSiteStats() { return adminRead('admin_site_stats'); }

/* ---- Paramètres du site (bandeau, Coup de cœur, prix en Anime Coins) ---- */
var SITE_SETTINGS_KEY = 'lum_site_settings';
var siteSettingsPromise = null;

function cachedSiteSettings() {
  try { return JSON.parse(localStorage.getItem(SITE_SETTINGS_KEY) || 'null'); } catch (e) { return null; }
}

function loadSiteSettings(force) {
  if (siteSettingsPromise && !force) return siteSettingsPromise;
  siteSettingsPromise = (async function () {
    if (!sb) return cachedSiteSettings();
    try {
      var res = await sb.rpc('site_settings_public');
      if (res.error || !res.data) return cachedSiteSettings();
      try { localStorage.setItem(SITE_SETTINGS_KEY, JSON.stringify(res.data)); } catch (e) {}
      return res.data;
    } catch (err) { return cachedSiteSettings(); }
  })();
  return siteSettingsPromise;
}

function adminSaveSetting(key, value) { return callRpc('admin_save_setting', { p_key: key, p_value: value }); }

/* ---- Décorations de profil ---- */
// Emplacements possibles (mêmes valeurs que decoration_placement() dans supabase/v10-emplacement-decorations.sql)
var DECORATION_PLACEMENTS = [
  { key: 'avatar_frame', label: 'Cadre autour de l\'avatar', group: 'Avatar' },
  { key: 'avatar_top', label: 'Au-dessus de l\'avatar (couronne, oreilles…)', group: 'Avatar' },
  { key: 'avatar_top_left', label: 'Avatar : coin en haut à gauche', group: 'Avatar' },
  { key: 'avatar_top_right', label: 'Avatar : coin en haut à droite', group: 'Avatar' },
  { key: 'avatar_bottom_left', label: 'Avatar : coin en bas à gauche', group: 'Avatar' },
  { key: 'avatar_bottom_right', label: 'Avatar : coin en bas à droite', group: 'Avatar' },
  { key: 'banner_full', label: 'Recouvre toute la bannière', group: 'Bannière' },
  { key: 'banner_top_left', label: 'Bannière : coin en haut à gauche', group: 'Bannière' },
  { key: 'banner_top_right', label: 'Bannière : coin en haut à droite', group: 'Bannière' },
  { key: 'banner_bottom_left', label: 'Bannière : coin en bas à gauche', group: 'Bannière' },
  { key: 'banner_bottom_right', label: 'Bannière : coin en bas à droite', group: 'Bannière' }
];

var DECORATION_CATEGORIES = [
  { key: 'cadre', label: 'Cadre' },
  { key: 'accessoire', label: 'Accessoire' },
  { key: 'pins', label: 'Pin\'s et badges' },
  { key: 'banniere', label: 'Bannière' },
  { key: 'saisonnier', label: 'Saisonnier' },
  { key: 'evenement', label: 'Événement' },
  { key: 'premium', label: 'Premium' },
  { key: 'anime', label: 'Thème anime' }
];

function decorationPlacement(d) {
  var key = d && d.placement;
  return DECORATION_PLACEMENTS.some(function (p) { return p.key === key; }) ? key : 'avatar_frame';
}
function decorationOnBanner(d) { return decorationPlacement(d).indexOf('banner_') === 0; }
function decorationCategoryLabel(key) {
  var c = DECORATION_CATEGORIES.filter(function (x) { return x.key === key; })[0];
  return c ? c.label : String(key || '');
}
async function decorationsCatalog() {
  var res = await callRpc('decorations_catalog');
  return res.ok ? { ok: true, items: res.items || [], equipped: res.equipped || null, coins: res.coins } : res;
}
function obtainDecoration(id) { return callRpc('obtain_decoration', { p_id: id }); }
function equipDecoration(id) { return callRpc('equip_decoration', { p_id: id || null }); }

var decorationImageCache = {};
async function decorationImage(id) {
  if (!id || !sb) return null;
  if (decorationImageCache[id] !== undefined) return decorationImageCache[id];
  var res = await sb.from('decorations').select('image_url, name').eq('id', id).maybeSingle();
  decorationImageCache[id] = res.error || !res.data ? null : res.data;
  return decorationImageCache[id];
}

function adminListDecorations() { return adminRead('admin_list_decorations'); }
function adminSaveDecoration(d) { return callRpc('admin_save_decoration', { p: d }); }
function adminDeleteDecoration(id) { return callRpc('admin_delete_decoration', { p_id: id }); }

/* ---- Succès progressifs et badges ---- */
async function progressOverview() {
  if (!sb) return { ok: false };
  var res = await sb.rpc('progress_overview');
  if (res.error || !res.data) return { ok: false, error: res.error && /Could not find the function/.test(res.error.message || '') ? 'missing' : 'error' };
  return Object.assign({ ok: true }, res.data);
}
function claimProgress() { return callRpc('claim_progress'); }
function myBadges() { return callRpc('my_badges'); }
function setShownBadges(ids) { return callRpc('set_shown_badges', { p_ids: ids }); }

async function publicProfileExtras(id) {
  if (!sb) return null;
  var res = await sb.rpc('public_profile_extras', { p_user: id });
  return res.error ? null : res.data;
}

function adminListProgress() { return adminRead('admin_list_progress'); }
function adminSaveAchievement(a) { return callRpc('admin_save_achievement', { p: a }); }
function adminDeleteAchievement(id) { return callRpc('admin_delete_achievement', { p_id: id }); }
function adminMoveAchievement(id, dir) { return callRpc('admin_move_achievement', { p_id: id, p_direction: dir }); }
function adminSaveBadge(b) { return callRpc('admin_save_badge', { p: b }); }
function adminDeleteBadge(id) { return callRpc('admin_delete_badge', { p_id: id }); }

// Image envoyée par un administrateur (décorations, badges, Coup de cœur) dans l'espace public « site-assets »
async function adminUploadAsset(folder, file) {
  if (!sb) return { error: SERVICE_DOWN_MESSAGE };
  var ext = STORAGE_EXTENSIONS[file.type];
  if (!ext) return { error: 'Format refusé : PNG, JPG, WebP ou GIF uniquement.' };
  if (file.size > 3 * 1024 * 1024) return { error: 'Image trop lourde : 3 Mo maximum.' };
  var path = folder + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
  var up = await sb.storage.from('site-assets').upload(path, file, { contentType: file.type });
  if (up.error) return { error: translateUploadError(up.error) };
  return { url: sb.storage.from('site-assets').getPublicUrl(path).data.publicUrl };
}

/* ---- Wishboard ---- */
// Ancien identifiant de visiteur permanent : plus utilisé depuis v13, on le retire du navigateur
try { localStorage.removeItem('lum_wish_voter'); } catch (e) {}

async function wishList() {
  var res = await callRpc('wish_list', { p_visitor: null });
  if (!res.ok) return res;
  var items = res.items || [];
  if (!hasSessionHint()) items.forEach(function (w) { if (engageMirrorHas('lum_voted_wishes', w.id)) w.voted = true; });
  return { ok: true, items: items };
}

// Actions légères (vote, j'aime, vue, présence) : passent par le Worker /api/engage, qui dérive une
// identité de confiance (compte connecté ou empreinte d'IP) et applique une limite. Plus d'identifiant
// de visiteur fourni par le navigateur.
// Miroir local (affichage seulement) de ce que l'anonyme a voté/aimé, car son identité serveur est
// fondée sur l'IP et n'est pas connue du navigateur. Le serveur reste la source de vérité des compteurs.
function engageMirror(key, id, on) {
  try {
    var set = JSON.parse(localStorage.getItem(key) || '[]');
    var i = set.indexOf(String(id));
    if (on && i === -1) set.push(String(id));
    if (!on && i !== -1) set.splice(i, 1);
    localStorage.setItem(key, JSON.stringify(set.slice(-500)));
  } catch (e) {}
}
function engageMirrorHas(key, id) {
  try { return JSON.parse(localStorage.getItem(key) || '[]').indexOf(String(id)) !== -1; } catch (e) { return false; }
}

async function engagePost(action, payload, retried) {
  try {
    var headers = { 'Content-Type': 'application/json' };
    if (sb) {
      var session = (await sb.auth.getSession()).data.session;
      if (session) headers.Authorization = 'Bearer ' + session.access_token;
    }
    var res = await fetch('/api/engage', { method: 'POST', headers: headers, body: JSON.stringify(Object.assign({ action: action }, payload)) });
    var data = await res.json().catch(function () { return {}; });
    if (res.status === 401 && data.reason === 'session_expired' && !retried && sb) {
      var refreshed = await sb.auth.refreshSession().catch(function () { return null; });
      if (refreshed && refreshed.data && refreshed.data.session) return engagePost(action, payload, true);
    }
    if (!res.ok) return { ok: false, status: res.status, reason: data.reason, error: RPC_MESSAGES[data.reason] || data.error || 'Action impossible pour le moment.' };
    return Object.assign({ ok: true }, data);
  } catch (e) { return { ok: false, error: SERVICE_DOWN_MESSAGE }; }
}

// « on » = état voulu (true : voter, false : retirer) : le serveur ne bascule jamais à l'aveugle
function wishVote(id, on) {
  return engagePost('wish_vote', { wish: id, on: !!on }).then(function (r) {
    if (r.ok) engageMirror('lum_voted_wishes', id, !!r.voted);
    return r;
  });
}

function wishAdd(a) {
  return callRpc('wish_add', { p_anilist: Number(a.id), p_title: String(a.title || ''), p_image: a.image || null, p_year: a.year || null, p_format: a.format || null, p_visitor: null });
}

function adminListWishes() { return adminRead('admin_list_wishes'); }

/* ---- Likes et vues d'un anime (fiche) ---- */
async function animeStats(id) {
  if (!sb || !Number(id)) return { ok: false };
  var res = await sb.rpc('anime_stats', { p_anime: Number(id), p_visitor: null });
  if (res.error || !res.data) return { ok: false };
  var data = Object.assign({ ok: true }, res.data);
  if (!hasSessionHint() && engageMirrorHas('lum_liked_animes', id)) data.liked = true;
  return data;
}
function toggleAnimeLike(id, on) {
  return engagePost('like', { anime: Number(id), on: !!on }).then(function (r) {
    if (r.ok) engageMirror('lum_liked_animes', id, !!r.liked);
    return r;
  });
}
function adminSetWishStatus(id, status) { return callRpc('admin_set_wish_status', { p_wish: id, p_status: status }); }

/* ---- Épisodes : Anime → Saison → Épisode → Langue → Lecteur (script SQL v14) ----
   Lecture publique par fonctions serveur (jamais d'accès direct aux sources) ; écriture réservée
   aux administrateurs. Les réponses suivent callRpc : { ok, … } ou { ok:false, error, reason }. */
Object.assign(RPC_MESSAGES, {
  not_found: "Cet épisode n'est pas disponible.",
  premium_only: 'Cet épisode est en accès anticipé pour les membres Premium.',
  anime_unknown: "Cet anime n'est pas encore ajouté à LumaAnime : ajoute-le d'abord depuis la recherche.",
  episode_invalid: 'Épisode invalide : saison de 0 à 99, numéro de 0 à 5 000, durée positive.',
  episode_exists: 'Cet épisode existe déjà pour cette saison.',
  episode_not_found: "Cet épisode n'existe plus.",
  range_invalid: 'Plage invalide : 500 épisodes au maximum à la fois.',
  season_invalid: 'Saison invalide.',
  season_not_empty: "Cette saison contient encore des épisodes : supprime-les d'abord.",
  media_has_episodes: 'Cette fiche AniList a déjà ses propres épisodes : elle ne peut pas devenir la saison d\'une autre série.',
  media_already_used: 'Cette fiche AniList est déjà utilisée comme saison d\'une autre série.',
  source_empty: 'Colle un lien de lecteur ou un identifiant de fichier.',
  source_not_found: "Cette source n'existe plus.",
  source_invalid: 'Source refusée : vérifie le lien, la langue et le lecteur choisis.',
  duplicate_source: 'Une source active existe déjà pour cette langue chez ce lecteur.',
  duplicate_video: 'Ce fichier est déjà rattaché à un autre épisode.',
  provider_unknown: 'Lecteur inconnu.',
  provider_invalid: 'Lecteur invalide : clé (a-z, 0-9, _), nom et type obligatoires.',
  host_invalid: 'Domaine invalide : indique au moins un domaine autorisé (ex. voe.sx).',
  host_forbidden: 'Le domaine du site (ou de son hébergement) ne peut pas être un lecteur.',
  template_invalid: "Format d'intégration invalide : il doit commencer par https://, utiliser un domaine autorisé et contenir {id}.",
  pattern_invalid: "Format d'identifiant invalide (expression régulière).",
  embed_scheme: 'Le lien doit commencer par https://.',
  embed_host: "Ce lien ne correspond à aucun domaine autorisé pour ce lecteur.",
  video_id_format: "Identifiant de fichier au mauvais format pour ce lecteur.",
  adult_forbidden: 'Les contenus pour adultes ne peuvent pas être publiés.',
  lang_mismatch: "Langue incohérente : une VO est dans la langue d'origine de l'anime, un doublage (VF…) dans une autre langue.",
  subtitle_invalid: 'Sous-titres incohérents : choisis une langue de sous-titres, ou « aucun ».',
  language_unknown: 'Langue inconnue ou indéterminée.',
  language_invalid: 'Langue invalide : code de 2 ou 3 lettres et nom obligatoires.',
  label_invalid: 'Libellé invalide : code en majuscules (2 à 12 caractères) et nom obligatoires.',
  label_protected: 'Le libellé « AUTRE » ne peut pas être désactivé.',
  rule_exists: 'Cette règle existe déjà.',
  rule_invalid: 'Règle invalide.',
  status_invalid: 'Statut invalide.',
  season_not_found: "Cette saison n'existe plus.",
  season_offset_locked: 'Cette saison a déjà des épisodes : son décalage de numérotation ne peut plus changer (sinon la synchro créerait des doublons décalés).',
  source_no_url: "Cette source n'a pas d'adresse valide : modifie-la pour ressaisir le lien avant de la réactiver.",
  sync_running: 'Une synchronisation est déjà en cours (autre onglet ou autre administrateur).',
  original_lang_unknown: "Langue d'origine de l'anime inconnue : précise-la d'abord (en haut de sa fiche admin), elle sert à distinguer VO et doublage."
});

function publicEpisodeList(anilistId) { return callRpc('public_episode_list', { p_anilist: Number(anilistId) }); }
function publicEpisodePlayback(anilistId, season, number) {
  return callRpc('public_episode_playback', { p_anilist: Number(anilistId), p_season: Number(season), p_number: Number(number) });
}
// Disponibilité de plusieurs animes à la fois (boutons « Regarder », badges de langue)
async function publicAvailableAnimes(ids) {
  var list = (ids || []).map(Number).filter(function (n) { return Number.isInteger(n) && n > 0; }).slice(0, 100);
  if (!list.length) return { ok: true, items: [] };
  return callRpc('public_available_animes', { p_ids: list });
}
function reportBrokenSource(sourceId) { return engagePost('report', { source: String(sourceId || '') }); }

function adminEpisodeOverview(opts) {
  opts = opts || {};
  return callRpc('admin_episode_overview', { p_search: opts.search || null, p_filter: opts.filter || 'all', p_offset: Number(opts.offset) || 0, p_limit: Number(opts.limit) || 50 });
}
function adminEpisodeTree(anilistId) { return callRpc('admin_episode_tree', { p_anilist: Number(anilistId) }); }
// Aperçu admin (bouton « Tester ») : même format que publicEpisodePlayback, sources non publiées comprises
function adminEpisodePlayback(anilistId, season, number) {
  return callRpc('admin_episode_playback', { p_anilist: Number(anilistId), p_season: Number(season), p_number: Number(number) });
}
function adminSyncAnime(media, createMissing) { return callRpc('admin_sync_anime', { p_data: media, p_create_missing: !!createMissing }); }
function adminAnimesToSync(limit) { return callRpc('admin_animes_to_sync', { p_limit: Number(limit) || 50 }); }
function adminRequestSync(anilistId) { return callRpc('admin_request_sync', { p_anilist: Number(anilistId) }); }
function adminSyncLog(ok, error, info) { return callRpc('admin_sync_log', { p_ok: !!ok, p_error: error || null, p_info: info || {} }); }
function adminSyncStatus() { return callRpc('admin_sync_status', {}); }
function adminSyncBegin() { return callRpc('admin_sync_begin', {}); }
function adminSyncFailed(anilistId, message) { return callRpc('admin_sync_failed', { p_anilist: Number(anilistId), p_message: String(message || '').slice(0, 300) }); }
function adminSetAnimeLang(anilistId, lang) { return callRpc('admin_set_anime_lang', { p_anilist: Number(anilistId), p_lang: lang || null }); }
function adminUpsertSeason(s) {
  return callRpc('admin_upsert_season', { p_anilist: Number(s.anilist_id), p_number: Number(s.number), p_media: s.media_anilist_id ? Number(s.media_anilist_id) : null, p_title: s.title || '', p_offset: Number(s.episode_offset) || 0 });
}
function adminDeleteSeason(anilistId, number) { return callRpc('admin_delete_season', { p_anilist: Number(anilistId), p_number: Number(number) }); }
function adminUpsertEpisode(e) {
  return callRpc('admin_upsert_episode', {
    p_id: e.id || null, p_anilist: Number(e.anilist_id), p_season: Number(e.season), p_number: Number(e.number),
    p_kind: e.kind || 'episode', p_title: e.title || '', p_duration_sec: e.duration_sec ? Number(e.duration_sec) : null,
    p_published: e.published !== false, p_premium_until: e.premium_until || null
  });
}
function adminAddEpisodeRange(anilistId, season, from, to) {
  return callRpc('admin_add_episode_range', { p_anilist: Number(anilistId), p_season: Number(season), p_from: Number(from), p_to: Number(to) });
}
function adminDeleteEpisode(id) { return callRpc('admin_delete_episode', { p_id: id }); }
function adminUpsertSource(s) {
  return callRpc('admin_upsert_source', {
    p_id: s.id || null, p_episode: s.episode_id, p_provider: s.provider, p_video_id: s.provider_video_id || null, p_url: s.url || null,
    p_audio_lang: s.audio_lang, p_audio_kind: s.audio_kind, p_subtitle_lang: s.subtitle_lang || null, p_subtitle_kind: s.subtitle_kind || 'none',
    p_rights_basis: s.rights_basis, p_rights_note: s.rights_note || '', p_priority: s.priority === '' || s.priority == null ? null : Number(s.priority),
    p_published: s.published !== false, p_status: s.status || 'ready'
  });
}
function adminDeleteSource(id) { return callRpc('admin_delete_source', { p_id: id }); }
function adminSetSourceStatus(id, status, published, clearReports) {
  return callRpc('admin_set_source_status', { p_id: id, p_status: status || null, p_published: typeof published === 'boolean' ? published : null, p_clear_reports: !!clearReports });
}
function adminBulkQualify(o) {
  return callRpc('admin_bulk_qualify', {
    p_anilist: Number(o.anilist_id), p_season: o.season == null || o.season === '' ? null : Number(o.season), p_provider: o.provider || null,
    p_audio_lang: o.audio_lang, p_audio_kind: o.audio_kind, p_subtitle_lang: o.subtitle_lang || null, p_subtitle_kind: o.subtitle_kind || 'none',
    p_publish: o.publish !== false, p_include_admin: !!o.include_admin
  });
}
function adminListProviders() { return callRpc('admin_list_providers', {}); }
function adminSetProvider(p) {
  return callRpc('admin_set_provider', {
    p_key: p.key, p_name: p.name, p_kind: p.kind, p_priority: Number(p.priority) || 0, p_active: p.active !== false,
    p_hosts: p.hosts || [], p_template: p.embed_template || null, p_id_pattern: p.id_pattern || null, p_sandbox: p.sandbox !== false
  });
}
function adminLanguageConfig() { return callRpc('admin_language_config', {}); }
function adminAddLanguage(code, name, sort) { return callRpc('admin_add_language', { p_code: code, p_name: name, p_sort: Number(sort) || 100 }); }
function adminSetLabel(code, name, sort, active) { return callRpc('admin_set_label', { p_code: code, p_name: name, p_sort: Number(sort) || 100, p_active: active !== false }); }
function adminAddLabelRule(r) {
  return callRpc('admin_add_label_rule', { p_label: r.label_code, p_audio_kind: r.audio_kind || null, p_audio_lang: r.audio_lang || null, p_subtitle: r.subtitle, p_subtitle_lang: r.subtitle_lang || null });
}
function adminDeleteLabelRule(id) { return callRpc('admin_delete_label_rule', { p_id: Number(id) }); }

(function () {
  if (!sb) return;
  function start() {
    if (/\/admin(\.html)?$/.test(location.pathname)) return;
    trackVisit(true);
    setInterval(function () { if (!document.hidden) trackVisit(false); }, STAT_HEARTBEAT);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) trackVisit(false); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
