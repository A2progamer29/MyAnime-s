/* =========================================================
   LumaAnime — pages/parametres.js
   ========================================================= */

var SETTINGS_TABS = ['profil', 'apparence', 'premium', 'coins', 'watchlist', 'favoris', 'compte'];

document.addEventListener('myanimes:user', function (e) {
  var root = document.querySelector('[data-settings]');
  var guard = document.querySelector('[data-settings-guard]');
  if (!root) return;
  var user = e.detail;
  if (!user) { guard.hidden = false; return; }
  root.hidden = false;

  setupTabs(root);
  renderProfile(user);
  setupUploads(user);
  setupDecorations(user);
  setupBadgePicker();
  setupPublicProfile(user);
  setupThemes(user);
  renderPremium(user);
  setupKeyForm(user);
  loadMyKeysBlock();
  renderMyOrders();
  renderSavedList(document.querySelector('[data-saved-list="watchlist"]'), user.watchlist, 'watchlist');
  renderSavedList(document.querySelector('[data-saved-list="favorites"]'), user.favorites, 'favorites');
  renderAccountFacts(user);
  renderCoinsTab(user);
  setupPseudoForm(user);
  setupEmailForm(user);
  setupPasswordReset(user);
}, { once: true });

function setupTabs(root) {
  var tablist = root.querySelector('[role="tablist"]');
  var wanted = (location.hash || '').replace('#', '');
  if (SETTINGS_TABS.indexOf(wanted) !== -1) {
    tablist.querySelectorAll('[role="tab"]').forEach(function (t) {
      t.setAttribute('aria-selected', String(t.getAttribute('data-tab') === wanted));
    });
  }
  initTabs(tablist, {
    onSelect: function (tab) { history.replaceState(null, '', '#' + tab.getAttribute('data-tab')); }
  });
  var desktop = window.matchMedia('(min-width: 1024px)');
  function orient() { tablist.setAttribute('aria-orientation', desktop.matches ? 'vertical' : 'horizontal'); }
  desktop.addEventListener('change', orient);
  orient();
}

/* ---- Aperçu du profil ---- */
function renderProfile(user) {
  document.querySelector('[data-profile-name]').textContent = user.pseudo;
  document.querySelector('[data-profile-email]').textContent = user.email;
  document.querySelector('[data-profile-badges]').innerHTML =
    '<span class="badge badge--muted">' + (isAdmin(user) ? 'Administrateur' : 'Membre') + '</span>' +
    (user.premium ? '<span class="badge badge--gold">' + icon('crown') + 'Premium</span>' : '');
  renderAvatarPreview(user.avatarUrl, user);
  renderBannerPreview(user.bannerUrl);
}

function renderAvatarPreview(url, user) {
  document.querySelector('[data-avatar-slot]').innerHTML = avatarHTML({ avatarUrl: url, pseudo: user.pseudo });
}

function renderBannerPreview(url) {
  var img = document.querySelector('[data-banner-img]');
  var safe = profileImageUrl(url);
  img.hidden = !safe;
  if (safe) img.src = safe; else img.removeAttribute('src');
}

function canLoadImage(src) {
  return new Promise(function (resolve) {
    var img = new Image();
    img.onload = function () { resolve(true); };
    img.onerror = function () { resolve(false); };
    img.src = src;
  });
}

