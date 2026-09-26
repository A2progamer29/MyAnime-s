/* =========================================================
   LumaAnime — pages/admin.js
   Administration : indicateurs, membres (Premium, Anime Coins, rôle, série, suppression),
   clés, commandes et journal. Toutes les actions passent par des fonctions serveur
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
    var src = typeof u.avatar_url === 'string' && /^https:\/\//.test(u.avatar_url) ? u.avatar_url : '';
    return '<span class="adm-avatar" aria-hidden="true">' + (src ? '<img src="' + esc(src) + '" alt="" loading="lazy">' : initial) + '</span>';
  }

  /* ---- Navigation ---- */
  var VIEWS = ['tableau', 'stats', 'membres', 'cles', 'commandes', 'journal'];
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
    var loaders = { tableau: loadStats, stats: loadSiteStats, membres: loadUsers, cles: loadKeys, commandes: loadOrders, journal: loadLog };
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
    accueil: 'Accueil', index: 'Accueil', catalogue: 'Catalogue', details: 'Fiches', lecteur: 'Lecteur', simulcast: 'Simulcast',
    calendrier: 'Calendrier', premium: 'Premium', coins: 'Anime Coins', profil: 'Profils', parametres: 'Paramètres',
    connexion: 'Connexion', inscription: 'Inscription', acheter: 'Achat', 'mon-premium': 'Mon Premium'
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
      ['Actifs maintenant', num(s.active_now)], ["Visiteurs aujourd'hui", num(s.visitors_today)], ["Pages vues aujourd'hui", num(s.views_today)],
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

    siteTitles = s.titles || [];
    renderSiteTitles();
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function () { if (currentView() === 'stats' && !document.hidden) loadSiteStats(); else liveTimer = null; }, 30000);
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
    var STATUS = { paid: '<span class="adm-tag adm-tag--green">Payée</span>', pending: '<span class="adm-tag adm-tag--warn">En attente</span>', failed: '<span class="adm-tag adm-tag--red">Échouée</span>' };
    tbody.innerHTML = rows.map(function (o) {
      return '<tr><td>' + date(o.created_at, true) + '</td><td>' + esc(o.pseudo || 'Compte supprimé') + '</td><td>' + esc(TIER_LABEL[o.tier] || o.tier) + '</td>' +
        '<td class="adm-num">' + money(o.amount) + '</td><td>' + (STATUS[o.status] || esc(o.status)) + '</td><td>' + date(o.paid_at, true) + '</td></tr>';
    }).join('');
  }

  var ACTIONS = {
    premium_ajoute: 'Premium donné', premium_retire: 'Premium retiré', coins: 'Anime Coins ajustés', role: 'Rôle modifié',
    serie_reinitialisee: 'Série réinitialisée', compte_supprime: 'Compte supprimé', cle_annulee: 'Clé annulée', cles_generees: 'Clés générées'
  };
  function logDetails(action, d) {
    d = d || {};
    if (action === 'premium_ajoute') return (TIER_LABEL[d.niveau] || d.niveau) + (d.jours ? ', ' + d.jours + ' jours' + (d.prolongation ? ' (prolongation)' : '') : '');
    if (action === 'premium_retire') return 'Ancien niveau : ' + (TIER_LABEL[d.ancien] || d.ancien || '—');
    if (action === 'coins') return (d.montant > 0 ? '+' : '') + num(d.montant) + ' AC' + (d.note ? ' — ' + d.note : '');
    if (action === 'role') return d.role === 'admin' ? 'Administrateur' : 'Membre';
    if (action === 'cle_annulee') return formatKey(d.code || '');
    if (action === 'cles_generees') return d.nombre + ' × ' + (d.type === 'coins' ? num(d.coins) + ' AC' : (TIER_LABEL[d.niveau] || d.niveau));
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
