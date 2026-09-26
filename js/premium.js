/* =========================================================
   LumaAnime — premium.js
   Niveaux Premium, règles des Anime Coins et petits calculs d'affichage.
   Les valeurs doivent rester identiques à celles des scripts du dossier supabase/ :
   c'est le serveur qui applique réellement les règles.
   ========================================================= */

var PREMIUM_TIERS = {
  soutien: {
    key: 'soutien',
    name: 'Soutien',
    price: 3.9,
    priceLabel: '3,90 €',
    durationDays: 30,
    durationLabel: '30 jours',
    coins: 1500,
    perks: ['Zéro publicité', 'Lecture en avance sur certains titres', 'Badge de soutien sur ton profil']
  },
  soutien_plus: {
    key: 'soutien_plus',
    name: 'Soutien +',
    price: 46.8,
    priceLabel: '46,80 €',
    durationDays: null,
    durationLabel: 'à vie',
    coins: 15000,
    perks: ['Tous les avantages Soutien', 'Téléchargement hors-ligne', 'Support prioritaire']
  }
};

var COIN_RULES = {
  base: 10,
  perStreakDay: 2,
  maxDaily: 30,
  weekBonus: 50,
  monthBonus: 150,
  timeZone: 'Europe/Paris'
};

// Succès : seuils et récompenses identiques à achievement_rules() (supabase/v3-securite-admin-succes.sql)
var ACHIEVEMENT_CATEGORIES = [
  { key: 'profil', label: 'Profil', icon: 'user' },
  { key: 'collection', label: 'Collection', icon: 'bookmark' },
  { key: 'serie', label: 'Série quotidienne', icon: 'flame' },
  { key: 'fidelite', label: 'Fidélité', icon: 'calendar' },
  { key: 'anciennete', label: 'Ancienneté', icon: 'clock' },
  { key: 'economie', label: 'Économie', icon: 'coin' },
  { key: 'premium', label: 'Premium et clés', icon: 'crown' },
  { key: 'chasseur', label: 'Chasseur de succès', icon: 'trophy' }
];

var DIFFICULTIES = {
  facile: { label: 'Facile', rank: 1 },
  moyen: { label: 'Moyen', rank: 2 },
  difficile: { label: 'Difficile', rank: 3 },
  tres_difficile: { label: 'Très difficile', rank: 4 },
  legendaire: { label: 'Légendaire', rank: 5 }
};

function ach(code, category, title, text, metric, threshold, reward, difficulty, minAge) {
  return { code: code, category: category, title: title, text: text, metric: metric, threshold: threshold, reward: reward, difficulty: difficulty, minAge: minAge || 0 };
}