/* ---- Téléversements ---- */
function setupUploads(user) {
  var config = {
    banner: {
      zone: document.querySelector('[data-banner-zone]'),
      input: document.getElementById('banner-input'),
      busy: document.querySelector('[data-banner-busy]'),
      error: document.getElementById('banner-error'),
      upload: uploadBanner,
      current: function () { return user.bannerUrl; },
      preview: function (url) { renderBannerPreview(url); },
      done: 'Bannière mise à jour.'
    },
    avatar: {
      zone: document.querySelector('[data-avatar-zone]'),
      input: document.getElementById('avatar-input'),
      busy: document.querySelector('[data-avatar-busy]'),
      error: document.getElementById('avatar-error'),
      upload: uploadAvatar,
      current: function () { return user.avatarUrl; },
      preview: function (url) { renderAvatarPreview(url, user); },
      done: 'Photo de profil mise à jour.'
    }
  };

  Object.keys(config).forEach(function (kind) {
    var c = config[kind];
    var working = false;

    async function handle(file) {
      if (working) { showToast('Un envoi est déjà en cours, patiente quelques secondes.', 'warning'); return; }
      c.error.textContent = '';
      working = true;
      var check = await prepareProfileImage(file, kind);
      working = false;
      if (check.cancelled) return;
      if (!check.ok) { c.error.textContent = check.message; c.input.focus(); return; }
      file = check.file;

      working = true;
      var previous = c.current();
      c.preview(check.previewUrl);
      c.busy.hidden = false;
      announce('Envoi de ' + IMAGE_RULES[kind].name + ' en cours.');
      var res = await c.upload(file);
      c.busy.hidden = true;
      working = false;

      if (res.error) {
        c.preview(previous);
        URL.revokeObjectURL(check.previewUrl);
        c.error.textContent = res.error;
        return;
      }
      if (!(await canLoadImage(res.url))) {
        c.error.textContent = 'Image enregistrée, mais elle ne s\'affiche pas : l\'espace de stockage n\'est peut-être pas public. Préviens l\'administrateur.';
      }
      c.preview(res.url);
      URL.revokeObjectURL(check.previewUrl);
      renderAccount(user);
      showToast(c.done, 'success');
    }

    bindImageDrop(c.zone, c.input, handle);
    c.zone.addEventListener('click', function (e) {
      if (e.target.closest('input, label, button, a')) return;
      if (kind === 'banner' && e.target.closest('[data-avatar-zone]')) return;
      c.input.click();
    });
  });
}

/* ---- Profil public ---- */
function setupPublicProfile(user) {
  var toggle = document.getElementById('setting-public');
  var link = document.querySelector('[data-public-link]');
  var state = document.querySelector('[data-public-state]');
  link.href = 'profil.html?id=' + encodeURIComponent(user.id);
  function render() {
    toggle.checked = !!user.settings.publicProfile;
    state.textContent = toggle.checked
      ? 'Ton profil est public : toute personne ayant le lien peut le voir.'
      : 'Ton profil est privé : la page affiche « Ce profil est privé ».';
  }
  toggle.addEventListener('change', async function () {
    var wanted = toggle.checked;
    toggle.disabled = true;
    var res = await updateSettings({ publicProfile: wanted });
    toggle.disabled = false;
    if (!res.ok) { toggle.checked = !wanted; showToast(res.error, 'error'); return; }
    render();
    showToast(wanted ? 'Ton profil est maintenant public.' : 'Ton profil est maintenant privé.', 'success');
  });
  render();
}

/* ---- Thème ---- */
function setupThemes(user) {
  var presets = window.MyAnimesTheme.presets;
  var inputs = document.querySelectorAll('input[name="theme"]');
  var active = user.settings.themePreset && presets[user.settings.themePreset] ? user.settings.themePreset : 'original';
  inputs.forEach(function (input) {
    input.checked = input.value === active;
    input.addEventListener('change', async function () {
      if (!input.checked) return;
      var p = presets[input.value];
      var before = Object.assign({}, user.settings);
      var patch = { themePreset: input.value, color: p.color, colorDim: p.dim, colorLight: p.light };
      window.MyAnimesTheme.apply(patch);
      inputs.forEach(function (i) { i.disabled = true; });
      var res = await updateSettings(patch);
      inputs.forEach(function (i) { i.disabled = false; });
      if (!res.ok) {
        window.MyAnimesTheme.apply(before);
        inputs.forEach(function (i) { i.checked = i.value === (before.themePreset || 'original'); });
        showToast(res.error, 'error');
        return;
      }
      cacheThemeForNextLoad(user);
      input.focus();
      showToast('Thème « ' + p.name + ' » appliqué sur tout le site.', 'success');
    });
  });
}

