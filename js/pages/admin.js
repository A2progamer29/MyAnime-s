/* =========================================================
   LumaAnime — pages/admin.js
   Administration : indicateurs, épisodes (animes, saisons, sources, lecteurs, langues),
   membres (Premium, Anime Coins, rôle, série, suppression), clés, commandes et journal. Toutes les actions passent par des fonctions serveur
   qui revérifient le rôle administrateur.
   ========================================================= */

(function () {
  var state = { me: null, users: [], keys: [], current: null, loaded: {} };
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function date(v, withTime) {
    if (!v) return '—';
    var o = { day: '2-digit', month: '2-digit', year: 'numeric' };
    if (withTime) { o.hour = '2-digit'; o.minute = '2-digit'; }
    return new Date(v).toLocaleDateString('fr-FR', o);
  }
  function num(v) { return Number(v || 0).toLocaleString('fr-FR'); }
  function money(v) { return Number(v || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }); }

  function toast(message, type) {
    var box = $('[data-toasts]');
    var el = document.createElement('div');
    el.className = 'adm-toast' + (type ? ' adm-toast--' + type : '');
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.textContent = message;
    box.appendChild(el);
    setTimeout(function () { el.remove(); }, type === 'error' ? 7000 : 4000);
  }

  function confirmBox(title, text, okLabel, danger) {
    var dlg = $('[data-confirm]');
    $('[data-confirm-title]').textContent = title;
    $('[data-confirm-text]').textContent = text;
    var ok = $('[data-confirm-ok]');
    ok.textContent = okLabel || 'Confirmer';
    ok.className = 'adm-btn ' + (danger ? 'adm-btn--danger' : 'adm-btn--primary');
    return new Promise(function (resolve) {
      dlg.addEventListener('close', function onClose() {
        dlg.removeEventListener('close', onClose);
        resolve(dlg.returnValue === 'ok');
      });
      dlg.returnValue = '';
      dlg.showModal();
    });
  }

  async function busy(btn, fn) {
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Patiente…';
    try { return await fn(); } finally { btn.disabled = false; btn.textContent = label; }
  }

  var TIER_LABEL = { soutien: 'Soutien', soutien_plus: 'Soutien +', legacy: 'Premium (ancien)' };
  function premiumActive(u) { return !!u.premium_tier && (!u.premium_until || new Date(u.premium_until).getTime() > Date.now()); }
  function premiumTag(u) {
    if (!u.premium_tier) return '<span class="adm-muted">—</span>';
    if (!premiumActive(u)) return '<span class="adm-tag adm-tag--warn">Expiré le ' + date(u.premium_until) + '</span>';
    return '<span class="adm-tag adm-tag--gold">' + esc(TIER_LABEL[u.premium_tier] || u.premium_tier) + '</span>' +
      (u.premium_until ? ' <span class="adm-muted">jusqu\'au ' + date(u.premium_until) + '</span>' : ' <span class="adm-muted">à vie</span>');
  }
  function avatar(u) {
    var initial = esc((u.pseudo || '?').trim().charAt(0).toUpperCase());
    var src = typeof u.avatar_url === 'string' && /^https:\/\/phjpyaiheswpuqjpdfuo\.supabase\.co\/storage\/v1\/object\/public\/avatars\/[A-Za-z0-9_.\/-]+$/.test(u.avatar_url) && u.avatar_url.indexOf('..') === -1 ? u.avatar_url : '';
    return '<span class="adm-avatar" aria-hidden="true">' + (src ? '<img src="' + esc(src) + '" alt="" loading="lazy">' : initial) + '</span>';
  }

  /* ---- Navigation ---- */
  var VIEWS = ['tableau', 'stats', 'episodes', 'wishboard', 'site', 'coins', 'decorations', 'succes', 'membres', 'cles', 'commandes', 'journal'];
  function currentView() {
    var v = location.hash.replace('#', '');
    return VIEWS.indexOf(v) !== -1 ? v : 'tableau';
  }
  function showView() {
    var view = currentView();
    $$('[data-view]').forEach(function (s) { s.hidden = s.getAttribute('data-view') !== view; });
    $$('[data-nav]').forEach(function (a) {
      if (a.getAttribute('data-nav') === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    var loaders = { tableau: loadStats, stats: loadSiteStats, episodes: loadEpisodes, wishboard: loadWishes, site: loadSiteView, coins: loadCoinsView, decorations: loadDecorationsAdmin, succes: loadProgressAdmin, membres: loadUsers, cles: loadKeys, commandes: loadOrders, journal: loadLog };
    if (!state.loaded[view]) { state.loaded[view] = true; loaders[view](); }
  }

  function failRow(tbody, cols, message) {
    tbody.innerHTML = '<tr><td class="adm-empty" colspan="' + cols + '">' + esc(message) + '</td></tr>';
  }

  /* ---- Tableau de bord ---- */
  async function loadStats() {
    var box = $('[data-kpis]');
    box.innerHTML = '<p class="adm-muted">Chargement…</p>';
    var res = await adminStats();
    if (!res.ok) { box.innerHTML = '<p class="adm-muted">' + esc(res.error) + '</p>'; return; }
    var s = res.data || {};
    var kpis = [
      ['Membres', num(s.members)], ['Nouveaux (7 jours)', num(s.new_7d)], ['Premium actifs', num(s.premium_active)],
      ['Premium à vie', num(s.lifetime)], ['Anime Coins en circulation', num(s.coins_total)], ['Commandes payées', num(s.orders_paid)],
      ['Revenus encaissés', money(s.revenue)], ['Clés disponibles', num(s.keys_unused)]
    ];
    box.innerHTML = kpis.map(function (k) { return '<div class="adm-kpi"><span>' + k[0] + '</span><strong>' + k[1] + '</strong></div>'; }).join('');
  }

  /* ---- Statistiques du site ---- */
  var PAGE_LABEL = {
    accueil: 'Accueil', index: 'Accueil', wishboard: 'Wishboard', catalogue: 'Catalogue', details: 'Fiches', lecteur: 'Lecteur', simulcast: 'Simulcast',
    calendrier: 'Calendrier', premium: 'Premium', coins: 'Anime Coins', profil: 'Profils', parametres: 'Paramètres',
    connexion: 'Connexion', inscription: 'Inscription', acheter: 'Achat', paiement: 'Paiement', 'mon-premium': 'Mon Premium'
  };
  var siteTitles = [];
  var liveTimer = null;

  async function loadSiteStats() {
    var box = $('[data-site-kpis]');
    if (!box.children.length) box.innerHTML = '<p class="adm-muted">Chargement…</p>';
    var res = await adminSiteStats();
    if (!res.ok) {
      box.innerHTML = '<p class="adm-muted">' + esc(res.error.indexOf('SQL v3') !== -1 ? "Le script SQL v4 (statistiques) n'est pas encore installé sur Supabase." : res.error) + '</p>';
      return;
    }
    var s = res.data || {};
    var kpis = [
      ['Actifs maintenant', num(s.active_now)], ['Connectés', num(s.active_members)], ['Non connectés', num(s.active_guests)],
      ["Visiteurs aujourd'hui", num(s.visitors_today)], ["Pages vues aujourd'hui", num(s.views_today)],
      ['Pages vues (7 jours)', num(s.views_7d)], ['Pages vues (30 jours)', num(s.views_30d)], ['Pages vues (total)', num(s.views_total)],
      ['Vues de titres (total)', num(s.title_views_total)]
    ];
    box.innerHTML = kpis.map(function (k) { return '<div class="adm-kpi"><span>' + k[0] + '</span><strong>' + k[1] + '</strong></div>'; }).join('');

    var pages = s.active_pages || [];
    var maxPage = Math.max.apply(null, pages.map(function (p) { return p.count; }).concat(1));
    $('[data-live-pages]').innerHTML = pages.length ? pages.map(function (p) {
      return '<li><span>' + esc(PAGE_LABEL[p.page] || p.page) + '</span><span class="bar" style="width:' + Math.round(p.count / maxPage * 100) + '%"></span><strong>' + num(p.count) + '</strong></li>';
    }).join('') : '<li class="adm-muted">Personne pour le moment.</li>';

    var days = s.daily || [];
    var maxDay = Math.max.apply(null, days.map(function (d) { return d.views; }).concat(1));
    $('[data-days]').innerHTML = days.map(function (d) {
      var label = new Date(d.day + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
      return '<li title="' + esc(label + ' : ' + num(d.views) + ' pages vues, ' + num(d.visitors) + ' visiteurs') + '"><b>' + num(d.views) + '</b>' +
        '<span class="col" style="height:' + Math.round(d.views / maxDay * 100) + '%"></span><small>' + esc(label) + '</small></li>';
    }).join('');

    renderOnline(s.active_list || [], s.active_members, s.active_guests);
    siteTitles = s.titles || [];
    renderSiteTitles();
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function () { if (currentView() === 'stats' && !document.hidden) loadSiteStats(); else liveTimer = null; }, 30000);
  }

  function agoFr(date) {
    var sec = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 1000));
    return sec < 10 ? 'à l\'instant' : 'il y a ' + (sec < 60 ? sec + ' s' : Math.floor(sec / 60) + ' min');
  }

  function renderOnline(list, members, guests) {
    var tbody = $('[data-online]');
    $('[data-online-count]').textContent = num(members) + ' connecté' + (members > 1 ? 's' : '') + ' · ' + num(guests) + ' non connecté' + (guests > 1 ? 's' : '');
    if (!list.length) { failRow(tbody, 4, 'Personne en ligne pour le moment.'); return; }
    tbody.innerHTML = list.map(function (v) {
      var who = v.member
        ? '<a href="profil.html?id=' + encodeURIComponent(v.user_id) + '" target="_blank" rel="noopener">' + esc(v.pseudo || 'Membre') + '</a> <span class="adm-tag adm-tag--green">Connecté</span>'
        : '<span class="adm-muted">Visiteur</span> <span class="adm-tag">Non connecté</span>';
      var title = v.anime_id
        ? '<a href="details.html?id=' + Number(v.anime_id) + '" target="_blank" rel="noopener">' + esc(v.anime_title || ('Anime #' + v.anime_id)) + '</a>'
        : '<span class="adm-muted">—</span>';
      return '<tr><td>' + who + '</td><td>' + esc(PAGE_LABEL[v.page] || v.page) + '</td><td>' + title + '</td><td class="adm-num">' + esc(agoFr(v.last_seen)) + '</td></tr>';
    }).join('');
  }

  function renderSiteTitles() {
    var tbody = $('[data-titles]');
    var q = $('[data-titles-search]').value.trim().toLowerCase();
    var list = siteTitles.map(function (t, i) { return Object.assign({ rank: i + 1 }, t); })
      .filter(function (t) { return !q || String(t.title || '').toLowerCase().indexOf(q) !== -1; });
    if (!list.length) { failRow(tbody, 5, siteTitles.length ? 'Aucun titre ne correspond.' : 'Aucune vue enregistrée pour le moment.'); return; }
    tbody.innerHTML = list.map(function (t) {
      return '<tr><td class="adm-num">' + t.rank + '</td>' +
        '<td><a href="details.html?id=' + Number(t.id) + '" target="_blank" rel="noopener">' + esc(t.title || ('Anime #' + t.id)) + '</a></td>' +
        '<td class="adm-num">' + num(t.today) + '</td><td class="adm-num">' + num(t.week) + '</td><td class="adm-num"><strong>' + num(t.total) + '</strong></td></tr>';
    }).join('');
  }

  /* ---- Paiements SumUp ---- */
  async function loadPayments() {
    var list = $('[data-payments]');
    var card = list.closest('.adm-pay');
    var old = card.querySelector('.adm-ready');
    if (old) old.remove();
    list.innerHTML = '<li><span></span><span class="adm-muted">Vérification auprès de SumUp et Supabase…</span></li>';
    var res = await adminPaymentStatus();
    if (!res.ok) {
      list.innerHTML = '<li><span class="ko" aria-hidden="true">✕</span><span>' + esc(res.error) + '</span></li>';
      return;
    }
    list.innerHTML = (res.checks || []).map(function (c) {
      return '<li><span class="' + (c.ok ? 'ok' : 'ko') + '" aria-hidden="true">' + (c.ok ? '✓' : '✕') + '</span><span><span class="adm-sr">' + (c.ok ? 'Correct : ' : 'Problème : ') + '</span>' + esc(c.text) + '</span></li>';
    }).join('');
    list.insertAdjacentHTML('afterend', res.ready
      ? '<p class="adm-ready adm-ready--ok" role="status">Les paiements sont prêts : les membres peuvent acheter une clé.</p>'
      : '<p class="adm-ready adm-ready--ko" role="status">Les paiements ne fonctionneront pas tant que les points en rouge ne sont pas réglés.</p>');
  }

  /* ---- Membres ---- */
  async function loadUsers() {
    var tbody = $('[data-users]');
    failRow(tbody, 8, 'Chargement des membres…');
    var res = await adminListUsers();
    if (!res.ok) { failRow(tbody, 8, res.error); return; }
    state.users = res.data || [];
    renderUsers();
  }

  function filteredUsers() {
    var q = $('[data-users-search]').value.trim().toLowerCase();
    var f = $('[data-users-filter]').value;
    return state.users.filter(function (u) {
      if (q && String(u.pseudo || '').toLowerCase().indexOf(q) === -1 && String(u.email || '').toLowerCase().indexOf(q) === -1) return false;
      if (f === 'premium') return premiumActive(u);
      if (f === 'free') return !premiumActive(u);
      if (f === 'admin') return u.role === 'admin';
      return true;
    });
  }

  function renderUsers() {
    var tbody = $('[data-users]');
    var list = filteredUsers();
    $('[data-users-count]').textContent = list.length + ' sur ' + state.users.length + ' membre' + (state.users.length > 1 ? 's' : '');
    if (!list.length) { failRow(tbody, 8, 'Aucun membre ne correspond.'); return; }
    tbody.innerHTML = list.map(function (u) {
      return '<tr>' +
        '<td><div class="adm-user">' + avatar(u) + '<div><strong>' + esc(u.pseudo) + '</strong><small>' + esc(u.email) + '</small></div></div></td>' +
        '<td>' + (u.role === 'admin' ? '<span class="adm-tag adm-tag--blue">Admin</span>' : 'Membre') + '</td>' +
        '<td>' + premiumTag(u) + '</td>' +
        '<td class="adm-num">' + num(u.coins) + '</td>' +
        '<td class="adm-num">' + num(u.streak) + '</td>' +
        '<td>' + date(u.joined_at) + '</td>' +
        '<td>' + date(u.last_sign_in_at, true) + '</td>' +
        '<td><button class="adm-btn adm-btn--sm" type="button" data-open="' + esc(u.id) + '">Gérer<span class="adm-sr"> ' + esc(u.pseudo) + '</span></button></td>' +
      '</tr>';
    }).join('');
  }

  /* ---- Panneau d'un membre ---- */
  var lastOpener = null;
  function openDrawer(id, opener) {
    var u = state.users.filter(function (x) { return x.id === id; })[0];
    if (!u) return;
    state.current = u;
    lastOpener = opener || lastOpener;
    var self = state.me && u.id === state.me.id;
    $('[data-d-name]').textContent = u.pseudo;
    $('[data-d-email]').textContent = u.email || '';
    $('[data-d-facts]').innerHTML = [
      ['Identifiant', '<span class="adm-code">' + esc(u.id) + '</span>'],
      ['Inscription', date(u.joined_at, true)],
      ['Dernière connexion', date(u.last_sign_in_at, true)],
      ['E-mail confirmé', u.email_confirmed_at ? 'Oui' : 'Non'],
      ['Profil public', u.public_profile ? 'Oui' : 'Non'],
      ['Série actuelle / record', num(u.streak) + ' / ' + num(u.best_streak) + ' jours'],
      ['Succès obtenus', num(u.achievements)]
    ].map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('');
    $('[data-d-premium]').innerHTML = 'Actuellement : ' + premiumTag(u);
    $('[data-d-coins]').textContent = 'Solde actuel : ' + num(u.coins) + ' AC';
    $('[data-role]').value = u.role === 'admin' ? 'admin' : 'membre';
    $('[data-role]').disabled = self;
    $('[data-role-save]').disabled = self;
    $('[data-delete]').disabled = self;
    $('[data-self-note]').hidden = !self;
    syncPremiumForm();
    $('[data-drawer]').hidden = false;
    $('.adm-drawer-panel').focus();
  }
  function closeDrawer() {
    $('[data-drawer]').hidden = true;
    state.current = null;
    if (lastOpener && document.body.contains(lastOpener)) lastOpener.focus();
  }
  function syncPremiumForm() {
    var form = $('[data-premium-form]');
    var lifetime = form.elements.tier.value === 'soutien_plus';
    $('[data-days-field]').hidden = lifetime;
    $('[data-extend-field]').hidden = lifetime;
    $('[data-premium-remove]').disabled = !(state.current && state.current.premium_tier);
  }
  async function refreshAfter(message) {
    toast(message, 'success');
    var id = state.current && state.current.id;
    var res = await adminListUsers();
    if (res.ok) { state.users = res.data || []; renderUsers(); }
    state.loaded.tableau = false;
    state.loaded.journal = false;
    if (id && !$('[data-drawer]').hidden) openDrawer(id);
  }

  function bindDrawer() {
    $$('[data-drawer-close]').forEach(function (b) { b.addEventListener('click', closeDrawer); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('[data-drawer]').hidden && !$('[data-confirm]').open) closeDrawer();
    });

    var pForm = $('[data-premium-form]');
    pForm.elements.tier.addEventListener('change', syncPremiumForm);
    pForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var u = state.current;
      var tier = pForm.elements.tier.value;
      var days = Number(pForm.elements.days.value);
      var extend = pForm.elements.extend.checked;
      if (tier === 'soutien' && (!Number.isInteger(days) || days < 1 || days > 3650)) { toast('La durée doit être un nombre entier entre 1 et 3 650 jours.', 'error'); pForm.elements.days.focus(); return; }
      var what = tier === 'soutien_plus' ? 'Soutien + à vie' : 'Soutien pour ' + days + ' jour' + (days > 1 ? 's' : '') + (extend ? ' (ajoutés à la durée restante)' : ' (à partir d\'aujourd\'hui)');
      if (!(await confirmBox('Donner le Premium ?', u.pseudo + ' recevra ' + what + '.', 'Donner le Premium'))) return;
      var res = await busy(e.submitter || pForm.querySelector('[type="submit"]'), function () { return adminSetPremium(u.id, tier, days, extend); });
      if (!res.ok) { toast(res.error, 'error'); return; }
      refreshAfter('Premium mis à jour pour ' + u.pseudo + '.');
    });
    $('[data-premium-remove]').addEventListener('click', async function () {
      var u = state.current;
      if (!(await confirmBox('Retirer le Premium ?', 'Le Premium de ' + u.pseudo + ' sera retiré immédiatement, sans remboursement automatique.', 'Retirer', true))) return;
      var btn = this;
      var res = await busy(btn, function () { return adminSetPremium(u.id, null, null, false); });
      if (!res.ok) { toast(res.error, 'error'); return; }
      refreshAfter('Premium retiré pour ' + u.pseudo + '.');
    });

    var cForm = $('[data-coins-form]');
    cForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var u = state.current;
      var amount = Number(cForm.elements.amount.value);
      var remove = e.submitter && e.submitter.value === 'remove';
      if (!Number.isInteger(amount) || amount < 1 || amount > 1000000) { toast('Indique un montant entier entre 1 et 1 000 000.', 'error'); cForm.elements.amount.focus(); return; }
      var delta = remove ? -amount : amount;
      if (!(await confirmBox(remove ? 'Retirer des Anime Coins ?' : 'Ajouter des Anime Coins ?', (remove ? '−' : '+') + num(amount) + ' AC pour ' + u.pseudo + ' (solde actuel : ' + num(u.coins) + ' AC).', remove ? 'Retirer' : 'Ajouter', remove))) return;
      var res = await busy(e.submitter, function () { return adminAdjustCoins(u.id, delta, cForm.elements.note.value.trim()); });
      if (!res.ok) { toast(res.error, 'error'); return; }
      cForm.elements.note.value = '';
      refreshAfter('Nouveau solde de ' + u.pseudo + ' : ' + num(res.coins) + ' AC.');
    });

    $('[data-role-save]').addEventListener('click', async function () {
      var u = state.current;
      var role = $('[data-role]').value;
      if (role === u.role) { toast('Ce membre a déjà ce rôle.'); return; }
      if (!(await confirmBox('Changer le rôle ?', u.pseudo + ' deviendra ' + (role === 'admin' ? 'administrateur (accès complet à ce panneau).' : 'simple membre.'), 'Changer le rôle', role === 'admin'))) return;
      var btn = this;
      var res = await busy(btn, function () { return setUserRole(u.id, role); });
      if (!res.ok) { toast(res.error, 'error'); return; }
      refreshAfter('Rôle de ' + u.pseudo + ' mis à jour.');
    });
    $('[data-streak-reset]').addEventListener('click', async function () {
      var u = state.current;
      if (!(await confirmBox('Réinitialiser la série ?', 'La série quotidienne de ' + u.pseudo + ' repartira de zéro. Son record est conservé.', 'Réinitialiser', true))) return;
      var btn = this;
      var res = await busy(btn, function () { return adminResetStreak(u.id); });
      if (!res.ok) { toast(res.error, 'error'); return; }
      refreshAfter('Série de ' + u.pseudo + ' réinitialisée.');
    });
    $('[data-delete]').addEventListener('click', async function () {
      var u = state.current;
      if (!(await confirmBox('Supprimer le compte de ' + u.pseudo + ' ?', 'Le compte de connexion, le profil, les listes, les Anime Coins et l\'historique seront supprimés définitivement.', 'Supprimer définitivement', true))) return;
      var btn = this;
      var res = await busy(btn, function () { return adminDeleteUser(u.id); });
      if (!res.ok) { toast(res.error, 'error'); return; }
      closeDrawer();
      toast(res.partial ? 'Profil supprimé. Le compte de connexion reste à supprimer dans Supabase (Authentication → Users).' : 'Compte de ' + u.pseudo + ' supprimé.', res.partial ? undefined : 'success');
      state.users = state.users.filter(function (x) { return x.id !== u.id; });
      renderUsers();
      state.loaded.tableau = false;
      state.loaded.journal = false;
    });
  }

  /* ---- Clés ---- */
  async function loadKeys() {
    var tbody = $('[data-keys]');
    failRow(tbody, 6, 'Chargement des clés…');
    var res = await adminListKeys();
    if (!res.ok) { failRow(tbody, 6, res.error); return; }
    state.keys = res.data || [];
    if (!state.keys.length) { failRow(tbody, 6, 'Aucune clé pour le moment.'); return; }
    var SOURCES = { achat: 'Achat', admin: 'Cadeau', evenement: 'Événement' };
    tbody.innerHTML = state.keys.map(function (k) {
      var expired = k.expires_at && new Date(k.expires_at).getTime() < Date.now();
      var status = k.redeemed_at
        ? '<span class="adm-tag">Utilisée' + (k.redeemed_by ? ' par ' + esc(k.redeemed_by) : '') + '</span>'
        : expired ? '<span class="adm-tag adm-tag--red">Annulée</span>' : '<span class="adm-tag adm-tag--green">Disponible</span>';
      var what = k.kind === 'coins' ? num(k.coins) + ' AC' : (TIER_LABEL[k.tier] || k.tier);
      var usable = !k.redeemed_at && !expired;
      return '<tr>' +
        '<td class="adm-code">' + esc(formatKey(k.code)) + '</td>' +
        '<td>' + esc(what) + '</td>' +
        '<td>' + esc(SOURCES[k.source] || k.source) + (k.buyer ? ' <span class="adm-muted">(' + esc(k.buyer) + ')</span>' : '') + '</td>' +
        '<td>' + status + '</td>' +
        '<td>' + date(k.created_at) + '</td>' +
        '<td>' + (usable ? '<button class="adm-btn adm-btn--sm" type="button" data-copy-key="' + esc(formatKey(k.code)) + '">Copier</button> <button class="adm-btn adm-btn--sm adm-btn--danger-ghost" type="button" data-revoke="' + esc(k.code) + '">Annuler</button>' : '') + '</td>' +
      '</tr>';
    }).join('');
  }

  function bindKeys() {
    var form = $('[data-keygen]');
    form.elements.kind.addEventListener('change', function () {
      var kind = form.elements.kind.value;
      $$('[data-kind]', form).forEach(function (f) { f.hidden = f.getAttribute('data-kind') !== kind; });
    });
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var kind = form.elements.kind.value;
      var count = Number(form.elements.count.value);
      var coins = Number(form.elements.coins.value);
      if (!Number.isInteger(count) || count < 1 || count > 50) { toast('Le nombre de clés doit être compris entre 1 et 50.', 'error'); return; }
      if (kind === 'coins' && (!Number.isInteger(coins) || coins < 10 || coins > 5000)) { toast('Les clés d\'Anime Coins valent entre 10 et 5 000 AC.', 'error'); return; }
      var btn = form.querySelector('[type="submit"]');
      var res = await busy(btn, function () {
        return adminGenerateKeys({ kind: kind, tier: form.elements.tier.value, coins: kind === 'coins' ? coins : null, count: count, source: form.elements.source.value });
      });
      if (!res.ok) { toast(res.error, 'error'); return; }
      var out = $('[data-keygen-output]');
      out.hidden = false;
      out.innerHTML = '<strong>' + res.items.length + ' clé' + (res.items.length > 1 ? 's' : '') + ' générée' + (res.items.length > 1 ? 's' : '') + '</strong>' +
        ' <button class="adm-btn adm-btn--sm" type="button" data-copy-all>Tout copier</button>' +
        '<ul>' + res.items.map(function (c) { return '<li>' + esc(formatKey(c)) + '</li>'; }).join('') + '</ul>';
      out.querySelector('[data-copy-all]').addEventListener('click', function () {
        copy(res.items.map(formatKey).join('\n'));
      });
      state.loaded.journal = false;
      state.loaded.tableau = false;
      loadKeys();
    });
    $('[data-keys]').addEventListener('click', async function (e) {
      var c = e.target.closest('[data-copy-key]');
      if (c) { copy(c.getAttribute('data-copy-key')); return; }
      var r = e.target.closest('[data-revoke]');
      if (!r) return;
      var code = r.getAttribute('data-revoke');
      if (!(await confirmBox('Annuler cette clé ?', formatKey(code) + ' ne pourra plus être activée.', 'Annuler la clé', true))) return;
      var res = await busy(r, function () { return adminRevokeKey(code); });
      if (!res.ok) { toast(res.error, 'error'); return; }
      toast('Clé annulée.', 'success');
      loadKeys();
    });
  }

  function copy(text) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () {
      toast('Copié dans le presse-papiers.', 'success');
    }, function () { toast('Copie impossible : sélectionne le texte manuellement.', 'error'); });
  }

  /* ---- Commandes et journal ---- */
  async function loadOrders() {
    var tbody = $('[data-orders]');
    failRow(tbody, 6, 'Chargement des commandes…');
    var res = await adminListOrders();
    if (!res.ok) { failRow(tbody, 6, res.error); return; }
    var rows = res.data || [];
    if (!rows.length) { failRow(tbody, 6, 'Aucune commande pour le moment.'); return; }
    var STATUS = { paid: '<span class="adm-tag adm-tag--green">Payée</span>', pending: '<span class="adm-tag adm-tag--warn">En attente</span>', failed: '<span class="adm-tag adm-tag--red">Échouée</span>', cancelled: '<span class="adm-tag">Annulée par le membre</span>' };
    tbody.innerHTML = rows.map(function (o) {
      return '<tr><td>' + date(o.created_at, true) + '</td><td>' + esc(o.pseudo || 'Compte supprimé') + '</td><td>' + esc(TIER_LABEL[o.tier] || o.tier) + '</td>' +
        '<td class="adm-num">' + money(o.amount) + '</td><td>' + (STATUS[o.status] || esc(o.status)) + '</td><td>' + date(o.paid_at, true) + '</td></tr>';
    }).join('');
  }

  var ACTIONS = {
    premium_ajoute: 'Premium donné', premium_retire: 'Premium retiré', coins: 'Anime Coins ajustés', role: 'Rôle modifié',
    serie_reinitialisee: 'Série réinitialisée', compte_supprime: 'Compte supprimé', cle_annulee: 'Clé annulée', cles_generees: 'Clés générées', parametre: 'Réglage du site', decoration: 'Décoration enregistrée', decoration_supprimee: 'Décoration supprimée', succes_progressif: 'Succès à paliers enregistré', succes_supprime: 'Succès supprimé', badge: 'Badge enregistré', badge_supprime: 'Badge supprimé'
  };
  function logDetails(action, d) {
    d = d || {};
    if (action === 'premium_ajoute') return (TIER_LABEL[d.niveau] || d.niveau) + (d.jours ? ', ' + d.jours + ' jours' + (d.prolongation ? ' (prolongation)' : '') : '');
    if (action === 'premium_retire') return 'Ancien niveau : ' + (TIER_LABEL[d.ancien] || d.ancien || '—');
    if (action === 'coins') return (d.montant > 0 ? '+' : '') + num(d.montant) + ' AC' + (d.note ? ' — ' + d.note : '');
    if (action === 'role') return d.role === 'admin' ? 'Administrateur' : 'Membre';
    if (action === 'cle_annulee') return formatKey(d.code || '');
    if (action === 'cles_generees') return d.nombre + ' × ' + (d.type === 'coins' ? num(d.coins) + ' AC' : (TIER_LABEL[d.niveau] || d.niveau));
    if (action === 'parametre') return { banner: 'Bandeau', featured: 'Coup de cœur', coin_tiers: 'Prix des paliers en coins', decoration_rate: 'Taux des décorations' }[d.cle] || d.cle || '';
    if (action === 'succes_progressif') return (d.nom || '') + (d.paliers ? ' — ' + d.paliers + ' paliers' : '');
    if (d.nom) return d.nom;
    return '';
  }
  async function loadLog() {
    var tbody = $('[data-log]');
    failRow(tbody, 5, 'Chargement du journal…');
    var res = await adminListLog();
    if (!res.ok) { failRow(tbody, 5, res.error); return; }
    var rows = res.data || [];
    if (!rows.length) { failRow(tbody, 5, 'Aucune action enregistrée pour le moment.'); return; }
    tbody.innerHTML = rows.map(function (l) {
      return '<tr><td>' + date(l.created_at, true) + '</td><td>' + esc(l.admin || '—') + '</td><td>' + esc(ACTIONS[l.action] || l.action) + '</td><td>' + esc(l.target || '—') + '</td><td>' + esc(logDetails(l.action, l.details)) + '</td></tr>';
    }).join('');
  }

  /* ---- Envoi d'images (décorations, badges, Coup de cœur) ---- */
  function bindUploads() {
    $$('[data-upload]').forEach(function (input) {
      input.addEventListener('change', async function () {
        var file = input.files && input.files[0];
        if (!file) return;
        var form = input.closest('form');
        var target = form.elements[input.getAttribute('data-upload-target')];
        var label = input.closest('.adm-upload');
        label.classList.add('is-busy');
        var res = await adminUploadAsset(input.getAttribute('data-upload'), file);
        label.classList.remove('is-busy');
        input.value = '';
        if (res.error) { toast(res.error, 'error'); return; }
        target.value = res.url;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        toast('Image envoyée.', 'success');
      });
    });
  }

  function iconSvg(name, size) {
    return '<svg width="' + (size || 18) + '" height="' + (size || 18) + '" aria-hidden="true" focusable="false" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><use href="assets/icons/sprite.svg#' + esc(name || 'trophy') + '"></use></svg>';
  }
  function badgeChip(b) {
    var color = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#ff4d6d';
    var img = /^https:\/\//.test(b.image_url || '') ? '<img src="' + esc(b.image_url) + '" alt="" width="18" height="18">' : iconSvg(b.icon);
    return '<span class="adm-badge-chip" style="--badge:' + color + '">' + img + '<span>' + esc(b.name || 'Badge') + '</span></span>';
  }
  var PLACEMENT_HINTS = {
    avatar_frame: 'Image carrée posée autour de la photo, 28 % plus grande : centre transparent obligatoire.',
    avatar_top: 'Petite image posée sur le haut de la photo (couronne, oreilles, auréole…).',
    banner_full: 'Image au format de la bannière (3:1), posée par-dessus : garde-la en grande partie transparente.'
  };
  function placementLabel(key) {
    var p = DECORATION_PLACEMENTS.filter(function (x) { return x.key === key; })[0];
    return p ? p.label : DECORATION_PLACEMENTS[0].label;
  }
  // Aperçu fidèle au site : mêmes proportions que .avatar-deco--* et .banner-deco--* (pages.css)
  function decoPreviewHTML(url, placement, small) {
    var place = DECORATION_PLACEMENTS.some(function (x) { return x.key === placement; }) ? placement : 'avatar_frame';
    var img = /^https:\/\/[^\s"<>]+$/.test(url || '') ? '<img class="adm-deco-img adm-deco--' + place + '" src="' + esc(url) + '" alt="">' : '';
    if (place.indexOf('banner_') === 0) return '<span class="adm-deco-banner' + (small ? ' is-small' : '') + '">' + img + '</span>';
    return '<span class="adm-deco-stage' + (small ? ' is-small' : '') + '"><span class="adm-deco-avatar">L</span>' + img + '</span>';
  }

  function priceLabel(cents) { return cents ? (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) : 'Gratuit'; }

  /* ---- Bandeau & Coup de cœur ---- */
  var siteCfg = null;
  var featuredPick = null;

  async function loadSiteView() {
    siteCfg = (await loadSiteSettings(true)) || {};
    var b = siteCfg.banner || {};
    var bf = $('[data-banner-form]');
    bf.elements.enabled.checked = !!b.enabled;
    bf.elements.text.value = b.text || '';
    bf.elements.link.value = b.link || '';
    bf.elements.new_tab.checked = !!b.new_tab;
    bf.elements.color.value = b.color || '#0d0d13';
    bf.elements.background.value = b.background || '#ff4d6d';
    bf.elements.animation.value = b.animation || 'none';
    renderBannerPreview();

    var f = siteCfg.featured || {};
    var ff = $('[data-featured-form]');
    ff.elements.enabled.checked = !!f.enabled;
    ff.elements.title.value = f.title || '';
    ff.elements.description.value = f.description || '';
    ff.elements.button_label.value = f.button_label || '';
    ff.elements.button_link.value = f.button_link || '';
    ff.elements.image.value = f.image || '';
    ff.elements.position.value = f.position || 'after_top';
    featuredPick = f.anilist_id ? { id: f.anilist_id, title: f.anime_title || ('Anime #' + f.anilist_id) } : null;
    renderFeaturedPick();
  }

  function renderBannerPreview() {
    var f = $('[data-banner-form]');
    var text = f.elements.text.value.trim();
    var box = $('[data-banner-preview]');
    box.className = 'adm-banner-preview adm-banner--' + f.elements.animation.value;
    box.style.setProperty('--banner-fg', f.elements.color.value);
    box.style.setProperty('--banner-bg', f.elements.background.value);
    var t = '<span class="adm-banner-text">' + esc(text || 'Ton texte apparaîtra ici') + '</span>';
    box.innerHTML = '<p class="adm-banner-inner">' + (f.elements.animation.value === 'marquee' ? '<span class="adm-banner-track">' + t + t + t + t + '</span>' : t) + '</p>' +
      (f.elements.enabled.checked ? '' : '<span class="adm-banner-off">Désactivé</span>');
    box.style.opacity = f.elements.enabled.checked ? '1' : '.55';
    // relance l'animation de l'aperçu
    box.querySelector('.adm-banner-inner').style.animation = 'none';
    void box.offsetWidth;
    box.querySelector('.adm-banner-inner').style.animation = '';
  }

  function renderFeaturedPick() {
    var box = $('[data-featured-picked]');
    box.hidden = !featuredPick;
    if (!featuredPick) { box.innerHTML = ''; return; }
    box.innerHTML = (featuredPick.image ? '<img src="' + esc(featuredPick.image) + '" alt="" width="46" height="66">' : '') +
      '<div><strong>' + esc(featuredPick.title) + '</strong><span class="adm-muted">AniList n°' + Number(featuredPick.id) + '</span></div>' +
      '<a class="adm-btn adm-btn--sm" href="details.html?id=' + Number(featuredPick.id) + '" target="_blank" rel="noopener">Voir la fiche</a>';
  }

  function bindSiteView() {
    var bf = $('[data-banner-form]');
    bf.addEventListener('input', renderBannerPreview);
    bf.addEventListener('change', renderBannerPreview);
    bf.addEventListener('submit', async function (e) {
      e.preventDefault();
      var err = $('[data-banner-error]');
      err.textContent = '';
      var link = bf.elements.link.value.trim();
      if (bf.elements.enabled.checked && !bf.elements.text.value.trim()) { err.textContent = 'Écris un texte pour activer le bandeau.'; return; }
      if (link && !/^https?:\/\/[^\s"<>]+$/i.test(link) && !/^[a-z0-9-]+\.html([?#][^\s"<>]*)?$/i.test(link)) { err.textContent = 'Lien invalide : utilise https://… ou une page du site comme wishboard.html.'; return; }
      var res = await busy(bf.querySelector('[type="submit"]'), function () {
        return adminSaveSetting('banner', {
          enabled: bf.elements.enabled.checked, text: bf.elements.text.value, link: link, new_tab: bf.elements.new_tab.checked,
          color: bf.elements.color.value, background: bf.elements.background.value, animation: bf.elements.animation.value
        });
      });
      if (!res.ok) { err.textContent = res.error; return; }
      try { localStorage.removeItem('lum_site_settings'); } catch (e2) {}
      toast('Bandeau enregistré. Il apparaît sur le site au prochain chargement de page.', 'success');
    });

    var ff = $('[data-featured-form]');
    var found = [];
    async function search() {
      var q = ff.elements.q.value.trim();
      var results = $('[data-featured-results]');
      if (q.length < 2) { results.innerHTML = '<li class="adm-muted">Tape au moins 2 caractères.</li>'; return; }
      results.innerHTML = '<li class="adm-muted">Recherche sur AniList…</li>';
      try { found = await anilistSearchAnime(q); } catch (err) { results.innerHTML = '<li class="adm-muted">' + esc(err.message) + '</li>'; return; }
      results.innerHTML = found.length ? found.map(function (m, i) {
        return '<li><button type="button" data-featured-pick="' + i + '">' +
          (m.coverImage && m.coverImage.medium ? '<img src="' + esc(m.coverImage.medium) + '" alt="" width="40" height="57" loading="lazy">' : '<span class="adm-ep-noimg"></span>') +
          '<span><strong>' + esc(animeName(m)) + '</strong><span class="adm-muted">' + esc([m.format, m.seasonYear].filter(Boolean).join(' · ')) + '</span></span></button></li>';
      }).join('') : '<li class="adm-muted">Aucun anime trouvé.</li>';
    }
    $('[data-featured-search]').addEventListener('click', search);
    ff.elements.q.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); search(); } });
    $('[data-featured-results]').addEventListener('click', function (e) {
      var b = e.target.closest('[data-featured-pick]');
      if (!b) return;
      var m = found[Number(b.getAttribute('data-featured-pick'))];
      featuredPick = { id: m.id, title: animeName(m), image: m.coverImage && m.coverImage.medium };
      $('[data-featured-results]').innerHTML = '';
      renderFeaturedPick();
    });
    ff.addEventListener('submit', async function (e) {
      e.preventDefault();
      var err = $('[data-featured-error]');
      err.textContent = '';
      if (ff.elements.enabled.checked && !featuredPick) { err.textContent = "Choisis d'abord l'anime à mettre en avant."; return; }
      var link = ff.elements.button_link.value.trim();
      if (link && !/^https?:\/\/[^\s"<>]+$/i.test(link) && !/^[a-z0-9-]+\.html([?#][^\s"<>]*)?$/i.test(link)) { err.textContent = 'Lien du bouton invalide.'; return; }
      var image = ff.elements.image.value.trim();
      if (image && !/^https:\/\/[^\s"<>]+$/.test(image)) { err.textContent = "L'image doit commencer par https://."; return; }
      var res = await busy(ff.querySelector('[type="submit"]'), function () {
        return adminSaveSetting('featured', {
          enabled: ff.elements.enabled.checked, anilist_id: featuredPick ? featuredPick.id : null, anime_title: featuredPick ? featuredPick.title : '',
          title: ff.elements.title.value, description: ff.elements.description.value, button_label: ff.elements.button_label.value,
          button_link: link, image: image, position: ff.elements.position.value
        });
      });
      if (!res.ok) { err.textContent = res.error; return; }
      try { localStorage.removeItem('lum_site_settings'); } catch (e2) {}
      toast('Coup de cœur enregistré.', 'success');
    });
  }

  /* ---- Coins & abonnements ---- */
  async function loadCoinsView() {
    var cfg = (await loadSiteSettings(true)) || {};
    var t = cfg.coin_tiers || {};
    var tf = $('[data-tiers-form]');
    tf.elements.t30.value = t['30'] || 1500;
    tf.elements.t60.value = t['60'] || 3000;
    tf.elements.t90.value = t['90'] || 4500;
    $('[data-rate-form]').elements.rate.value = cfg.decoration_rate || 385;
    renderRateTable();
  }

  function renderRateTable() {
    var rate = Number($('[data-rate-form]').elements.rate.value) || 0;
    var rows = '';
    for (var c = 0; c <= 300; c += 50) {
      rows += '<tr><td>' + priceLabel(c) + '</td><td class="adm-num">' + (c ? num(Math.ceil(c * rate / 100)) + ' AC' : 'Gratuit') + '</td></tr>';
    }
    $('[data-rate-table]').innerHTML = rows;
  }

  function bindCoinsView() {
    var tf = $('[data-tiers-form]');
    tf.addEventListener('submit', async function (e) {
      e.preventDefault();
      var err = $('[data-tiers-error]');
      err.textContent = '';
      var v = { '30': Number(tf.elements.t30.value), '60': Number(tf.elements.t60.value), '90': Number(tf.elements.t90.value) };
      if (['30', '60', '90'].some(function (k) { return !Number.isInteger(v[k]) || v[k] < 100 || v[k] > 1000000; })) { err.textContent = 'Chaque prix doit être un nombre entier entre 100 et 1 000 000.'; return; }
      if (!(v['30'] < v['60'] && v['60'] < v['90']) && !(await confirmBox('Prix inhabituels', 'Un palier plus long coûte moins cher ou autant qu\'un palier plus court. Enregistrer quand même ?', 'Enregistrer'))) return;
      var res = await busy(tf.querySelector('[type="submit"]'), function () { return adminSaveSetting('coin_tiers', v); });
      if (!res.ok) { err.textContent = res.error; return; }
      try { localStorage.removeItem('lum_site_settings'); } catch (e2) {}
      toast('Prix des paliers enregistrés.', 'success');
    });
    var rf = $('[data-rate-form]');
    rf.elements.rate.addEventListener('input', renderRateTable);
    rf.addEventListener('submit', async function (e) {
      e.preventDefault();
      var err = $('[data-rate-error]');
      err.textContent = '';
      var rate = Number(rf.elements.rate.value);
      if (!Number.isInteger(rate) || rate < 10 || rate > 100000) { err.textContent = 'Le taux doit être un entier entre 10 et 100 000.'; return; }
      var res = await busy(rf.querySelector('[type="submit"]'), function () { return adminSaveSetting('decoration_rate', { coins_per_euro: rate }); });
      if (!res.ok) { err.textContent = res.error; return; }
      try { localStorage.removeItem('lum_site_settings'); } catch (e2) {}
      toast('Taux enregistré.', 'success');
    });
  }

  /* ---- Décorations ---- */
  var decos = [];
  var decoEditing = null;

  async function loadDecorationsAdmin() {
    var tbody = $('[data-deco-rows]');
    failRow(tbody, 5, 'Chargement…');
    var res = await adminListDecorations();
    if (!res.ok) { failRow(tbody, 5, /SQL/.test(res.error) ? "Le script SQL v9 (personnalisation) n'est pas encore installé sur Supabase." : res.error); return; }
    decos = res.data || [];
    renderDecoRows();
  }

  function renderDecoRows() {
    var tbody = $('[data-deco-rows]');
    var active = decos.filter(function (d) { return d.active; }).length;
    $('[data-deco-count]').textContent = num(decos.length) + ' décoration' + (decos.length > 1 ? 's' : '') + ' · ' + num(active) + ' disponible' + (active > 1 ? 's' : '');
    if (!decos.length) { failRow(tbody, 5, 'Aucune décoration. Crée la première avec le formulaire.'); return; }
    tbody.innerHTML = decos.map(function (d) {
      return '<tr>' +
        '<td><div class="adm-wish">' + decoPreviewHTML(d.image_url, d.placement, true) + '<div><strong>' + esc(d.name) + '</strong><span class="adm-muted">' + esc(decorationCategoryLabel(d.category)) + ' · ' + esc(placementLabel(d.placement)) + '</span>' + (d.description ? '<span class="adm-muted">' + esc(d.description) + '</span>' : '') + '</div></div></td>' +
        '<td>' + priceLabel(d.price_cents) + (d.cost ? '<br><span class="adm-muted">' + num(d.cost) + ' AC</span>' : '') + '</td>' +
        '<td><span class="adm-tag ' + (d.active ? 'adm-tag--green' : '') + '">' + (d.active ? 'Disponible' : 'Désactivée') + '</span></td>' +
        '<td class="adm-num">' + num(d.owners) + '<br><span class="adm-muted">' + num(d.equipped) + ' équipée' + (d.equipped > 1 ? 's' : '') + '</span></td>' +
        '<td class="adm-cell-actions">' +
          '<button class="adm-btn adm-btn--sm" type="button" data-deco-edit="' + esc(d.id) + '">Modifier</button> ' +
          '<button class="adm-btn adm-btn--sm" type="button" data-deco-toggle="' + esc(d.id) + '">' + (d.active ? 'Désactiver' : 'Activer') + '</button> ' +
          '<button class="adm-btn adm-btn--sm adm-btn--danger-ghost" type="button" data-deco-delete="' + esc(d.id) + '">Supprimer</button>' +
        '</td></tr>';
    }).join('');
  }

  function decoFormData(f) {
    return {
      id: decoEditing ? decoEditing.id : null, name: f.elements.name.value.trim(), description: f.elements.description.value.trim(),
      image_url: f.elements.image_url.value.trim(), category: f.elements.category.value || 'cadre', placement: f.elements.placement.value || 'avatar_frame',
      price_cents: Number(f.elements.price_cents.value), active: f.elements.active.checked, sort: Number(f.elements.sort.value) || 0
    };
  }

  function resetDecoForm() {
    var f = $('[data-deco-form]');
    decoEditing = null;
    f.reset();
    fillDecoSelects();
    $('[data-deco-form-title]').textContent = 'Nouvelle décoration';
    $('[data-deco-submit]').textContent = 'Créer la décoration';
    $('[data-deco-cancel]').hidden = true;
    $('[data-deco-error]').textContent = '';
    updateDecoPreview();
  }

  // Catégories prédéfinies (+ l'ancienne catégorie d'une décoration si elle n'en fait pas partie)
  function fillDecoSelects(extraCategory) {
    var f = $('[data-deco-form]');
    var cats = DECORATION_CATEGORIES.slice();
    if (extraCategory && !cats.some(function (c) { return c.key === extraCategory; })) cats.push({ key: extraCategory, label: extraCategory + ' (ancienne)' });
    f.elements.category.innerHTML = cats.map(function (c) { return '<option value="' + esc(c.key) + '">' + esc(c.label) + '</option>'; }).join('');
    var groups = {};
    DECORATION_PLACEMENTS.forEach(function (p) { (groups[p.group] = groups[p.group] || []).push(p); });
    f.elements.placement.innerHTML = Object.keys(groups).map(function (g) {
      return '<optgroup label="' + esc(g) + '">' + groups[g].map(function (p) { return '<option value="' + p.key + '">' + esc(p.label) + '</option>'; }).join('') + '</optgroup>';
    }).join('');
  }

  function updateDecoPreview() {
    var f = $('[data-deco-form]');
    var place = f.elements.placement.value || 'avatar_frame';
    $('[data-deco-preview]').innerHTML = decoPreviewHTML(f.elements.image_url.value.trim(), place, false);
    $('[data-deco-placement-hint]').textContent = PLACEMENT_HINTS[place] || (place.indexOf('banner_') === 0
      ? 'Petit motif posé dans ce coin de la bannière (environ 16 % de sa largeur).'
      : 'Petite image posée dans ce coin de la photo (environ 40 % de sa taille).');
  }

  async function saveDeco(data, btn) {
    var res = await busy(btn, function () { return adminSaveDecoration(data); });
    if (!res.ok) return res;
    await loadDecorationsAdmin();
    return res;
  }

  function bindDecorationsAdmin() {
    var f = $('[data-deco-form]');
    fillDecoSelects();
    f.elements.image_url.addEventListener('input', updateDecoPreview);
    f.elements.placement.addEventListener('change', updateDecoPreview);
    $('[data-deco-cancel]').addEventListener('click', resetDecoForm);
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var err = $('[data-deco-error]');
      err.textContent = '';
      var d = decoFormData(f);
      if (!d.name) { err.textContent = 'Donne un nom à la décoration.'; return; }
      if (!/^https:\/\/[^\s"<>]+$/.test(d.image_url)) { err.textContent = "Ajoute une image (adresse https:// ou bouton « Envoyer une image »)."; return; }
      if (!/^[a-z0-9_-]{1,30}$/.test(d.category)) { err.textContent = 'Catégorie : lettres minuscules, chiffres, - et _ uniquement.'; return; }
      if (d.price_cents < 0 || d.price_cents > 300 || d.price_cents % 50) { err.textContent = 'Prix entre 0 et 3 €, par paliers de 0,50 €.'; return; }
      var wasEditing = !!decoEditing;
      var res = await saveDeco(d, $('[data-deco-submit]'));
      if (!res.ok) { err.textContent = res.error; return; }
      toast(wasEditing ? 'Décoration modifiée.' : 'Décoration créée.', 'success');
      resetDecoForm();
    });
    $('[data-deco-rows]').addEventListener('click', async function (e) {
      var edit = e.target.closest('[data-deco-edit]');
      var toggle = e.target.closest('[data-deco-toggle]');
      var del = e.target.closest('[data-deco-delete]');
      var btn = edit || toggle || del;
      if (!btn) return;
      var d = decos.filter(function (x) { return x.id === btn.getAttribute(edit ? 'data-deco-edit' : toggle ? 'data-deco-toggle' : 'data-deco-delete'); })[0];
      if (!d) return;
      if (edit) {
        decoEditing = d;
        f.elements.name.value = d.name;
        f.elements.description.value = d.description || '';
        f.elements.image_url.value = d.image_url;
        fillDecoSelects(d.category);
        f.elements.category.value = d.category;
        f.elements.placement.value = DECORATION_PLACEMENTS.some(function (x) { return x.key === d.placement; }) ? d.placement : 'avatar_frame';
        f.elements.price_cents.value = String(d.price_cents);
        f.elements.sort.value = d.sort || 0;
        f.elements.active.checked = d.active;
        $('[data-deco-form-title]').textContent = 'Modifier « ' + d.name + ' »';
        $('[data-deco-submit]').textContent = 'Enregistrer';
        $('[data-deco-cancel]').hidden = false;
        updateDecoPreview();
        f.scrollIntoView({ behavior: 'smooth', block: 'start' });
        f.elements.name.focus();
      } else if (toggle) {
        var res = await saveDeco({ id: d.id, name: d.name, description: d.description, image_url: d.image_url, category: d.category, placement: d.placement, price_cents: d.price_cents, active: !d.active, sort: d.sort }, toggle);
        if (!res.ok) { toast(res.error, 'error'); return; }
        toast(d.active ? 'Décoration retirée de la boutique (les membres qui la possèdent la gardent).' : 'Décoration de nouveau disponible.', 'success');
      } else if (del) {
        if (!(await confirmBox('Supprimer « ' + d.name + ' » ?', num(d.owners) + ' membre(s) la possèdent : elle disparaîtra de leur collection et de leur profil. Les Anime Coins dépensés ne sont pas remboursés. Pour simplement la retirer de la boutique, utilise plutôt « Désactiver ».', 'Supprimer définitivement', true))) return;
        var r = await busy(del, function () { return adminDeleteDecoration(d.id); });
        if (!r.ok) { toast(r.error, 'error'); return; }
        if (decoEditing && decoEditing.id === d.id) resetDecoForm();
        await loadDecorationsAdmin();
        toast('Décoration supprimée.', 'success');
      }
    });
  }

  /* ---- Succès à paliers & badges ---- */
  var METRIC_LABELS = {
    favorites: 'Animes en favoris', watchlist: 'Animes dans la watchlist', daily_days: 'Récompenses quotidiennes récupérées',
    best_streak: 'Meilleure série (jours)', age_days: "Jours d'ancienneté", earned: 'Anime Coins gagnés (hors succès)',
    coins: 'Anime Coins possédés', keys: 'Clés activées', bought_with_coins: 'Premium échangés contre des coins',
    achievements: 'Succès classiques obtenus', wish_votes: 'Votes sur le Wishboard', wish_proposals: 'Animes proposés au Wishboard',
    wish_accepted: 'Propositions Wishboard acceptées', decorations: 'Décorations possédées', badges: 'Badges obtenus', tiers: 'Paliers atteints (tous succès)', likes: 'Likes donnés'
  };
  var prog = { achievements: [], badges: [], metrics: [] };
  var achEditing = null;
  var tierRows = [];
  var badgeEditing = null;

  async function loadProgressAdmin() {
    var tbody = $('[data-ach-rows]');
    failRow(tbody, 7, 'Chargement…');
    var res = await adminListProgress();
    if (!res.ok) {
      var msg = /SQL/.test(res.error) ? "Le script SQL v9 (personnalisation) n'est pas encore installé sur Supabase." : res.error;
      failRow(tbody, 7, msg); failRow($('[data-badge-rows]'), 6, msg); return;
    }
    prog = res.data || prog;
    if (!decos.length) { var d = await adminListDecorations(); if (d.ok) decos = d.data || []; }
    $('[data-metric-select]').innerHTML = (prog.metrics || []).map(function (m) { return '<option value="' + esc(m) + '">' + esc(METRIC_LABELS[m] || m) + '</option>'; }).join('');
    renderAchRows();
    renderBadgeRows();
  }

  function renderAchRows() {
    var tbody = $('[data-ach-rows]');
    var list = prog.achievements || [];
    if (!list.length) { failRow(tbody, 7, 'Aucun succès à paliers. Crée le premier avec « Nouveau succès à paliers ».'); return; }
    tbody.innerHTML = list.map(function (a, i) {
      return '<tr>' +
        '<td class="adm-nowrap"><button class="adm-btn adm-btn--sm" type="button" data-ach-move="-1" data-id="' + esc(a.id) + '"' + (i === 0 ? ' disabled' : '') + ' title="Monter">↑</button> <button class="adm-btn adm-btn--sm" type="button" data-ach-move="1" data-id="' + esc(a.id) + '"' + (i === list.length - 1 ? ' disabled' : '') + ' title="Descendre">↓</button></td>' +
        '<td><div class="adm-wish">' + iconSvg(a.icon, 22) + '<div><strong>' + esc(a.name) + '</strong><span class="adm-muted">' + esc(a.description || '') + '</span></div></div></td>' +
        '<td>' + esc(METRIC_LABELS[a.metric] || a.metric) + '</td>' +
        '<td class="adm-num">' + num((a.tiers || []).length) + '</td>' +
        '<td class="adm-num">' + num(a.players) + '</td>' +
        '<td><span class="adm-tag ' + (a.active ? 'adm-tag--green' : '') + '">' + (a.active ? 'Actif' : 'Inactif') + '</span></td>' +
        '<td class="adm-cell-actions"><button class="adm-btn adm-btn--sm" type="button" data-ach-edit="' + esc(a.id) + '">Modifier</button> <button class="adm-btn adm-btn--sm adm-btn--danger-ghost" type="button" data-ach-delete="' + esc(a.id) + '">Supprimer</button></td>' +
      '</tr>';
    }).join('');
  }

  function niceRound(v) {
    var step = v < 20 ? 1 : v < 100 ? 5 : v < 1000 ? 25 : v < 10000 ? 250 : v < 100000 ? 1000 : 10000;
    return Math.max(1, Math.round(v / step) * step);
  }

  // Progression de plus en plus exigeante : écarts croissants entre le 1er et le dernier objectif
  function generateTiers(count, first, last, reward) {
    var out = [];
    var prev = 0;
    for (var i = 0; i < count; i++) {
      var t = count === 1 ? 1 : i / (count - 1);
      var v = first + (last - first) * Math.pow(t, 2.5);
      var goal = i === 0 ? first : i === count - 1 ? last : niceRound(v);
      if (goal <= prev) goal = prev + 1;
      out.push({ goal: goal, reward_coins: Math.round(reward * (1 + i * 0.5)), badge_id: '', decoration_id: '' });
      prev = goal;
    }
    return out;
  }

  function optionsHTML(items, selected, emptyLabel) {
    return '<option value="">' + emptyLabel + '</option>' + items.map(function (x) {
      return '<option value="' + esc(x.id) + '"' + (x.id === selected ? ' selected' : '') + '>' + esc(x.name) + (x.active === false ? ' (inactif)' : '') + '</option>';
    }).join('');
  }

  function renderTierRows() {
    var tbody = $('[data-tier-rows]');
    if (!tierRows.length) { failRow(tbody, 6, 'Aucun palier : utilise « Générer » ou « Ajouter un palier ».'); return; }
    tbody.innerHTML = tierRows.map(function (t, i) {
      var bad = i > 0 && Number(t.goal) <= Number(tierRows[i - 1].goal);
      return '<tr>' +
        '<td class="adm-num">' + (i + 1) + '</td>' +
        '<td><input class="adm-input adm-input--sm' + (bad ? ' is-invalid' : '') + '" type="number" min="1" value="' + esc(t.goal) + '" data-tier-field="goal" data-i="' + i + '" aria-label="Objectif du palier ' + (i + 1) + '"></td>' +
        '<td><input class="adm-input adm-input--sm" type="number" min="0" max="100000" value="' + esc(t.reward_coins || 0) + '" data-tier-field="reward_coins" data-i="' + i + '" aria-label="Récompense du palier ' + (i + 1) + '"></td>' +
        '<td><select class="adm-input adm-input--sm" data-tier-field="badge_id" data-i="' + i + '" aria-label="Badge du palier ' + (i + 1) + '">' + optionsHTML(prog.badges || [], t.badge_id, 'Aucun') + '</select></td>' +
        '<td><select class="adm-input adm-input--sm" data-tier-field="decoration_id" data-i="' + i + '" aria-label="Décoration du palier ' + (i + 1) + '">' + optionsHTML(decos, t.decoration_id, 'Aucune') + '</select></td>' +
        '<td><button class="adm-btn adm-btn--sm adm-btn--danger-ghost" type="button" data-tier-remove="' + i + '" title="Retirer ce palier">✕</button></td>' +
      '</tr>';
    }).join('');
  }

  function openAchEditor(a) {
    var f = $('[data-ach-form]');
    achEditing = a || null;
    f.reset();
    $('[data-ach-error]').textContent = '';
    $('[data-ach-form-title]').textContent = a ? 'Modifier « ' + a.name + ' »' : 'Nouveau succès à paliers';
    if (a) {
      f.elements.name.value = a.name;
      f.elements.description.value = a.description || '';
      f.elements.icon.value = a.icon || 'trophy';
      f.elements.category.value = a.category || 'progression';
      f.elements.metric.value = a.metric;
      f.elements.unit.value = a.unit || '';
      f.elements.active.checked = a.active;
      tierRows = (a.tiers || []).map(function (t) { return { goal: t.goal, reward_coins: t.reward_coins, badge_id: t.badge_id || '', decoration_id: t.decoration_id || '' }; });
    } else {
      tierRows = generateTiers(10, 1, 1000, 5);
    }
    f.hidden = false;
    renderTierRows();
    f.scrollIntoView({ behavior: 'smooth', block: 'start' });
    f.elements.name.focus();
  }

  function renderBadgeRows() {
    var tbody = $('[data-badge-rows]');
    var list = prog.badges || [];
    if (!list.length) { failRow(tbody, 6, 'Aucun badge pour le moment.'); return; }
    tbody.innerHTML = list.map(function (b) {
      return '<tr><td>' + badgeChip(b) + '</td><td>' + esc(b.description || '—') + '</td><td class="adm-num">' + num(b.tiers) + '</td><td class="adm-num">' + num(b.owners) + '</td>' +
        '<td><span class="adm-tag ' + (b.active ? 'adm-tag--green' : '') + '">' + (b.active ? 'Actif' : 'Inactif') + '</span></td>' +
        '<td class="adm-cell-actions"><button class="adm-btn adm-btn--sm" type="button" data-badge-edit="' + esc(b.id) + '">Modifier</button> <button class="adm-btn adm-btn--sm adm-btn--danger-ghost" type="button" data-badge-delete="' + esc(b.id) + '">Supprimer</button></td></tr>';
    }).join('');
  }

  function badgeFormValue() {
    var f = $('[data-badge-form]');
    return { id: badgeEditing ? badgeEditing.id : null, name: f.elements.name.value.trim(), description: f.elements.description.value.trim(), icon: f.elements.icon.value,
      image_url: f.elements.image_url.value.trim(), color: f.elements.color.value, active: f.elements.active.checked };
  }
  function updateBadgePreview() { $('[data-badge-preview]').innerHTML = badgeChip(badgeFormValue()); }
  function resetBadgeForm() {
    var f = $('[data-badge-form]');
    badgeEditing = null;
    f.reset();
    $('[data-badge-form-title]').textContent = 'Nouveau badge';
    $('[data-badge-submit]').textContent = 'Créer le badge';
    $('[data-badge-cancel]').hidden = true;
    $('[data-badge-error]').textContent = '';
    updateBadgePreview();
  }

  function bindProgressAdmin() {
    var f = $('[data-ach-form]');
    $('[data-ach-new]').addEventListener('click', function () { openAchEditor(null); });
    $('[data-ach-cancel]').addEventListener('click', function () { f.hidden = true; achEditing = null; });
    $('[data-tiers-generate]').addEventListener('click', async function () {
      var count = Number(f.elements.gen_count.value), first = Number(f.elements.gen_first.value), last = Number(f.elements.gen_last.value), reward = Number(f.elements.gen_reward.value) || 0;
      if (!Number.isInteger(count) || count < 1 || count > 200) { $('[data-ach-error]').textContent = 'Nombre de paliers entre 1 et 200.'; return; }
      if (!(first >= 1) || !(last > first) || last - first < count - 1) { $('[data-ach-error]').textContent = 'Le dernier objectif doit être supérieur au premier d\'au moins ' + (count - 1) + '.'; return; }
      if (tierRows.length && !(await confirmBox('Remplacer les paliers ?', 'Les ' + tierRows.length + ' paliers actuels du formulaire seront remplacés (rien n\'est enregistré avant « Enregistrer le succès »).', 'Remplacer'))) return;
      $('[data-ach-error]').textContent = '';
      tierRows = generateTiers(count, first, last, reward);
      renderTierRows();
    });
    $('[data-tier-add]').addEventListener('click', function () {
      var last = tierRows.length ? Number(tierRows[tierRows.length - 1].goal) : 0;
      tierRows.push({ goal: niceRound(Math.max(last + 1, last * 1.5)), reward_coins: tierRows.length ? tierRows[tierRows.length - 1].reward_coins : 5, badge_id: '', decoration_id: '' });
      renderTierRows();
    });
    $('[data-tier-rows]').addEventListener('change', function (e) {
      var el = e.target.closest('[data-tier-field]');
      if (!el) return;
      var t = tierRows[Number(el.getAttribute('data-i'))];
      var field = el.getAttribute('data-tier-field');
      t[field] = field === 'goal' || field === 'reward_coins' ? Number(el.value) : el.value;
      if (field === 'goal') renderTierRows();
    });
    $('[data-tier-rows]').addEventListener('click', function (e) {
      var b = e.target.closest('[data-tier-remove]');
      if (!b) return;
      tierRows.splice(Number(b.getAttribute('data-tier-remove')), 1);
      renderTierRows();
    });
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var err = $('[data-ach-error]');
      err.textContent = '';
      var name = f.elements.name.value.trim();
      if (!name) { err.textContent = 'Donne un nom au succès.'; return; }
      if (!tierRows.length) { err.textContent = 'Ajoute au moins un palier.'; return; }
      for (var i = 0; i < tierRows.length; i++) {
        var g = Number(tierRows[i].goal);
        if (!Number.isInteger(g) || g < 1 || (i && g <= Number(tierRows[i - 1].goal))) { err.textContent = 'Palier ' + (i + 1) + ' : l\'objectif doit être un entier supérieur à celui du palier précédent.'; return; }
      }
      if (achEditing && achEditing.tiers && tierRows.length < achEditing.tiers.length &&
          !(await confirmBox('Supprimer des paliers ?', (achEditing.tiers.length - tierRows.length) + ' palier(s) seront supprimés, ainsi que leur progression chez les membres. Les récompenses déjà données sont conservées.', 'Enregistrer', true))) return;
      var payload = {
        id: achEditing ? achEditing.id : null, name: name, description: f.elements.description.value.trim(), icon: f.elements.icon.value,
        category: (f.elements.category.value.trim() || 'progression').toLowerCase(), metric: f.elements.metric.value, unit: f.elements.unit.value.trim(),
        active: f.elements.active.checked, sort: achEditing ? achEditing.sort : ((prog.achievements || []).length + 1) * 10,
        tiers: tierRows.map(function (t) { return { goal: Number(t.goal), reward_coins: Number(t.reward_coins) || 0, badge_id: t.badge_id || null, decoration_id: t.decoration_id || null }; })
      };
      var res = await busy(f.querySelector('[type="submit"]'), function () { return adminSaveAchievement(payload); });
      if (!res.ok) { err.textContent = res.error + (res.level ? ' (palier ' + res.level + ')' : ''); return; }
      toast('Succès « ' + name + ' » enregistré avec ' + payload.tiers.length + ' paliers.', 'success');
      f.hidden = true;
      achEditing = null;
      await loadProgressAdmin();
    });
    $('[data-ach-rows]').addEventListener('click', async function (e) {
      var edit = e.target.closest('[data-ach-edit]');
      var del = e.target.closest('[data-ach-delete]');
      var move = e.target.closest('[data-ach-move]');
      if (edit) { openAchEditor((prog.achievements || []).filter(function (a) { return a.id === edit.getAttribute('data-ach-edit'); })[0]); return; }
      if (move) {
        var r = await busy(move, function () { return adminMoveAchievement(move.getAttribute('data-id'), Number(move.getAttribute('data-ach-move'))); });
        if (!r.ok) { toast(r.error, 'error'); return; }
        await loadProgressAdmin();
        return;
      }
      if (del) {
        var a = (prog.achievements || []).filter(function (x) { return x.id === del.getAttribute('data-ach-delete'); })[0];
        if (!a || !(await confirmBox('Supprimer « ' + a.name + ' » ?', 'Le succès, ses ' + (a.tiers || []).length + ' paliers et la progression des membres seront supprimés. Les Anime Coins, badges et décorations déjà gagnés sont conservés.', 'Supprimer définitivement', true))) return;
        var d = await busy(del, function () { return adminDeleteAchievement(a.id); });
        if (!d.ok) { toast(d.error, 'error'); return; }
        await loadProgressAdmin();
        toast('Succès supprimé.', 'success');
      }
    });

    var bf = $('[data-badge-form]');
    bf.addEventListener('input', updateBadgePreview);
    bf.addEventListener('change', updateBadgePreview);
    $('[data-badge-cancel]').addEventListener('click', resetBadgeForm);
    bf.addEventListener('submit', async function (e) {
      e.preventDefault();
      var err = $('[data-badge-error]');
      err.textContent = '';
      var v = badgeFormValue();
      if (!v.name) { err.textContent = 'Donne un nom au badge.'; return; }
      if (v.image_url && !/^https:\/\/[^\s"<>]+$/.test(v.image_url)) { err.textContent = "L'image doit commencer par https://."; return; }
      var wasEditing = !!badgeEditing;
      var res = await busy($('[data-badge-submit]'), function () { return adminSaveBadge(v); });
      if (!res.ok) { err.textContent = res.error; return; }
      toast(wasEditing ? 'Badge modifié.' : 'Badge créé : associe-le à un palier dans un succès.', 'success');
      resetBadgeForm();
      await loadProgressAdmin();
    });
    $('[data-badge-rows]').addEventListener('click', async function (e) {
      var edit = e.target.closest('[data-badge-edit]');
      var del = e.target.closest('[data-badge-delete]');
      var b = (prog.badges || []).filter(function (x) { return x.id === (edit || del || { getAttribute: function () { return ''; } }).getAttribute(edit ? 'data-badge-edit' : 'data-badge-delete'); })[0];
      if (!b) return;
      if (edit) {
        badgeEditing = b;
        bf.elements.name.value = b.name;
        bf.elements.description.value = b.description || '';
        bf.elements.icon.value = b.icon || 'trophy';
        bf.elements.image_url.value = b.image_url || '';
        bf.elements.color.value = b.color || '#ff4d6d';
        bf.elements.active.checked = b.active;
        $('[data-badge-form-title]').textContent = 'Modifier « ' + b.name + ' »';
        $('[data-badge-submit]').textContent = 'Enregistrer';
        $('[data-badge-cancel]').hidden = false;
        updateBadgePreview();
        bf.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (del) {
        if (!(await confirmBox('Supprimer le badge « ' + b.name + ' » ?', num(b.owners) + ' membre(s) le possèdent et il est lié à ' + num(b.tiers) + ' palier(s). Il disparaîtra des profils ; les paliers restent mais ne donneront plus ce badge.', 'Supprimer définitivement', true))) return;
        var r = await busy(del, function () { return adminDeleteBadge(b.id); });
        if (!r.ok) { toast(r.error, 'error'); return; }
        if (badgeEditing && badgeEditing.id === b.id) resetBadgeForm();
        await loadProgressAdmin();
        toast('Badge supprimé.', 'success');
      }
    });
    updateBadgePreview();
  }

  /* ---- Wishboard ---- */
  var wishes = [];
  var WISH_STATUS = {
    pending: ['En attente', ''], accepted: ['Accepté', 'adm-tag--green'], not_found: ['Non trouvé', 'adm-tag--warn'],
    refused: ['Refusé', 'adm-tag--red'], too_recent: ['Trop récent', 'adm-tag--blue']
  };
  var WISH_ACTIONS = [['accepted', 'Accepter', 'adm-btn--primary'], ['not_found', 'Non trouvé', ''], ['refused', 'Refuser', 'adm-btn--danger-ghost'], ['too_recent', 'Trop récent', '']];

  function updateWishBadge() {
    var pending = wishes.filter(function (w) { return w.status === 'pending'; }).length;
    var badge = $('[data-wish-pending]');
    badge.hidden = !pending;
    badge.textContent = pending;
  }

  async function loadWishes() {
    var tbody = $('[data-wishes]');
    failRow(tbody, 5, 'Chargement…');
    var res = await adminListWishes();
    if (!res.ok) { failRow(tbody, 5, res.error.indexOf('SQL') !== -1 ? "Le script SQL v8 (Wishboard) n'est pas encore installé sur Supabase." : res.error); return; }
    wishes = res.data || [];
    renderWishes();
  }

  function renderWishes() {
    var tbody = $('[data-wishes]');
    var filter = $('[data-wish-filter]').value;
    var q = $('[data-wish-search]').value.trim().toLowerCase();
    updateWishBadge();
    var list = wishes.filter(function (w) {
      return (filter === 'all' || w.status === filter) && (!q || String(w.title).toLowerCase().indexOf(q) !== -1);
    });
    if (!list.length) { failRow(tbody, 5, wishes.length ? 'Aucune proposition dans cette catégorie.' : 'Aucune proposition pour le moment.'); return; }
    tbody.innerHTML = list.map(function (w) {
      var st = WISH_STATUS[w.status] || [w.status, ''];
      var img = typeof w.image === 'string' && /^https:\/\//.test(w.image) ? '<img class="adm-wish-img" src="' + esc(w.image) + '" alt="" loading="lazy" width="34" height="48">' : '';
      var actions = WISH_ACTIONS.filter(function (a) { return a[0] !== w.status; }).map(function (a) {
        return '<button class="adm-btn adm-btn--sm ' + a[2] + '" type="button" data-wish-set="' + a[0] + '" data-wish-id="' + esc(w.id) + '">' + a[1] + '</button>';
      }).join(' ') + (w.status !== 'pending' ? ' <button class="adm-btn adm-btn--sm" type="button" data-wish-set="pending" data-wish-id="' + esc(w.id) + '">Remettre en attente</button>' : '');
      return '<tr>' +
        '<td><div class="adm-wish">' + img + '<div><a href="details.html?id=' + Number(w.anilist_id) + '" target="_blank" rel="noopener">' + esc(w.title) + '</a>' +
          '<span class="adm-muted">' + esc([w.format, w.year].filter(Boolean).join(' · ')) + '</span></div></div></td>' +
        '<td class="adm-num"><strong>' + num(w.votes) + '</strong></td>' +
        '<td><span class="adm-tag ' + st[1] + '">' + esc(st[0]) + '</span>' + (w.decided_at ? '<br><span class="adm-muted">' + date(w.decided_at) + (w.decider ? ' par ' + esc(w.decider) : '') + '</span>' : '') + '</td>' +
        '<td>' + date(w.created_at) + '<br><span class="adm-muted">' + esc(w.author || 'membre supprimé') + '</span></td>' +
        '<td class="adm-wish-actions">' + actions + '</td>' +
      '</tr>';
    }).join('');
  }

  function bindWishes() {
    $('[data-wish-filter]').addEventListener('change', renderWishes);
    $('[data-wish-search]').addEventListener('input', renderWishes);
    $('[data-wish-refresh]').addEventListener('click', loadWishes);
    $('[data-wishes]').addEventListener('click', async function (e) {
      var btn = e.target.closest('[data-wish-set]');
      if (!btn) return;
      var id = btn.getAttribute('data-wish-id');
      var status = btn.getAttribute('data-wish-set');
      var w = wishes.filter(function (x) { return x.id === id; })[0];
      if (!w) return;
      var res = await busy(btn, function () { return adminSetWishStatus(id, status); });
      if (!res.ok) { toast(res.error, 'error'); return; }
      w.status = status;
      w.decided_at = status === 'pending' ? null : new Date().toISOString();
      w.decider = status === 'pending' ? null : (state.me && state.me.pseudo);
      renderWishes();
      toast('« ' + w.title + ' » : ' + (WISH_STATUS[status] || [status])[0].toLowerCase() + '.', 'success');
    });
    adminListWishes().then(function (r) { if (r.ok && !state.loaded.wishboard) { wishes = r.data || []; updateWishBadge(); } });
  }

  /* ---- Épisodes : Anime → Saison → Épisode → Langue → Lecteur ---- */
  var EP_PAGE = 50;
  var SYNC_EVERY_MS = 6 * 3600 * 1000;
  var epx = {
    tab: 'list', filter: 'all', search: '', offset: 0, items: [], total: 0, seq: 0, timer: null, found: [],
    current: null, tree: null, treeSeq: 0, focusKey: null, listStale: false, sync: null,
    providers: null, langs: null, providersPane: false, langsPane: false
  };

  var AL_STATUS = { FINISHED: 'Terminé', RELEASING: 'En cours de diffusion', NOT_YET_RELEASED: 'Pas encore sorti', CANCELLED: 'Annulé', HIATUS: 'En pause' };
  var EP_KIND = { episode: 'Épisode', special: 'Spécial', ova: 'OVA', ona: 'ONA', movie: 'Film', recap: 'Récapitulatif' };
  var SRC_STATUS = {
    ready: ['PRÊT', 'green'], failed: ['ÉCHEC', 'red'], disabled: ['DÉSACTIVÉ', 'off'],
    pending: ['EN ATTENTE', 'warn'], uploading: ['EN ATTENTE', 'warn'], processing: ['EN ATTENTE', 'warn']
  };
  var STATUS_CHOICES = [['ready', 'Prête'], ['pending', 'En attente'], ['failed', 'En échec'], ['disabled', 'Désactivée']];
  var REVIEW_REASON = {
    langue_inconnue_v7: "ancien épisode (avant la v14) : sa langue n'a jamais été précisée",
    langue_audio_inconnue: 'langue audio inconnue ou indéterminée',
    langue_origine_inconnue: "langue d'origine de l'anime inconnue : précise-la en haut de la fiche",
    lang_mismatch: "langue incohérente : une VO doit être dans la langue d'origine, un doublage dans une autre",
    st_meme_langue: "sous-titres dans la même langue que l'audio"
  };
  var RIGHTS = { own: 'Mes propres vidéos', licensed: 'Sous licence', public_domain: 'Domaine public', cc_license: 'Licence Creative Commons' };
  var RELATION = {
    SEQUEL: 'Suite', PREQUEL: 'Préquelle', SIDE_STORY: 'Histoire parallèle', SPIN_OFF: 'Spin-off', PARENT: 'Série principale',
    ALTERNATIVE: 'Version alternative', SUMMARY: 'Résumé', COMPILATION: 'Compilation', CONTAINS: 'Contient', OTHER: 'Autre'
  };
  var SEASON_RELATIONS = ['SEQUEL', 'PREQUEL', 'SIDE_STORY', 'SPIN_OFF', 'PARENT', 'ALTERNATIVE'];
  var AUDIO_KIND = { original: 'Audio original', dub: 'Doublage' };
  var SUB_KIND = { none: 'Aucun', hard: 'Incrustés dans la vidéo', soft: 'À activer dans le lecteur' };

  function animeName(m) { return (m.title && (m.title.english || m.title.romaji || m.title.native)) || ('Anime #' + m.id); }
  function plural(n, one, many) { return num(n) + ' ' + (Number(n) > 1 ? (many || one + 's') : one); }
  function ago(v) {
    if (!v) return 'jamais';
    var min = Math.round((Date.now() - new Date(v).getTime()) / 60000);
    if (min < 1) return "à l'instant";
    if (min < 60) return 'il y a ' + min + ' min';
    var h = Math.round(min / 60);
    if (h < 48) return 'il y a ' + h + ' h';
    return 'il y a ' + Math.round(h / 24) + ' jours';
  }
  function coverImg(url, w, h) {
    return typeof url === 'string' && /^https:\/\/[^\s"<>]+$/.test(url)
      ? '<img src="' + esc(url) + '" alt="" width="' + w + '" height="' + h + '" loading="lazy">'
      : '<span class="adm-ep-noimg" aria-hidden="true"></span>';
  }
  function seasonName(n) { return Number(n) === 0 ? 'Spéciaux (saison 0)' : 'Saison ' + Number(n); }
  function episodeName(e) { return (e.kind && e.kind !== 'episode' ? (EP_KIND[e.kind] || e.kind) : 'Épisode') + ' ' + Number(e.number); }
  function reviewText(code) { return REVIEW_REASON[code] || code || 'raison non précisée'; }
  function toLocalInput(v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d.getTime())) return '';
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // Comme busy(), mais garde le contenu HTML du bouton (textes réservés aux lecteurs d'écran)
  async function busyHTML(btn, fn) {
    var html = btn.innerHTML;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = 'Patiente…';
    try { return await fn(); } finally { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.innerHTML = html; }
  }

  async function epProviders(force) {
    if (!epx.providers || force) {
      var res = await adminListProviders();
      if (!res.ok) return res;
      epx.providers = res.items || [];
    }
    return { ok: true, items: epx.providers };
  }
  async function epLangs(force) {
    if (!epx.langs || force) {
      var res = await adminLanguageConfig();
      if (!res.ok) return res;
      epx.langs = { languages: res.languages || [], labels: res.labels || [], rules: res.rules || [] };
    }
    return Object.assign({ ok: true }, epx.langs);
  }
  function langName(code) {
    if (!code) return '—';
    var l = epx.langs && epx.langs.languages.filter(function (x) { return x.code === code; })[0];
    return l ? l.name_fr : code;
  }
  function langOptions(selected, withUnknown) {
    return (epx.langs ? epx.langs.languages : []).filter(function (l) {
      return withUnknown || (l.code !== 'und' && l.code !== 'mul');
    }).map(function (l) {
      return '<option value="' + esc(l.code) + '"' + (l.code === selected ? ' selected' : '') + '>' + esc(l.name_fr) + ' (' + esc(l.code) + ')</option>';
    }).join('');
  }
  function providerOptions(selected) {
    return (epx.providers || []).map(function (p) {
      return '<option value="' + esc(p.key) + '"' + (p.key === selected ? ' selected' : '') + '>' + esc(p.name) + (p.active ? '' : ' (désactivé)') + '</option>';
    }).join('');
  }
  function choiceOptions(pairs, selected) {
    return pairs.map(function (p) { return '<option value="' + esc(p[0]) + '"' + (p[0] === selected ? ' selected' : '') + '>' + esc(p[1]) + '</option>'; }).join('');
  }
  function presetGroupHTML(selected) {
    return '<div class="adm-presets" role="group" aria-label="Préréglages de langue">' + LANGUAGE_PRESETS.map(function (p) {
      return '<button class="adm-seg-btn" type="button" data-preset="' + esc(p.code) + '" aria-pressed="' + (p.code === selected) + '">' + esc(p.code) + '</button>';
    }).join('') + '</div>';
  }
  function markPreset(root, code) {
    $$('[data-preset]', root).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-preset') === code)); });
  }

  function loadEpisodes() {
    epLangs();
    epProviders();
    loadOverview(true);
    loadReviewAlert();
    loadSyncStatus(true);
  }

  /* Onglets Animes / Lecteurs / Langues */
  function showEpTab(tab) {
    epx.tab = tab;
    $$('[data-ep-tab]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-ep-tab') === tab)); });
    $('[data-ep-pane="list"]').hidden = tab !== 'list' || !!epx.current;
    $('[data-ep-pane="anime"]').hidden = tab !== 'list' || !epx.current;
    $('[data-ep-pane="providers"]').hidden = tab !== 'providers';
    $('[data-ep-pane="languages"]').hidden = tab !== 'languages';
    if (tab === 'providers' && !epx.providersPane) { epx.providersPane = true; loadProvidersPane(); }
    if (tab === 'languages' && !epx.langsPane) { epx.langsPane = true; loadLanguagesPane(); }
  }

  /* Liste des animes du site */
  async function loadOverview(reset) {
    var list = $('[data-ep-animes]');
    var seq = ++epx.seq;
    if (reset) {
      epx.offset = 0;
      epx.items = [];
      list.innerHTML = '<li class="adm-empty-li">Chargement…</li>';
    }
    var res = await adminEpisodeOverview({ search: epx.search, filter: epx.filter, offset: epx.offset, limit: EP_PAGE });
    if (seq !== epx.seq) return;
    if (!res.ok) {
      list.innerHTML = '<li class="adm-empty-li">' + esc(res.error) + '</li>';
      $('[data-ep-more]').hidden = true;
      $('[data-ep-total]').textContent = '';
      return;
    }
    epx.total = Number(res.total) || 0;
    epx.items = epx.items.concat(res.items || []);
    epx.offset = epx.items.length;
    renderOverview();
  }

  function renderOverview() {
    var list = $('[data-ep-animes]');
    $('[data-ep-total]').textContent = epx.total
      ? plural(epx.total, 'anime') + (epx.items.length < epx.total ? ' · ' + num(epx.items.length) + ' affichés' : '')
      : '';
    $('[data-ep-more]').hidden = epx.items.length >= epx.total;
    if (!epx.items.length) {
      list.innerHTML = '<li class="adm-empty-li">' + (epx.search || epx.filter !== 'all'
        ? 'Aucun anime ne correspond.'
        : 'Aucun anime pour le moment : ajoute le premier avec la recherche AniList ci-dessus.') + '</li>';
      return;
    }
    list.innerHTML = epx.items.map(animeRowHTML).join('');
  }

  function animeRowHTML(a) {
    var title = a.title || ('Anime #' + a.anilist_id);
    var tags = [
      '<span class="adm-tag">' + plural(a.episode_count, 'épisode') + '</span>',
      '<span class="adm-tag adm-tag--green">' + plural(a.ready, 'source prête', 'sources prêtes') + '</span>'
    ];
    if (a.missing) tags.push('<span class="adm-tag adm-tag--warn">' + plural(a.missing, 'épisode sans source', 'épisodes sans source') + '</span>');
    if (a.failed) tags.push('<span class="adm-tag adm-tag--red">' + plural(a.failed, 'échec') + '</span>');
    if (a.review) tags.push('<span class="adm-tag adm-tag--warn">' + num(a.review) + ' à vérifier</span>');
    if (a.reports) tags.push('<span class="adm-tag adm-tag--red">' + plural(a.reports, 'signalement') + '</span>');
    var meta = [AL_STATUS[a.status] || 'Statut AniList inconnu'];
    if (a.episodes_total) meta.push(num(a.episodes_total) + ' ép. sur AniList');
    if (a.next_airing_episode) meta.push('prochain : ép. ' + num(a.next_airing_episode));
    meta.push('synchro ' + ago(a.last_synced_at));
    return '<li><button class="adm-anime-row" type="button" data-ep-open="' + Number(a.anilist_id) + '">' + coverImg(a.cover, 46, 66) +
      '<span class="adm-anime-info"><strong>' + esc(title) + '</strong>' +
      '<span class="adm-muted">' + esc(meta.join(' · ')) + '</span>' +
      (a.sync_error ? '<span class="adm-error-inline">Erreur de synchro : ' + esc(a.sync_error) + '</span>' : '') +
      '<span class="adm-tags">' + tags.join(' ') + '</span></span></button></li>';
  }

  async function loadReviewAlert() {
    var box = $('[data-ep-review-alert]');
    var res = await adminEpisodeOverview({ filter: 'review', offset: 0, limit: 1 });
    if (!res.ok || !Number(res.total)) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<p><strong>' + plural(res.total, 'anime a', 'animes ont') + ' des sources « à vérifier ».</strong> ' +
      'Ce sont surtout les anciens épisodes (créés avant le système de langues) migrés sans langue connue : ' +
      'ils restent invisibles du public tant que leur langue n\'est pas précisée. Ouvre l\'anime puis utilise « Qualifier en masse » pour tout indiquer en une fois.</p>' +
      '<button class="adm-btn adm-btn--sm" type="button" data-ep-show-review>Voir ces animes</button>';
  }

  function setFilter(filter) {
    epx.filter = filter;
    $$('[data-ep-filter]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-ep-filter') === filter)); });
    loadOverview(true);
  }

  /* Synchronisation AniList (dans le navigateur de l'admin) */
  function syncInfoText(st) {
    if (!st) return 'Aucune synchronisation pour le moment.';
    var parts = [st.last_success_at
      ? 'Dernière synchro réussie : ' + date(st.last_success_at, true) + ' (' + ago(st.last_success_at) + ').'
      : 'Aucune synchro réussie pour le moment.'];
    var i = st.info || {};
    if (st.last_started_at) {
      parts.push('Dernier passage ' + ago(st.last_started_at) + ' : ' + plural(i.done || 0, 'fiche à jour', 'fiches à jour') + ', ' +
        plural(i.failed || 0, 'échec') + ', ' + plural(i.created || 0, 'épisode créé', 'épisodes créés') + '.');
    }
    if (st.last_error) parts.push('Erreur : ' + st.last_error);
    return parts.join(' ');
  }

  async function loadSyncStatus(auto) {
    var box = $('[data-sync-state]');
    var res = await adminSyncStatus();
    if (epx.sync) return;
    if (!res.ok) { box.textContent = res.error; return; }
    box.textContent = syncInfoText(res.state);
    var last = res.state && res.state.last_success_at ? new Date(res.state.last_success_at).getTime() : 0;
    if (auto && Date.now() - last > SYNC_EVERY_MS) runSync(true);
  }

  async function runSync(auto) {
    if (epx.sync) return;
    var ctrl = new AbortController();
    epx.sync = ctrl;
    var runBtn = $('[data-sync-run]');
    var cancelBtn = $('[data-sync-cancel]');
    var bar = $('[data-sync-progress]');
    var box = $('[data-sync-state]');
    runBtn.disabled = true;
    cancelBtn.hidden = false;
    cancelBtn.disabled = false;
    bar.hidden = false;
    bar.removeAttribute('value');
    box.textContent = auto ? 'Synchronisation automatique en cours (la dernière date de plus de 6 heures)…' : 'Synchronisation en cours…';
    var result;
    var begin = typeof adminSyncBegin === 'function' ? await adminSyncBegin() : { ok: true };
    if (!begin.ok) {
      epx.sync = null;
      runBtn.disabled = false;
      cancelBtn.hidden = true;
      bar.hidden = true;
      box.textContent = begin.reason === 'sync_running' ? 'Une synchronisation est déjà en cours (autre onglet ou autre administrateur). Réessaie dans quelques minutes.' : begin.error;
      if (!auto) toast(box.textContent, 'error');
      return;
    }
    try {
      result = await runAnilistSync({
        signal: ctrl.signal,
        createMissing: $('[data-sync-create]').checked,
        onProgress: function (p) {
          if (p.total > 0) { bar.max = p.total; bar.value = p.done + p.failed; }
          var n = p.done + p.failed;
          // Zone lue par les lecteurs d'écran : début, tous les 10 animes et fin seulement
          if (n === 0 || n % 10 === 0 || n === p.total) {
            box.textContent = 'Synchronisation : ' + num(n) + ' sur ' + num(p.total) + (p.failed ? ' (' + plural(p.failed, 'échec') + ')' : '') + '…';
          }
        }
      });
    } catch (err) {
      result = { ok: false, error: (err && err.message) || 'Synchronisation interrompue.' };
    }
    epx.sync = null;
    runBtn.disabled = false;
    cancelBtn.hidden = true;
    bar.hidden = true;
    var summary = result.cancelled ? 'Synchronisation annulée.'
      : !result.ok ? 'Synchronisation en échec : ' + result.error
      : result.total ? 'Synchronisation terminée : ' + plural(result.done, 'fiche à jour', 'fiches à jour') +
          (result.failed ? ', ' + plural(result.failed, 'échec') : '') + ', ' + plural(result.created, 'épisode créé', 'épisodes créés') + '.'
      : 'Tout est déjà à jour.';
    if (!auto || !result.ok) toast(summary, result.cancelled ? '' : result.ok ? 'success' : 'error');
    box.textContent = summary;
    if (result.total) {
      loadOverview(true);
      if (epx.current) reloadTree();
    }
    setTimeout(function () { if (!epx.sync) loadSyncStatus(false); }, 1500);
  }

  // Relit sur AniList quelques fiches précises (fiche ouverte, saison ajoutée) et les enregistre
  async function syncMedias(ids) {
    var medias;
    try { medias = await anilistFetchMedia(ids); } catch (err) { return { ok: false, error: err.message, created: 0 }; }
    var create = $('[data-sync-create]').checked;
    var created = 0;
    var errors = [];
    var seen = {};
    for (var i = 0; i < medias.length; i++) {
      seen[medias[i].id] = true;
      var r = await adminSyncAnime(medias[i], create);
      if (r.ok) created += Number(r.created) || 0; else errors.push(animeName(medias[i]) + ' : ' + r.error);
    }
    ids.forEach(function (id) { if (!seen[id]) errors.push('Fiche n°' + id + ' introuvable sur AniList.'); });
    return errors.length ? { ok: false, error: errors.join(' · '), created: created } : { ok: true, created: created };
  }

  /* Ajout d'un anime depuis AniList */
  async function searchAddAnime(form) {
    var q = form.elements.q.value.trim();
    var results = $('[data-ep-add-results]');
    if (q.length < 2) { results.innerHTML = '<li class="adm-muted">Tape au moins 2 caractères.</li>'; return; }
    results.innerHTML = '<li class="adm-muted">Recherche sur AniList…</li>';
    try { epx.found = await anilistSearchAnime(q); } catch (err) { results.innerHTML = '<li class="adm-muted">' + esc(err.message) + '</li>'; return; }
    results.innerHTML = epx.found.length ? epx.found.map(function (m, i) {
      return '<li><button type="button" data-ep-add-pick="' + i + '">' + coverImg(m.coverImage && m.coverImage.medium, 40, 57) +
        '<span><strong>' + esc(animeName(m)) + '</strong><span class="adm-muted">' +
        esc([m.format, m.seasonYear, m.episodes ? m.episodes + ' ép.' : '', AL_STATUS[m.status]].filter(Boolean).join(' · ')) +
        '</span></span></button></li>';
    }).join('') : '<li class="adm-muted">Aucun anime trouvé.</li>';
  }

  async function addAnime(m, btn) {
    var create = $('[data-ep-add-create]').checked;
    var res = await busyHTML(btn, async function () {
      var medias;
      try { medias = await anilistFetchMedia([m.id]); } catch (err) { return { ok: false, error: err.message }; }
      if (!medias.length) return { ok: false, error: 'Cet anime est introuvable sur AniList.' };
      return adminSyncAnime(medias[0], create);
    });
    if (!res.ok) { toast(res.error, 'error'); return; }
    toast('« ' + animeName(m) + ' » ajouté' + (res.created ? ' : ' + plural(res.created, 'épisode créé', 'épisodes créés') : '') + '.', 'success');
    $('[data-ep-add-results]').innerHTML = '';
    epx.listStale = true;
    openAnime(res.anilist_id || m.id);
  }

  /* Fiche d'un anime */
  async function openAnime(id) {
    epx.current = Number(id);
    epx.tree = null;
    showEpTab('list');
    var box = $('[data-ep-tree]');
    box.innerHTML = '<p class="adm-muted">Chargement de la fiche…</p>';
    box.focus();
    await reloadTree();
  }

  function closeAnime() {
    var id = epx.current;
    epx.current = null;
    epx.tree = null;
    $('[data-ep-tree]').innerHTML = '';
    showEpTab('list');
    if (epx.listStale) { epx.listStale = false; loadOverview(true).then(function () { focusRow(id); }); loadReviewAlert(); } else focusRow(id);
  }
  function focusRow(id) {
    var row = $('[data-ep-open="' + Number(id) + '"]');
    if (row) row.focus(); else $('[data-ep-search]').focus();
  }

  async function reloadTree() {
    var id = epx.current;
    if (!id) return;
    var seq = ++epx.treeSeq;
    var all = await Promise.all([adminEpisodeTree(id), epProviders(), epLangs()]);
    if (epx.current !== id || seq !== epx.treeSeq) return;
    var box = $('[data-ep-tree]');
    if (!all[0].ok) { box.innerHTML = '<p class="adm-error">' + esc(all[0].error) + '</p>'; return; }
    epx.tree = all[0];
    epx.tree.relations = epx.tree.relations || [];
    epx.tree.seasons = epx.tree.seasons || [];
    renderTree();
  }

  function renderTree() {
    var box = $('[data-ep-tree]');
    var t = epx.tree;
    var active = document.activeElement;
    var inside = !!active && box.contains(active);
    var key = epx.focusKey || (inside && active !== box ? active.getAttribute('data-k') : null);
    var refocus = inside || !!epx.focusKey || !active || active === document.body;
    epx.focusKey = null;
    var review = 0;
    t.seasons.forEach(function (s) { s.episodes.forEach(function (e) { e.sources.forEach(function (src) { if (src.needs_review) review++; }); }); });
    box.innerHTML = treeHeadHTML(t) + langCardHTML(t.anime) + (review ? bulkCardHTML(t, review) : '') + seasonsCardHTML(t) +
      t.seasons.map(function (s) { return seasonHTML(s, t); }).join('');
    if (refocus && !$('[data-ep-dialog]').open) {
      var el = key ? box.querySelector('[data-k="' + key + '"]') : null;
      if (el) el.focus(); else box.focus();
    }
  }

  function treeHeadHTML(t) {
    var a = t.anime;
    var title = a.title_display || a.title_english || a.title_romaji || ('Anime #' + a.anilist_id);
    var facts = [
      ['AniList', 'n°' + a.anilist_id + (a.format ? ' · ' + a.format : '') + (a.season_year ? ' · ' + a.season_year : '')],
      ['Statut', AL_STATUS[a.status] || 'inconnu'],
      ['Épisodes AniList', a.episodes ? num(a.episodes) : 'non communiqué'],
      ['Prochain épisode', a.next_airing_episode ? 'ép. ' + num(a.next_airing_episode) + (a.next_airing_at ? ', le ' + date(a.next_airing_at, true) : '') : '—'],
      ['Dernière synchro', a.last_synced_at ? date(a.last_synced_at, true) + ' (' + ago(a.last_synced_at) + ')' : 'jamais']
    ];
    return '<section class="adm-card adm-ep-head" aria-labelledby="ep-tree-title">' + coverImg(a.cover, 92, 130) +
      '<div class="adm-ep-head-body"><h2 id="ep-tree-title">' + esc(title) + '</h2>' +
      (a.title_romaji && a.title_romaji !== title ? '<p class="adm-muted">' + esc(a.title_romaji) + '</p>' : '') +
      '<dl class="adm-facts adm-facts--inline">' + facts.map(function (f) { return '<dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd>'; }).join('') + '</dl>' +
      (a.sync_error ? '<p class="adm-error">Dernière erreur de synchro : ' + esc(a.sync_error) + '</p>' : '') +
      (a.is_adult ? '<p class="adm-error">Contenu pour adultes : rien ne peut être publié pour cet anime.</p>' : '') +
      '<div class="adm-actions"><button class="adm-btn" type="button" data-tree-sync data-k="sync">Forcer la synchro</button>' +
      '<a class="adm-btn" href="details.html?id=' + Number(a.anilist_id) + '" target="_blank" rel="noopener">Voir la fiche publique<span class="adm-sr"> (nouvel onglet)</span></a></div>' +
      '</div></section>';
  }

  function langCardHTML(a) {
    var auto = a.original_lang_source !== 'admin';
    return '<section class="adm-card" aria-labelledby="ep-lang-title"><h2 id="ep-lang-title">Langue d\'origine</h2>' +
      '<p class="adm-muted adm-intro">Elle sert à distinguer la VO (audio dans la langue d\'origine) d\'un doublage (VF…). En automatique, elle est déduite du pays d\'origine indiqué par AniList.</p>' +
      (a.original_lang ? '' : '<p class="adm-error">Langue d\'origine inconnue : les sources de cet anime ne peuvent pas être publiées tant qu\'elle n\'est pas précisée.</p>') +
      '<form class="adm-toolbar adm-toolbar--flush" data-tree-lang-form novalidate>' +
      '<label class="adm-field"><span>Langue d\'origine</span><select class="adm-input" name="lang">' +
      '<option value=""' + (auto ? ' selected' : '') + '>Automatique' + (auto ? ' (actuellement : ' + esc(a.original_lang ? langName(a.original_lang) : 'inconnue') + ')' : '') + '</option>' +
      langOptions(auto ? null : a.original_lang) + '</select></label>' +
      '<button class="adm-btn" type="submit" data-k="lang">Enregistrer la langue</button></form></section>';
  }

  function bulkCardHTML(t, count) {
    return '<section class="adm-card adm-card--warn" aria-labelledby="ep-bulk-title"><h2 id="ep-bulk-title">Qualifier en masse · ' +
      plural(count, 'source à vérifier', 'sources à vérifier') + '</h2>' +
      '<p class="adm-muted adm-intro">Une source « à vérifier » n\'est jamais publiée. Ce sont surtout d\'anciens épisodes migrés sans langue connue : choisis leur langue ici pour toutes les corriger en une fois. Tu peux limiter à une saison ou à un lecteur. Par défaut, les sources que tu as saisies toi-même ne sont pas modifiées.</p>' +
      '<form data-bulk-form novalidate><input type="hidden" name="preset" value="">' +
      '<p class="adm-field-label" id="ep-bulk-presets">Langue de ces sources</p>' + presetGroupHTML(null).replace('aria-label="Préréglages de langue"', 'aria-labelledby="ep-bulk-presets"') +
      '<div class="adm-row">' +
      '<label class="adm-field"><span>Saison (facultatif)</span><select class="adm-input" name="season"><option value="">Toutes les saisons</option>' +
      t.seasons.map(function (s) { return '<option value="' + Number(s.number) + '">' + esc(seasonName(s.number)) + '</option>'; }).join('') + '</select></label>' +
      '<label class="adm-field"><span>Lecteur (facultatif)</span><select class="adm-input" name="provider"><option value="">Tous les lecteurs</option>' + providerOptions(null) + '</select></label>' +
      '</div>' +
      '<label class="adm-check"><input type="checkbox" name="publish" checked> Publier ces sources une fois leur langue précisée</label>' +
      '<label class="adm-check"><input type="checkbox" name="include_admin"> Inclure aussi les sources que j\'ai saisies et qui sont « à vérifier » (langue incohérente…)</label>' +
      '<p class="adm-error" data-bulk-error role="alert"></p>' +
      '<div class="adm-actions"><button class="adm-btn adm-btn--primary" type="submit" data-k="bulk">Appliquer la langue</button></div></form></section>';
  }

  function nextSeasonNumber(t) {
    var used = {};
    t.seasons.forEach(function (s) { used[s.number] = true; });
    var n = 1;
    while (used[n] && n < 99) n++;
    return n;
  }

  function seasonsCardHTML(t) {
    var next = nextSeasonNumber(t);
    var sugg = t.relations.filter(function (r) {
      return r.mapped_season == null && SEASON_RELATIONS.indexOf(r.relation) !== -1 && Number(r.to_id) !== Number(t.anime.anilist_id);
    });
    var list = t.seasons.length ? '<ul class="adm-season-sum">' + t.seasons.map(function (s) {
      var media = s.media_anilist_id
        ? 'fiche AniList ' + (s.media && s.media.title ? '« ' + s.media.title + ' » ' : '') + '(n°' + s.media_anilist_id + ')'
        : 'aucune fiche AniList liée';
      return '<li><strong>' + esc(seasonName(s.number)) + '</strong>' + (s.title ? ' — ' + esc(s.title) : '') +
        ' <span class="adm-muted">· ' + esc(media) + ' · ' + plural(s.episodes.length, 'épisode') + '</span></li>';
    }).join('') + '</ul>' : '<p class="adm-muted">Aucune saison pour le moment.</p>';
    var suggestions = sugg.length ? '<h3 class="adm-subtitle">Suggestions d\'après AniList</h3><ul class="adm-suggest">' + sugg.map(function (r) {
      var id = Number(r.to_id);
      return '<li><span><strong>' + esc(r.title || ('Fiche n°' + id)) + '</strong> <span class="adm-muted">· ' +
        esc([RELATION[r.relation] || r.relation, r.format, 'n°' + id].filter(Boolean).join(' · ')) + '</span></span>' +
        '<span class="adm-suggest-actions"><label class="adm-field adm-field--inline"><span>N°</span>' +
        '<input class="adm-input adm-input--sm adm-input--num" type="number" min="0" max="99" value="' + next + '" data-suggest-number="' + id + '" aria-label="Numéro de saison pour ' + esc(r.title || ('la fiche ' + id)) + '"></label>' +
        '<button class="adm-btn adm-btn--sm" type="button" data-season-suggest="' + id + '" data-k="sugg-' + id + '">Ajouter comme saison ' + next + '</button></span></li>';
    }).join('') + '</ul><p class="adm-muted">Une fois liée, la fiche est synchronisée : ses épisodes déjà diffusés sont créés dans cette saison si la case « Créer les nouveaux épisodes diffusés » de la synchro est cochée.</p>' : '';
    return '<section class="adm-card" aria-labelledby="ep-seasons-title"><div class="adm-head adm-head--card"><h2 id="ep-seasons-title">Saisons</h2>' +
      '<button class="adm-btn adm-btn--sm" type="button" data-season-new data-k="season-new">Ajouter une saison</button></div>' +
      '<p class="adm-muted adm-intro">Sur AniList, chaque saison est souvent une fiche à part. Relie-les ici pour regrouper tous les épisodes sous cet anime. La saison 0 regroupe les spéciaux.</p>' +
      list + suggestions + '</section>';
  }

  function seasonHTML(s, t) {
    var n = Number(s.number);
    var m = s.media;
    var info = s.media_anilist_id
      ? 'Fiche AniList liée : ' + (m && m.title ? m.title + ' ' : '') + '(n°' + s.media_anilist_id + ')' +
        (m ? ' · ' + (AL_STATUS[m.status] || 'statut inconnu') + (m.episodes ? ' · ' + m.episodes + ' ép.' : '') +
          (m.next_airing_episode ? ' · prochain : ép. ' + m.next_airing_episode : '') + ' · synchro ' + ago(m.last_synced_at) : ' · pas encore synchronisée')
      : 'Aucune fiche AniList liée : saison gérée à la main.';
    if (s.episode_offset) info += ' · Décalage de numérotation : +' + s.episode_offset;
    var name = seasonName(n);
    return '<section class="adm-card adm-season" aria-labelledby="ep-s-' + n + '">' +
      '<div class="adm-head adm-head--card"><h2 id="ep-s-' + n + '">' + esc(name) + (s.title ? ' — ' + esc(s.title) : '') + '</h2>' +
      '<div class="adm-actions adm-actions--tight" role="group" aria-label="' + esc('Actions pour ' + name) + '">' +
      '<button class="adm-btn adm-btn--sm adm-btn--primary" type="button" data-ep-new="' + n + '" data-k="ep-new-' + n + '">Ajouter un épisode</button>' +
      '<button class="adm-btn adm-btn--sm" type="button" data-ep-range="' + n + '" data-k="ep-range-' + n + '">Ajouter une plage</button>' +
      '<button class="adm-btn adm-btn--sm" type="button" data-season-edit="' + n + '" data-k="season-edit-' + n + '">Modifier la saison</button>' +
      (s.episodes.length ? '' : '<button class="adm-btn adm-btn--sm adm-btn--danger-ghost" type="button" data-season-del="' + n + '" data-k="season-del-' + n + '">Supprimer la saison</button>') +
      '</div></div><p class="adm-muted">' + esc(info) + '</p>' +
      (s.episodes.length ? '<ol class="adm-episodes">' + s.episodes.map(function (e) { return episodeHTML(e, t); }).join('') + '</ol>'
        : '<p class="adm-empty-box">Aucun épisode dans cette saison.</p>') +
      '</section>';
  }

  function episodeHTML(e, t) {
    var name = episodeName(e);
    var tags = [];
    if (!e.published) tags.push('<span class="adm-tag adm-tag--warn">Masqué</span>');
    if (e.premium_until && new Date(e.premium_until).getTime() > Date.now()) tags.push('<span class="adm-tag adm-tag--gold">Premium jusqu\'au ' + date(e.premium_until, true) + '</span>');
    if (e.duration_sec) tags.push('<span class="adm-muted">' + Math.round(e.duration_sec / 60) + ' min</span>');
    var groups = {};
    var order = [];
    e.sources.forEach(function (src) {
      var k = src.label || 'AUTRE';
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(src);
    });
    var sources = order.length ? order.map(function (k) {
      return '<div class="adm-lang-group"><h4>' + esc(k) + ' <span class="adm-muted">· ' + plural(groups[k].length, 'lecteur') + '</span></h4>' +
        '<ul class="adm-src-list">' + groups[k].map(function (src) { return sourceHTML(src, e, t); }).join('') + '</ul></div>';
    }).join('') : '<p class="adm-muted">Aucune source : l\'épisode reste invisible du public.</p>';
    var id = esc(e.id);
    return '<li class="adm-episode"><div class="adm-episode-head"><h3>' + esc(name) + (e.title ? ' <span class="adm-episode-title">' + esc(e.title) + '</span>' : '') + '</h3>' +
      (tags.length ? '<span class="adm-tags">' + tags.join(' ') + '</span>' : '') +
      '<div class="adm-actions adm-actions--tight" role="group" aria-label="' + esc('Actions pour ' + name + ', ' + seasonName(e.season)) + '">' +
      '<button class="adm-btn adm-btn--sm adm-btn--primary" type="button" data-src-new="' + id + '" data-k="src-new-' + id + '">Ajouter une source</button>' +
      '<button class="adm-btn adm-btn--sm" type="button" data-ep-edit="' + id + '" data-k="ep-edit-' + id + '">Modifier</button>' +
      '<button class="adm-btn adm-btn--sm adm-btn--danger-ghost" type="button" data-ep-del="' + id + '" data-k="ep-del-' + id + '">Supprimer</button>' +
      '</div></div>' + sources + '</li>';
  }

  function sourceHTML(src, e, t) {
    var st = SRC_STATUS[src.status] || [String(src.status || '').toUpperCase(), 'off'];
    var name = src.provider_name || src.provider;
    var flags = [src.published
      ? '<span class="adm-tag adm-tag--green">Publiée</span>'
      : '<span class="adm-tag">Non publiée</span>' + (src.publish_requested && src.needs_review ? ' <span class="adm-muted">(publication bloquée tant qu\'elle est à vérifier)</span>' : '')];
    if (src.needs_review) flags.push('<span class="adm-tag adm-tag--warn">À vérifier</span> <span class="adm-muted">' + esc(reviewText(src.review_reason)) + '</span>');
    if (src.reports) flags.push('<span class="adm-tag adm-tag--red">' + plural(src.reports, 'signalement') + '</span>' + (src.last_report_at ? ' <span class="adm-muted">dernier ' + esc(ago(src.last_report_at)) + '</span>' : ''));
    var lang = (AUDIO_KIND[src.audio_kind] || src.audio_kind) + ' (' + langName(src.audio_lang) + '), sous-titres : ' +
      (src.subtitle_kind === 'none' ? 'aucun' : (SUB_KIND[src.subtitle_kind] || src.subtitle_kind).toLowerCase() + ' (' + langName(src.subtitle_lang) + ')');
    var rights = 'Droits : ' + (RIGHTS[src.rights_basis] || src.rights_basis || '—') + (src.rights_note ? ' (' + src.rights_note + ')' : '');
    var prio = 'Priorité : ' + (src.priority == null ? 'celle du lecteur' : src.priority);
    var id = esc(src.id);
    var ctx = name + ' ' + (src.label || '') + ', ' + episodeName(e) + ', ' + seasonName(e.season);
    var test = 'lecteur.html?id=' + Number(t.anime.anilist_id) + '&season=' + Number(e.season) + '&episode=' + Number(e.number) +
      '&lang=' + encodeURIComponent(src.label || '') + '&player=' + encodeURIComponent(src.provider || '') + '&apercu=1';
    var off = src.status === 'disabled';
    return '<li class="adm-src">' +
      '<div class="adm-src-head"><span class="adm-pill adm-pill--' + st[1] + '">' + esc(st[0]) + '</span><strong>' + esc(name) + '</strong>' + flags.join(' ') + '</div>' +
      '<p class="adm-src-meta">' + esc(lang) + ' · ' + esc(rights) + ' · ' + esc(prio) + '</p>' +
      '<p class="adm-src-url adm-code" title="' + esc(src.url || '') + '">' + esc(src.url || src.provider_video_id || 'aucune adresse') + '</p>' +
      (src.last_error ? '<p class="adm-error">Dernière erreur' + (src.last_checked_at ? ' (' + esc(date(src.last_checked_at, true)) + ')' : '') + ' : ' + esc(src.last_error) + '</p>' : '') +
      '<div class="adm-actions adm-actions--tight" role="group" aria-label="' + esc('Actions sur la source ' + ctx) + '">' +
      '<a class="adm-btn adm-btn--sm" href="' + esc(test) + '" target="_blank" rel="noopener">Tester<span class="adm-sr"> (nouvel onglet)</span></a>' +
      '<button class="adm-btn adm-btn--sm" type="button" data-src-edit="' + id + '" data-k="src-edit-' + id + '">Modifier</button>' +
      '<button class="adm-btn adm-btn--sm" type="button" data-src-pub="' + id + '" data-k="src-pub-' + id + '">' + (src.publish_requested ? 'Dépublier' : 'Publier') + '</button>' +
      '<button class="adm-btn adm-btn--sm" type="button" data-src-toggle="' + id + '" data-k="src-toggle-' + id + '">' + (off ? 'Réactiver' : 'Désactiver') + '</button>' +
      (src.reports ? '<button class="adm-btn adm-btn--sm" type="button" data-src-clear="' + id + '" data-k="src-clear-' + id + '">Effacer les signalements</button>' : '') +
      '<button class="adm-btn adm-btn--sm adm-btn--danger-ghost" type="button" data-src-del="' + id + '" data-k="src-del-' + id + '">Supprimer</button>' +
      '</div></li>';
  }

  function findSeason(n) { return epx.tree.seasons.filter(function (s) { return Number(s.number) === Number(n); })[0] || null; }
  function findEpisode(id) {
    var found = null;
    epx.tree.seasons.forEach(function (s) { s.episodes.forEach(function (e) { if (e.id === id) found = e; }); });
    return found;
  }
  function findSource(id) {
    var found = null;
    epx.tree.seasons.forEach(function (s) {
      s.episodes.forEach(function (e) { e.sources.forEach(function (src) { if (src.id === id) found = { episode: e, source: src }; }); });
    });
    return found;
  }
  function changed(msg) {
    toast(msg, 'success');
    epx.listStale = true;
    reloadTree();
  }

  /* Fenêtre de saisie (épisode, plage, saison, source) */
  var dlgKey = null;
  var dlgActive = false;
  // Fermeture idempotente : appelée par les boutons et par l'événement close (touche Échap)
  function closeDialog() {
    var dlg = $('[data-ep-dialog]');
    if (dlg.open) dlg.close();
    if (!dlgActive) return;
    dlgActive = false;
    $('[data-ep-dialog-body]').innerHTML = '';
    var key = dlgKey;
    dlgKey = null;
    var el = key ? $('[data-ep-tree] [data-k="' + key + '"]') : null;
    if (el) el.focus(); else if (epx.current) $('[data-ep-tree]').focus();
    if (!key) return;
    epx.focusKey = key;
    setTimeout(function () { if (epx.focusKey === key) epx.focusKey = null; }, 4000);
  }
  function openDialog(html, onSubmit, onReady) {
    var dlg = $('[data-ep-dialog]');
    var body = $('[data-ep-dialog-body]');
    var opener = document.activeElement;
    dlgKey = opener && opener.getAttribute ? opener.getAttribute('data-k') : null;
    body.innerHTML = html;
    var form = body.querySelector('form');
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var err = form.querySelector('[data-dlg-error]');
      err.textContent = '';
      var close = await onSubmit(form, err);
      if (close) closeDialog();
    });
    $$('[data-dlg-close]', form).forEach(function (b) { b.addEventListener('click', closeDialog); });
    if (onReady) onReady(form);
    dlgActive = true;
    if (!dlg.open) dlg.showModal();
    var first = form.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea');
    if (first) first.focus();
  }
  function dialogFoot(label) {
    return '<p class="adm-error" data-dlg-error role="alert"></p>' +
      '<div class="adm-actions"><button class="adm-btn" type="button" data-dlg-close>Fermer</button>' +
      '<button class="adm-btn adm-btn--primary" type="submit" data-dlg-submit>' + esc(label) + '</button></div>';
  }

  function episodeDialog(seasonNumber, ep) {
    var t = epx.tree;
    var a = t.anime;
    var s = findSeason(ep ? ep.season : seasonNumber);
    var nums = s ? s.episodes.map(function (x) { return Number(x.number); }) : [];
    var e = ep || { season: seasonNumber, number: nums.length ? Math.max.apply(null, nums) + 1 : 1, kind: Number(seasonNumber) === 0 ? 'special' : 'episode', title: '', duration_sec: null, published: true, premium_until: null };
    var title = ep ? 'Modifier « ' + episodeName(ep) + ' » · ' + seasonName(ep.season) : 'Ajouter un épisode · ' + seasonName(seasonNumber);
    var html = '<form class="adm-form" novalidate><h2 id="ep-dialog-title">' + esc(title) + '</h2>' +
      '<div class="adm-row">' +
      '<label class="adm-field"><span>Saison</span><select class="adm-input" name="season">' + t.seasons.map(function (x) {
        return '<option value="' + Number(x.number) + '"' + (Number(x.number) === Number(e.season) ? ' selected' : '') + '>' + esc(seasonName(x.number)) + '</option>';
      }).join('') + '</select></label>' +
      '<label class="adm-field adm-field--xs"><span>Numéro</span><input class="adm-input" name="number" type="number" min="0" max="5000" required value="' + Number(e.number) + '"></label>' +
      '<label class="adm-field"><span>Type</span><select class="adm-input" name="kind">' + choiceOptions(Object.keys(EP_KIND).map(function (k) { return [k, EP_KIND[k]]; }), e.kind) + '</select></label>' +
      '</div>' +
      '<label class="adm-field"><span>Titre (facultatif)</span><input class="adm-input" name="title" type="text" maxlength="200" value="' + esc(e.title || '') + '"></label>' +
      '<div class="adm-row">' +
      '<label class="adm-field adm-field--xs"><span>Durée (minutes)</span><input class="adm-input" name="duration" type="number" min="1" max="1440" value="' + (e.duration_sec ? Math.round(e.duration_sec / 60) : '') + '"></label>' +
      '<label class="adm-field"><span>Accès anticipé Premium jusqu\'au</span><input class="adm-input" name="premium_until" type="datetime-local" value="' + esc(toLocalInput(e.premium_until)) + '" aria-describedby="ep-premium-help"></label>' +
      '</div>' +
      '<p class="adm-muted" id="ep-premium-help">Jusqu\'à cette date, seuls les membres Premium peuvent regarder l\'épisode. Laisse vide pour l\'ouvrir à tout le monde.</p>' +
      '<label class="adm-check"><input type="checkbox" name="published"' + (e.published !== false ? ' checked' : '') + '> Épisode publié (visible dès qu\'une source est prête)</label>' +
      dialogFoot(ep ? 'Enregistrer' : 'Ajouter l\'épisode') + '</form>';
    openDialog(html, async function (f, err) {
      var number = Number(f.elements.number.value);
      var minutes = f.elements.duration.value === '' ? null : Number(f.elements.duration.value);
      var until = f.elements.premium_until.value;
      if (f.elements.number.value === '' || !Number.isInteger(number) || number < 0 || number > 5000) { err.textContent = 'Numéro d\'épisode invalide (0 à 5 000).'; return false; }
      if (minutes !== null && (!(minutes > 0) || minutes > 1440)) { err.textContent = 'Durée invalide (1 à 1 440 minutes).'; return false; }
      if (until && isNaN(new Date(until).getTime())) { err.textContent = 'Date d\'accès anticipé invalide.'; return false; }
      var res = await busyHTML(f.querySelector('[data-dlg-submit]'), function () {
        return adminUpsertEpisode({
          id: ep ? ep.id : null, anilist_id: a.anilist_id, season: Number(f.elements.season.value), number: number,
          kind: f.elements.kind.value, title: f.elements.title.value.trim().slice(0, 200),
          duration_sec: minutes ? Math.round(minutes * 60) : null, published: f.elements.published.checked,
          premium_until: until ? new Date(until).toISOString() : null
        });
      });
      if (!res.ok) { err.textContent = res.error; return false; }
      changed(ep ? 'Épisode modifié.' : 'Épisode ' + number + ' ajouté.');
      return true;
    });
  }

  function rangeDialog(seasonNumber) {
    var a = epx.tree.anime;
    var s = findSeason(seasonNumber);
    var nums = s ? s.episodes.map(function (x) { return Number(x.number); }) : [];
    var from = nums.length ? Math.max.apply(null, nums) + 1 : 1;
    var html = '<form class="adm-form" novalidate><h2 id="ep-dialog-title">Ajouter une plage d\'épisodes · ' + esc(seasonName(seasonNumber)) + '</h2>' +
      '<p class="adm-muted">Crée d\'un coup les épisodes manquants (500 au maximum). Les numéros déjà présents sont ignorés ; sans source, les épisodes restent invisibles du public.</p>' +
      '<div class="adm-row">' +
      '<label class="adm-field adm-field--xs"><span>Du n°</span><input class="adm-input" name="from" type="number" min="0" max="5000" required value="' + from + '"></label>' +
      '<label class="adm-field adm-field--xs"><span>Au n°</span><input class="adm-input" name="to" type="number" min="0" max="5000" required value="' + (from + 11) + '"></label>' +
      '</div>' + dialogFoot('Créer les épisodes') + '</form>';
    openDialog(html, async function (f, err) {
      var x = Number(f.elements.from.value);
      var y = Number(f.elements.to.value);
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y > 5000 || y < x) { err.textContent = 'Plage invalide : le second numéro doit être supérieur ou égal au premier.'; return false; }
      if (y - x >= 500) { err.textContent = 'Plage trop grande : 500 épisodes au maximum à la fois.'; return false; }
      var res = await busyHTML(f.querySelector('[data-dlg-submit]'), function () { return adminAddEpisodeRange(a.anilist_id, seasonNumber, x, y); });
      if (!res.ok) { err.textContent = res.error; return false; }
      changed(res.created ? plural(res.created, 'épisode créé', 'épisodes créés') + '.' : 'Aucun épisode créé : ils existaient déjà.');
      return true;
    });
  }

  function seasonDialog(s) {
    var t = epx.tree;
    var a = t.anime;
    var isNew = !s;
    var cur = s || { number: nextSeasonNumber(t), title: '', media_anilist_id: null, episode_offset: 0 };
    var html = '<form class="adm-form" novalidate><h2 id="ep-dialog-title">' + (isNew ? 'Ajouter une saison' : 'Modifier « ' + esc(seasonName(cur.number)) + ' »') + '</h2>' +
      '<div class="adm-row">' +
      '<label class="adm-field adm-field--xs"><span>Numéro (0 = spéciaux)</span><input class="adm-input" name="number" type="number" min="0" max="99" required value="' + Number(cur.number) + '"' + (isNew ? '' : ' disabled') + '></label>' +
      '<label class="adm-field adm-grow"><span>Titre (facultatif)</span><input class="adm-input" name="title" type="text" maxlength="200" value="' + esc(cur.title || '') + '"></label>' +
      '</div><div class="adm-row">' +
      '<label class="adm-field"><span>Fiche AniList de la saison (n°, facultatif)</span><input class="adm-input" name="media" type="number" min="1" max="10000000" value="' + (cur.media_anilist_id ? Number(cur.media_anilist_id) : '') + '"></label>' +
      '<label class="adm-field adm-field--xs"><span>Décalage</span><input class="adm-input" name="offset" type="number" min="0" max="5000" value="' + Number(cur.episode_offset || 0) + '" aria-describedby="ep-offset-help"></label>' +
      '</div>' +
      '<p class="adm-muted" id="ep-offset-help">Décalage : nombre ajouté aux numéros AniList de cette fiche. Exemple : 12 si cette saison continue la numérotation de la précédente (épisodes 13, 14…). Sinon, laisse 0.</p>' +
      (isNew ? '' : '<p class="adm-muted">Le numéro d\'une saison ne se modifie pas : crée une nouvelle saison si besoin.</p>') +
      dialogFoot(isNew ? 'Ajouter la saison' : 'Enregistrer') + '</form>';
    openDialog(html, async function (f, err) {
      var number = Number(f.elements.number.value);
      var media = f.elements.media.value === '' ? null : Number(f.elements.media.value);
      var offset = Number(f.elements.offset.value || 0);
      if (!Number.isInteger(number) || number < 0 || number > 99) { err.textContent = 'Numéro de saison invalide (0 à 99).'; return false; }
      if (isNew && findSeason(number)) { err.textContent = 'Cette saison existe déjà : modifie-la depuis sa carte.'; return false; }
      if (media !== null && (!Number.isInteger(media) || media < 1 || media > 10000000)) { err.textContent = 'Numéro de fiche AniList invalide.'; return false; }
      if (!Number.isInteger(offset) || offset < 0 || offset > 5000) { err.textContent = 'Décalage invalide (0 à 5 000).'; return false; }
      var btn = f.querySelector('[data-dlg-submit]');
      var res = await busyHTML(btn, function () {
        return adminUpsertSeason({ anilist_id: a.anilist_id, number: number, media_anilist_id: media, title: f.elements.title.value.trim(), episode_offset: offset });
      });
      if (!res.ok) { err.textContent = res.error; return false; }
      var msg = isNew ? seasonName(number) + ' ajoutée.' : seasonName(number) + ' enregistrée.';
      if (media && media !== Number(cur.media_anilist_id || 0) && media !== Number(a.anilist_id)) {
        var sync = await busyHTML(btn, function () { return syncMedias([media]); });
        if (!sync.ok) {
          adminRequestSync(media);
          toast(msg + ' La synchro de la fiche n°' + media + ' a échoué : ' + sync.error, 'error');
          epx.listStale = true;
          reloadTree();
          return true;
        }
        if (sync.created) msg += ' ' + plural(sync.created, 'épisode créé', 'épisodes créés') + '.';
      }
      changed(msg);
      return true;
    });
  }

  async function linkSuggestedSeason(btn) {
    var a = epx.tree.anime;
    var media = Number(btn.getAttribute('data-season-suggest'));
    var input = $('[data-suggest-number="' + media + '"]');
    var number = Number(input ? input.value : nextSeasonNumber(epx.tree));
    if (!Number.isInteger(number) || number < 0 || number > 99) { toast('Numéro de saison invalide (0 à 99).', 'error'); return; }
    if (findSeason(number)) { toast(seasonName(number) + ' existe déjà : choisis un autre numéro.', 'error'); return; }
    var steps = await busyHTML(btn, async function () {
      var r = await adminUpsertSeason({ anilist_id: a.anilist_id, number: number, media_anilist_id: media, title: '', episode_offset: 0 });
      if (!r.ok) return { linked: false, error: r.error };
      var s = await syncMedias([media]);
      return { linked: true, sync: s };
    });
    if (!steps.linked) { toast(steps.error, 'error'); return; }
    epx.focusKey = 'season-new';
    if (!steps.sync.ok) {
      adminRequestSync(media);
      toast(seasonName(number) + ' liée, mais sa synchro a échoué : ' + steps.sync.error, 'error');
      epx.listStale = true;
      reloadTree();
      return;
    }
    changed(seasonName(number) + ' liée et synchronisée' + (steps.sync.created ? ' : ' + plural(steps.sync.created, 'épisode créé', 'épisodes créés') : '') + '.');
  }

  async function forceSync(btn) {
    var t = epx.tree;
    var ids = [Number(t.anime.anilist_id)];
    t.seasons.forEach(function (s) { if (s.media_anilist_id && ids.indexOf(Number(s.media_anilist_id)) === -1) ids.push(Number(s.media_anilist_id)); });
    var res = await busyHTML(btn, function () { return syncMedias(ids); });
    if (!res.ok) {
      ids.forEach(function (id) { adminRequestSync(id); });
      toast('Synchro incomplète : ' + res.error, 'error');
      reloadTree();
      return;
    }
    changed('Fiche synchronisée' + (res.created ? ' : ' + plural(res.created, 'épisode créé', 'épisodes créés') : '') + '.');
  }

  /* Formulaire d'une source */
  function sourceDialog(ep, src) {
    var a = epx.tree.anime;
    var provs = epx.providers || [];
    var orig = a.original_lang || null;
    var firstActive = provs.filter(function (p) { return p.active; })[0] || provs[0] || {};
    // Nouvelle source : aucune langue présélectionnée, l'admin choisit (une VF ne doit jamais partir en VOSTFR par défaut)
    var cur = src ? Object.assign({}, src) : {
      provider: firstActive.key, provider_video_id: '', url: '', rights_basis: '', rights_note: '', priority: null, published: true, status: 'ready',
      audio_kind: '', audio_lang: '', subtitle_kind: '', subtitle_lang: ''
    };
    if (src) cur.published = !!src.publish_requested;
    var unknownAudio = cur.audio_lang === 'und' || cur.audio_lang === 'mul';
    var html = '<form class="adm-form" novalidate data-src-form>' +
      '<h2 id="ep-dialog-title">' + (src ? 'Modifier la source' : 'Ajouter une source') + '</h2>' +
      '<p class="adm-muted">' + esc((a.title_display || 'Anime #' + a.anilist_id) + ' · ' + seasonName(ep.season) + ' · ' + episodeName(ep)) + '</p>' +
      '<label class="adm-field"><span>Lien (page de la vidéo, lien d\'intégration ou code &lt;iframe&gt;)</span>' +
      '<textarea class="adm-input adm-textarea adm-textarea--sm" name="link" rows="2" maxlength="3000" spellcheck="false" placeholder="https://voe.sx/e/… ou &lt;iframe src=&quot;…&quot;&gt;&lt;/iframe&gt;" aria-describedby="src-detect">' + esc(cur.url || '') + '</textarea></label>' +
      '<p class="adm-muted adm-detect" id="src-detect" data-src-detect role="status" aria-live="polite"></p>' +
      '<div class="adm-row">' +
      '<label class="adm-field"><span>Lecteur</span><select class="adm-input" name="provider">' + providerOptions(cur.provider) + '</select></label>' +
      '<label class="adm-field adm-grow" data-vid-field><span>Identifiant du fichier</span><input class="adm-input adm-code" name="video_id" type="text" maxlength="64" spellcheck="false" autocomplete="off" value="' + esc(cur.provider_video_id || '') + '"></label>' +
      '</div>' +
      '<fieldset class="adm-fieldset"><legend>Langue</legend>' +
      '<p class="adm-muted">Choisis un préréglage ou règle chaque champ. Le libellé affiché aux visiteurs (VOSTFR, VF…) est calculé par le serveur.</p>' +
      presetGroupHTML(null) +
      (orig ? '' : '<p class="adm-error">Langue d\'origine de l\'anime inconnue : précise-la d\'abord en haut de la fiche, sinon la source ne pourra pas être publiée.</p>') +
      '<div class="adm-row">' +
      '<label class="adm-field"><span>Audio</span><select class="adm-input" name="audio_kind">' + choiceOptions([['', 'Choisir…'], ['original', 'Audio original (VO)'], ['dub', 'Doublage']], cur.audio_kind) + '</select></label>' +
      '<label class="adm-field"><span>Langue audio</span><select class="adm-input" name="audio_lang"><option value="">Choisir…</option>' + langOptions(cur.audio_lang, unknownAudio) + '</select></label>' +
      '<label class="adm-field"><span>Sous-titres</span><select class="adm-input" name="subtitle_kind">' + choiceOptions([['', 'Choisir…'], ['none', 'Aucun'], ['hard', 'Incrustés dans la vidéo'], ['soft', 'À activer dans le lecteur']], cur.subtitle_kind) + '</select></label>' +
      '<label class="adm-field"><span>Langue des sous-titres</span><select class="adm-input" name="subtitle_lang"><option value="">Aucune</option>' + langOptions(cur.subtitle_lang) + '</select></label>' +
      '</div></fieldset>' +
      '<fieldset class="adm-fieldset"><legend>Droits de diffusion</legend><div class="adm-row">' +
      '<label class="adm-field"><span>Base des droits (obligatoire)</span><select class="adm-input" name="rights_basis" required><option value="">Choisir…</option>' +
      choiceOptions(Object.keys(RIGHTS).map(function (k) { return [k, RIGHTS[k]]; }), cur.rights_basis) + '</select></label>' +
      '<label class="adm-field adm-grow"><span>Note (facultative : licence, auteur…)</span><input class="adm-input" name="rights_note" type="text" maxlength="500" value="' + esc(cur.rights_note || '') + '"></label>' +
      '</div></fieldset>' +
      '<div class="adm-row">' +
      '<label class="adm-field adm-field--xs"><span>Priorité</span><input class="adm-input" name="priority" type="number" min="-1000" max="1000" placeholder="du lecteur" value="' + (cur.priority == null ? '' : Number(cur.priority)) + '"></label>' +
      '<label class="adm-field"><span>Statut</span><select class="adm-input" name="status">' + choiceOptions(STATUS_CHOICES, cur.status === 'uploading' || cur.status === 'processing' ? 'pending' : cur.status) + '</select></label>' +
      '<label class="adm-check adm-check--inline"><input type="checkbox" name="published"' + (cur.published !== false ? ' checked' : '') + '> Publier</label>' +
      '</div>' +
      '<div class="adm-result" data-src-result role="status" hidden></div>' +
      dialogFoot(src ? 'Enregistrer' : 'Ajouter la source') + '</form>';
    var editingId = src ? src.id : null;

    openDialog(html, async function (f, err) {
      var p = provs.filter(function (x) { return x.key === f.elements.provider.value; })[0];
      if (!p) { err.textContent = 'Choisis un lecteur.'; return false; }
      var link = f.elements.link.value.trim();
      var vid = f.elements.video_id.value.trim();
      var payload = {
        id: editingId, episode_id: ep.id, provider: p.key,
        audio_kind: f.elements.audio_kind.value, audio_lang: f.elements.audio_lang.value,
        subtitle_kind: f.elements.subtitle_kind.value, subtitle_lang: f.elements.subtitle_kind.value === 'none' ? null : f.elements.subtitle_lang.value,
        rights_basis: f.elements.rights_basis.value, rights_note: f.elements.rights_note.value.trim().slice(0, 500),
        priority: f.elements.priority.value.trim(), published: f.elements.published.checked, status: f.elements.status.value
      };
      if (p.embed_template) {
        if (!vid && link) { var got = LumaProviders.parse(link, [p]); if (got && got.id) vid = got.id; }
        if (vid) {
          if (!/^[A-Za-z0-9_-]{1,64}$/.test(vid)) { err.textContent = 'Identifiant de fichier invalide : lettres, chiffres, « - » et « _ » uniquement.'; return false; }
          payload.provider_video_id = vid;
        }
      }
      if (!payload.provider_video_id) {
        if (!link) { err.textContent = 'Colle le lien de la vidéo chez le lecteur.'; return false; }
        var parsed = LumaProviders.parse(link, [p]);
        var href = parsed && parsed.url ? parsed.url : (LumaProviders.toUrl(link) || {}).href;
        if (!href || !/^https:\/\/[^\s"<>]+$/.test(href)) { err.textContent = 'Lien invalide : il doit commencer par https:// (ou être un code <iframe> contenant une telle adresse).'; return false; }
        payload.url = href;
      }
      if (!payload.audio_kind) { err.textContent = 'Choisis la langue de la vidéo : un préréglage (VOSTFR, VF…) ou « Audio original / Doublage ».'; return false; }
      if (!payload.audio_lang) { err.textContent = orig ? 'Choisis la langue audio.' : "Langue d'origine de l'anime inconnue : précise-la d'abord en haut de la fiche."; return false; }
      if (!payload.subtitle_kind) { err.textContent = 'Indique les sous-titres (ou « Aucun »).'; return false; }
      if (payload.subtitle_kind !== 'none' && !payload.subtitle_lang) { err.textContent = 'Choisis la langue des sous-titres, ou « Aucun » sous-titre.'; return false; }
      if (!payload.rights_basis) { err.textContent = 'Indique la base des droits de cette vidéo.'; f.elements.rights_basis.focus(); return false; }
      if (payload.priority !== '' && (!Number.isInteger(Number(payload.priority)) || Math.abs(Number(payload.priority)) > 1000)) { err.textContent = 'Priorité invalide (-1 000 à 1 000).'; return false; }
      var res = await busyHTML(f.querySelector('[data-dlg-submit]'), function () { return adminUpsertSource(payload); });
      var out = f.querySelector('[data-src-result]');
      if (!res.ok) { out.hidden = true; err.textContent = res.error; return false; }
      var created = !editingId;
      editingId = res.id || editingId;
      f.querySelector('#ep-dialog-title').textContent = 'Modifier la source';
      f.querySelector('[data-dlg-submit]').textContent = 'Enregistrer';
      out.hidden = false;
      out.className = 'adm-result' + (res.needs_review ? ' adm-result--warn' : ' adm-result--ok');
      out.innerHTML = '<strong>Source ' + (created ? 'ajoutée' : 'enregistrée') + '.</strong> Libellé calculé par le serveur : <b>' + esc(res.label || 'AUTRE') + '</b>. ' +
        (res.published ? 'Publiée.' : 'Non publiée.') +
        (res.needs_review ? '<br>À vérifier : ' + esc(reviewText(res.review_reason)) + '. Elle ne sera pas publiée tant que ce n\'est pas corrigé.' : '');
      epx.listStale = true;
      reloadTree();
      return false;
    }, function (f) {
      var detect = f.querySelector('[data-src-detect]');
      function provider() { return provs.filter(function (x) { return x.key === f.elements.provider.value; })[0] || null; }
      function syncFields() {
        var p = provider();
        f.querySelector('[data-vid-field]').hidden = !(p && p.embed_template);
        var none = f.elements.subtitle_kind.value === 'none';
        f.elements.subtitle_lang.disabled = none;
        if (none) f.elements.subtitle_lang.value = '';
        var match = LANGUAGE_PRESETS.filter(function (x) {
          var lp = languagePreset(x.code, orig);
          return lp.audio_kind === f.elements.audio_kind.value && (lp.audio_lang || '') === f.elements.audio_lang.value &&
            lp.subtitle_kind === f.elements.subtitle_kind.value && (lp.subtitle_lang || '') === f.elements.subtitle_lang.value;
        })[0];
        markPreset(f, match ? match.code : null);
      }
      function onLink() {
        var text = f.elements.link.value.trim();
        if (!text) { detect.textContent = ''; return; }
        var got = LumaProviders.parse(text, provs);
        if (!got) { detect.textContent = 'Lien non reconnu : vérifie qu\'il commence par https:// puis choisis le lecteur à la main.'; return; }
        f.elements.provider.value = got.provider;
        var p = provider();
        f.elements.video_id.value = got.id || '';
        detect.textContent = 'Lecteur reconnu : ' + (p ? p.name : got.provider) + (got.id ? ' · identifiant ' + got.id : ' · le lien d\'intégration sera conservé') +
          (p && !p.active ? ' (ce lecteur est désactivé)' : '') + '.';
        syncFields();
      }
      f.elements.link.addEventListener('input', onLink);
      f.addEventListener('change', function (e) { if (e.target.name !== 'link') syncFields(); });
      f.querySelector('.adm-presets').addEventListener('click', function (e) {
        var b = e.target.closest('[data-preset]');
        if (!b) return;
        var lp = languagePreset(b.getAttribute('data-preset'), orig);
        f.elements.audio_kind.value = lp.audio_kind;
        f.elements.audio_lang.value = lp.audio_lang || '';
        f.elements.subtitle_kind.value = lp.subtitle_kind;
        f.elements.subtitle_lang.disabled = lp.subtitle_kind === 'none';
        f.elements.subtitle_lang.value = lp.subtitle_lang || '';
        syncFields();
      });
      syncFields();
      if (f.elements.link.value.trim()) onLink();
    });
  }

  /* Actions de la fiche (délégation) */
  async function onTreeClick(e) {
    var b = e.target.closest('button');
    var box = $('[data-ep-tree]');
    if (!b || !box.contains(b) || !epx.tree) return;
    var a = epx.tree.anime;
    var v;
    if (b.hasAttribute('data-tree-sync')) return forceSync(b);
    if (b.hasAttribute('data-season-new')) return seasonDialog(null);
    if (b.hasAttribute('data-season-suggest')) return linkSuggestedSeason(b);
    if ((v = b.getAttribute('data-season-edit')) !== null) return seasonDialog(findSeason(v));
    if ((v = b.getAttribute('data-season-del')) !== null) {
      if (!(await confirmBox('Supprimer « ' + seasonName(v) + ' » ?', 'Elle ne contient aucun épisode. La fiche AniList liée n\'est pas supprimée.', 'Supprimer', true))) return;
      var rs = await busyHTML(b, function () { return adminDeleteSeason(a.anilist_id, Number(v)); });
      if (!rs.ok) { toast(rs.error || 'Suppression impossible.', 'error'); return; }
      epx.focusKey = 'season-new';
      changed(seasonName(v) + ' supprimée.');
      return;
    }
    if ((v = b.getAttribute('data-ep-new')) !== null) return episodeDialog(Number(v), null);
    if ((v = b.getAttribute('data-ep-range')) !== null) return rangeDialog(Number(v));
    if ((v = b.getAttribute('data-ep-edit')) !== null) { var ee = findEpisode(v); if (ee) episodeDialog(ee.season, ee); return; }
    if ((v = b.getAttribute('data-ep-del')) !== null) {
      var ed = findEpisode(v);
      if (!ed) return;
      var n = ed.sources.length;
      if (!(await confirmBox('Supprimer « ' + episodeName(ed) + ' » (' + seasonName(ed.season) + ') ?',
        (n ? plural(n, 'source sera supprimée', 'sources seront supprimées') + ' avec lui. ' : '') + 'Les vidéos restent chez leurs lecteurs.', 'Supprimer', true))) return;
      var rd = await busyHTML(b, function () { return adminDeleteEpisode(ed.id); });
      if (!rd.ok) { toast(rd.error, 'error'); return; }
      epx.focusKey = 'ep-new-' + Number(ed.season);
      changed('« ' + episodeName(ed) + ' » supprimé.');
      return;
    }
    if ((v = b.getAttribute('data-src-new')) !== null) { var en = findEpisode(v); if (en) sourceDialog(en, null); return; }
    var hit;
    if ((v = b.getAttribute('data-src-edit')) !== null) { hit = findSource(v); if (hit) sourceDialog(hit.episode, hit.source); return; }
    if ((v = b.getAttribute('data-src-pub')) !== null) {
      hit = findSource(v);
      if (!hit) return;
      var pub = !hit.source.publish_requested;
      return sourceAction(b, hit.source, null, pub, false, pub
        ? (hit.source.needs_review ? 'Publication demandée : elle se fera dès que la langue sera vérifiée.' : 'Source publiée.')
        : 'Source dépubliée.');
    }
    if ((v = b.getAttribute('data-src-toggle')) !== null) {
      hit = findSource(v);
      if (!hit) return;
      var off = hit.source.status === 'disabled';
      return sourceAction(b, hit.source, off ? 'ready' : 'disabled', null, false, off ? 'Source réactivée.' : 'Source désactivée.');
    }
    if ((v = b.getAttribute('data-src-clear')) !== null) {
      hit = findSource(v);
      if (hit) sourceAction(b, hit.source, null, null, true, 'Signalements effacés.');
      return;
    }
    if ((v = b.getAttribute('data-src-del')) !== null) {
      hit = findSource(v);
      if (!hit) return;
      var s = hit.source;
      if (!(await confirmBox('Supprimer cette source ?', (s.provider_name || s.provider) + ' · ' + (s.label || '') + ' · ' + episodeName(hit.episode) + '. La vidéo reste chez le lecteur.', 'Supprimer', true))) return;
      var rx = await busyHTML(b, function () { return adminDeleteSource(s.id); });
      if (!rx.ok) { toast(rx.error, 'error'); return; }
      epx.focusKey = 'src-new-' + hit.episode.id;
      changed('Source supprimée.');
      return;
    }
    if ((v = b.getAttribute('data-preset')) !== null) {
      var form = b.closest('[data-bulk-form]');
      if (!form) return;
      form.elements.preset.value = v;
      markPreset(form, v);
    }
  }

  async function sourceAction(btn, src, status, published, clear, okMsg) {
    var res = await busyHTML(btn, function () { return adminSetSourceStatus(src.id, status, published, clear); });
    if (!res.ok) { toast(res.error, 'error'); return; }
    if (clear) epx.focusKey = 'src-edit-' + src.id;
    changed(okMsg);
  }

  async function onTreeSubmit(e) {
    var f = e.target;
    if (!epx.tree) return;
    var a = epx.tree.anime;
    if (f.hasAttribute('data-tree-lang-form')) {
      e.preventDefault();
      var lang = f.elements.lang.value || null;
      var res = await busyHTML(f.querySelector('[type="submit"]'), function () { return adminSetAnimeLang(a.anilist_id, lang); });
      if (!res.ok) { toast(res.error, 'error'); return; }
      changed(lang ? 'Langue d\'origine enregistrée : ' + langName(lang) + '.' : 'Langue d\'origine repassée en automatique.');
      return;
    }
    if (f.hasAttribute('data-bulk-form')) {
      e.preventDefault();
      var err = f.querySelector('[data-bulk-error]');
      err.textContent = '';
      var code = f.elements.preset.value;
      if (!code) { err.textContent = 'Choisis la langue de ces sources (VOSTFR, VF…).'; return; }
      if (!a.original_lang) { err.textContent = "Langue d'origine de l'anime inconnue : précise-la d'abord ci-dessus."; return; }
      var lp = languagePreset(code, a.original_lang);
      var payload = Object.assign({
        anilist_id: a.anilist_id, season: f.elements.season.value, provider: f.elements.provider.value || null, publish: f.elements.publish.checked,
        include_admin: f.elements.include_admin.checked
      }, lp);
      var r = await busyHTML(f.querySelector('[type="submit"]'), function () { return adminBulkQualify(payload); });
      if (!r.ok) { err.textContent = r.error; return; }
      epx.focusKey = 'lang';
      changed(r.updated ? plural(r.updated, 'source mise à jour', 'sources mises à jour') + ' en ' + code + '.' : 'Aucune source à vérifier ne correspond à ces critères.');
      loadReviewAlert();
    }
  }

  /* Réglages : lecteurs */
  function providerFieldsHTML(p, isNew) {
    p = p || { key: '', name: '', kind: 'embed', priority: 0, active: true, hosts: [], embed_template: '', id_pattern: '', sandbox: true };
    var uid = isNew ? 'new' : esc(p.key);
    return '<div class="adm-row">' +
      (isNew ? '<label class="adm-field"><span>Clé (a-z, 0-9, _)</span><input class="adm-input adm-code" name="key" type="text" required maxlength="30" pattern="[a-z0-9_]{2,30}" placeholder="kani" autocomplete="off" spellcheck="false"></label>' : '') +
      '<label class="adm-field"><span>Nom</span><input class="adm-input" name="name" type="text" required maxlength="40" value="' + esc(p.name) + '" placeholder="Kani"></label>' +
      '<label class="adm-field"><span>Type</span><select class="adm-input" name="kind">' + choiceOptions([['embed', 'Intégration (iframe)'], ['direct', 'Fichier vidéo direct (MP4/WebM)']], p.kind) + '</select></label>' +
      '<label class="adm-field adm-field--xs"><span>Priorité</span><input class="adm-input" name="priority" type="number" min="-1000" max="1000" value="' + Number(p.priority || 0) + '"></label>' +
      '</div>' +
      '<label class="adm-field"><span>Domaines autorisés (séparés par des virgules)</span><input class="adm-input adm-code" name="hosts" type="text" maxlength="800" spellcheck="false" value="' + esc((p.hosts || []).join(', ')) + '" placeholder="voe.sx, kani.example"></label>' +
      '<div class="adm-row">' +
      '<label class="adm-field adm-grow"><span>Format d\'intégration (facultatif, avec {id})</span><input class="adm-input adm-code" name="embed_template" type="text" maxlength="300" spellcheck="false" value="' + esc(p.embed_template || '') + '" placeholder="https://voe.sx/e/{id}"></label>' +
      '<label class="adm-field adm-grow"><span>Format d\'identifiant (facultatif, expression régulière)</span><input class="adm-input adm-code" name="id_pattern" type="text" maxlength="200" spellcheck="false" value="' + esc(p.id_pattern || '') + '" placeholder="^[A-Za-z0-9]{8,16}$"></label>' +
      '</div>' +
      '<label class="adm-check"><input type="checkbox" name="active"' + (p.active !== false ? ' checked' : '') + '> Actif (proposé aux visiteurs)</label>' +
      '<label class="adm-check"><input type="checkbox" name="sandbox"' + (p.sandbox !== false ? ' checked' : '') + ' aria-describedby="sb-help-' + uid + '"> Bac à sable</label>' +
      '<p class="adm-muted" id="sb-help-' + uid + '">Le bac à sable protège les visiteurs contre les fenêtres surgissantes et les redirections du lecteur. Décoche-le seulement si le lecteur refuse de s\'afficher.</p>';
  }

  function readProviderForm(f, key) {
    return {
      key: key || f.elements.key.value.trim().toLowerCase(),
      name: f.elements.name.value.trim(),
      kind: f.elements.kind.value,
      priority: Number(f.elements.priority.value || 0),
      active: f.elements.active.checked,
      hosts: f.elements.hosts.value.split(',').map(function (h) { return h.trim().toLowerCase(); }).filter(Boolean),
      embed_template: f.elements.embed_template.value.trim() || null,
      id_pattern: f.elements.id_pattern.value.trim() || null,
      sandbox: f.elements.sandbox.checked
    };
  }

  function checkProvider(p) {
    if (!/^[a-z0-9_]{2,30}$/.test(p.key)) return 'Clé invalide : 2 à 30 caractères parmi a-z, 0-9 et _.';
    if (!p.name) return 'Indique le nom du lecteur.';
    if (!Number.isInteger(p.priority) || Math.abs(p.priority) > 1000) return 'Priorité invalide (-1 000 à 1 000).';
    if (p.kind === 'embed' && !p.hosts.length) return 'Indique au moins un domaine autorisé (ex. voe.sx).';
    if (p.embed_template && p.embed_template.indexOf('{id}') === -1) return 'Le format d\'intégration doit contenir {id}.';
    return '';
  }

  async function loadProvidersPane() {
    var box = $('[data-prov-list]');
    box.innerHTML = '<p class="adm-muted">Chargement…</p>';
    var res = await epProviders(true);
    if (!res.ok) { box.innerHTML = '<p class="adm-error">' + esc(res.error) + '</p>'; return; }
    box.innerHTML = res.items.length ? res.items.map(function (p) {
      return '<form class="adm-card adm-form adm-prov-card" data-prov-form="' + esc(p.key) + '" novalidate aria-labelledby="prov-' + esc(p.key) + '">' +
        '<div class="adm-head adm-head--card"><h2 id="prov-' + esc(p.key) + '">' + esc(p.name) + ' <span class="adm-code adm-muted">' + esc(p.key) + '</span></h2>' +
        (p.active ? '<span class="adm-tag adm-tag--green">Actif</span>' : '<span class="adm-tag">Inactif</span>') + '</div>' +
        providerFieldsHTML(p, false) +
        '<p class="adm-error" data-prov-error role="alert"></p>' +
        '<div class="adm-actions"><button class="adm-btn adm-btn--primary" type="submit">Enregistrer</button></div></form>';
    }).join('') : '<p class="adm-muted">Aucun lecteur pour le moment.</p>';
    $('[data-prov-new-fields]').innerHTML = providerFieldsHTML(null, true);
  }

  async function onProviderSubmit(e) {
    var f = e.target.closest('[data-prov-form]');
    if (!f) return;
    e.preventDefault();
    var err = f.querySelector('[data-prov-error]');
    err.textContent = '';
    var p = readProviderForm(f, f.getAttribute('data-prov-form'));
    var bad = checkProvider(p);
    if (bad) { err.textContent = bad; return; }
    var res = await busyHTML(f.querySelector('[type="submit"]'), function () { return adminSetProvider(p); });
    if (!res.ok) { err.textContent = res.error; return; }
    var tag = f.querySelector('.adm-head .adm-tag');
    if (tag) { tag.className = 'adm-tag' + (p.active ? ' adm-tag--green' : ''); tag.textContent = p.active ? 'Actif' : 'Inactif'; }
    epProviders(true);
    toast('Lecteur « ' + p.name + ' » enregistré.', 'success');
  }

  async function onProviderNew(e) {
    e.preventDefault();
    var f = e.target;
    var err = $('[data-prov-new-error]');
    err.textContent = '';
    var p = readProviderForm(f, null);
    var bad = checkProvider(p);
    if (bad) { err.textContent = bad; return; }
    if ((epx.providers || []).some(function (x) { return x.key === p.key; })) { err.textContent = 'Cette clé existe déjà : modifie le lecteur dans la liste.'; return; }
    var res = await busyHTML(f.querySelector('[type="submit"]'), function () { return adminSetProvider(p); });
    if (!res.ok) { err.textContent = res.error; return; }
    toast('Lecteur « ' + p.name + ' » ajouté.', 'success');
    await loadProvidersPane();
    var added = $('[data-prov-form="' + p.key + '"] [name="name"]');
    if (added) added.focus();
  }

  /* Réglages : langues et libellés */
  function ruleText(r) {
    var audio = r.audio_kind ? (r.audio_kind === 'original' ? 'Audio original' : 'Doublage') : 'Audio quelconque';
    audio += r.audio_lang ? ' en ' + langName(r.audio_lang) : '';
    var sub = r.subtitle === 'none' ? 'sans sous-titres' : r.subtitle === 'any' ? 'sous-titres peu importe' : 'sous-titres en ' + langName(r.subtitle_lang);
    return audio + ', ' + sub;
  }

  async function loadLanguagesPane(focusSel) {
    var box = $('[data-lang-config]');
    if (!epx.langs) box.innerHTML = '<p class="adm-muted">Chargement…</p>';
    var res = await epLangs(true);
    if (!res.ok) { box.innerHTML = '<p class="adm-error">' + esc(res.error) + '</p>'; return; }
    var labelOpts = res.labels.map(function (l) { return '<option value="' + esc(l.code) + '">' + esc(l.code) + '</option>'; }).join('');
    box.innerHTML =
      '<section class="adm-card" aria-labelledby="lang-labels-title"><h2 id="lang-labels-title">Libellés</h2>' +
      '<p class="adm-muted adm-intro">Ce que voient les visiteurs (VOSTFR, VF…). L\'ordre fixe leur position dans le lecteur ; un libellé inactif n\'est plus utilisé (les sources concernées passent en « Autre »).</p>' +
      '<div class="adm-table-wrap"><table class="adm-table adm-table--compact"><caption class="adm-sr">Libellés de langue</caption>' +
      '<thead><tr><th scope="col">Code</th><th scope="col">Nom affiché</th><th scope="col">Ordre</th><th scope="col">Actif</th><th scope="col"><span class="adm-sr">Action</span></th></tr></thead><tbody>' +
      res.labels.map(function (l) {
        var c = esc(l.code);
        return '<tr data-label-row="' + c + '"><th scope="row" class="adm-code">' + c + '</th>' +
          '<td><input class="adm-input adm-input--sm" name="name" type="text" maxlength="60" value="' + esc(l.name_fr) + '" aria-label="Nom affiché pour ' + c + '"></td>' +
          '<td><input class="adm-input adm-input--sm adm-input--num" name="sort" type="number" min="-1000" max="10000" value="' + Number(l.sort) + '" aria-label="Ordre de ' + c + '"></td>' +
          '<td><input type="checkbox" name="active"' + (l.active ? ' checked' : '') + ' aria-label="' + c + ' actif"' + (l.code === 'AUTRE' ? ' disabled' : '') + '></td>' +
          '<td class="adm-cell-actions"><button class="adm-btn adm-btn--sm" type="button" data-label-save="' + c + '">Enregistrer<span class="adm-sr"> ' + c + '</span></button></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<form class="adm-toolbar adm-toolbar--top" data-label-new novalidate>' +
      '<label class="adm-field adm-field--xs"><span>Nouveau code</span><input class="adm-input adm-code" name="code" type="text" maxlength="12" placeholder="VOSTAR" required></label>' +
      '<label class="adm-field"><span>Nom affiché</span><input class="adm-input" name="name" type="text" maxlength="60" required></label>' +
      '<label class="adm-field adm-field--xs"><span>Ordre</span><input class="adm-input" name="sort" type="number" min="-1000" max="10000" value="100"></label>' +
      '<button class="adm-btn" type="submit">Ajouter le libellé</button></form></section>' +

      '<section class="adm-card" aria-labelledby="lang-rules-title"><h2 id="lang-rules-title">Règles</h2>' +
      '<p class="adm-muted adm-intro">Chaque règle associe une combinaison audio + sous-titres à un libellé. La règle la plus précise l\'emporte ; sans règle correspondante, la source est affichée en « Autre ».</p>' +
      '<div class="adm-table-wrap"><table class="adm-table adm-table--compact"><caption class="adm-sr">Règles de calcul des libellés</caption>' +
      '<thead><tr><th scope="col">Libellé</th><th scope="col">Combinaison</th><th scope="col"><span class="adm-sr">Action</span></th></tr></thead><tbody>' +
      (res.rules.length ? res.rules.map(function (r) {
        return '<tr><td><span class="adm-tag adm-tag--blue">' + esc(r.label_code) + '</span></td><td>' + esc(ruleText(r)) + '</td>' +
          '<td class="adm-cell-actions"><button class="adm-btn adm-btn--sm adm-btn--danger-ghost" type="button" data-rule-del="' + Number(r.id) + '">Supprimer<span class="adm-sr"> la règle ' + esc(r.label_code) + ' : ' + esc(ruleText(r)) + '</span></button></td></tr>';
      }).join('') : '<tr><td class="adm-empty" colspan="3">Aucune règle : toutes les sources sont affichées en « Autre ».</td></tr>') +
      '</tbody></table></div>' +
      '<form class="adm-toolbar adm-toolbar--top" data-rule-new novalidate>' +
      '<label class="adm-field adm-field--xs"><span>Libellé</span><select class="adm-input" name="label">' + labelOpts + '</select></label>' +
      '<label class="adm-field"><span>Audio</span><select class="adm-input" name="audio_kind">' + choiceOptions([['', 'Peu importe'], ['original', 'Audio original'], ['dub', 'Doublage']], '') + '</select></label>' +
      '<label class="adm-field"><span>Langue audio</span><select class="adm-input" name="audio_lang"><option value="">Toute langue</option>' + langOptions(null) + '</select></label>' +
      '<label class="adm-field"><span>Sous-titres</span><select class="adm-input" name="subtitle">' + choiceOptions([['none', 'Sans sous-titres'], ['any', 'Peu importe'], ['lang', 'Dans une langue précise']], 'none') + '</select></label>' +
      '<label class="adm-field"><span>Langue des sous-titres</span><select class="adm-input" name="subtitle_lang" disabled><option value="">—</option>' + langOptions(null) + '</select></label>' +
      '<button class="adm-btn" type="submit">Ajouter la règle</button></form></section>' +

      '<section class="adm-card" aria-labelledby="lang-list-title"><h2 id="lang-list-title">Langues</h2>' +
      '<p class="adm-muted adm-intro">Langues utilisables pour l\'audio et les sous-titres. Pour renommer une langue, ajoute-la de nouveau avec le même code.</p>' +
      '<ul class="adm-lang-list">' + res.languages.map(function (l) {
        return '<li><span class="adm-code">' + esc(l.code) + '</span> ' + esc(l.name_fr) + ' <span class="adm-muted">· ordre ' + Number(l.sort) + '</span></li>';
      }).join('') + '</ul>' +
      '<form class="adm-toolbar adm-toolbar--top" data-language-new novalidate>' +
      '<label class="adm-field adm-field--xs"><span>Code (2 ou 3 lettres)</span><input class="adm-input adm-code" name="code" type="text" maxlength="3" placeholder="ar" required></label>' +
      '<label class="adm-field"><span>Nom en français</span><input class="adm-input" name="name" type="text" maxlength="60" placeholder="arabe" required></label>' +
      '<label class="adm-field adm-field--xs"><span>Ordre</span><input class="adm-input" name="sort" type="number" min="-1000" max="10000" value="100"></label>' +
      '<button class="adm-btn" type="submit">Ajouter la langue</button></form></section>';
    if (focusSel) { var el = box.querySelector(focusSel); if (el) el.focus(); }
  }

  async function onLangClick(e) {
    var b = e.target.closest('button');
    if (!b) return;
    var v;
    if ((v = b.getAttribute('data-label-save')) !== null) {
      var row = b.closest('tr');
      var name = row.querySelector('[name="name"]').value.trim();
      var sort = Number(row.querySelector('[name="sort"]').value || 100);
      if (!name) { toast('Indique le nom affiché du libellé.', 'error'); return; }
      var res = await busyHTML(b, function () { return adminSetLabel(v, name, sort, row.querySelector('[name="active"]').checked); });
      if (!res.ok) { toast(res.error, 'error'); return; }
      epLangs(true);
      toast('Libellé ' + v + ' enregistré.', 'success');
      return;
    }
    if ((v = b.getAttribute('data-rule-del')) !== null) {
      if (!(await confirmBox('Supprimer cette règle ?', 'Les sources concernées seront affichées avec la règle suivante la plus précise, ou en « Autre ».', 'Supprimer', true))) return;
      var r = await busyHTML(b, function () { return adminDeleteLabelRule(Number(v)); });
      if (!r.ok) { toast(r.error || 'Suppression impossible.', 'error'); return; }
      toast('Règle supprimée.', 'success');
      loadLanguagesPane('[data-rule-new] [name="label"]');
    }
  }

  async function onLangSubmit(e) {
    var f = e.target;
    var res;
    if (f.hasAttribute('data-label-new')) {
      e.preventDefault();
      var code = f.elements.code.value.trim().toUpperCase();
      var name = f.elements.name.value.trim();
      if (!/^[A-Z0-9]{2,12}$/.test(code) || !name) { toast('Libellé invalide : code de 2 à 12 lettres ou chiffres et nom obligatoires.', 'error'); return; }
      res = await busyHTML(f.querySelector('[type="submit"]'), function () { return adminSetLabel(code, name, Number(f.elements.sort.value || 100), true); });
      if (!res.ok) { toast(res.error, 'error'); return; }
      toast('Libellé ' + code + ' ajouté. Ajoute maintenant une règle pour l\'utiliser.', 'success');
      loadLanguagesPane('[data-rule-new] [name="label"]');
      return;
    }
    if (f.hasAttribute('data-rule-new')) {
      e.preventDefault();
      var rule = {
        label_code: f.elements.label.value, audio_kind: f.elements.audio_kind.value || null, audio_lang: f.elements.audio_lang.value || null,
        subtitle: f.elements.subtitle.value, subtitle_lang: f.elements.subtitle.value === 'lang' ? f.elements.subtitle_lang.value : null
      };
      if (rule.subtitle === 'lang' && !rule.subtitle_lang) { toast('Choisis la langue des sous-titres.', 'error'); return; }
      res = await busyHTML(f.querySelector('[type="submit"]'), function () { return adminAddLabelRule(rule); });
      if (!res.ok) { toast(res.error, 'error'); return; }
      toast('Règle ajoutée.', 'success');
      loadLanguagesPane('[data-rule-new] [name="label"]');
      return;
    }
    if (f.hasAttribute('data-language-new')) {
      e.preventDefault();
      var lc = f.elements.code.value.trim().toLowerCase();
      var ln = f.elements.name.value.trim();
      if (!/^[a-z]{2,3}$/.test(lc) || !ln) { toast('Langue invalide : code de 2 ou 3 lettres et nom obligatoires.', 'error'); return; }
      res = await busyHTML(f.querySelector('[type="submit"]'), function () { return adminAddLanguage(lc, ln, Number(f.elements.sort.value || 100)); });
      if (!res.ok) { toast(res.error, 'error'); return; }
      toast('Langue « ' + ln + ' » enregistrée.', 'success');
      loadLanguagesPane('[data-language-new] [name="code"]');
    }
  }

  function bindEpisodes() {
    $$('[data-ep-tab]').forEach(function (b) {
      b.addEventListener('click', function () { showEpTab(b.getAttribute('data-ep-tab')); });
    });

    var addForm = $('[data-ep-add]');
    addForm.addEventListener('submit', function (e) { e.preventDefault(); searchAddAnime(addForm); });
    $('[data-ep-add-results]').addEventListener('click', function (e) {
      var b = e.target.closest('[data-ep-add-pick]');
      if (!b) return;
      var m = epx.found[Number(b.getAttribute('data-ep-add-pick'))];
      if (m) addAnime(m, b);
    });

    $('[data-ep-search]').addEventListener('input', function (e) {
      clearTimeout(epx.timer);
      var value = e.target.value.trim();
      epx.timer = setTimeout(function () { epx.search = value; loadOverview(true); }, 300);
    });
    $('[data-ep-filters]').addEventListener('click', function (e) {
      var b = e.target.closest('[data-ep-filter]');
      if (b) setFilter(b.getAttribute('data-ep-filter'));
    });
    $('[data-ep-more]').addEventListener('click', function () { loadOverview(false); });
    $('[data-ep-animes]').addEventListener('click', function (e) {
      var b = e.target.closest('[data-ep-open]');
      if (b) openAnime(b.getAttribute('data-ep-open'));
    });
    $('[data-ep-review-alert]').addEventListener('click', function (e) {
      if (!e.target.closest('[data-ep-show-review]')) return;
      setFilter('review');
      $('[data-ep-filter="review"]').focus();
    });

    $('[data-sync-run]').addEventListener('click', function () { runSync(false); });
    $('[data-sync-cancel]').addEventListener('click', function () {
      if (!epx.sync) return;
      epx.sync.abort();
      this.disabled = true;
      $('[data-sync-state]').textContent = 'Annulation en cours…';
    });
    window.addEventListener('beforeunload', function (e) {
      if (!epx.sync) return;
      e.preventDefault();
      e.returnValue = '';
    });

    $('[data-ep-back]').addEventListener('click', closeAnime);
    var tree = $('[data-ep-tree]');
    tree.addEventListener('click', onTreeClick);
    tree.addEventListener('submit', onTreeSubmit);
    tree.addEventListener('input', function (e) {
      var v = e.target.getAttribute('data-suggest-number');
      if (v === null) return;
      var btn = tree.querySelector('[data-season-suggest="' + v + '"]');
      if (btn) btn.textContent = 'Ajouter comme saison ' + (e.target.value === '' ? '…' : Number(e.target.value));
    });

    $('[data-ep-dialog]').addEventListener('close', closeDialog);

    $('[data-prov-list]').addEventListener('submit', onProviderSubmit);
    $('[data-prov-new]').addEventListener('submit', onProviderNew);
    var langBox = $('[data-lang-config]');
    langBox.addEventListener('click', onLangClick);
    langBox.addEventListener('submit', onLangSubmit);
    langBox.addEventListener('change', function (e) {
      if (e.target.name !== 'subtitle') return;
      var f = e.target.form;
      f.elements.subtitle_lang.disabled = e.target.value !== 'lang';
      if (e.target.value !== 'lang') f.elements.subtitle_lang.value = '';
    });
  }

  /* ---- Démarrage ---- */
  async function start() {
    var guard = $('[data-guard]');
    var me = typeof getCurrentUser === 'function' ? await getCurrentUser() : null;
    if (!me) {
      guard.innerHTML = 'Connecte-toi avec un compte administrateur. <a href="connexion.html?next=admin.html">Se connecter</a>';
      return;
    }
    if (!isAdmin(me)) {
      guard.innerHTML = 'Accès refusé : cette page est réservée aux administrateurs. <a href="index.html">Retour au site</a>';
      return;
    }
    state.me = me;
    $('[data-me]').textContent = 'Connecté : ' + me.pseudo;
    guard.hidden = true;
    bindDrawer();
    bindKeys();
    bindEpisodes();
    bindWishes();
    bindUploads();
    bindSiteView();
    bindCoinsView();
    bindDecorationsAdmin();
    bindProgressAdmin();
    $('[data-users-search]').addEventListener('input', renderUsers);
    $('[data-users-filter]').addEventListener('change', renderUsers);
    $('[data-users]').addEventListener('click', function (e) {
      var b = e.target.closest('[data-open]');
      if (b) openDrawer(b.getAttribute('data-open'), b);
    });
    $('[data-refresh]').addEventListener('click', function () { loadStats(); loadPayments(); });
    $('[data-pay-check]').addEventListener('click', loadPayments);
    $('[data-stats-refresh]').addEventListener('click', loadSiteStats);
    $('[data-titles-search]').addEventListener('input', renderSiteTitles);
    window.addEventListener('hashchange', function () { if (currentView() === 'stats' && state.loaded.stats && !liveTimer) loadSiteStats(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && currentView() === 'stats' && state.loaded.stats) loadSiteStats(); });
    loadPayments();
    window.addEventListener('hashchange', showView);
    showView();
  }

  document.addEventListener('DOMContentLoaded', start);
})();
