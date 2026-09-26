/* =========================================================
   LumaAnime — api.js
   Affichage des données d'animes (accueil, calendrier, saisons, fiche).
   Les requêtes et le cache sont dans data.js.
   ========================================================= */

/* ---- Gabarits ---- */
function animeCardHTML(a, i) {
  var meta = a.genres.slice(0, 2).concat(a.episodes ? [a.episodes + ' ép.'] : []).join(' · ');
  return '<li class="card" style="--i:' + (i % 12) + '">' +
    '<div class="card-media"><div class="card-poster">' +
      (a.image ? '<img src="' + escapeHTML(a.image) + '" alt="" loading="lazy" decoding="async" width="230" height="325">' : '<span class="card-placeholder">' + icon('image') + '</span>') +
      (a.format ? '<span class="card-type">' + escapeHTML(typeFr(a.format)) + '</span>' : '') +
      (a.score ? '<span class="card-score">' + icon('star', 'icon--fill') + scoreFr(a.score) + '<span class="sr-only"> sur 10</span></span>' : '') +
    '</div></div>' +
    '<div class="card-body">' +
      '<h3 class="card-title"><a class="card-link" href="' + detailsHref(a) + '">' + escapeHTML(a.title) + '</a></h3>' +
      (meta ? '<p class="card-meta">' + escapeHTML(meta) + '</p>' : '') +
    '</div>' +
    '<div class="card-actions">' + listToggleIconHTML('watchlist', listAnime(a)) + listToggleIconHTML('favorites', listAnime(a)) + '</div>' +
  '</li>';
}

function skeletonCardsHTML(count) {
  var out = '';
  for (var i = 0; i < count; i++) {
    out += '<li class="card skeleton-card" aria-hidden="true"><div class="skeleton skeleton-poster"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line skeleton-line--short"></div></li>';
  }
  return out;
}

function errorStateHTML(tag, message) {
  return '<' + tag + ' class="state state--error state--full" role="alert">' + icon('alert') +
    '<strong>Impossible de charger les données</strong>' +
    '<p>' + escapeHTML(message || 'Le service AniList ne répond pas ou limite temporairement les requêtes. Patiente une minute puis réessaie. Ton compte et tes listes ne sont pas concernés.') + '</p>' +
    '<button class="btn btn-sm" type="button" data-retry>' + icon('refresh') + '<span>Réessayer le chargement</span></button>' +
  '</' + tag + '>';
}

function renderLoadError(container, retryFn, message) {
  var tag = /^(UL|OL)$/.test(container.tagName) ? 'li' : 'div';
  container.removeAttribute('aria-busy');
  container.innerHTML = errorStateHTML(tag, message);
  container.querySelector('[data-retry]').addEventListener('click', retryFn);
}

function emptyStateHTML(tag, title, text) {
  return '<' + tag + ' class="state state--full">' + icon('search') + '<strong>' + escapeHTML(title) + '</strong><p>' + escapeHTML(text) + '</p></' + tag + '>';
}



var HERO_DELAY = 7000;
var HERO_COUNT = 10;

