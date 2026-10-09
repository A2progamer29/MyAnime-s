/* =========================================================
   LumaAnime — layout.js
   En-tête, navigation, pied de page (une seule source pour toutes les pages)
   + petits utilitaires partagés (échappement HTML, icônes)
   ========================================================= */

var ICON_SPRITE = 'assets/icons/sprite.svg?v=20261007b';

function escapeHTML(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function safeImageUrl(url) {
  return /^(https:\/\/|blob:)/i.test(String(url || '')) ? String(url) : '';
}

// Avatar et bannière : uniquement des images envoyées dans le stockage du site (ou un aperçu local blob:)
var PROFILE_MEDIA_RE = /^https:\/\/phjpyaiheswpuqjpdfuo\.supabase\.co\/storage\/v1\/object\/public\/(avatars|banners)\/[A-Za-z0-9_.\/-]+$/;
function profileImageUrl(url) {
  var s = String(url || '');
  if (/^blob:/i.test(s)) return s;
  return PROFILE_MEDIA_RE.test(s) && s.indexOf('..') === -1 ? s : '';
}

function icon(name, extraClass) {
  if (!/^[a-z0-9-]+$/.test(String(name || ''))) name = 'trophy';
  var cls = 'icon' + (extraClass ? ' ' + extraClass : '');
  return '<svg class="' + cls + '" aria-hidden="true" focusable="false"><use href="' + ICON_SPRITE + '#' + name + '"></use></svg>';
}

function brandLogoSrc() {
  return window.MA_BRAND_LOGO || 'assets/logos/logo-original.png';
}

function currentPage() {
  return document.body.getAttribute('data-page') || '';
}

function currentRelativeUrl() {
  var file = location.pathname.split('/').pop() || 'index.html';
  if (!/\.html$/.test(file)) file += '.html';
  return file + location.search;
}

var SITE_NAV = [
  { page: 'wishboard', href: 'wishboard.html', label: 'Wishboard', icon: 'sparkle', main: true, tab: true },
  { page: 'accueil', href: 'index.html', label: 'Accueil', icon: 'home', main: false, tab: true },
  { page: 'catalogue', href: 'catalogue.html', label: 'Catalogue', icon: 'grid', main: true, tab: true },
  { page: 'calendrier', href: 'calendrier.html', label: 'Calendrier', icon: 'calendar', main: true, tab: true },
  { page: 'simulcast', href: 'simulcast.html', label: 'Simulcast', icon: 'broadcast', main: true, tab: true },
  { page: 'premium', href: 'premium.html', label: 'Premium', icon: 'crown', main: true, tab: false }
];

function hasSessionHint() {
  try {
    return Object.keys(localStorage).some(function (k) { return k.indexOf('sb-') === 0 && /-auth-token$/.test(k); });
  } catch (e) { return false; }
}

function brandMarkHTML() {
  return window.MA_BRAND_IMAGE
    ? '<img class="brand-logo" data-brand-logo src="' + brandLogoSrc() + '" alt="" width="40" height="40">'
    : '<span class="brand-letter" aria-hidden="true">L</span>';
}

function brandHTML() {
  return '<a class="brand" href="index.html">' +
    brandMarkHTML() +
    '<span class="brand-word" aria-hidden="true">umaAnime</span>' +
    '<span class="sr-only">LumaAnime, accueil</span>' +
  '</a>';
}

function renderHeader() {
  var header = document.querySelector('[data-site-header]');
  if (!header) return;
  var page = currentPage();
  var mainLinks = SITE_NAV.filter(function (n) { return n.main; }).map(function (n) {
    return '<li><a href="' + n.href + '"' + (n.page === page ? ' aria-current="page"' : '') + '>' + n.label + '</a></li>';
  }).join('');
  var tabLinks = SITE_NAV.filter(function (n) { return n.tab; }).map(function (n) {
    return '<li><a href="' + n.href + '"' + (n.page === page ? ' aria-current="page"' : '') + '>' + icon(n.icon) + '<span>' + n.label + '</span></a></li>';
  }).join('');
  var accountTabCurrent = ['parametres', 'connexion', 'inscription', 'mot-de-passe'].indexOf(page) !== -1;
  var searchValue = page === 'catalogue' ? (new URLSearchParams(location.search).get('q') || '') : '';

  header.innerHTML =
    '<div class="wrap header-bar">' +
      brandHTML() +
      '<nav class="main-nav" aria-label="Navigation principale"><ul>' + mainLinks + '</ul></nav>' +
      '<div class="header-tools">' +
        '<button class="tool-btn" type="button" data-search-toggle aria-expanded="false" aria-controls="site-search">' + icon('search') + '<span class="sr-only">Rechercher un anime</span></button>' +
        '<div class="account" data-account>' + (hasSessionHint() ? '<span class="account-placeholder" aria-hidden="true"></span>' : guestHTML()) + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="search-panel" id="site-search" hidden>' +
      '<form class="wrap search-form" action="catalogue.html" method="get" role="search">' +
        '<label class="sr-only" for="site-search-input">Rechercher un anime par titre</label>' +
        '<input class="input" id="site-search-input" name="q" type="search" maxlength="100" autocomplete="off" placeholder="Titre d\'un anime, par ex. Frieren" value="' + escapeHTML(searchValue) + '">' +
        '<button class="btn btn-primary" type="submit">' + icon('search') + '<span>Rechercher</span></button>' +
      '</form>' +
    '</div>' +
    '<nav class="tabbar" aria-label="Navigation mobile"><ul>' + tabLinks +
      '<li><a href="connexion.html" data-account-tab' + (accountTabCurrent ? ' aria-current="page"' : '') + '>' + icon('user') + '<span data-account-tab-label>' + (hasSessionHint() ? 'Compte' : 'Connexion') + '</span></a></li>' +
    '</ul></nav>';

  document.body.classList.add('has-tabbar');
  setupSearchPanel(header);
  setupHeaderScroll(header);
}

function guestHTML() {
  var next = encodeURIComponent(currentRelativeUrl());
  var page = currentPage();
  var loginHref = (page === 'connexion' || page === 'inscription') ? 'connexion.html' : 'connexion.html?next=' + next;
  return '<div class="account-guest">' +
    '<a class="btn btn-ghost btn-sm" href="' + loginHref + '">Connexion</a>' +
    '<a class="btn btn-primary btn-sm" href="inscription.html">Créer un compte</a>' +
  '</div>';
}

function avatarHTML(user, extraClass) {
  var url = profileImageUrl(user && user.avatarUrl);
  var letter = ((user && user.pseudo) || '?').trim().charAt(0).toUpperCase() || '?';
  return '<span class="avatar' + (extraClass ? ' ' + extraClass : '') + '" aria-hidden="true">' +
    (url ? '<img src="' + escapeHTML(url) + '" alt="">' : '<span class="avatar-letter">' + escapeHTML(letter) + '</span>') +
  '</span>';
}

// Décoration équipée : { image_url, placement }. Les emplacements « avatar_* » se posent sur la photo,
// les emplacements « banner_* » sur la bannière (voir decorationBannerHTML).
var AVATAR_DECO_PLACES = ['avatar_frame', 'avatar_top', 'avatar_top_left', 'avatar_top_right', 'avatar_bottom_left', 'avatar_bottom_right'];
var BANNER_DECO_PLACES = ['banner_full', 'banner_top_left', 'banner_top_right', 'banner_bottom_left', 'banner_bottom_right'];

function decorationParts(deco) {
  if (!deco) return null;
  var url = typeof deco === 'string' ? deco : deco.image_url;
  if (!/^https:\/\/[^\s"<>]+$/.test(String(url || ''))) return null;
  var place = typeof deco === 'string' ? 'avatar_frame' : deco.placement;
  if (AVATAR_DECO_PLACES.indexOf(place) === -1 && BANNER_DECO_PLACES.indexOf(place) === -1) place = 'avatar_frame';
  return { url: url, place: place };
}

function decoratedAvatarHTML(user, deco, extraClass) {
  var d = decorationParts(deco);
  if (!d || AVATAR_DECO_PLACES.indexOf(d.place) === -1) return avatarHTML(user, extraClass);
  return '<span class="avatar-deco-wrap' + (extraClass ? ' ' + extraClass + '-wrap' : '') + '">' + avatarHTML(user, extraClass) +
    '<img class="avatar-deco avatar-deco--' + d.place.replace('avatar_', '') + '" src="' + escapeHTML(d.url) + '" alt="" aria-hidden="true" loading="lazy" decoding="async"></span>';
}

function decorationBannerHTML(deco) {
  var d = decorationParts(deco);
  if (!d || BANNER_DECO_PLACES.indexOf(d.place) === -1) return '';
  return '<img class="banner-deco banner-deco--' + d.place.replace('banner_', '') + '" src="' + escapeHTML(d.url) + '" alt="" aria-hidden="true" loading="lazy" decoding="async">';
}

function renderAccount(user) {
  var slot = document.querySelector('[data-account]');
  var tab = document.querySelector('[data-account-tab]');
  var tabLabel = document.querySelector('[data-account-tab-label]');
  if (tab) {
    tab.href = user ? 'parametres.html' : 'connexion.html';
    if (tabLabel) tabLabel.textContent = user ? 'Compte' : 'Connexion';
  }
  if (!slot) return;
  if (!user) { slot.innerHTML = guestHTML(); return; }

  var page = currentPage();
  var admin = typeof isAdmin === 'function' && isAdmin(user);
  var item = function (href, key, iconName, label) {
    return '<li><a href="' + href + '"' + (page === key ? ' aria-current="page"' : '') + '>' + icon(iconName) + label + '</a></li>';
  };
  var status = typeof premiumStatus === 'function' ? premiumStatus(user) : { active: false };
  var daily = typeof dailyPreview === 'function' ? dailyPreview(user) : { available: false };
  var coinsLabel = '<span class="menu-label">Anime Coins</span><span class="menu-meta">' + (typeof formatCoins === 'function' ? formatCoins(user.coins) : '') + '</span>' +
    (daily.available ? '<span class="menu-dot" aria-hidden="true"></span><span class="sr-only"> (récompense du jour disponible)</span>' : '');
  updatePremiumNav(status.active);
  slot.innerHTML =
    '<button class="account-btn" type="button" data-account-toggle aria-expanded="false" aria-controls="account-menu">' +
      avatarHTML(user) +
      (daily.available ? '<span class="account-dot" aria-hidden="true"></span>' : '') +
      '<span class="account-name">' + escapeHTML(user.pseudo) + '</span>' +
      '<span class="sr-only">Menu du compte</span>' +
      icon('chevron-down') +
    '</button>' +
    '<div class="account-menu" id="account-menu" hidden>' +
      '<div class="account-menu-head"><strong>' + escapeHTML(user.pseudo) + '</strong><span>' + escapeHTML(user.email) + '</span></div>' +
      '<ul>' +
        item('wishboard.html', 'wishboard', 'sparkle', 'Wishboard') +
        item('profil.html?id=' + encodeURIComponent(user.id), 'profil', 'user', 'Mon profil public') +
        item('parametres.html', 'parametres', 'sliders', 'Paramètres') +
        (status.active ? item('mon-premium.html', 'mon-premium', 'crown', 'Mon Premium') : item('premium.html', 'premium', 'crown', 'Premium')) +
        item('coins.html', 'coins', 'coin', coinsLabel) +
        (admin ? item('admin.html', 'admin', 'shield', 'Administration') : '') +
        '<li class="menu-sep"><button type="button" class="menu-danger" data-logout>' + icon('logout') + 'Se déconnecter</button></li>' +
      '</ul>' +
    '</div>';
  setupAccountMenu(slot);
}

function updatePremiumNav(active) {
  var link = document.querySelector('.main-nav a[href="premium.html"], .main-nav a[href="mon-premium.html"]');
  if (!link) return;
  link.href = active ? 'mon-premium.html' : 'premium.html';
  link.textContent = active ? 'Mon Premium' : 'Premium';
  var current = currentPage() === (active ? 'mon-premium' : 'premium');
  if (current) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
}

function setupAccountMenu(slot) {
  var btn = slot.querySelector('[data-account-toggle]');
  var menu = slot.querySelector('#account-menu');
  if (!btn || !menu) return;
  function close(returnFocus) {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (returnFocus) btn.focus();
  }
  btn.addEventListener('click', function () {
    var open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) { var first = menu.querySelector('a, button'); if (first) first.focus(); }
  });
  slot.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !menu.hidden) { e.preventDefault(); close(true); }
  });
  document.addEventListener('click', function (e) {
    if (!menu.hidden && !slot.contains(e.target)) close(false);
  });
  slot.addEventListener('focusout', function (e) {
    if (!menu.hidden && e.relatedTarget && !slot.contains(e.relatedTarget)) close(false);
  });
  var logout = slot.querySelector('[data-logout]');
  if (logout) logout.addEventListener('click', async function () {
    logout.disabled = true;
    if (typeof logoutUser === 'function') await logoutUser();
    window.location.href = 'index.html';
  });
}

