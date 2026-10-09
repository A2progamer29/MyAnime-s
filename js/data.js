/* =========================================================
   LumaAnime — data.js
   Accès aux données d'animes, partagé par toutes les pages et par l'écran de chargement.
   AniList (GraphQL, sans clé, environ 30 requêtes par minute et par visiteur) :
   requêtes groupées, dédoublonnées, mises en file d'attente et gardées en cache local.
   Synopsis français : /api/synopsis (traduction faite et mémorisée par le serveur).
   ========================================================= */

var ANILIST_URL = 'https://graphql.anilist.co';
var PREFERS_REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var CACHE_PREFIX = 'ma_';
var CACHE_TTL = 30 * 60 * 1000;

var MEDIA_FIELDS = 'id idMal title { romaji english native } coverImage { large extraLarge } bannerImage format status episodes duration season seasonYear averageScore genres isAdult';

/* ---- Cache local (localStorage, partagé entre onglets et visites) ---- */
function cacheGet(key, maxAge) {
  try {
    var raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    var entry = JSON.parse(raw);
    if (maxAge && Date.now() - entry.ts > maxAge) return null;
    return entry.data;
  } catch (e) { return null; }
}

function cachePrune(keepRatio) {
  try {
    var entries = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(CACHE_PREFIX) === 0) {
        var ts = 0;
        try { ts = JSON.parse(localStorage.getItem(k)).ts || 0; } catch (e) {}
        entries.push({ k: k, ts: ts });
      }
    }
    entries.sort(function (a, b) { return a.ts - b.ts; });
    var drop = Math.ceil(entries.length * (1 - keepRatio));
    entries.slice(0, drop).forEach(function (e) { localStorage.removeItem(e.k); });
  } catch (e) {}
}

function cacheSet(key, data) {
  var value = JSON.stringify({ ts: Date.now(), data: data });
  try { localStorage.setItem(CACHE_PREFIX + key, value); }
  catch (e) {
    cachePrune(0.4);
    try { localStorage.setItem(CACHE_PREFIX + key, value); } catch (e2) {}
  }
}

function hashText(text) {
  var h = 5381;
  for (var i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/* ---- Appels AniList ---- */
var anilistQueue = Promise.resolve();
var anilistInflight = {};

async function anilistRequest(query, variables, attempt) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, 12000);
  try {
    var res = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: query, variables: variables || {} }),
      signal: controller.signal
    });
    if (res.status === 429 && !attempt) {
      var wait = Math.min(Number(res.headers.get('Retry-After')) || 5, 15) * 1000;
      await new Promise(function (r) { setTimeout(r, wait); });
      return anilistRequest(query, variables, 1);
    }
    var json = await res.json();
    if (!res.ok || json.errors) throw new Error((json.errors && json.errors[0] && json.errors[0].message) || 'HTTP ' + res.status);
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

function anilist(query, variables, maxAge) {
  var key = 'al_' + hashText(query + JSON.stringify(variables || {}));
  var fresh = cacheGet(key, maxAge || CACHE_TTL);
  if (fresh) return Promise.resolve(fresh);
  if (anilistInflight[key]) return anilistInflight[key];
  var run = anilistQueue.then(function () { return anilistRequest(query, variables); });
  anilistQueue = run.catch(function () {}).then(function () { return new Promise(function (r) { setTimeout(r, 200); }); });
  anilistInflight[key] = run.then(function (data) {
    cacheSet(key, data);
    return data;
  }, function (err) {
    var stale = cacheGet(key, 0);
    if (stale) return stale;
    throw err;
  }).finally(function () { delete anilistInflight[key]; });
  return anilistInflight[key];
}