async function loadHero() {
  var hero = document.querySelector('[data-hero]');
  if (!hero) return;
  var slidesRoot = hero.querySelector('[data-hero-slides]');
  var indexRoot = hero.querySelector('[data-hero-index]');
  try {
    var data = await loadHomeData();
    var items = data.hero.media.map(toAnime).filter(function (a) { return a.imageLarge && !a.isAdult; }).slice(0, HERO_COUNT);
    if (!items.length) throw new Error('vide');

    slidesRoot.innerHTML = items.map(function (a, i) {
      return '<article class="hero-slide' + (i === 0 ? ' is-active' : '') + '" role="group" aria-roledescription="diapositive" aria-label="' + (i + 1) + ' sur ' + items.length + '"' + (i === 0 ? '' : ' inert') + '>' +
        '<div class="duotone" aria-hidden="true"><img src="' + escapeHTML(a.banner || a.imageLarge) + '" alt="" ' + (i === 0 ? 'fetchpriority="high"' : 'loading="lazy"') + ' draggable="false"></div>' +
        '<div class="wrap hero-inner">' +
          '<div class="hero-copy">' +
            '<p class="eyebrow">N°' + (i + 1) + ' des tendances en diffusion</p>' +
            '<h2 class="hero-title"><a href="' + detailsHref(a) + '">' + escapeHTML(a.title) + '</a></h2>' +
            '<ul class="chip-list">' +
              (a.format ? '<li class="chip">' + escapeHTML(typeFr(a.format)) + '</li>' : '') +
              (a.year ? '<li class="chip">' + Number(a.year) + '</li>' : '') +
              (a.score ? '<li class="chip chip--score">' + icon('star', 'icon--fill') + scoreFr(a.score) + '<span class="sr-only"> sur 10 sur AniList</span></li>' : '') +
              a.genres.slice(0, 2).map(function (g) { return '<li class="chip">' + escapeHTML(g) + '</li>'; }).join('') +
            '</ul>' +
            (a.description ? '<p class="hero-synopsis" data-hero-synopsis="' + Number(a.id) + '" lang="en">' + escapeHTML(truncate(a.description, 260)) + '</p>' : '') +
            '<div class="hero-actions">' +
              '<a class="btn btn-primary btn-lg" href="' + detailsHref(a) + '">Voir la fiche<span class="sr-only"> de ' + escapeHTML(a.title) + '</span>' + icon('arrow-right') + '</a>' +
              listToggleIconHTML('watchlist', listAnime(a)) +
            '</div>' +
          '</div>' +
          '<div class="hero-poster"><div class="poster-frame"><img src="' + escapeHTML(a.imageLarge) + '" alt="" ' + (i === 0 ? '' : 'loading="lazy"') + ' width="300" height="424" draggable="false"></div></div>' +
        '</div>' +
      '</article>';
    }).join('');

    indexRoot.innerHTML = items.map(function (a, i) {
      return '<li><button type="button" data-hero-go="' + i + '"' + (i === 0 ? ' aria-current="true"' : '') + '>' +
        '<span class="hero-index-num">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span class="hero-index-title" aria-hidden="true">' + escapeHTML(a.title) + '</span>' +
        '<span class="sr-only">Afficher la diapositive ' + (i + 1) + ' : ' + escapeHTML(a.title) + '</span>' +
        '<span class="hero-index-bar" aria-hidden="true"><span></span></span>' +
      '</button></li>';
    }).join('');

    setupHeroCarousel(hero, items.length);
    refreshListButtons();

    frenchSynopses(items.filter(function (a) { return a.description; }).map(function (a) { return a.id; })).then(function (fr) {
      Object.keys(fr).forEach(function (id) {
        var p = slidesRoot.querySelector('[data-hero-synopsis="' + Number(id) + '"]');
        if (p) { p.textContent = truncate(fr[id], 260); p.setAttribute('lang', 'fr'); }
      });
    });
  } catch (err) {
    renderLoadError(slidesRoot, loadHero);
  }
}

