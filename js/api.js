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
      (a.score ? '<span class="card-score">' + scoreHTML(a.score) + '</span>' : '') +
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

/* ---- Disponibilité sur LumaAnime (épisodes jouables, langues) ---- */
function validLabels(labels) {
  return (Array.isArray(labels) ? labels : []).filter(function (l) { return typeof l === 'string' && l; });
}

// Badges de langue en liste (hors lien)
// counts/total (facultatifs) : nombre d'épisodes par langue ; une langue partielle affiche « VF · 3/12 ép. »
function langBadgesHTML(labels, labelledBy, counts, total) {
  var list = validLabels(labels);
  if (!list.length) return '';
  var all = Number(total) || 0;
  return '<ul class="lang-badges"' + (labelledBy ? ' aria-labelledby="' + escapeHTML(labelledBy) + '"' : '') + '>' +
    list.map(function (l) {
      var n = counts && Number(counts[l]);
      var partial = all > 1 && n > 0 && n < all;
      return '<li class="lang-badge">' + escapeHTML(l) +
        (partial ? '<span class="lang-badge-count" aria-hidden="true"> · ' + n + '/' + all + ' ép.</span><span class="sr-only"> (' + n + (n > 1 ? ' épisodes' : ' épisode') + ' sur ' + all + ')</span>' : '') +
        '</li>';
    }).join('') + '</ul>';
}

// Badges de langue à l'intérieur d'un lien : simples spans, séparateurs lus par les lecteurs d'écran
function langSpansHTML(labels) {
  var list = validLabels(labels);
  if (!list.length) return '';
  return '<span class="lang-badges"><span class="sr-only">, en </span>' +
    list.map(function (l) { return '<span class="lang-badge">' + escapeHTML(l) + '</span>'; }).join('<span class="sr-only"> ou </span>') + '</span>';
}

// Remplace un élément par du HTML en gardant le focus clavier s'il était dessus
function replaceKeepingFocus(el, html) {
  var tpl = document.createElement('template');
  tpl.innerHTML = html;
  var next = tpl.content.firstElementChild;
  if (!next) return;
  var focused = document.activeElement === el;
  el.replaceWith(next);
  if (focused) next.focus();
}

