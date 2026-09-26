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
  setupPublicProfile(user);
  setupThemes(user);
  renderPremium(user);
  setupKeyForm(user);
  loadMyKeysBlock();
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
  var safe = /^(https:|blob:)/.test(String(url || '')) ? url : '';
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

/* ---- Compte ---- */
function renderAccountFacts(user, factsOnly) {
  var joined = user.joinedAt ? new Date(user.joinedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Date inconnue';
  document.querySelector('[data-account-facts]').innerHTML = [
    ['Pseudo', user.pseudo],
    ['Adresse e-mail', user.email],
    ['Rôle', isAdmin(user) ? 'Administrateur' : 'Membre'],
    ['Inscrit depuis le', joined]
  ].map(function (f) { return '<div><dt>' + f[0] + '</dt><dd>' + escapeHTML(f[1]) + '</dd></div>'; }).join('');

  if (factsOnly) return;
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
  var pending = form.querySelector('[data-email-pending]');
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