// Défilement automatique : suspendu au survol, au focus et pendant un glisser ; désactivé si les animations sont réduites.
// Bande des titres : glisser à la souris ou au doigt pour voir la suite. Diapositive : balayage au doigt.
function setupHeroCarousel(hero, count) {
  var slides = hero.querySelectorAll('.hero-slide');
  var buttons = hero.querySelectorAll('[data-hero-go]');
  var slidesRoot = hero.querySelector('[data-hero-slides]');
  var strip = hero.querySelector('[data-hero-index]');
  var index = 0;
  var playing = !PREFERS_REDUCED_MOTION;
  var held = false;
  var timer = null;
  var lastStripTouch = 0;

  hero.style.setProperty('--hero-delay', HERO_DELAY + 'ms');

  function revealActive() {
    if (Date.now() - lastStripTouch < 4000) return;
    var b = buttons[index];
    var sr = strip.getBoundingClientRect();
    var br = b.getBoundingClientRect();
    if (br.left < sr.left || br.right > sr.right) {
      strip.scrollTo({ left: strip.scrollLeft + (br.left - sr.left) - 12, behavior: PREFERS_REDUCED_MOTION ? 'auto' : 'smooth' });
    }
  }
  function show(i) {
    index = (i + count) % count;
    slides.forEach(function (s, n) {
      var active = n === index;
      s.classList.toggle('is-active', active);
      if (active) s.removeAttribute('inert'); else s.setAttribute('inert', '');
    });
    buttons.forEach(function (b, n) {
      if (n === index) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    revealActive();
    schedule();
  }
  function schedule() {
    clearTimeout(timer);
    var running = playing && !held;
    hero.classList.toggle('is-stopped', !playing);
    slidesRoot.setAttribute('aria-live', playing ? 'off' : 'polite');
    hero.classList.remove('is-running');
    if (running) {
      void hero.offsetWidth;
      hero.classList.add('is-running');
      timer = setTimeout(function () { show(index + 1); }, HERO_DELAY);
    }
  }
  function hold(value) { held = value; schedule(); }

  buttons.forEach(function (b) {
    b.addEventListener('click', function () { show(Number(b.getAttribute('data-hero-go'))); });
  });

  enableDragScroll(strip);
  ['pointerdown', 'wheel', 'touchstart'].forEach(function (type) {
    strip.addEventListener(type, function () { lastStripTouch = Date.now(); }, { passive: true });
  });
  strip.addEventListener('scroll', function () { if (strip.classList.contains('is-dragging')) lastStripTouch = Date.now(); }, { passive: true });

  var swipe = null;
  slidesRoot.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse') return;
    swipe = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  slidesRoot.addEventListener('pointerup', function (e) {
    if (!swipe || e.pointerId !== swipe.id) return;
    var dx = e.clientX - swipe.x;
    var dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) show(index + (dx < 0 ? 1 : -1));
  });
  slidesRoot.addEventListener('pointercancel', function () { swipe = null; });

  hero.addEventListener('mouseenter', function () { hold(true); });
  hero.addEventListener('mouseleave', function () { hold(hero.contains(document.activeElement)); });
  hero.addEventListener('focusin', function () { hold(true); });
  hero.addEventListener('focusout', function (e) { if (!hero.contains(e.relatedTarget)) hold(hero.matches(':hover')); });
  hero.addEventListener('touchstart', function () { hold(true); }, { passive: true });
  hero.addEventListener('touchend', function () { setTimeout(function () { hold(false); }, 3000); }, { passive: true });
  document.addEventListener('visibilitychange', function () { hold(document.hidden || hero.matches(':hover')); });

  show(0);
}

function viewsFr(n) { return Number(n).toLocaleString('fr-FR') + ' vue' + (n > 1 ? 's' : ''); }

async function topTenItems() {
  var ranked = [];
  try {
    var views = await topViewed(10);
    if (views.length) {
      var data = await loadAnimeByIds(views.map(function (v) { return Number(v.id); }));
      var byId = {};
      data.Page.media.forEach(function (m) { byId[m.id] = toAnime(m); });
      views.forEach(function (v) {
        var a = byId[v.id];
        if (a && !a.isAdult) ranked.push(Object.assign({}, a, { views: Number(v.views) || 0 }));
      });
    }
  } catch (e) {}
  if (ranked.length < 10) {
    var home = await loadHomeData();
    var seen = {};
    ranked.forEach(function (a) { seen[a.id] = true; });
    home.top.media.map(toAnime).forEach(function (a) {
      if (ranked.length < 10 && !a.isAdult && !seen[a.id]) ranked.push(a);
    });
  }
  return ranked.slice(0, 10);
}

function topBadgeHTML(a, chipClass) {
  if (a.views) return '<span class="' + chipClass + '">' + icon('eye') + viewsFr(a.views) + '</span>';
  if (a.score) return '<span class="' + chipClass + '">' + icon('star', 'icon--fill') + scoreFr(a.score) + '<span class="sr-only"> sur 10</span></span>';
  return '';
}

async function loadTop10() {
  var podium = document.querySelector('[data-top-podium]');
  var rest = document.querySelector('[data-top-list]');
  if (!podium) return;
  podium.setAttribute('aria-busy', 'true');
  try {
    var items = await topTenItems();
    podium.innerHTML = items.slice(0, 3).map(function (a, i) {
      return '<li class="podium-item">' +
        '<div class="poster-frame"><img src="' + escapeHTML(a.imageLarge) + '" alt="" loading="lazy" width="300" height="424"></div>' +
        '<div class="podium-body">' +
          '<span class="rank-num" aria-hidden="true">' + (i + 1) + '</span>' +
          '<h3><span class="sr-only">Numéro ' + (i + 1) + ' : </span><a href="' + detailsHref(a) + '">' + escapeHTML(a.title) + '</a></h3>' +
          '<p>' + escapeHTML([typeFr(a.format), a.year, a.episodes ? a.episodes + ' ép.' : null].filter(Boolean).join(' · ')) + '</p>' +
          topBadgeHTML(a, 'chip chip--score') +
        '</div>' +
      '</li>';
    }).join('');
    if (rest) rest.innerHTML = items.slice(3).map(function (a, i) {
      return '<li class="top-row">' +
        '<span class="rank-num" aria-hidden="true">' + (i + 4) + '</span>' +
        '<img src="' + escapeHTML(a.image) + '" alt="" loading="lazy" width="48" height="68">' +
        '<div><h3><span class="sr-only">Numéro ' + (i + 4) + ' : </span><a href="' + detailsHref(a) + '">' + escapeHTML(a.title) + '</a></h3>' +
        '<p>' + escapeHTML([typeFr(a.format), a.year].filter(Boolean).join(' · ')) + '</p></div>' +
        (topBadgeHTML(a, 'top-score') || '<span></span>') +
      '</li>';
    }).join('');
    podium.removeAttribute('aria-busy');
  } catch (err) {
    if (rest) rest.innerHTML = '';
    renderLoadError(podium, loadTop10);
  }
}

async function loadHomeSeason() {
  var grid = document.querySelector('[data-home-grid]');
  if (!grid) return;
  grid.setAttribute('aria-busy', 'true');
  grid.innerHTML = skeletonCardsHTML(12);
  try {
    var data = await loadHomeData();
    var items = data.season.media.map(toAnime).filter(function (a) { return !a.isAdult; });
    grid.innerHTML = items.length ? items.map(animeCardHTML).join('') : emptyStateHTML('li', 'Aucun anime trouvé', 'La saison en cours n\'est pas encore renseignée sur AniList.');
    grid.removeAttribute('aria-busy');
    refreshListButtons();
  } catch (err) {
    renderLoadError(grid, loadHomeSeason);
  }
}

/* ---- Accueil : reprendre la lecture ---- */
function formatMinSec(sec) {
  if (!sec || !isFinite(sec)) return '0:00';
  var m = Math.floor(sec / 60);
  return m + ':' + String(Math.floor(sec % 60)).padStart(2, '0');
}

function continueHref(item) {
  return 'lecteur.html?' + (item.src === 'anilist' ? 'id=' : 'mal=') + Number(item.id);
}

function renderContinueWatching(user) {
  var section = document.querySelector('[data-continue-section]');
  var list = document.querySelector('[data-continue-list]');
  if (!section || !list) return;
  var items = (user && user.continueWatching) || [];
  section.hidden = !items.length;
  if (!items.length) return;
  list.innerHTML = items.map(function (item) {
    var pct = item.duration ? Math.min(100, Math.round((item.currentTime / item.duration) * 100)) : 0;
    var img = safeImageUrl(item.image);
    var title = escapeHTML(item.title || 'Titre inconnu');
    return '<li class="continue-item">' +
      '<div class="continue-thumb">' +
        (img ? '<img src="' + escapeHTML(img) + '" alt="" loading="lazy">' : '') +
        icon('play', 'icon--fill') +
        '<span class="continue-progress" aria-hidden="true"><span style="width:' + pct + '%"></span></span>' +
      '</div>' +
      '<div class="continue-info">' +
        '<div><h3><a href="' + continueHref(item) + '">' + title + '</a></h3>' +
        '<p>Vidéo de démonstration · ' + formatMinSec(item.currentTime) + ' sur ' + formatMinSec(item.duration) + ' (' + pct + ' %)</p></div>' +
        '<button class="icon-btn" type="button" data-continue-remove="' + continueKey(item) + '" title="Retirer de la reprise">' + icon('x') + '<span class="sr-only">Retirer « ' + title + ' » de la reprise de lecture</span></button>' +
      '</div>' +
    '</li>';
  }).join('');
  list.querySelectorAll('[data-continue-remove]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      btn.setAttribute('aria-busy', 'true');
      var res = await removeContinueWatching(btn.getAttribute('data-continue-remove'));
      if (!res.ok) { btn.removeAttribute('aria-busy'); showToast('Impossible de retirer ce titre. Réessaie.', 'error'); return; }
      renderContinueWatching(await getCurrentUser());
      showToast('Titre retiré de la reprise de lecture.', 'success');
      var heading = document.getElementById('continue-title');
      if (heading) heading.focus();
    });
  });
}