/* ---- Premium ---- */
function renderPremium(user) {
  var box = document.querySelector('[data-premium-state]');
  var st = premiumStatus(user);
  if (st.active) {
    box.innerHTML = '<span class="badge badge--gold">' + icon('crown') + escapeHTML(st.tier.name) + '</span>' +
      '<p>' + (st.legacy ? 'Premium actif, attribué avant le système de clés.' : st.lifetime ? 'Premium actif à vie.' : 'Premium actif jusqu\'au ' + escapeHTML(formatDateFr(st.until, true)) + ' (encore ' + formatRemaining(st.msLeft) + ').') + '</p>' +
      '<div class="action-row"><a class="btn btn-sm" href="mon-premium.html">' + icon('crown') + '<span>Voir mon espace Premium</span></a></div>';
  } else {
    var expired = user.premiumTier && user.premiumUntil;
    box.innerHTML = '<span class="badge badge--muted">Compte gratuit</span>' +
      '<p>' + (expired ? 'Ton Premium a expiré le ' + escapeHTML(formatDateFr(user.premiumUntil)) + '. ' : '') + 'Active une clé ci-dessous, ou débloque le Premium avec tes Anime Coins.</p>' +
      '<div class="action-row"><a class="btn btn-sm" href="premium.html">Voir les offres Premium</a><a class="btn btn-sm btn-ghost" href="coins.html">' + icon('coin') + '<span>Mes Anime Coins</span></a></div>';
  }
}

function setupKeyForm(user) {
  var form = document.getElementById('key-form');
  var input = document.getElementById('premium-key');
  var result = form.querySelector('[data-key-result]');
  var submit = form.querySelector('[type="submit"]');

  input.addEventListener('input', function () {
    var formatted = formatKey(input.value);
    if (formatted !== input.value) input.value = formatted;
    if (input.getAttribute('aria-invalid')) setFieldError(input, '');
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    result.textContent = '';
    setFieldError(input, validateKey(input.value));
    if (focusFirstInvalid(form)) return;
    setBusy(submit, true, 'Vérification de la clé…');
    var res = await redeemPremiumKey(normalizeKey(input.value));
    setBusy(submit, false);
    if (!res.ok) { setFieldError(input, res.error); input.focus(); return; }
    input.value = '';
    var fresh = await refreshedUser();
    if (res.kind === 'coins') {
      result.textContent = '+' + formatCoins(res.coins_added) + ' ajoutés à ton solde.';
    } else {
      var t = PREMIUM_TIERS[res.tier];
      result.textContent = 'Premium ' + (t ? t.name : '') + ' activé ' + (res.until ? 'jusqu\'au ' + formatDateFr(res.until, true) : 'à vie') + '. Merci pour ton soutien !';
    }
    showToast(result.textContent, 'success');
    if (fresh) { Object.assign(user, fresh); renderPremium(fresh); renderProfile(fresh); renderAccount(fresh); }
    loadMyKeysBlock();
  });
}

async function loadMyKeysBlock() {
  var block = document.querySelector('[data-my-keys-block]');
  var list = document.querySelector('[data-my-keys]');
  var keys = await listMyKeys();
  block.hidden = !keys.length;
  list.innerHTML = keys.map(keyItemHTML).join('');
}


/* ---- Décorations ---- */
var decoState = { items: [], equipped: null, filter: 'all', user: null };

function decoPriceLabel(d) {
  if (!d.cost) return 'Gratuite';
  return formatCoins(d.cost);
}

async function loadDecorations() {
  var list = document.querySelector('[data-deco-list]');
  var res = await decorationsCatalog();
  if (!res.ok) { list.innerHTML = '<li class="catalog-status">' + escapeHTML(/installée/.test(res.error || '') ? 'Les décorations seront disponibles très bientôt.' : res.error) + '</li>'; return; }
  decoState.items = res.items;
  decoState.equipped = res.equipped;
  if (typeof res.coins === 'number') decoState.user.coins = res.coins;
  renderDecorations();
  renderDecoratedPreview();
}