var ACHIEVEMENTS = [
  ach('profil_complet', 'profil', 'Profil complet', 'Ajoute une photo de profil et une bannière.', 'profile_images', 1, 50, 'facile'),
  ach('profil_public', 'profil', 'Visage public', 'Rends ton profil visible publiquement.', 'public_profile', 1, 20, 'facile'),
  ach('styliste', 'profil', 'Styliste', "Choisis une autre couleur que celle d'origine pour le site.", 'custom_theme', 1, 20, 'facile'),
  ach('premiere_watchlist', 'collection', 'Premier choix', 'Ajoute un premier anime à ta watchlist.', 'watchlist', 1, 15, 'facile'),
  ach('collectionneur', 'collection', 'Collectionneur', 'Garde 25 animes différents dans ta watchlist.', 'watchlist', 25, 60, 'moyen', 7),
  ach('archiviste', 'collection', 'Archiviste', 'Garde 100 animes différents dans ta watchlist.', 'watchlist', 100, 150, 'difficile', 30),
  ach('bibliotheque', 'collection', 'Bibliothèque vivante', 'Garde 300 animes différents dans ta watchlist.', 'watchlist', 300, 350, 'tres_difficile', 90),
  ach('coup_de_coeur', 'collection', 'Coups de cœur', 'Ajoute 10 animes à tes favoris.', 'favorites', 10, 40, 'moyen', 7),
  ach('passionne', 'collection', 'Passionné', 'Ajoute 50 animes à tes favoris.', 'favorites', 50, 150, 'difficile', 30),
  ach('pantheon', 'collection', 'Panthéon', 'Ajoute 150 animes à tes favoris.', 'favorites', 150, 350, 'tres_difficile', 90),
  ach('serie_7', 'serie', 'Une semaine pile', 'Atteins une série de 7 jours de récompenses quotidiennes.', 'best_streak', 7, 60, 'moyen'),
  ach('serie_30', 'serie', 'Un mois sans faille', 'Atteins une série de 30 jours.', 'best_streak', 30, 200, 'difficile'),
  ach('serie_60', 'serie', 'Deux mois de suite', 'Atteins une série de 60 jours.', 'best_streak', 60, 350, 'difficile'),
  ach('serie_100', 'serie', 'Centurion', 'Atteins une série de 100 jours.', 'best_streak', 100, 600, 'tres_difficile'),
  ach('serie_200', 'serie', 'Inarrêtable', 'Atteins une série de 200 jours.', 'best_streak', 200, 1000, 'tres_difficile'),
  ach('serie_365', 'serie', 'Une année entière', 'Atteins une série de 365 jours.', 'best_streak', 365, 2000, 'legendaire'),
  ach('fidele_30', 'fidelite', 'Habitué', 'Récupère 30 récompenses quotidiennes au total.', 'daily_days', 30, 80, 'moyen'),
  ach('fidele_100', 'fidelite', 'Fidèle', 'Récupère 100 récompenses quotidiennes au total.', 'daily_days', 100, 250, 'difficile'),
  ach('fidele_250', 'fidelite', 'Pilier', 'Récupère 250 récompenses quotidiennes au total.', 'daily_days', 250, 500, 'tres_difficile'),
  ach('fidele_500', 'fidelite', 'Gardien du site', 'Récupère 500 récompenses quotidiennes au total.', 'daily_days', 500, 1200, 'legendaire'),
  ach('fidele_1000', 'fidelite', 'Mille matins', 'Récupère 1 000 récompenses quotidiennes au total.', 'daily_days', 1000, 2500, 'legendaire'),
  ach('anciennete_3m', 'anciennete', 'Trois mois', 'Sois membre depuis 90 jours.', 'age_days', 90, 100, 'moyen'),
  ach('anciennete_6m', 'anciennete', 'Six mois', 'Sois membre depuis 182 jours.', 'age_days', 182, 200, 'difficile'),
  ach('anciennete_1a', 'anciennete', 'Premier anniversaire', 'Sois membre depuis un an.', 'age_days', 365, 400, 'tres_difficile'),
  ach('anciennete_2a', 'anciennete', 'Vétéran', 'Sois membre depuis deux ans.', 'age_days', 730, 900, 'legendaire'),
  ach('anciennete_3a', 'anciennete', 'Ancien', 'Sois membre depuis trois ans.', 'age_days', 1095, 1500, 'legendaire'),
  ach('tirelire', 'economie', 'Tirelire', 'Possède 1 000 Anime Coins en même temps.', 'coins', 1000, 60, 'moyen'),
  ach('coffre_fort', 'economie', 'Coffre-fort', 'Possède 5 000 Anime Coins en même temps.', 'coins', 5000, 250, 'difficile'),
  ach('dragon', 'economie', 'Trésor du dragon', 'Possède 15 000 Anime Coins en même temps.', 'coins', 15000, 800, 'legendaire'),
  ach('gagne_2500', 'economie', 'Petit pécule', 'Gagne 2 500 Anime Coins au total, hors succès.', 'earned', 2500, 120, 'difficile'),
  ach('gagne_10000', 'economie', 'Fortune', 'Gagne 10 000 Anime Coins au total, hors succès.', 'earned', 10000, 500, 'tres_difficile'),
  ach('gagne_25000', 'economie', 'Magnat', 'Gagne 25 000 Anime Coins au total, hors succès.', 'earned', 25000, 1500, 'legendaire'),
  ach('premiere_cle', 'premium', 'Première clé', "Active une clé LumaAnime.", 'keys', 1, 30, 'facile'),
  ach('cles_5', 'premium', 'Trousseau', "Active 5 clés LumaAnime.", 'keys', 5, 150, 'difficile'),
  ach('soutien_actif', 'premium', 'Soutien', 'Aie un Premium actif.', 'premium', 1, 100, 'moyen'),
  ach('mecene', 'premium', 'Mécène', 'Obtiens le Premium Soutien + à vie.', 'lifetime', 1, 500, 'tres_difficile'),
  ach('economiste', 'premium', 'Économiste', 'Débloque le Premium avec tes Anime Coins.', 'bought_with_coins', 1, 200, 'difficile'),
  ach('economiste_3', 'premium', 'Stratège', 'Débloque le Premium 3 fois avec tes Anime Coins.', 'bought_with_coins', 3, 500, 'tres_difficile'),
  ach('chasseur_10', 'chasseur', 'Chasseur', 'Débloque 10 succès.', 'achievements', 10, 200, 'difficile'),
  ach('chasseur_20', 'chasseur', 'Traqueur', 'Débloque 20 succès.', 'achievements', 20, 600, 'tres_difficile'),
  ach('chasseur_30', 'chasseur', 'Collectionneur de trophées', 'Débloque 30 succès.', 'achievements', 30, 1200, 'legendaire'),
  ach('platine', 'chasseur', 'Platine', 'Débloque tous les autres succès.', 'achievements', 41, 3000, 'legendaire')
];