/* ---- Calendrier : épisodes diffusés chaque jour, à l'heure locale ---- */
var WEEK_LABELS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
var TOKYO_TIME = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });
var LOCAL_TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });


function scheduleRowHTML(s, i) {
  var a = toAnime(s.media);
  var when = new Date(s.airingAt * 1000);
  var meta = ['Épisode ' + s.episode + (a.episodes ? ' sur ' + a.episodes : ''), typeFr(a.format)].filter(Boolean).join(' · ');
  return '<li class="schedule-row" style="--i:' + (i % 20) + '">' +
    '<div class="schedule-time"><strong><span class="sr-only">À </span>' + LOCAL_TIME.format(when) + '</strong><span>' + TOKYO_TIME.format(when) + ' au Japon</span></div>' +
    '<span class="schedule-node" aria-hidden="true"></span>' +
    (a.image ? '<img src="' + escapeHTML(a.image) + '" alt="" loading="lazy" width="52" height="74">' : '<span></span>') +
    '<div class="schedule-info">' +
      '<h3><a href="' + detailsHref(a) + '">' + escapeHTML(a.title) + '</a></h3>' +
      '<p>' + escapeHTML(meta) + '</p>' +
    '</div>' +
  '</li>';
}

async function loadDay(dayIndex, panel, page) {
  var list = panel.querySelector('.schedule');
  var more = panel.querySelector('[data-day-more]');
  page = page || 1;
  if (page === 1) {
    if (panel.getAttribute('data-loaded') === '1') return;
    list.setAttribute('aria-busy', 'true');
    list.innerHTML = '<li class="state state--full">' + icon('clock') + '<strong>Chargement du ' + WEEK_LABELS[dayIndex].toLowerCase() + '…</strong></li>';
  } else {
    setBusy(more, true, 'Chargement…');
  }
  try {
    var data = await loadDayData(dayIndex, page);
    var rows = data.Page.airingSchedules.filter(function (s) { return s.media && !s.media.isAdult; });
    var offset = page === 1 ? 0 : list.children.length;
    var html = rows.map(function (s, i) { return scheduleRowHTML(s, offset + i); }).join('');
    if (page === 1) list.innerHTML = html || emptyStateHTML('li', 'Aucune diffusion recensée', 'AniList ne liste aucun épisode diffusé ce jour-là.');
    else list.insertAdjacentHTML('beforeend', html);
    list.removeAttribute('aria-busy');
    panel.setAttribute('data-loaded', '1');
    panel.setAttribute('data-page', String(page));
    more.hidden = !data.Page.pageInfo.hasNextPage;
    if (page > 1) {
      setBusy(more, false);
      var first = list.children[offset];
      var link = first && first.querySelector('a');
      if (link) link.focus();
    }
  } catch (err) {
    if (page > 1) { setBusy(more, false); showToast('Impossible de charger la suite. Réessaie dans une minute.', 'error'); return; }
    panel.removeAttribute('data-loaded');
    renderLoadError(list, function () { loadDay(dayIndex, panel, 1); });
  }
}