// Aperçu en haut de l'onglet : photo et bannière avec la décoration équipée (ou essayée)
function previewDecoration(d) {
  var u = decoState.user;
  document.querySelector('[data-avatar-slot]').innerHTML = decoratedAvatarHTML({ avatarUrl: u.avatarUrl, pseudo: u.pseudo }, d);
  var zone = document.querySelector('[data-banner-zone]');
  var old = zone.querySelector('.banner-deco');
  if (old) old.remove();
  var html = decorationBannerHTML(d);
  if (html) zone.insertAdjacentHTML('beforeend', html);
}

function renderDecoratedPreview() {
  previewDecoration(decoState.items.filter(function (d) { return d.id === decoState.equipped; })[0] || null);
}

function decoCardPreviewHTML(d, u) {
  if (!decorationOnBanner(d)) return decoratedAvatarHTML({ avatarUrl: u.avatarUrl, pseudo: u.pseudo }, d);
  var banner = profileImageUrl(u.bannerUrl) ? '<img src="' + escapeHTML(profileImageUrl(u.bannerUrl)) + '" alt="">' : '';
  return '<span class="deco-mini-banner">' + banner + decorationBannerHTML(d) + '</span>';
}

function renderDecorations() {
  var list = document.querySelector('[data-deco-list]');
  var f = decoState.filter;
  var items = decoState.items.filter(function (d) {
    return f === 'all' || (f === 'free' && !d.cost) || (f === 'paid' && d.cost > 0) || (f === 'owned' && d.owned);
  });
  if (!items.length) {
    list.innerHTML = '<li class="catalog-status">' + (decoState.items.length ? 'Aucune décoration dans cette catégorie.' : 'Aucune décoration disponible pour le moment.') + '</li>';
    return;
  }
  var u = decoState.user;
  list.innerHTML = items.map(function (d) {
    var equipped = d.id === decoState.equipped;
    var action;
    if (equipped) action = '<button class="btn btn-sm" type="button" data-deco-unequip>' + icon('x') + '<span>Retirer</span></button>';
    else if (d.owned) action = '<button class="btn btn-primary btn-sm" type="button" data-deco-equip="' + escapeHTML(d.id) + '">' + icon('check') + '<span>Équiper</span></button>';
    else if (!d.active) action = '<span class="badge badge--muted">Indisponible</span>';
    else if (d.cost > (u.coins || 0)) action = '<button class="btn btn-sm" type="button" disabled>' + icon('lock') + '<span>Il manque ' + formatCoins(d.cost - (u.coins || 0)) + '</span></button>';
    else action = '<button class="btn ' + (d.cost ? '' : 'btn-primary ') + 'btn-sm" type="button" data-deco-get="' + escapeHTML(d.id) + '">' + icon(d.cost ? 'coin' : 'gift') + '<span>' + (d.cost ? 'Obtenir pour ' + formatCoins(d.cost) : 'Obtenir gratuitement') + '</span></button>';
    return '<li class="deco-card' + (equipped ? ' is-equipped' : '') + '">' +
      '<button class="deco-preview" type="button" data-deco-preview="' + escapeHTML(d.id) + '" title="Prévisualiser sur ma photo">' +
        decoCardPreviewHTML(d, u) +
        '<span class="sr-only">Prévisualiser « ' + escapeHTML(d.name) + ' » sur mon profil</span>' +
      '</button>' +
      '<div class="deco-body">' +
        '<p class="deco-name">' + escapeHTML(d.name) + (equipped ? ' <span class="badge badge--accent">Équipée</span>' : d.owned ? ' <span class="badge badge--muted">Obtenue</span>' : '') + '</p>' +
        '<p class="deco-meta">' + escapeHTML(decorationCategoryLabel(d.category)) + ' · ' + (decorationOnBanner(d) ? 'bannière' : 'avatar') + '</p>' +
        (d.description ? '<p class="deco-desc">' + escapeHTML(d.description) + '</p>' : '') +
        '<p class="deco-price">' + (d.cost ? icon('coin') : '') + escapeHTML(decoPriceLabel(d)) + '</p>' +
        action +
      '</div>' +
    '</li>';
  }).join('');
}