function setupSearchPanel(header) {
  var toggle = header.querySelector('[data-search-toggle]');
  var panel = header.querySelector('#site-search');
  if (!toggle || !panel) return;
  var input = panel.querySelector('input');
  function setOpen(open, returnFocus) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) input.focus();
    else if (returnFocus) toggle.focus();
  }
  toggle.addEventListener('click', function () { setOpen(panel.hidden, false); });
  panel.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false, true); }
  });
  input.addEventListener('input', function () { input.setCustomValidity(''); });
  panel.querySelector('form').addEventListener('submit', function (e) {
    var value = input.value.trim();
    if (value.length < 3) {
      e.preventDefault();
      input.setCustomValidity(value ? 'Saisis au moins 3 caractères (actuellement ' + value.length + ').' : 'Saisis le titre d\'un anime (3 caractères minimum).');
      input.reportValidity();
      return;
    }
    input.value = value;
  });
}

function setupHeaderScroll(header) {
  var onScroll = function () { header.classList.toggle('is-scrolled', window.scrollY > 8); };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function renderFooter() {
  var footer = document.querySelector('[data-site-footer]');
  if (!footer) return;
  var year = new Date().getFullYear();
  footer.innerHTML =
    '<div class="wrap">' +
      '<div class="footer-grid">' +
        '<div class="footer-brand">' + brandHTML() +
          '<p>Catalogue, calendrier de diffusion et suivi d\'animes. Les fiches proviennent d\'AniList. Aucun épisode n\'est hébergé ni diffusé sur le site : chaque fiche renvoie vers les plateformes officielles.</p>' +
        '</div>' +
        '<nav class="footer-col" aria-labelledby="footer-explore"><h2 id="footer-explore">Explorer</h2><ul>' +
          '<li><a href="wishboard.html">Wishboard</a></li>' +
          '<li><a href="catalogue.html">Catalogue</a></li>' +
          '<li><a href="calendrier.html">Calendrier</a></li>' +
          '<li><a href="simulcast.html">Simulcast</a></li>' +
          '<li><a href="premium.html">Premium</a></li>' +
        '</ul></nav>' +
        '<nav class="footer-col" aria-labelledby="footer-account"><h2 id="footer-account">Compte</h2><ul>' +
          '<li><a href="connexion.html">Connexion</a></li>' +
          '<li><a href="inscription.html">Créer un compte</a></li>' +
          '<li><a href="parametres.html">Paramètres</a></li>' +
        '</ul></nav>' +
        '<nav class="footer-col" aria-labelledby="footer-info"><h2 id="footer-info">Informations</h2><ul>' +
          '<li><a href="mentions-legales.html">Mentions légales et crédits</a></li>' +
          '<li><a href="confidentialite.html">Confidentialité et données</a></li>' +
          '<li><a href="conditions.html">Conditions d\'utilisation</a></li>' +
        '</ul></nav>' +
      '</div>' +
      '<div class="footer-bottom">' +
        '<span>© ' + year + ' LumaAnime. Tous droits réservés sur le design et le logo. Les visuels d\'animes appartiennent à leurs ayants droit.</span>' +
        '<span class="footer-heart">Fait avec ' + icon('heart') + '<span class="sr-only">amour</span></span>' +
      '</div>' +
    '</div>';
}

// Pages de connexion et d'inscription : mur d'affiches des animes du moment (données déjà en cache)
async function renderAuthWall() {
  var wall = document.querySelector('[data-auth-wall]');
  if (!wall || typeof loadHomeData !== 'function') return;
  try {
    var data = await loadHomeData();
    var seen = {};
    var covers = data.hero.media.concat(data.top.media, data.season.media).filter(function (m) {
      if (m.isAdult || seen[m.id] || !m.coverImage) return false;
      seen[m.id] = true;
      return true;
    }).map(function (m) { return safeImageUrl(m.coverImage.large); }).filter(Boolean).slice(0, 18);
    if (covers.length < 6) return;
    var cols = [[], [], []];
    covers.forEach(function (src, i) { cols[i % 3].push(src); });
    wall.innerHTML = cols.map(function (col) {
      var imgs = col.concat(col, col).map(function (src) { return '<img src="' + escapeHTML(src) + '" alt="" width="230" height="325" decoding="async">'; }).join('');
      return '<div class="auth-wall-col"><div class="auth-wall-track">' + imgs + '</div></div>';
    }).join('');
    requestAnimationFrame(function () { wall.classList.add('is-ready'); });
  } catch (e) {}
}

/* ---- Bandeau au-dessus du header (réglé dans le panel admin) ---- */
var BANNER_ANIMATIONS = ['none', 'fade', 'slide', 'marquee', 'pulse'];

function renderSiteBanner(cfg) {
  var header = document.querySelector('[data-site-header]');
  if (!header) return;
  var el = document.querySelector('[data-site-banner]');
  if (!cfg || !cfg.enabled || !String(cfg.text || '').trim()) { if (el) el.remove(); return; }
  var anim = BANNER_ANIMATIONS.indexOf(cfg.animation) !== -1 ? cfg.animation : 'none';
  var color = /^#[0-9a-f]{6}$/i.test(cfg.color || '') ? cfg.color : '#0d0d13';
  var bg = /^#[0-9a-f]{6}$/i.test(cfg.background || '') ? cfg.background : '#ff4d6d';
  var link = String(cfg.link || '');
  var safeLink = /^https?:\/\/[^\s"<>]+$/i.test(link) || /^[a-z0-9-]+\.html([?#][^\s"<>]*)?$/i.test(link) ? link : '';
  var text = '<span class="site-banner-text">' + escapeHTML(cfg.text) + '</span>';
  var inner = anim === 'marquee'
    ? '<span class="site-banner-track" aria-hidden="true">' + text + text + text + text + '</span><span class="sr-only">' + escapeHTML(cfg.text) + '</span>'
    : text;
  var html = safeLink
    ? '<a class="site-banner-link" href="' + escapeHTML(safeLink) + '"' + (cfg.new_tab ? ' target="_blank" rel="noopener"' : '') + '>' + inner + (cfg.new_tab ? '<span class="sr-only"> (nouvel onglet)</span>' : '') + '</a>'
    : '<p class="site-banner-link">' + inner + '</p>';
  if (!el) {
    el = document.createElement('div');
    el.setAttribute('data-site-banner', '');
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Annonce');
    header.parentNode.insertBefore(el, header);
  }
  el.className = 'site-banner site-banner--' + anim;
  el.style.setProperty('--banner-fg', color);
  el.style.setProperty('--banner-bg', bg);
  el.innerHTML = html;
}

renderHeader();
try { renderSiteBanner((JSON.parse(localStorage.getItem('lum_site_settings') || 'null') || {}).banner); } catch (e) {}

document.addEventListener('DOMContentLoaded', async function () {
  renderFooter();
  if (typeof loadSiteSettings === 'function') loadSiteSettings().then(function (cfg) {
    renderSiteBanner(cfg && cfg.banner);
    var tiers = cfg && cfg.coin_tiers;
    document.querySelectorAll('[data-coin-price]').forEach(function (el) {
      var price = tiers && Number(tiers[el.getAttribute('data-coin-price')]);
      if (price) el.textContent = 'ou dès ' + price.toLocaleString('fr-FR') + ' Anime Coins (30 jours)';
    });
  });
  renderAuthWall();
  var user = null;
  if (typeof getCurrentUser === 'function') {
    try { user = await getCurrentUser(); } catch (e) { user = null; }
  }
  renderAccount(user);
  if (user) {
    window.MyAnimesTheme.apply(user.settings);
    if (typeof cacheThemeForNextLoad === 'function') cacheThemeForNextLoad(user);
  }
  document.dispatchEvent(new CustomEvent('myanimes:user', { detail: user }));
});