function initCalendar() {
  var root = document.querySelector('[data-calendar]');
  if (!root) return;
  var today = todayIndex();
  var monday = weekStart();
  var dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

  var tabs = WEEK_LABELS.map(function (label, i) {
    var date = new Date(monday);
    date.setDate(monday.getDate() + i);
    return '<button class="tab" role="tab" type="button" id="day-tab-' + i + '" aria-controls="day-panel-' + i + '" aria-selected="' + (i === today) + '"' + (i === today ? ' aria-current="date"' : '') + '>' +
      '<span>' + label + '</span>' +
      '<span class="day-date">' + dateFmt.format(date).replace(/\.$/, '') + '</span>' +
    '</button>';
  }).join('');
  var panels = WEEK_LABELS.map(function (label, i) {
    return '<div class="tab-panel" role="tabpanel" id="day-panel-' + i + '" aria-labelledby="day-tab-' + i + '" tabindex="0" hidden>' +
      '<h2 class="sr-only">Épisodes diffusés le ' + label.toLowerCase() + '</h2>' +
      '<ol class="schedule"></ol>' +
      '<div class="load-more"><button class="btn" type="button" data-day-more hidden>Afficher plus de diffusions du ' + label.toLowerCase() + '</button></div>' +
    '</div>';
  }).join('');
  root.innerHTML = '<div class="tabs day-tabs" role="tablist" aria-label="Jour de la semaine">' + tabs + '</div>' + panels;

  root.querySelectorAll('[data-day-more]').forEach(function (btn, i) {
    btn.addEventListener('click', function () {
      var panel = document.getElementById('day-panel-' + i);
      loadDay(i, panel, Number(panel.getAttribute('data-page') || '1') + 1);
    });
  });

  initTabs(root.querySelector('[role="tablist"]'), {
    onSelect: function (tab) {
      var i = Number(tab.id.replace('day-tab-', ''));
      loadDay(i, document.getElementById('day-panel-' + i), 1);
    }
  });
}

/* ---- Saisons (page Simulcast) ---- */
var seasonState = { index: currentSeasonIndex(), page: 1 };

async function loadSeason(append) {
  var grid = document.querySelector('[data-season-grid]');
  var more = document.querySelector('[data-season-more]');
  var status = document.querySelector('[data-season-status]');
  if (!grid) return;
  seasonState.page = append ? seasonState.page + 1 : 1;
  if (!append) {
    grid.setAttribute('aria-busy', 'true');
    grid.innerHTML = skeletonCardsHTML(12);
    status.textContent = 'Chargement de la saison ' + seasonLabel(seasonState.index) + '…';
    more.hidden = true;
  } else setBusy(more, true, 'Chargement…');
  try {
    var data = await loadSeasonData(seasonState.index, seasonState.page);
    var items = data.Page.media.map(toAnime).filter(function (a) { return !a.isAdult; });
    var offset = append ? grid.querySelectorAll('.card').length : 0;
    var html = items.map(function (a, i) { return animeCardHTML(a, offset + i); }).join('');
    if (append) grid.insertAdjacentHTML('beforeend', html);
    else grid.innerHTML = html || emptyStateHTML('li', 'Aucun anime trouvé', 'AniList ne liste pas encore d\'anime pour cette saison.');
    var shown = grid.querySelectorAll('.card').length;
    status.textContent = seasonLabel(seasonState.index) + ' : ' + shown + ' anime' + (shown > 1 ? 's' : '') + ' affiché' + (shown > 1 ? 's' : '') + ', du plus au moins populaire.';
    if (append) { setBusy(more, false); var first = grid.querySelectorAll('.card')[offset]; if (first) first.querySelector('.card-link').focus(); }
    more.hidden = !data.Page.pageInfo.hasNextPage;
    grid.removeAttribute('aria-busy');
    refreshListButtons();
  } catch (err) {
    if (append) { seasonState.page -= 1; setBusy(more, false); showToast('Impossible de charger la suite. Réessaie dans une minute.', 'error'); return; }
    status.textContent = 'Le chargement a échoué.';
    renderLoadError(grid, function () { loadSeason(false); });
  }
}