function setupDecorations(user) {
  decoState.user = user;
  var list = document.querySelector('[data-deco-list]');
  document.querySelector('[data-deco-filters]').addEventListener('click', function (e) {
    var b = e.target.closest('[data-deco-filter]');
    if (!b) return;
    decoState.filter = b.getAttribute('data-deco-filter');
    this.querySelectorAll('[data-deco-filter]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    renderDecorations();
  });
  list.addEventListener('click', async function (e) {
    var prev = e.target.closest('[data-deco-preview]');
    var get = e.target.closest('[data-deco-get]');
    var equip = e.target.closest('[data-deco-equip]');
    var unequip = e.target.closest('[data-deco-unequip]');
    if (prev) {
      var d0 = decoState.items.filter(function (x) { return x.id === prev.getAttribute('data-deco-preview'); })[0];
      previewDecoration(d0);
      document.querySelector('[data-banner-zone]').scrollIntoView({ behavior: 'smooth', block: 'center' });
      announce('Aperçu de « ' + (d0 ? d0.name : '') + ' » sur ' + (decorationOnBanner(d0) ? 'ta bannière' : 'ta photo') + ', en haut de la page.');
      clearTimeout(setupDecorations.timer);
      setupDecorations.timer = setTimeout(renderDecoratedPreview, 6000);
      return;
    }
    if (get) {
      var d = decoState.items.filter(function (x) { return x.id === get.getAttribute('data-deco-get'); })[0];
      if (!d) return;
      if (d.cost) {
        var ok = await confirmDialog({ title: 'Obtenir « ' + d.name + ' » ?', message: formatCoins(d.cost) + ' seront retirés de ton solde. Cette opération ne peut pas être annulée.', confirmLabel: 'Obtenir pour ' + formatCoins(d.cost), cancelLabel: 'Annuler' });
        if (!ok) return;
      }
      setBusy(get, true, 'Patiente…');
      var res = await obtainDecoration(d.id);
      if (!res.ok) { setBusy(get, false); showToast(res.error, 'warning'); return; }
      showToast('« ' + d.name + ' » est à toi ! Tu peux maintenant l\'équiper.', 'success');
      var fresh = await refreshedUser();
      if (fresh) { decoState.user = fresh; renderAccount(fresh); }
      await loadDecorations();
      return;
    }
    if (equip || unequip) {
      var id = equip ? equip.getAttribute('data-deco-equip') : null;
      var btn = equip || unequip;
      setBusy(btn, true, 'Patiente…');
      var r = await equipDecoration(id);
      if (!r.ok) { setBusy(btn, false); showToast(r.error, 'warning'); return; }
      decoState.equipped = id;
      renderDecorations();
      renderDecoratedPreview();
      showToast(id ? 'Décoration équipée.' : 'Décoration retirée.', 'success');
    }
  });
  loadDecorations();
}

/* ---- Badges publics ---- */
var MAX_SHOWN_BADGES = 5;

async function setupBadgePicker() {
  var box = document.querySelector('[data-badge-picker]');
  var res = await myBadges();
  if (!res.ok) { box.innerHTML = '<p class="catalog-status">' + escapeHTML(/installée/.test(res.error || '') ? 'Les badges seront disponibles très bientôt.' : res.error) + '</p>'; return; }
  var items = res.items || [];
  var shown = (res.shown || []).filter(function (id) { return items.some(function (b) { return b.id === id; }); });
  if (!items.length) {
    box.innerHTML = '<p class="catalog-status">Tu n\'as pas encore de badge. Atteins des paliers de succès pour en gagner.</p>';
    return;
  }
  function render() {
    box.innerHTML =
      '<p class="field-hint" role="status">' + shown.length + ' / ' + MAX_SHOWN_BADGES + ' badges choisis' + (shown.length ? '' : ' (les 5 plus récents seront affichés)') + '.</p>' +
      '<ul class="badge-picker">' + items.map(function (b) {
        var on = shown.indexOf(b.id) !== -1;
        return '<li><button class="badge-pick" type="button" aria-pressed="' + on + '" data-badge-toggle="' + escapeHTML(b.id) + '"' + (!on && shown.length >= MAX_SHOWN_BADGES ? ' disabled' : '') + '>' +
          badgeHTML(b) + (on ? '<span class="badge-pick-order" aria-hidden="true">' + (shown.indexOf(b.id) + 1) + '</span>' : '') +
          '<span class="sr-only">' + (on ? ' (affiché, cliquer pour retirer)' : ' (cliquer pour afficher)') + '</span></button></li>';
      }).join('') + '</ul>';
  }
  render();
  box.addEventListener('click', async function (e) {
    var b = e.target.closest('[data-badge-toggle]');
    if (!b || b.disabled) return;
    var id = b.getAttribute('data-badge-toggle');
    var next = shown.indexOf(id) !== -1 ? shown.filter(function (x) { return x !== id; }) : shown.concat([id]);
    var r = await setShownBadges(next);
    if (!r.ok) { showToast(r.error, 'warning'); return; }
    shown = r.shown || next;
    render();
    var again = box.querySelector('[data-badge-toggle="' + id + '"]');
    if (again) again.focus();
  });
}

/* ---- Paiements et données bancaires ---- */
var ORDER_STATUS = {
  paid: ['Payée', 'badge--gold'], pending: ['En attente', 'badge--muted'],
  failed: ['Non aboutie', 'badge--muted'], cancelled: ['Annulée', 'badge--muted']
};

async function renderMyOrders() {
  var list = document.querySelector('[data-my-orders]');
  var summary = document.querySelector('[data-pending-summary]');
  if (!list) return;
  var orders = await listMyOrders();
  if (!orders) { list.innerHTML = '<li class="muted">Historique indisponible pour le moment.</li>'; summary.textContent = 'Indisponible pour le moment.'; return; }
  var pending = orders.filter(function (o) { return o.status === 'pending' && o.checkout_id; }).length;
  summary.textContent = pending ? pending + ' paiement' + (pending > 1 ? 's' : '') + ' en attente de vérification.' : 'Aucun paiement en attente.';
  list.innerHTML = orders.length ? orders.map(function (o) {
    var t = PREMIUM_TIERS[o.tier];
    var st = ORDER_STATUS[o.status] || [o.status, 'badge--muted'];
    return '<li><div><strong>Clé ' + escapeHTML(t ? t.name : o.tier) + '</strong><time datetime="' + escapeHTML(o.created_at) + '">' + escapeHTML(formatDateFr(o.created_at, true)) + '</time></div>' +
      '<span class="order-amount">' + escapeHTML(Number(o.amount).toLocaleString('fr-FR', { style: 'currency', currency: o.currency || 'EUR' })) + '</span>' +
      '<span class="badge ' + st[1] + '">' + escapeHTML(st[0]) + '</span></li>';
  }).join('') : '<li class="muted">Aucune commande pour le moment.</li>';
}

/* ---- Compte ---- */
function renderAccountFacts(user, factsOnly) {
  var joined = user.joinedAt ? new Date(user.joinedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Date inconnue';
  var facts = document.querySelector('[data-account-facts]');
  facts.innerHTML = [
    ['Pseudo', user.pseudo, 'pseudo', 'Changer de pseudo'],
    ['Adresse e-mail', user.email, 'email', 'Changer d\'adresse e-mail'],
    ['Rôle', isAdmin(user) ? 'Administrateur' : 'Membre'],
    ['Inscrit depuis le', joined]
  ].map(function (f) {
    var edit = f[2] ? '<button class="icon-btn account-edit" type="button" data-edit="' + f[2] + '" title="' + f[3] + '">' + icon('edit') + '<span class="sr-only">' + f[3] + '</span></button>' : '';
    return '<div><dt>' + f[0] + '</dt><dd><span>' + escapeHTML(f[1]) + '</span>' + edit + '</dd></div>';
  }).join('');

  if (factsOnly) return;
  facts.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-edit]');
    if (!btn) return;
    var dlg = document.querySelector('[data-edit-dialog="' + btn.getAttribute('data-edit') + '"]');
    dlg.showModal();
    var field = dlg.querySelector('input:not([disabled])');
    if (field) { field.focus(); field.select(); }
  });
  document.querySelectorAll('[data-edit-dialog]').forEach(function (dlg) {
    dlg.querySelector('[data-dialog-close]').addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('close', function () {
      var opener = facts.querySelector('[data-edit="' + dlg.getAttribute('data-edit-dialog') + '"]');
      if (opener) opener.focus();
    });
  });
  var logout = document.querySelector('[data-settings-logout]');
  logout.addEventListener('click', async function () {
    setBusy(logout, true, 'Déconnexion…');
    await logoutUser();
    window.location.href = 'index.html';
  });
}