// Mesures calculables sans le serveur (affichage provisoire si le script SQL v3 n'est pas encore installé)
function localAchievementMetrics(user) {
  if (!user) return {};
  var status = premiumStatus(user);
  return {
    profile_images: user.avatarUrl && user.bannerUrl ? 1 : 0,
    public_profile: user.settings.publicProfile ? 1 : 0,
    custom_theme: user.settings.themePreset && user.settings.themePreset !== 'original' ? 1 : 0,
    watchlist: (user.watchlist || []).length,
    favorites: (user.favorites || []).length,
    best_streak: user.bestStreak || user.streak || 0,
    age_days: user.joinedAt ? Math.floor((Date.now() - user.joinedAt) / 86400000) : 0,
    coins: user.coins || 0,
    premium: status.active ? 1 : 0,
    lifetime: status.lifetime ? 1 : 0,
    achievements: (user.achievements || []).length
  };
}

function formatCoins(n) {
  return Number(n || 0).toLocaleString('fr-FR') + ' AC';
}

function formatDateFr(date, withTime, short) {
  if (!date) return '';
  var opts = { day: 'numeric', month: short ? 'short' : 'long', year: 'numeric' };
  if (withTime) { opts.hour = '2-digit'; opts.minute = '2-digit'; }
  return new Date(date).toLocaleDateString('fr-FR', opts);
}

// Statut Premium calculé à partir du profil (le serveur reste la référence)
function premiumStatus(user) {
  if (!user || !user.premiumTier) return { active: false };
  var legacy = user.premiumTier === 'legacy';
  var tier = legacy ? PREMIUM_TIERS.soutien : PREMIUM_TIERS[user.premiumTier];
  if (!tier) return { active: false };
  var until = user.premiumUntil ? new Date(user.premiumUntil) : null;
  var active = !until || until.getTime() > Date.now();
  var msLeft = until ? until.getTime() - Date.now() : null;
  return {
    active: active,
    legacy: legacy,
    tier: tier,
    since: user.premiumSince ? new Date(user.premiumSince) : null,
    until: until,
    lifetime: !until && !legacy,
    daysLeft: msLeft === null ? null : Math.max(0, Math.ceil(msLeft / 86400000)),
    msLeft: msLeft
  };
}

function formatRemaining(ms) {
  if (ms === null || ms === undefined) return 'Sans limite';
  if (ms <= 0) return 'Expiré';
  var days = Math.floor(ms / 86400000);
  var hours = Math.floor((ms % 86400000) / 3600000);
  if (days >= 2) return days + ' jours';
  if (days === 1) return '1 jour et ' + hours + ' h';
  var minutes = Math.floor((ms % 3600000) / 60000);
  return hours + ' h ' + String(minutes).padStart(2, '0');
}

/* ---- Récompense quotidienne (aperçu ; le calcul officiel est fait par le serveur) ---- */
function parisDateString(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: COIN_RULES.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date || new Date());
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

function dailyRewardFor(streak) {
  return Math.min(COIN_RULES.base + COIN_RULES.perStreakDay * (streak - 1), COIN_RULES.maxDaily);
}

function dailyPreview(user) {
  var today = parisDateString();
  var last = user.lastDaily || null;
  if (last === today) return { available: false, streak: user.streak || 0 };
  var gap = last ? daysBetween(last, today) : null;
  var current = user.streak || 0;
  var streak = gap === 1 ? current + 1 : gap === 2 ? Math.max(current, 1) : 1;
  var grows = streak !== current;
  var bonus = 0;
  if (grows && streak % 7 === 0) bonus += COIN_RULES.weekBonus;
  if (grows && streak % 30 === 0) bonus += COIN_RULES.monthBonus;
  return { available: true, streak: streak, reward: dailyRewardFor(streak), bonus: bonus, resets: gap !== null && gap > 2, grace: gap === 2 };
}