function initSeasons() {
  var root = document.querySelector('[data-seasons]');
  if (!root) return;
  var label = root.querySelector('[data-season-label]');
  var prev = root.querySelector('[data-season-prev]');
  var next = root.querySelector('[data-season-next]');
  var current = root.querySelector('[data-season-current]');
  function render() {
    label.textContent = seasonLabel(seasonState.index);
    prev.querySelector('[data-nav-label]').textContent = seasonLabel(seasonState.index - 1);
    next.querySelector('[data-nav-label]').textContent = seasonLabel(seasonState.index + 1);
    current.hidden = seasonState.index === currentSeasonIndex();
    loadSeason(false);
  }
  prev.addEventListener('click', function () { seasonState.index -= 1; render(); });
  next.addEventListener('click', function () { seasonState.index += 1; render(); });
  current.addEventListener('click', function () { seasonState.index = currentSeasonIndex(); render(); label.focus(); });
  root.querySelector('[data-season-more]').addEventListener('click', function () { loadSeason(true); });
  render();
}

/* ---- Fiche anime ---- */
function fuzzyDate(d) {
  if (!d || !d.year) return '';
  if (!d.month) return String(d.year);
  return new Date(d.year, d.month - 1, d.day || 1).toLocaleDateString('fr-FR', d.day ? { day: 'numeric', month: 'long', year: 'numeric' } : { month: 'long', year: 'numeric' });
}


async function loadAnimeDetails() {
  var root = document.querySelector('[data-details]');
  if (!root) return;
  var params = new URLSearchParams(location.search);
  if (params.get('src') === 'partenaire') return loadPartnerDetails(root);
  var titleEl = root.querySelector('[data-d-title]');
  if (!params.get('id') && !params.get('mal')) { showDetailsProblem(root, 'Aucun anime n\'est indiqué dans l\'adresse de la page.'); return; }
  try {
    var m = await fetchAnimeDetails(params);
    if (!m) throw new Error('vide');
    var a = toAnime(m);
    if (a.isAdult) { showDetailsProblem(root, 'Cette fiche concerne un contenu réservé aux adultes et n\'est pas affichée sur LumaAnime.'); return; }

    if (params.get('mal')) history.replaceState(null, '', 'details.html?id=' + Number(a.id));
    document.title = a.title + ' — LumaAnime';
    titleEl.textContent = a.title;
    if (typeof trackTitleView === 'function') trackTitleView(a.id, a.title);
    root.querySelector('[data-d-crumb]').textContent = a.title;
    root.querySelector('[data-d-eyebrow]').textContent = [typeFr(a.format), STATUS_FR[a.status]].filter(Boolean).join(' · ');

    var alt = [];
    if (a.titleRomaji && a.titleRomaji !== a.title) alt.push('<span lang="ja-Latn">' + escapeHTML(a.titleRomaji) + '</span>');
    if (a.titleNative) alt.push('<span lang="ja">' + escapeHTML(a.titleNative) + '</span>');
    var altEl = root.querySelector('[data-d-alt]');
    altEl.innerHTML = alt.join(' · ');
    altEl.hidden = !alt.length;

    if (a.imageLarge) root.querySelector('[data-d-poster]').src = a.imageLarge;
    var backdrop = root.querySelector('[data-d-backdrop]');
    if (a.banner || a.imageLarge) backdrop.innerHTML = '<img src="' + escapeHTML(a.banner || a.imageLarge) + '" alt="">';

    var next = m.nextAiringEpisode;
    root.querySelector('[data-d-chips]').innerHTML = [
      a.season && a.year ? '<li class="chip">' + icon('calendar') + escapeHTML(SEASON_FR[a.season] + ' ' + a.year) + '</li>' : '',
      a.episodes ? '<li class="chip">' + icon('tv') + a.episodes + ' épisode' + (a.episodes > 1 ? 's' : '') + '</li>' : '',
      a.score ? '<li class="chip chip--score">' + icon('star', 'icon--fill') + scoreFr(a.score) + '<span class="sr-only"> sur 10</span> <span class="muted">(AniList)</span></li>' : '',
      next ? '<li class="chip">' + icon('clock') + 'Épisode ' + next.episode + ' le ' + escapeHTML(new Date(next.airingAt * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })) + '</li>' : ''
    ].join('');

    root.querySelector('[data-d-actions]').innerHTML =
      listToggleButtonHTML('watchlist', listAnime(a), 'btn-primary') +
      listToggleButtonHTML('favorites', listAnime(a)) +
      '<a class="btn btn-ghost" href="lecteur.html?id=' + Number(a.id) + '">' + icon('play', 'icon--fill') + '<span>Tester le lecteur (vidéo de démo)</span></a>';

    var synopsis = root.querySelector('[data-d-synopsis]');
    var langNote = root.querySelector('[data-d-lang-note]');
    if (a.description) {
      synopsis.textContent = 'Traduction du synopsis en cours…';
      synopsis.removeAttribute('lang');
      applyFrenchSynopsis(synopsis, a.id, a.description, 0, function (translated) {
        langNote.textContent = translated ? 'Synopsis traduit automatiquement de l\'anglais (source : AniList).' : 'Synopsis en anglais, fourni par AniList (traduction indisponible pour le moment).';
      });
    } else { synopsis.textContent = 'Aucun synopsis n\'est disponible pour ce titre sur AniList.'; synopsis.removeAttribute('lang'); langNote.hidden = true; }

    var tags = (m.tags || []).filter(function (t) { return !t.isMediaSpoiler && t.rank >= 60; }).slice(0, 5).map(function (t) { return t.name; });
    var aired = [fuzzyDate(m.startDate), fuzzyDate(m.endDate)].filter(Boolean);
    var facts = [
      ['Studio' + ((m.studios && m.studios.nodes.length > 1) ? 's' : ''), ((m.studios && m.studios.nodes) || []).map(function (s) { return s.name; }).join(', ')],
      ['Genres', a.genres.join(', ')],
      ['Thèmes', tags.join(', ')],
      ['Diffusion', aired.length === 2 && aired[0] !== aired[1] ? 'Du ' + aired[0] + ' au ' + aired[1] : (aired[0] ? 'Depuis le ' + aired[0] : '')],
      ['Format', typeFr(a.format)],
      ['Durée', a.duration ? a.duration + ' min par épisode' : ''],
      ['Source', SOURCE_FR[m.source] || ''],
      ['Note AniList', a.score ? scoreFr(a.score) + ' sur 10' : '']
    ].filter(function (f) { return f[1]; });
    root.querySelector('[data-d-facts]').innerHTML = facts.map(function (f) {
      return '<div><dt>' + escapeHTML(f[0]) + '</dt><dd>' + escapeHTML(f[1]) + '</dd></div>';
    }).join('');

    renderTrailer(root, m.trailer, a.title);
    renderWatchLinks(root, m.externalLinks);
    renderEpisodes(root, m, a);
    refreshListButtons();
  } catch (err) {
    titleEl.textContent = 'Fiche indisponible';
    renderLoadError(root.querySelector('[data-d-synopsis-block]'), function () { location.reload(); });
  }
}