/* ---- Anime Coins ---- */
function renderCoinsTab(user) {
  var facts = document.querySelector('[data-coins-facts]');
  var claimed = (user.achievements || []).length;
  facts.innerHTML = [
    ['Solde', formatCoins(user.coins)],
    ['Série en cours', (user.streak || 0) + ' jour' + (user.streak > 1 ? 's' : '')],
    ['Meilleure série', (user.bestStreak || 0) + ' jour' + (user.bestStreak > 1 ? 's' : '')],
    ['Succès obtenus', claimed + ' sur ' + ACHIEVEMENTS.length]
  ].map(function (f) { return '<div><dt>' + f[0] + '</dt><dd>' + escapeHTML(f[1]) + '</dd></div>'; }).join('');

  var box = document.querySelector('[data-settings-daily]');
  var preview = dailyPreview(user);
  if (!preview.available) {
    box.innerHTML = '<p>' + icon('check') + ' Récompense du jour déjà récupérée. Reviens demain (minuit, heure de Paris) pour continuer ta série.</p>';
    return;
  }
  var total = preview.reward + preview.bonus;
  box.innerHTML = '<p>Ta récompense du jour : <strong class="coin-amount">+' + total + ' AC</strong>' + (preview.bonus ? ' (bonus de série inclus)' : '') + '.</p>' +
    '<div><button class="btn btn-primary" type="button" data-settings-claim>' + icon('coin') + '<span>Récupérer ' + total + ' Anime Coins</span></button></div>';
  box.querySelector('[data-settings-claim]').addEventListener('click', async function () {
    var btn = this;
    setBusy(btn, true, 'Récupération…');
    var res = await claimDailyReward();
    if (!res.ok) { setBusy(btn, false); showToast(res.error, 'warning'); return; }
    showToast('+' + (res.reward + res.bonus) + ' Anime Coins ! Série : ' + res.streak + ' jour' + (res.streak > 1 ? 's' : '') + '.', 'success');
    var fresh = await refreshedUser();
    if (fresh) { renderAccount(fresh); renderCoinsTab(fresh); }
  });
}