/* ---- Clés Premium ---- */
var KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function normalizeKey(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Nouvelles clés : « LUM » ; les clés émises avant le changement de nom (« MYA ») restent valables
var KEY_PREFIXES = ['LUM', 'MYA'];

function keyPrefix(raw) {
  return KEY_PREFIXES.filter(function (p) { return raw.indexOf(p) === 0; })[0] || null;
}

function formatKey(value) {
  var raw = normalizeKey(value);
  var prefix = keyPrefix(raw);
  if (!prefix) return raw;
  var groups = raw.slice(3, 19).match(/.{1,4}/g) || [];
  return raw.length <= 3 ? raw : prefix + '-' + groups.join('-');
}

function keyItemHTML(k) {
  var tier = PREMIUM_TIERS[k.tier];
  var what = k.kind === 'coins' ? formatCoins(k.coins) : 'Premium ' + (tier ? tier.name + ' (' + tier.durationLabel + ')' : '');
  var used = !!k.redeemed_at;
  return '<li>' +
    '<div>' +
      '<p class="key-code">' + escapeHTML(formatKey(k.code)) + '</p>' +
      '<p class="key-meta"><span>' + escapeHTML(what) + '</span><span>Achetée le ' + escapeHTML(formatDateFr(k.created_at)) + '</span>' +
        '<span class="badge ' + (used ? 'badge--muted' : 'badge--gold') + '">' + (used ? 'Déjà utilisée' : 'Disponible') + '</span></p>' +
    '</div>' +
    (used ? '' : '<button class="btn btn-sm" type="button" data-copy="' + escapeHTML(formatKey(k.code)) + '">' + icon('copy') + '<span>Copier<span class="sr-only"> la clé ' + escapeHTML(formatKey(k.code)) + '</span></span></button>') +
  '</li>';
}

// Paiements terminés côté SumUp mais dont la clé n'a pas encore été récupérée (page fermée trop tôt, coupure…)
async function renderPendingOrders(container, onKey) {
  if (!container || typeof listPendingOrders !== 'function') return;
  var orders = await listPendingOrders();
  container.innerHTML = orders.map(function (o) {
    var tier = PREMIUM_TIERS[o.tier];
    return '<div class="notice"><svg class="icon" aria-hidden="true" focusable="false"><use href="assets/icons/sprite.svg#card"></use></svg><div class="notice-body">' +
      '<p><strong>Paiement en attente de vérification</strong> : clé ' + escapeHTML(tier ? tier.name : o.tier) + ' du ' + escapeHTML(formatDateFr(o.created_at, true)) + '. Si tu as bien payé, vérifie le paiement pour récupérer ta clé.</p>' +
      '<button class="btn btn-sm" type="button" data-check-order="' + escapeHTML(o.id) + '">Vérifier le paiement</button></div></div>';
  }).join('');
  container.querySelectorAll('[data-check-order]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      setBusy(btn, true, 'Vérification…');
      var res = await completeCheckout(btn.getAttribute('data-check-order'));
      setBusy(btn, false);
      if (!res.ok) { showToast(res.error || 'Le paiement n\'est pas confirmé par SumUp.', res.status === 409 ? 'warning' : 'error'); return; }
      showToast('Paiement confirmé : ta clé ' + formatKey(res.key) + ' est disponible.', 'success');
      if (onKey) onKey(res.key);
    });
  });
}

function validateKey(value) {
  var raw = normalizeKey(value);
  if (!raw) return 'Saisis ta clé Premium.';
  var prefix = keyPrefix(raw);
  if (!prefix) return 'Une clé LumaAnime commence par « LUM » (ou « MYA » pour les clés plus anciennes).';
  var body = raw.slice(3);
  if (body.length < 16) return 'Clé incomplète : il manque ' + (16 - body.length) + ' caractère' + (16 - body.length > 1 ? 's' : '') + ' après « ' + prefix + ' ».';
  if (body.length > 16) return 'Clé trop longue : elle compte 16 caractères après « ' + prefix + ' ».';
  var bad = body.split('').filter(function (c) { return KEY_ALPHABET.indexOf(c) === -1; });
  if (bad.length) return 'Caractère impossible dans une clé : « ' + bad[0] + ' ». Les clés n\'utilisent ni O, ni 0, ni I, ni 1.';
  return '';
}