function heroWatchHTML(a, avail) {
  if (avail) {
    return '<a class="btn btn-primary btn-lg" href="' + escapeHTML(watchHref(a, avail)) + '" data-hero-watch="' + Number(a.id) + '">' + icon('play', 'icon--fill') + 'Regarder<span class="sr-only"> ' + escapeHTML(a.title) + '</span></a>';
  }
  return '<a class="btn btn-primary btn-lg" href="' + detailsHref(a) + '" data-hero-watch="' + Number(a.id) + '">' + icon('info') + 'Voir la fiche<span class="sr-only"> de ' + escapeHTML(a.title) + '</span></a>';
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
              (a.score ? '<li class="chip chip--score">' + scoreHTML(a.score, 'AniList') + '</li>' : '') +
              a.genres.slice(0, 2).map(function (g) { return '<li class="chip">' + escapeHTML(g) + '</li>'; }).join('') +
            '</ul>' +
            (a.description ? '<p class="hero-synopsis" data-hero-synopsis="' + Number(a.id) + '" lang="en">' + escapeHTML(truncate(a.description, 260)) + '</p>' : '') +
            '<div class="hero-actions">' +
              heroWatchHTML(a, null) +
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

    // « Regarder » seulement pour les animes qui ont un épisode jouable (un seul appel groupé)
    if (typeof loadAvailability === 'function') loadAvailability(items.map(function (a) { return a.id; })).then(function (avail) {
      if (!avail) return;
      items.forEach(function (a) {
        if (!avail[a.id]) return;
        var btn = slidesRoot.querySelector('[data-hero-watch="' + Number(a.id) + '"]');
        if (btn) replaceKeepingFocus(btn, heroWatchHTML(a, avail[a.id]));
      });
    });

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
        if (a && !a.isAdult) ranked.push(a);
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
  if (a.score) return '<span class="' + chipClass + '">' + scoreHTML(a.score) + '</span>';
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

// Saison 0 = épisodes spéciaux ; une entrée sans saison est en saison 1
function continueSeason(item) {
  var s = Number(item.season);
  return Number.isInteger(s) && s >= 0 && item.season !== null && item.season !== '' ? s : 1;
}

// Entrées AniList : ?id= ; anciennes entrées MyAnimeList : ?mal= (le lecteur retrouve la fiche AniList)
function continueHref(item) {
  var ep = Number(item.episode);
  return 'lecteur.html?' + (item.src === 'anilist' ? 'id=' : 'mal=') + Number(item.id) +
    (Number.isInteger(ep) && ep >= 0 && item.episode !== null && item.episode !== '' ? '&season=' + continueSeason(item) + '&episode=' + ep : '');
}

function continueEpisodeLabel(item) {
  var ep = Number(item.episode);
  if (!Number.isInteger(ep) || item.episode === null || item.episode === '') return '';
  var s = continueSeason(item);
  return (s === 0 ? 'Épisode spécial ' + ep : 'Saison ' + s + ' · Épisode ' + ep);
}

function renderContinueWatching(user) {
  var section = document.querySelector('[data-continue-section]');
  var list = document.querySelector('[data-continue-list]');
  if (!section || !list) return;
  var items = (user && user.continueWatching) || [];
  section.hidden = !items.length;
  if (!items.length) return;
  list.innerHTML = items.map(function (item) {
    // Lecteur intégré (VOE, Vidmoly…) : position inconnue, on n'affiche que l'épisode
    var embed = item.embed === true;
    var current = Number(item.currentTime) || 0;
    var duration = Number(item.duration) || 0;
    var pct = !embed && duration ? Math.max(0, Math.min(100, Math.round((current / duration) * 100))) : 0;
    var img = safeImageUrl(item.image);
    var title = escapeHTML(item.title || 'Titre inconnu');
    var episode = continueEpisodeLabel(item);
    var detail = embed
      ? (episode || 'Reprendre la lecture')
      : (episode ? episode + ' · ' : '') + 'Reprise à ' + formatMinSec(current) + ' sur ' + formatMinSec(duration) + ' (' + pct + ' %)';
    return '<li class="continue-item' + (embed ? ' continue-item--embed' : '') + '">' +
      '<div class="continue-thumb">' +
        (img ? '<img src="' + escapeHTML(img) + '" alt="" loading="lazy">' : '') +
        icon('play', 'icon--fill') +
        (embed ? '' : '<span class="continue-progress" aria-hidden="true"><span style="width:' + pct + '%"></span></span>') +
      '</div>' +
      '<div class="continue-info">' +
        '<div><h3><a href="' + escapeHTML(continueHref(item)) + '">' + title + '</a></h3>' +
        '<p>' + escapeHTML(detail) + '</p></div>' +
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

/* ---- Fiche anime : likes et vues ---- */
function formatCount(n) { return Number(n || 0).toLocaleString('fr-FR'); }

async function setupAnimeStats(root, a) {
  if (typeof animeStats !== 'function') return;
  var btn = root.querySelector('[data-like]');
  var stats = await animeStats(a.id);
  if (!stats.ok) return;
  var chips = root.querySelector('[data-d-chips]');
  chips.insertAdjacentHTML('beforeend', '<li class="chip" data-views-chip>' + icon('eye') + '<span>' + formatCount(stats.views) + ' vue' + (stats.views > 1 ? 's' : '') + '</span></li>');
  function render() {
    btn.setAttribute('aria-pressed', String(!!stats.liked));
    btn.classList.toggle('is-liked', !!stats.liked);
    btn.querySelector('[data-like-label]').textContent = stats.liked ? 'J\'aime déjà' : 'J\'aime';
    btn.querySelector('[data-like-count]').textContent = formatCount(stats.likes);
    btn.setAttribute('aria-label', (stats.liked ? 'Retirer mon j\'aime' : 'J\'aime') + ' — ' + formatCount(stats.likes) + ' j\'aime pour ' + a.title);
  }
  render();
  btn.hidden = false;
  var busy = false;
  btn.addEventListener('click', async function () {
    if (busy) return;
    busy = true;
    var before = { liked: stats.liked, likes: stats.likes };
    stats.liked = !stats.liked;
    stats.likes += stats.liked ? 1 : -1;
    render();
    var res = await toggleAnimeLike(a.id, stats.liked);
    busy = false;
    if (!res.ok) { stats.liked = before.liked; stats.likes = before.likes; render(); showToast(res.error, 'warning'); return; }
    stats.liked = !!res.liked;
    stats.likes = Number(res.likes) || 0;
    render();
  });
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

    root.querySelector('[data-d-alt]').hidden = true;

    if (a.imageLarge) root.querySelector('[data-d-poster]').src = a.imageLarge;
    var backdrop = root.querySelector('[data-d-backdrop]');
    if (a.banner || a.imageLarge) backdrop.innerHTML = '<img src="' + escapeHTML(a.banner || a.imageLarge) + '" alt="">';

    var next = m.nextAiringEpisode;
    root.querySelector('[data-d-chips]').innerHTML = [
      a.season && a.year ? '<li class="chip">' + icon('calendar') + escapeHTML(SEASON_FR[a.season] + ' ' + a.year) + '</li>' : '',
      a.episodes ? '<li class="chip">' + icon('tv') + a.episodes + ' épisode' + (a.episodes > 1 ? 's' : '') + '</li>' : '',
      a.score ? '<li class="chip chip--score">' + scoreHTML(a.score) + ' <span class="muted">(AniList)</span></li>' : '',
      next ? '<li class="chip">' + icon('clock') + 'Épisode ' + next.episode + ' le ' + escapeHTML(new Date(next.airingAt * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })) + '</li>' : ''
    ].join('');

    root.querySelector('[data-d-actions]').innerHTML =
      detailWatchHTML(a, null, 'loading') +
      listToggleButtonHTML('watchlist', listAnime(a)) +
      listToggleButtonHTML('favorites', listAnime(a)) +
      '<button class="btn like-btn" type="button" data-like aria-pressed="false" hidden>' + icon('thumb-up') + '<span data-like-label>J\'aime</span><span class="like-count" data-like-count>0</span></button>';
    setupAnimeStats(root, a);

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
      ['Note AniList', a.score ? scoreFr(a.score) + '/100' : '']
    ].filter(function (f) { return f[1]; });
    root.querySelector('[data-d-facts]').innerHTML = facts.map(function (f) {
      return '<div><dt>' + escapeHTML(f[0]) + '</dt><dd>' + escapeHTML(f[1]) + '</dd></div>';
    }).join('');

    renderTrailer(root, m.trailer, a.title);
    renderWatchLinks(root, m.externalLinks);
    setupWatchAvailability(root, m, a);
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

// Bouton principal de la fiche. state : 'loading' (vérification en cours), 'error' (serveur muet) ou rien.
// Jamais de lien tant que la disponibilité n'est pas confirmée.
function detailWatchHTML(a, avail, state) {
  if (avail) {
    return '<a class="btn btn-primary" href="' + escapeHTML(watchHref(a, avail)) + '" data-d-watch>' + icon('play', 'icon--fill') + '<span>Regarder</span></a>';
  }
  if (state === 'loading') {
    return '<button class="btn btn-soon" type="button" data-d-watch aria-disabled="true"><span class="btn-spinner" aria-hidden="true"></span><span>Recherche des épisodes…</span></button>';
  }
  if (state === 'error') {
    return '<button class="btn btn-soon" type="button" data-d-watch aria-disabled="true">' + icon('alert') + '<span>Lecture indisponible</span>' +
      '<span class="sr-only"> : la liste des épisodes n\'a pas pu être vérifiée, recharge la page pour réessayer</span></button>';
  }
  return '<button class="btn btn-soon" type="button" data-d-watch aria-disabled="true">' + icon('clock') + '<span>Bientôt disponible</span>' +
    '<span class="sr-only"> : aucun épisode de « ' + escapeHTML(a.title) + ' » n\'est encore disponible sur LumaAnime</span></button>';
}

async function setupWatchAvailability(root, m, a) {
  var item = null;
  var seasons = null;
  try {
    var avail = await loadAvailability([a.id]);
    item = avail ? avail[a.id] || null : null;
    var slot = root.querySelector('[data-d-watch]');
    if (slot) replaceKeepingFocus(slot, detailWatchHTML(a, item, avail ? '' : 'error'));

    var langs = root.querySelector('[data-d-langs]');
    if (langs && item && validLabels(item.labels).length) {
      langs.innerHTML = '<span class="detail-langs-label" id="d-langs-label">Langues disponibles</span>' + langBadgesHTML(item.labels, 'd-langs-label', item.counts, item.total);
      langs.hidden = false;
    }

    if (item && typeof publicEpisodeList === 'function') {
      var res = await publicEpisodeList(item.root);
      if (res && res.ok && Array.isArray(res.seasons) && res.seasons.length) seasons = res.seasons;
    }
  } catch (err) { seasons = null; }
  renderEpisodes(root, m, a, seasons ? { seasons: seasons, avail: item } : null);
}

// Libellé d'un épisode : « Épisode 3 », « OVA 1 », « Spécial 2 »…
function episodeName(e) {
  return (EPISODE_KIND_FR[e.kind] || 'Épisode') + ' ' + Number(e.number);
}

function lumaEpisodeHTML(rootId, e) {
  var n = Number(e.number);
  var name = episodeName(e);
  var kind = e.kind && e.kind !== 'episode' && EPISODE_KIND_FR[e.kind] ? EPISODE_KIND_FR[e.kind] : '';
  var until = e.premium_until ? new Date(e.premium_until) : null;
  var untilText = until && !isNaN(until.getTime()) ? until.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : '';
  var lock = e.premium_until
    ? '<span class="episode-lock"' + (untilText ? ' title="Accès anticipé Premium jusqu\'au ' + escapeHTML(untilText) + '"' : '') + '>' + icon('lock') +
        '<span>Premium</span><span class="sr-only"> : accès anticipé' + (untilText ? ' jusqu\'au ' + escapeHTML(untilText) : '') + '</span></span>'
    : '';
  return '<li><a class="episode-link" href="' + escapeHTML(episodeHref(rootId, e.season, n)) + '">' +
    '<span class="episode-num" aria-hidden="true">' + n + '</span>' +
    '<span class="episode-title">' +
      (e.title ? '<span class="sr-only">' + escapeHTML(name) + ' : </span>' + escapeHTML(e.title) : escapeHTML(name)) +
      (e.title && kind ? ' <span class="episode-kind" aria-hidden="true">' + escapeHTML(kind) + '</span>' : '') +
    '</span>' +
    '<span class="episode-extra">' + langSpansHTML(e.labels) + lock + '</span>' +
  '</a></li>';
}

// Liste LumaAnime : épisodes jouables, par saison (saison 0 = spéciaux)
function renderLumaEpisodes(root, box, luma) {
  var item = luma.avail;
  var rootId = Number(item.root);
  var only = item.season !== null && item.season !== undefined ? Number(item.season) : null;
  var seasons = luma.seasons.filter(function (s) { return s && Array.isArray(s.episodes) && s.episodes.length; });
  var shown = only === null ? seasons : seasons.filter(function (s) { return Number(s.number) === only; });
  if (!shown.length) shown = seasons;
  if (!shown.length) return false;
  var headings = shown.length > 1 || Number(shown[0].number) !== 1;
  box.innerHTML = shown.map(function (s) {
    var num = Number(s.number);
    var id = 'episodes-season-' + num;
    var heading = (num === 0 ? 'Épisodes spéciaux' : 'Saison ' + num) + (s.title ? ' · ' + s.title : '');
    var eps = s.episodes.filter(function (e) { return e && Number.isInteger(Number(e.number)); });
    return '<div class="episode-season">' +
      (headings ? '<h3 class="episode-season-title" id="' + id + '">' + escapeHTML(heading) + '</h3>' : '') +
      '<ol class="episode-list episode-list--luma" aria-labelledby="' + (headings ? id : 'episodes-title') + '">' +
        eps.map(function (e) { return lumaEpisodeHTML(rootId, e); }).join('') +
      '</ol>' +
    '</div>';
  }).join('');
  box.hidden = false;

  var note = root.querySelector('[data-d-episodes-note]');
  if (note && only !== null && seasons.length > shown.length) {
    note.innerHTML = 'Cette fiche correspond à la saison ' + only + ' de la série. <a href="details.html?id=' + rootId + '">Voir toutes les saisons</a>';
    note.hidden = false;
  }
  return true;
}

function renderEpisodes(root, m, a, luma) {
  var list = root.querySelector('[data-d-episodes]');
  var note = root.querySelector('[data-d-episodes-note]');
  var box = root.querySelector('[data-d-luma-episodes]');
  if (luma && box && renderLumaEpisodes(root, box, luma)) {
    list.hidden = true;
    list.innerHTML = '';
    return;
  }
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
      item.rating ? '<li class="chip chip--score">' + scoreHTML(item.rating * 10) + ' <span class="muted">(TMDB)</span></li>' : ''
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
      ['Note TMDB', item.rating ? Math.round(item.rating * 10) + '/100' : ''],
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


/* ---- Accueil : images des genres (bannière AniList de l'anime le plus populaire du genre) ---- */
function loadGenreBanners() {
  var tiles = document.querySelectorAll('.genre-tile');
  if (tiles.length) loadGenreFallbacks(Array.prototype.slice.call(tiles));
}

async function loadGenreFallbacks(tiles) {
  var defs = [], vars = [], fields = [], variables = {};
  tiles.forEach(function (tile, i) {
    var params = new URL(tile.getAttribute('href'), location.href).searchParams;
    var genre = params.get('genre'), tag = params.get('tag');
    if (!genre && !tag) return;
    vars.push('$v' + i + ': String');
    variables['v' + i] = genre || tag;
    fields.push('g' + i + ': Page(perPage: 8) { media(type: ANIME, isAdult: false, sort: POPULARITY_DESC, ' + (genre ? 'genre' : 'tag') + ': $v' + i + ') { id bannerImage } }');
    defs.push(i);
  });
  if (!fields.length) return;
  try {
    var data = await anilist('query (' + vars.join(', ') + ') { ' + fields.join(' ') + ' }', variables);
    var used = {};
    defs.forEach(function (i) {
      var media = (data['g' + i] && data['g' + i].media) || [];
      var pick = media.filter(function (m) { return safeImageUrl(m.bannerImage) && !used[m.id]; })[0];
      if (!pick) return;
      used[pick.id] = true;
      tiles[i].style.setProperty('--img', 'url("' + safeImageUrl(pick.bannerImage) + '")');
    });
  } catch (e) {}
}

/* ---- Accueil : Coup de cœur (choisi dans le panel admin) ---- */
var FEATURED_ANCHORS = { after_hero: '[data-hero]', after_top: '[data-home-top]', after_season: '[data-home-season]', after_genres: '[data-home-genres]' };

async function loadFeatured() {
  var section = document.querySelector('[data-featured]');
  if (!section || typeof loadSiteSettings !== 'function') return;
  var cfg = ((await loadSiteSettings()) || {}).featured;
  if (!cfg || !cfg.enabled || !Number(cfg.anilist_id)) { section.hidden = true; return; }
  var anchor = document.querySelector(FEATURED_ANCHORS[cfg.position] || FEATURED_ANCHORS.after_top);
  if (anchor && anchor.nextElementSibling !== section) anchor.parentNode.insertBefore(section, anchor.nextElementSibling);
  var a = null;
  try { var m = await fetchAnimeDetails(new URLSearchParams('id=' + Number(cfg.anilist_id))); a = m && toAnime(m); } catch (e) { a = null; }
  if (!a || a.isAdult) { section.hidden = true; return; }

  var image = safeImageUrl(cfg.image) || a.imageLarge;
  var link = String(cfg.button_link || '');
  var href = /^https?:\/\/[^\s"<>]+$/i.test(link) || /^[a-z0-9-]+\.html([?#][^\s"<>]*)?$/i.test(link) ? link : detailsHref(a);
  var external = /^https?:\/\//i.test(href) && href.indexOf(location.origin) !== 0;
  var title = cfg.title || a.title;
  section.innerHTML =
    '<div class="wrap">' +
      '<div class="featured">' +
        '<div class="duotone" aria-hidden="true">' + (a.banner || a.imageLarge ? '<img src="' + escapeHTML(a.banner || a.imageLarge) + '" alt="" loading="lazy">' : '') + '</div>' +
        '<div class="featured-poster"><div class="poster-frame"><img src="' + escapeHTML(image) + '" alt="" loading="lazy" width="300" height="424"></div></div>' +
        '<div class="featured-copy">' +
          '<p class="eyebrow featured-eyebrow">' + icon('heart', 'icon--fill') + "Coup de cœur de l'équipe</p>" +
          '<h2 class="section-title featured-title" id="featured-title">' + escapeHTML(title) + '</h2>' +
          (cfg.title && cfg.title !== a.title ? '<p class="featured-anime"><a href="' + detailsHref(a) + '">' + escapeHTML(a.title) + '</a></p>' : '') +
          '<ul class="chip-list">' +
            (a.format ? '<li class="chip">' + escapeHTML(typeFr(a.format)) + '</li>' : '') +
            (a.year ? '<li class="chip">' + Number(a.year) + '</li>' : '') +
            (a.score ? '<li class="chip chip--score">' + scoreHTML(a.score) + '</li>' : '') +
          '</ul>' +
          '<p class="featured-desc" data-featured-desc' + (cfg.description ? '' : ' lang="en"') + '>' + escapeHTML(cfg.description || truncate(a.description || '', 420)) + '</p>' +
          '<div class="hero-actions">' +
            '<a class="btn btn-primary btn-lg" href="' + escapeHTML(href) + '"' + (external ? ' target="_blank" rel="noopener"' : '') + '>' + escapeHTML(cfg.button_label || 'Découvrir la fiche') + icon('arrow-right') + '</a>' +
            listToggleIconHTML('watchlist', listAnime(a)) +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  section.hidden = false;
  refreshListButtons();
  if (!cfg.description && a.description) {
    applyFrenchSynopsis(section.querySelector('[data-featured-desc]'), a.id, a.description, 420);
  }
}

document.addEventListener('DOMContentLoaded', function () {
  loadFeatured();
  loadGenreBanners();
  loadHero();
  loadTop10();
  loadHomeSeason();
  initCalendar();
  initSeasons();
  loadAnimeDetails();
});

document.addEventListener('myanimes:user', function (e) { renderContinueWatching(e.detail); });