/* ---- Pseudo ---- */
var PSEUDO_COOLDOWN = 7 * 86400000;

function setupPseudoForm(user) {
  var form = document.querySelector('[data-pseudo-form]');
  var input = form.elements.pseudo;
  var note = form.querySelector('[data-pseudo-cooldown]');
  var btn = form.querySelector('[type="submit"]');
  input.value = user.pseudo || '';

  function renderCooldown() {
    var next = user.pseudoChangedAt ? new Date(user.pseudoChangedAt).getTime() + PSEUDO_COOLDOWN : 0;
    var locked = next > Date.now();
    note.hidden = !locked;
    if (locked) note.textContent = 'Prochain changement possible le ' + formatDateFr(new Date(next), true) + '.';
    input.disabled = locked;
    btn.disabled = locked;
  }
  renderCooldown();

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var value = input.value.trim().replace(/\s+/g, ' ');
    var error = validatePseudo(value);
    if (!error && value === user.pseudo) error = 'C\'est déjà ton pseudo actuel.';
    if (!error && value.toLowerCase() !== String(user.pseudo || '').toLowerCase() && !(await isPseudoAvailable(value))) error = 'Ce pseudo est déjà utilisé par un autre membre.';
    setFieldError(input, error);
    if (error) { input.focus(); return; }
    var ok = await confirmDialog({
      title: 'Changer de pseudo ?',
      message: 'Tu t\'appelleras « ' + value + ' ». Tu ne pourras plus en changer pendant 7 jours.',
      confirmLabel: 'Changer de pseudo',
      cancelLabel: 'Annuler'
    });
    if (!ok) return;
    setBusy(btn, true, 'Enregistrement…');
    var res = await changePseudo(value);
    setBusy(btn, false);
    if (!res.ok) {
      var msg = res.error;
      if (res.reason === 'pseudo_cooldown' && res.next_at) msg += ' Prochain changement possible le ' + formatDateFr(res.next_at, true) + '.';
      setFieldError(input, msg);
      input.focus();
      return;
    }
    form.closest('dialog').close();
    showToast('Ton pseudo est maintenant « ' + res.pseudo + ' ».', 'success');
    var fresh = await refreshedUser();
    if (fresh) {
      user = fresh;
      renderAccount(fresh);
      renderProfile(fresh);
      renderAccountFacts(fresh, true);
      input.value = fresh.pseudo;
      renderCooldown();
    }
  });
}