/* ---- Libellés en français ---- */
var EPISODE_KIND_FR = { episode: 'Épisode', special: 'Spécial', ova: 'OVA', ona: 'ONA', movie: 'Film', recap: 'Récapitulatif' };
var FORMAT_FR ={ TV: 'Anime', TV_SHORT: 'Série courte', MOVIE: 'Film', SPECIAL: 'Spécial', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Clip' };
var STATUS_FR = { FINISHED: 'Diffusion terminée', RELEASING: 'En cours de diffusion', NOT_YET_RELEASED: 'Pas encore diffusé', CANCELLED: 'Annulé', HIATUS: 'En pause' };
var SEASON_FR = { WINTER: 'Hiver', SPRING: 'Printemps', SUMMER: 'Été', FALL: 'Automne' };
var SOURCE_FR = { ORIGINAL: 'Œuvre originale', MANGA: 'Manga', LIGHT_NOVEL: 'Light novel', VISUAL_NOVEL: 'Visual novel', VIDEO_GAME: 'Jeu vidéo', NOVEL: 'Roman', WEB_NOVEL: 'Web novel', ANIME: 'Anime', MANHWA: 'Manhwa', MANHUA: 'Manhua', WEB_MANGA: 'Web manga', LIVE_ACTION: 'Film en prises de vue réelles', GAME: 'Jeu', COMIC: 'Comics', MULTIMEDIA_PROJECT: 'Projet multimédia', PICTURE_BOOK: 'Livre illustré', DOUJINSHI: 'Doujinshi', OTHER: 'Autre' };
var GENRE_FR = {
  Action: 'Action', Adventure: 'Aventure', Comedy: 'Comédie', Drama: 'Drame', Ecchi: 'Ecchi', Fantasy: 'Fantasy', Horror: 'Horreur',
  'Mahou Shoujo': 'Magical girl', Mecha: 'Mecha', Music: 'Musique', Mystery: 'Mystère', Psychological: 'Psychologique', Romance: 'Romance',
  'Sci-Fi': 'Science-fiction', 'Slice of Life': 'Tranche de vie', Sports: 'Sport', Supernatural: 'Surnaturel', Thriller: 'Thriller'
};

function typeFr(format) { return FORMAT_FR[format] || format || ''; }
function genreFr(name) { return GENRE_FR[name] || name; }
// Notes sur 100 (AniList donne directement une note de 0 à 100)
function scoreFr(score) { return String(Math.round(Number(score) || 0)); }
// Couleur : rouge en dessous de 40, orange de 40 à 69, vert à partir de 70
function scoreTone(score) { var n = Number(score) || 0; return n < 40 ? 'low' : n < 70 ? 'mid' : 'high'; }
function scoreHTML(score, source) {
  return '<span class="score score--' + scoreTone(score) + '">' + scoreFr(score) + '<span class="score-max">/100</span></span>' +
    '<span class="sr-only"> sur 100' + (source ? ' (' + source + ')' : '') + '</span>';
}
function truncate(text, max) {
  var t = String(text || '').trim();
  return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') + '…' : t;
}

// Les descriptions AniList contiennent un peu de HTML : on n'en garde que le texte
function htmlToText(html) {
  var source = String(html || '').replace(/<br\s*\/?>/gi, '\n');
  var text = new DOMParser().parseFromString('<body>' + source + '</body>', 'text/html').body.textContent || '';
  return text.replace(/\(Source:[^)]*\)\s*$/i, '').replace(/\n{3,}/g, '\n\n').trim();
}

// Titres en anglais quand AniList en connaît un, sinon en japonais romanisé
var MAL_BY_ID = {};
function rememberMalId(m) {
  if (m && m.id && m.idMal) MAL_BY_ID[Number(m.id)] = Number(m.idMal);
}

function toAnime(m) {
  rememberMalId(m);
  var cover = m.coverImage || {};
  var t = m.title || {};
  return {
    id: m.id,
    malId: m.idMal || null,
    title: t.english || t.romaji || 'Titre indisponible',
    titleRomaji: t.romaji,
    titleNative: t.native,
    image: safeImageUrl(cover.large || cover.extraLarge),
    imageLarge: safeImageUrl(cover.extraLarge || cover.large),
    banner: safeImageUrl(m.bannerImage),
    format: m.format,
    status: m.status,
    episodes: m.episodes,
    duration: m.duration,
    season: m.season,
    year: m.seasonYear,
    score: m.averageScore || null,
    genres: (m.genres || []).map(genreFr),
    isAdult: !!m.isAdult,
    description: m.description ? htmlToText(m.description) : ''
  };
}

function listAnime(a) {
  return { anilist_id: a.id, mal_id: a.malId, title: a.title, image: a.image };
}

function detailsHref(a) { return 'details.html?id=' + Number(a.id); }
function episodeHref(root, season, number) {
  return 'lecteur.html?id=' + Number(root) + '&season=' + Number(season) + '&episode=' + Number(number);
}
// avail = élément renvoyé par loadAvailability : on vise directement le premier épisode jouable.
// Sans épisode jouable confirmé, on renvoie vers la fiche (jamais vers un lecteur vide).
function watchHref(a, avail) {
  if (!avail || !avail.first || !(Number(avail.root) > 0)) return detailsHref(a);
  var season = avail.season !== null && avail.season !== undefined ? avail.season : avail.first.season;
  return episodeHref(avail.root, season, avail.first.number);
}