// Bande-annonce : rien n'est chargé depuis YouTube avant le clic
function renderTrailer(root, trailer, title) {
  var block = root.querySelector('[data-d-trailer-block]');
  var box = root.querySelector('[data-d-trailer]');
  if (!block || !trailer || trailer.site !== 'youtube' || !/^[\w-]{6,20}$/.test(trailer.id || '')) return;
  var thumb = 'https://i.ytimg.com/vi/' + trailer.id + '/hqdefault.jpg';
  box.innerHTML = '<button class="trailer-facade" type="button">' +
    '<img src="' + thumb + '" alt="" loading="lazy" width="480" height="360">' +
    '<span class="trailer-play" aria-hidden="true">' + icon('play', 'icon--fill') + '</span>' +
    '<span class="sr-only">Lire la bande-annonce de ' + escapeHTML(title) + ' (YouTube)</span>' +
  '</button>';
  box.querySelector('button').addEventListener('click', function () {
    box.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + trailer.id + '?autoplay=1&amp;rel=0" title="Bande-annonce de ' + escapeHTML(title) + '" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>';
    box.querySelector('iframe').focus();
  });
  block.hidden = false;
}

function renderWatchLinks(root, links) {
  var block = root.querySelector('[data-d-watch-block]');
  var list = root.querySelector('[data-d-watch-links]');
  if (!block) return;
  var seen = {};
  var streaming = (links || []).filter(function (l) {
    if (l.type !== 'STREAMING' || !/^https:\/\//.test(l.url || '') || seen[l.site]) return false;
    seen[l.site] = true;
    return true;
  });
  if (!streaming.length) return;
  list.innerHTML = streaming.map(function (l) {
    return '<li><a class="btn btn-sm" href="' + escapeHTML(l.url) + '" target="_blank" rel="noopener noreferrer">' + icon('external') +
      '<span>' + escapeHTML(l.site) + '<span class="sr-only"> (s\'ouvre dans un nouvel onglet)</span></span></a></li>';
  }).join('');
  block.hidden = false;
}

function renderEpisodes(root, m, a) {
  var list = root.querySelector('[data-d-episodes]');
  var note = root.querySelector('[data-d-episodes-note]');
  var eps = (m.streamingEpisodes || []).map(function (e) { return e.title; }).filter(Boolean);
  if (eps.length) {
    list.innerHTML = eps.slice(0, 60).map(function (t, i) {
      return '<li><span class="episode-num">' + (i + 1) + '</span><span class="episode-title" lang="en">' + escapeHTML(t) + '</span></li>';
    }).join('');
    if (eps.length > 60) { note.hidden = false; note.textContent = 'Seuls les 60 premiers épisodes sont listés ici.'; }
    return;
  }
  var next = m.nextAiringEpisode;
  list.innerHTML = '<li><span class="episode-num">' + (a.episodes || '—') + '</span><span class="episode-title">' +
    (a.episodes ? 'épisode' + (a.episodes > 1 ? 's' : '') + ' au total' : 'Nombre d\'épisodes pas encore connu') +
    (next ? ' · prochain : épisode ' + next.episode + ' le ' + escapeHTML(new Date(next.airingAt * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })) : '') +
    '</span></li>';
}