/* ---- Adresse e-mail ---- */
function setupEmailForm(user) {
  var form = document.querySelector('[data-email-form]');
  var input = form.elements.email;
  var pending = document.querySelector('[data-email-pending]');
  var btn = form.querySelector('[type="submit"]');

  function showPending(address) {
    pending.hidden = !address;
    if (address) pending.textContent = 'Changement en attente : confirme le lien envoyé à ' + address + '. Tant que ce n\'est pas fait, ton adresse reste ' + user.email + '.';
  }
  pendingEmailChange().then(showPending);

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var value = input.value.trim();
    var error = validateEmail(value);
    if (!error && value.toLowerCase() === String(user.email || '').toLowerCase()) error = 'C\'est déjà l\'adresse de ton compte.';
    setFieldError(input, error);
    if (error) { input.focus(); return; }
    setBusy(btn, true, 'Envoi du lien…');
    var res = await changeEmail(value);
    setBusy(btn, false);
    if (!res.ok) { setFieldError(input, res.error); input.focus(); return; }
    input.value = '';
    form.closest('dialog').close();
    showPending(res.pending || value);
    showToast('Lien de confirmation envoyé à ' + value + '.', 'success');
  });
}

/* ---- Mot de passe ---- */
function setupPasswordReset(user) {
  var btn = document.querySelector('[data-password-reset]');
  var status = document.querySelector('[data-password-status]');
  btn.addEventListener('click', async function () {
    status.textContent = '';
    status.classList.remove('form-alert--success');
    setBusy(btn, true, 'Envoi du lien…');
    var res = await requestPasswordReset(user.email);
    setBusy(btn, false);
    if (!res.ok) { status.textContent = res.error; return; }
    status.classList.add('form-alert--success');
    status.textContent = 'Lien envoyé à ' + user.email + '. Ouvre-le pour choisir ton nouveau mot de passe (pense aux courriers indésirables).';
    btn.disabled = true;
    setTimeout(function () { btn.disabled = false; }, 60000);
  });
}