/* ---- Disponibilité des épisodes sur LumaAnime (fonction serveur, script SQL v14) ---- */
// Renvoie { id: { root, season, labels, first } } pour les animes jouables (un id absent = rien de jouable),
// ou null si la disponibilité n'a pas pu être vérifiée.
async function loadAvailability(ids) {
  if (typeof publicAvailableAnimes !== 'function') return null;
  try {
    var res = await publicAvailableAnimes(ids);
    if (!res || !res.ok) return null;
    var map = {};
    (res.items || []).forEach(function (it) {
      if (it && it.first && Number(it.root) > 0 && Number.isInteger(Number(it.first.number))) map[Number(it.anilist_id)] = it;
    });
    return map;
  } catch (e) { return null; }
}

/* ---- Saisons et semaines ---- */
var SEASON_KEYS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
function currentSeasonIndex() {
  var d = new Date();
  return d.getFullYear() * 4 + Math.floor(d.getMonth() / 3);
}
function seasonFromIndex(idx) { return { year: Math.floor(idx / 4), key: SEASON_KEYS[((idx % 4) + 4) % 4] }; }
function seasonLabel(idx) { var s = seasonFromIndex(idx); return SEASON_FR[s.key] + ' ' + s.year; }

function weekStart() {
  var d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
function todayIndex() { return (new Date().getDay() + 6) % 7; }

/* ---- Requêtes nommées (mêmes textes partout, donc même cache) ---- */
var HOME_QUERY = 'query ($season: MediaSeason, $year: Int) {' +
  ' hero: Page(perPage: 12) { media(type: ANIME, status: RELEASING, isAdult: false, sort: TRENDING_DESC) { ' + MEDIA_FIELDS + ' description(asHtml: false) } }' +
  ' top: Page(perPage: 12) { media(type: ANIME, isAdult: false, sort: SCORE_DESC) { ' + MEDIA_FIELDS + ' } }' +
  ' season: Page(perPage: 12) { media(type: ANIME, isAdult: false, season: $season, seasonYear: $year, sort: POPULARITY_DESC) { ' + MEDIA_FIELDS + ' } }' +
  ' }';

var homeDataPromise = null;
function loadHomeData() {
  if (!homeDataPromise) {
    var s = seasonFromIndex(currentSeasonIndex());
    homeDataPromise = anilist(HOME_QUERY, { season: s.key, year: s.year })
      .catch(function (err) { homeDataPromise = null; throw err; });
  }
  return homeDataPromise;
}

var IDS_QUERY = 'query ($ids: [Int]) { Page(perPage: 50) { media(type: ANIME, id_in: $ids, isAdult: false) { ' + MEDIA_FIELDS + ' } } }';
function loadAnimeByIds(ids) {
  return anilist(IDS_QUERY, { ids: ids }, CACHE_TTL);
}

var DAY_QUERY = 'query ($from: Int, $to: Int, $page: Int) { Page(page: $page, perPage: 50) { pageInfo { hasNextPage } airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) { airingAt episode media { ' + MEDIA_FIELDS + ' } } } }';
function loadDayData(dayIndex, page) {
  var start = weekStart();
  start.setDate(start.getDate() + dayIndex);
  var end = new Date(start);
  end.setDate(end.getDate() + 1);
  return anilist(DAY_QUERY, { from: Math.floor(start.getTime() / 1000) - 1, to: Math.floor(end.getTime() / 1000), page: page || 1 });
}

var SEASON_QUERY = 'query ($season: MediaSeason, $year: Int, $page: Int) { Page(page: $page, perPage: 24) { pageInfo { hasNextPage } media(type: ANIME, isAdult: false, season: $season, seasonYear: $year, sort: POPULARITY_DESC) { ' + MEDIA_FIELDS + ' } } }';
function loadSeasonData(index, page) {
  var s = seasonFromIndex(index);
  return anilist(SEASON_QUERY, { season: s.key, year: s.year, page: page || 1 });
}

var CATALOG_PAGE_SIZE = 24;
var CATALOG_QUERY = 'query ($page: Int, $search: String, $genres: [String], $tags: [String], $sort: [MediaSort]) { Page(page: $page, perPage: ' + CATALOG_PAGE_SIZE + ') { pageInfo { hasNextPage } media(type: ANIME, isAdult: false, search: $search, genre_in: $genres, tag_in: $tags, sort: $sort) { ' + MEDIA_FIELDS + ' } } }';
function loadCatalogData(opts) {
  return anilist(CATALOG_QUERY, {
    page: opts.page || 1,
    search: opts.search || null,
    genres: opts.genres && opts.genres.length ? opts.genres : null,
    tags: opts.tags && opts.tags.length ? opts.tags : null,
    sort: opts.sort || ['POPULARITY_DESC']
  });
}

var DETAIL_FIELDS = MEDIA_FIELDS + ' description(asHtml: false) source startDate { year month day } endDate { year month day }' +
  ' studios(isMain: true) { nodes { name } } tags { name rank isMediaSpoiler } nextAiringEpisode { episode airingAt }' +
  ' trailer { id site thumbnail } externalLinks { site url type } streamingEpisodes { title }';

async function fetchAnimeDetails(params) {
  var byMal = !params.get('id') && params.get('mal');
  var id = Number(byMal ? params.get('mal') : params.get('id'));
  if (!id || id < 1) return null;
  var data = await anilist(
    'query ($id: Int, $mal: Int) { Media(id: $id, idMal: $mal, type: ANIME) { ' + DETAIL_FIELDS + ' } }',
    byMal ? { mal: id } : { id: id },
    6 * 60 * 60 * 1000
  );
  return data.Media;
}

/* ---- Synopsis en français ---- */
var SYNOPSIS_TTL = 30 * 24 * 60 * 60 * 1000;
var synopsisInflight = {};

function synopsisServiceOff() {
  try { return Number(sessionStorage.getItem(CACHE_PREFIX + 'fr_off') || 0) > Date.now(); } catch (e) { return false; }
}

async function fetchSynopsisBatch(ids) {
  var out = {};
  try {
    var mal = ids.map(function (id) { return MAL_BY_ID[id] || 0; });
    var res = await fetch('/api/synopsis?ids=' + ids.join(',') + '&mal=' + mal.join(','), { headers: { Accept: 'application/json' } });
    if (res.status === 503 || res.status === 404) {
      try { sessionStorage.setItem(CACHE_PREFIX + 'fr_off', String(Date.now() + 10 * 60 * 1000)); } catch (e) {}
      return out;
    }
    if (!res.ok) return out;
    var data = await res.json();
    Object.keys(data.items || {}).forEach(function (id) {
      var text = data.items[id];
      if (typeof text === 'string' && text.trim()) { out[id] = text; cacheSet('fr_' + id, text); }
    });
  } catch (e) {}
  return out;
}

// Renvoie { id: texte français } pour les ids déjà traduits ou traduisibles ; les autres restent absents
async function frenchSynopses(ids) {
  var out = {};
  var missing = [];
  ids.forEach(function (id) {
    id = Number(id);
    if (!id) return;
    var cached = cacheGet('fr_' + id, SYNOPSIS_TTL);
    if (cached) out[id] = cached;
    else if (missing.indexOf(id) === -1) missing.push(id);
  });
  if (!missing.length || synopsisServiceOff()) return out;

  var waiting = [];
  var toFetch = missing.filter(function (id) {
    if (synopsisInflight[id]) { waiting.push(synopsisInflight[id].then(function (r) { if (r[id]) out[id] = r[id]; })); return false; }
    return true;
  });
  for (var i = 0; i < toFetch.length; i += 12) {
    var chunk = toFetch.slice(i, i + 12);
    var p = fetchSynopsisBatch(chunk);
    chunk.forEach(function (id) { synopsisInflight[id] = p; });
    waiting.push(p.then(function (r) { Object.keys(r).forEach(function (k) { out[k] = r[k]; }); }));
    p.finally(function () { chunk.forEach(function (id) { if (synopsisInflight[id] === p) delete synopsisInflight[id]; }); });
  }
  await Promise.all(waiting);
  return out;
}

// Affiche le synopsis français s'il existe, sinon le texte anglais d'AniList (signalé comme tel)
async function applyFrenchSynopsis(el, id, englishText, max, onDone) {
  if (!el) return;
  var fr = (await frenchSynopses([id]))[id];
  var text = fr || englishText || '';
  el.textContent = max ? truncate(text, max) : text;
  if (fr) el.setAttribute('lang', 'fr'); else el.setAttribute('lang', 'en');
  if (onDone) onDone(!!fr);
}