/* ---- Fiche d'un titre du catalogue partenaire (source optionnelle) ---- */
async function loadPartnerDetails(root) {
  var id = new URLSearchParams(location.search).get('id') || '';
  if (!/^[\w-]{1,64}$/.test(id)) { showDetailsProblem(root, 'Aucun titre n\'est indiqué dans l\'adresse de la page.'); return; }
  try {
    var res = await fetch('/api/catalogue?id=' + encodeURIComponent(id), { headers: { Accept: 'application/json' } });
    var data = await res.json().catch(function () { return null; });
    if (res.status === 404) { showDetailsProblem(root, 'Ce titre n\'existe plus dans le catalogue partenaire.'); return; }
    if (!res.ok || !data || !data.item) throw new Error('HTTP ' + res.status);
    var item = data.item;
    var series = item.type === 'series';
    document.title = item.title + ' — LumaAnime';
    root.querySelector('[data-d-title]').textContent = item.title;
    root.querySelector('[data-d-crumb]').textContent = item.title;
    root.querySelector('[data-d-eyebrow]').textContent = [series ? 'Série' : 'Film', 'catalogue partenaire'].join(' · ');
    if (item.poster) root.querySelector('[data-d-poster]').src = item.poster;
    var backdrop = root.querySelector('[data-d-backdrop]');
    if (item.backdrop || item.poster) backdrop.innerHTML = '<img src="' + escapeHTML(item.backdrop || item.poster) + '" alt="">';
    root.querySelector('[data-d-chips]').innerHTML = [
      item.year ? '<li class="chip">' + icon('calendar') + item.year + '</li>' : '',
      series && item.seasons ? '<li class="chip">' + icon('tv') + item.seasons + ' saison' + (item.seasons > 1 ? 's' : '') + '</li>' : '',
      item.rating ? '<li class="chip chip--score">' + icon('star', 'icon--fill') + item.rating.toLocaleString('fr-FR') + '<span class="sr-only"> sur 10</span> <span class="muted">(TMDB)</span></li>' : ''
    ].join('');
    root.querySelector('[data-d-actions]').innerHTML = '<a class="btn" href="catalogue.html">' + icon('arrow-left') + '<span>Retour au catalogue</span></a>';
    var synopsis = root.querySelector('[data-d-synopsis]');
    synopsis.textContent = item.overview || 'Aucun résumé n\'est disponible pour ce titre.';
    synopsis.removeAttribute('lang');
    root.querySelector('[data-d-lang-note]').textContent = 'Résumé et affiche : TMDB, transmis par le catalogue partenaire.';
    root.querySelector('[data-d-facts]').innerHTML = [
      ['Type', series ? 'Série' : 'Film'],
      ['Année', item.year],
      ['Genres', item.genres.join(', ')],
      ['Note TMDB', item.rating ? item.rating.toLocaleString('fr-FR') + ' sur 10' : ''],
      ['Saisons', series ? item.seasons : ''],
      ['Épisodes', series ? item.episodes : '']
    ].filter(function (f) { return f[1]; }).map(function (f) {
      return '<div><dt>' + escapeHTML(f[0]) + '</dt><dd>' + escapeHTML(f[1]) + '</dd></div>';
    }).join('');
    root.querySelector('.detail-episodes').hidden = true;
  } catch (err) {
    root.querySelector('[data-d-title]').textContent = 'Fiche indisponible';
    renderLoadError(root.querySelector('[data-d-synopsis-block]'), function () { location.reload(); }, 'Le catalogue partenaire ne répond pas. Réessaie dans quelques minutes.');
  }
}

function showDetailsProblem(root, message) {
  root.innerHTML = '<div class="wrap adult-block"><div class="state">' + icon('info') +
    '<strong>Fiche non disponible</strong><p>' + escapeHTML(message) + '</p>' +
    '<a class="btn btn-sm" href="catalogue.html">Retourner au catalogue</a></div></div>';
  document.title = 'Fiche non disponible — LumaAnime';
}


/* ---- Accueil : images des genres (seulement celles présentes sur le serveur) ---- */
async function loadGenreBanners() {
  var tiles = document.querySelectorAll('.genre-tile');
  if (!tiles.length) return;
  var list = cacheGet('genre_banners', 10 * 60 * 1000);
  if (!list) {
    try {
      var res = await fetch('/api/genres', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      list = (await res.json()).banners || [];
      cacheSet('genre_banners', list);
    } catch (e) { return; }
  }
  tiles.forEach(function (tile) {
    var match = tile.className.match(/genre-tile--([a-z-]+)/);
    if (!match || list.indexOf(match[1]) === -1) return;
    tile.style.setProperty('--img', 'url("' + new URL('assets/' + match[1] + '-banner.png', location.href).href + '")');
  });
}

document.addEventListener('DOMContentLoaded', function () {
  loadGenreBanners();
  loadHero();
  loadTop10();
  loadHomeSeason();
  initCalendar();
  initSeasons();
  loadAnimeDetails();
});

document.addEventListener('myanimes:user', function (e) { renderContinueWatching(e.detail); });
