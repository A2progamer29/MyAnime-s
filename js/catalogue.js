/* =========================================================
   LumaAnime — catalogue.js
   Page Catalogue. Deux sources possibles :
   - 'anilist'    : animes d'AniList (source par défaut)
   - 'partenaire' : films et séries du catalogue UQFlex via /api/catalogue (métadonnées seulement)
   ========================================================= */

var CATALOG_SOURCE = 'anilist';

var CATALOG_SOURCES = {
  anilist: {
    lead: 'Recherche parmi les fiches d\'AniList, filtre par genre et trie les résultats. Ajoute tes coups de cœur à ta watchlist ou à tes favoris.',
    searchHint: 'De 2 à 100 caractères. Titres en anglais, en japonais romanisé ou en japonais.',
    placeholder: 'Par ex. Frieren, One Piece…',
    genresHint: 'Si tu coches plusieurs genres, seuls les animes qui ont tous ces genres s\'affichent.',
    note: 'Fiches, affiches et notes : AniList.',
    minSearch: 2,
    unit: 'anime',
    sorts: [
      { value: 'popularity', label: 'Popularité', text: 'popularité', sort: ['POPULARITY_DESC'] },
      { value: 'score', label: 'Mieux notés', text: 'note', sort: ['SCORE_DESC'] },
      { value: 'recent', label: 'Plus récents', text: 'date de sortie', sort: ['START_DATE_DESC'] },
      { value: 'title', label: 'Ordre alphabétique', text: 'ordre alphabétique', sort: ['TITLE_ENGLISH', 'TITLE_ROMAJI'] }
    ],
    filters: [
      ['g:Action', 'Action'], ['g:Adventure', 'Aventure'], ['g:Comedy', 'Comédie'], ['g:Drama', 'Drame'], ['g:Fantasy', 'Fantasy'],
      ['g:Horror', 'Horreur'], ['t:Isekai', 'Isekai'], ['g:Mecha', 'Mecha'], ['g:Mystery', 'Mystère'], ['g:Psychological', 'Psychologique'],
      ['g:Romance', 'Romance'], ['g:Sci-Fi', 'Science-fiction'], ['t:Seinen', 'Seinen'], ['t:Shounen', 'Shōnen'], ['g:Sports', 'Sport'],
      ['g:Supernatural', 'Surnaturel'], ['g:Slice of Life', 'Tranche de vie']
    ]
  },
  partenaire: {
    lead: 'Films et séries issus d\'un catalogue partenaire, affichés à titre d\'essai. Aucun titre n\'est lisible sur LumaAnime.',
    searchHint: '100 caractères maximum. Recherche dans les titres en français.',
    placeholder: 'Par ex. Creed, Dune…',
    genresHint: 'Si tu coches plusieurs genres, seuls les titres qui ont tous ces genres s\'affichent.',
    note: 'Affiches, résumés et notes : TMDB, transmis par le catalogue partenaire.',
    minSearch: 1,
    unit: 'titre',
    sorts: [
      { value: 'rating', label: 'Mieux notés', text: 'note' },
      { value: 'recent', label: 'Plus récents', text: 'année de sortie' },
      { value: 'title', label: 'Ordre alphabétique', text: 'ordre alphabétique' }
    ]
  }
};

var catalog = { q: '', type: 'all', filters: [], sort: '', page: 1, shown: CATALOG_PAGE_SIZE, items: null, request: 0, loading: false };

function catalogSource() { return CATALOG_SOURCES[CATALOG_SOURCE]; }
function foldText(value) { return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

function chipHTML(type, name, value, label, checked) {
  return '<label class="chip-check"><input type="' + type + '" name="' + name + '" value="' + escapeHTML(value) + '"' + (checked ? ' checked' : '') + '><span>' + escapeHTML(label) + '</span></label>';
}

/* ---- Adresse de la page ---- */
function splitParam(value) { return String(value || '').split(',').map(function (v) { return v.trim(); }).filter(Boolean); }

function readCatalogParams() {
  var p = new URLSearchParams(location.search);
  catalog.q = (p.get('q') || '').trim().slice(0, TEXT_RULES.search.max);
  catalog.type = ['movie', 'series'].indexOf(p.get('type')) !== -1 ? p.get('type') : 'all';
  if (CATALOG_SOURCE === 'anilist') {
    catalog.filters = splitParam(p.get('genre')).map(function (g) { return 'g:' + g; }).concat(splitParam(p.get('tag')).map(function (t) { return 't:' + t; }));
  } else {
    catalog.filters = splitParam(p.get('genre'));
  }
  var sorts = catalogSource().sorts.map(function (s) { return s.value; });
  catalog.sort = sorts.indexOf(p.get('sort')) !== -1 ? p.get('sort') : sorts[0];
}

function writeCatalogParams() {
  var p = new URLSearchParams();
  if (catalog.q) p.set('q', catalog.q);
  if (catalog.type !== 'all') p.set('type', catalog.type);
  if (CATALOG_SOURCE === 'anilist') {
    var g = catalog.filters.filter(function (f) { return f.indexOf('g:') === 0; }).map(function (f) { return f.slice(2); });
    var t = catalog.filters.filter(function (f) { return f.indexOf('t:') === 0; }).map(function (f) { return f.slice(2); });
    if (g.length) p.set('genre', g.join(','));
    if (t.length) p.set('tag', t.join(','));
  } else if (catalog.filters.length) {
    p.set('genre', catalog.filters.join(','));
  }
  if (catalog.sort !== catalogSource().sorts[0].value) p.set('sort', catalog.sort);
  var qs = p.toString();
  history.replaceState(null, '', 'catalogue.html' + (qs ? '?' + qs : ''));
}

function statusText(shown, sortValue, total) {
  var src = catalogSource();
  var sort = src.sorts.filter(function (s) { return s.value === sortValue; })[0];
  var unit = src.unit + (shown > 1 ? 's' : '');
  return shown + ' ' + unit + ' affiché' + (shown > 1 ? 's' : '') + (total ? ' sur ' + total.toLocaleString('fr-FR') : '') + ', triés par ' + sort.text + '.';
}

/* ---- Source AniList ---- */
async function loadAnilistCatalog(append) {
  var grid = document.querySelector('[data-catalog-grid]');
  var status = document.querySelector('[data-catalog-status]');
  var more = document.querySelector('[data-catalog-more]');
  var request = ++catalog.request;
  catalog.page = append ? catalog.page + 1 : 1;
  catalog.loading = true;
  grid.setAttribute('aria-busy', 'true');
  if (!append) { grid.innerHTML = skeletonCardsHTML(12); status.textContent = 'Chargement des résultats…'; more.hidden = true; }
  else setBusy(more, true, 'Chargement…');

  var sort = catalogSource().sorts.filter(function (s) { return s.value === catalog.sort; })[0];
  var genres = catalog.filters.filter(function (f) { return f.indexOf('g:') === 0; }).map(function (f) { return f.slice(2); });
  var tags = catalog.filters.filter(function (f) { return f.indexOf('t:') === 0; }).map(function (f) { return f.slice(2); });
  try {
    var data = await loadCatalogData({ page: catalog.page, search: catalog.q, genres: genres, tags: tags, sort: catalog.q && catalog.sort === 'popularity' ? ['SEARCH_MATCH', 'POPULARITY_DESC'] : sort.sort });
    if (request !== catalog.request) return;
    var items = data.Page.media.map(toAnime).filter(function (a) { return !a.isAdult; });
    var offset = append ? grid.querySelectorAll('.card:not(.skeleton-card)').length : 0;
    var html = items.map(function (a, i) { return animeCardHTML(a, offset + i); }).join('');
    if (append) grid.insertAdjacentHTML('beforeend', html);
    else grid.innerHTML = html || emptyStateHTML('li', 'Aucun résultat', catalog.q
      ? 'Aucun anime ne correspond à « ' + catalog.q + ' » avec ces filtres. Essaie un autre titre ou retire un filtre.'
      : 'Aucun anime ne correspond à ces filtres. Retire un genre pour élargir la recherche.');
    var shown = grid.querySelectorAll('.card:not(.skeleton-card)').length;
    status.textContent = shown ? statusText(shown, catalog.sort) : 'Aucun résultat.';
    more.hidden = !data.Page.pageInfo.hasNextPage;
    if (append) { setBusy(more, false); var first = grid.querySelectorAll('.card:not(.skeleton-card)')[offset]; if (first) first.querySelector('.card-link').focus(); }
    grid.removeAttribute('aria-busy');
    refreshListButtons();
  } catch (err) {
    if (request !== catalog.request) return;
    if (append) { catalog.page -= 1; setBusy(more, false); showToast('Impossible de charger plus de résultats. Réessaie dans une minute.', 'error'); grid.removeAttribute('aria-busy'); return; }
    status.textContent = 'Le chargement a échoué.';
    renderLoadError(grid, function () { loadAnilistCatalog(false); });
  } finally {
    if (request === catalog.request) catalog.loading = false;
  }
}

/* ---- Source partenaire ---- */
function partnerCardHTML(item, i) {
  var meta = [item.year].concat(item.genres.slice(0, 2)).filter(Boolean).join(' · ');
  return '<li class="card" style="--i:' + (i % 12) + '">' +
    '<div class="card-media"><div class="card-poster">' +
      (item.poster ? '<img src="' + escapeHTML(item.poster) + '" alt="" loading="lazy" decoding="async" width="342" height="513">' : '<span class="card-placeholder">' + icon('image') + '</span>') +
      '<span class="card-type">' + (item.type === 'series' ? 'Série' : 'Film') + '</span>' +
      (item.rating ? '<span class="card-score">' + scoreHTML(item.rating * 10, 'TMDB') + '</span>' : '') +
    '</div></div>' +
    '<div class="card-body">' +
      '<h3 class="card-title"><a class="card-link" href="details.html?src=partenaire&amp;id=' + encodeURIComponent(item.id) + '">' + escapeHTML(item.title) + '</a></h3>' +
      (meta ? '<p class="card-meta">' + escapeHTML(meta) + '</p>' : '') +
    '</div>' +
  '</li>';
}

async function fetchPartnerCatalog() {
  var cached = cacheGet('partner_catalog', 10 * 60 * 1000);
  if (cached) return cached;
  var res = await fetch('/api/catalogue', { headers: { Accept: 'application/json' } });
  var data = await res.json().catch(function () { return null; });
  if (!res.ok || !data || !Array.isArray(data.items)) throw new Error((data && data.error) || 'HTTP ' + res.status);
  cacheSet('partner_catalog', data.items);
  return data.items;
}

function partnerFiltered() {
  var q = foldText(catalog.q);
  var list = catalog.items.filter(function (item) {
    if (catalog.type !== 'all' && item.type !== catalog.type) return false;
    if (q && foldText(item.title).indexOf(q) === -1) return false;
    return catalog.filters.every(function (g) { return item.genres.indexOf(g) !== -1; });
  });
  var sorters = {
    rating: function (a, b) { return (b.rating || 0) - (a.rating || 0); },
    recent: function (a, b) { return (b.year || 0) - (a.year || 0); },
    title: function (a, b) { return a.title.localeCompare(b.title, 'fr'); }
  };
  return list.sort(sorters[catalog.sort] || sorters.rating);
}

function renderPartnerGenres() {
  var counts = {};
  catalog.items.forEach(function (item) { item.genres.forEach(function (g) { counts[g] = (counts[g] || 0) + 1; }); });
  var top = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 16).sort(function (a, b) { return a.localeCompare(b, 'fr'); });
  catalog.filters = catalog.filters.filter(function (g) { return top.indexOf(g) !== -1; });
  document.querySelector('[data-genre-options]').innerHTML = top.map(function (g) { return chipHTML('checkbox', 'genre', g, g, catalog.filters.indexOf(g) !== -1); }).join('');
}

function renderPartner(append) {
  var grid = document.querySelector('[data-catalog-grid]');
  var status = document.querySelector('[data-catalog-status]');
  var more = document.querySelector('[data-catalog-more]');
  var list = partnerFiltered();
  var offset = append ? grid.querySelectorAll('.card').length : 0;
  var html = list.slice(offset, catalog.shown).map(function (item, i) { return partnerCardHTML(item, offset + i); }).join('');
  if (append) grid.insertAdjacentHTML('beforeend', html);
  else grid.innerHTML = html || emptyStateHTML('li', 'Aucun résultat', 'Aucun titre ne correspond à ces filtres. Vérifie l\'orthographe ou retire un filtre.');
  var shown = Math.min(catalog.shown, list.length);
  status.textContent = list.length ? statusText(shown, catalog.sort, list.length) : 'Aucun résultat.';
  more.hidden = shown >= list.length;
  if (append) { var first = grid.querySelectorAll('.card')[offset]; if (first) first.querySelector('.card-link').focus(); }
  grid.removeAttribute('aria-busy');
}

async function loadPartner() {
  var grid = document.querySelector('[data-catalog-grid]');
  var status = document.querySelector('[data-catalog-status]');
  grid.setAttribute('aria-busy', 'true');
  grid.innerHTML = skeletonCardsHTML(12);
  status.textContent = 'Chargement du catalogue…';
  try {
    catalog.items = await fetchPartnerCatalog();
    renderPartnerGenres();
    syncFilterCount();
    renderPartner(false);
  } catch (err) {
    status.textContent = 'Le chargement a échoué.';
    renderLoadError(grid, loadPartner, 'Le catalogue partenaire ne répond pas. Réessaie dans quelques minutes.');
  }
}

/* ---- Interface commune ---- */
function syncFilterCount() {
  var n = catalog.filters.length + (catalog.type !== 'all' ? 1 : 0);
  document.querySelector('[data-filter-count]').textContent = n ? '(' + n + ' actif' + (n > 1 ? 's' : '') + ')' : '';
  document.querySelector('[data-filters-reset]').disabled = !n;
}

function refreshCatalog(append) {
  if (!append) { writeCatalogParams(); syncFilterCount(); catalog.shown = CATALOG_PAGE_SIZE; }
  if (CATALOG_SOURCE === 'partenaire') { if (catalog.items) renderPartner(append); }
  else loadAnilistCatalog(append);
}

function initCataloguePage() {
  var form = document.querySelector('[data-catalog-form]');
  if (!form) return;
  var src = catalogSource();
  readCatalogParams();

  var search = form.querySelector('#catalog-q');
  var sortSelect = form.querySelector('#catalog-sort');
  var drawer = document.querySelector('[data-filters-drawer]');
  var more = document.querySelector('[data-catalog-more]');

  document.querySelector('[data-catalog-lead]').textContent = src.lead;
  document.getElementById('catalog-q-hint').textContent = src.searchHint;
  document.querySelector('[data-genre-hint]').textContent = src.genresHint;
  document.querySelector('[data-list-note]').textContent = src.note;
  search.placeholder = src.placeholder;
  search.value = catalog.q;
  sortSelect.innerHTML = src.sorts.map(function (s) { return '<option value="' + s.value + '">' + s.label + '</option>'; }).join('');
  sortSelect.value = catalog.sort;
  more.textContent = 'Afficher 24 ' + src.unit + 's de plus';

  if (CATALOG_SOURCE === 'partenaire') {
    var typeBox = document.querySelector('[data-type-filter]');
    typeBox.hidden = false;
    typeBox.querySelector('[data-type-options]').innerHTML =
      chipHTML('radio', 'type', 'all', 'Tout', catalog.type === 'all') +
      chipHTML('radio', 'type', 'movie', 'Films', catalog.type === 'movie') +
      chipHTML('radio', 'type', 'series', 'Séries', catalog.type === 'series');
  } else {
    var known = src.filters.map(function (f) { return f[0]; });
    catalog.filters = catalog.filters.filter(function (f) { return known.indexOf(f) !== -1; });
    document.querySelector('[data-genre-options]').innerHTML = src.filters.map(function (f) {
      return chipHTML('checkbox', 'genre', f[0], f[1], catalog.filters.indexOf(f[0]) !== -1);
    }).join('');
  }
  if (catalog.q && catalog.q.length < src.minSearch) {
    setFieldError(search, 'Saisis au moins ' + src.minSearch + ' caractères pour lancer une recherche.');
    catalog.q = '';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var value = search.value.trim();
    if (value && value.length < src.minSearch) {
      setFieldError(search, 'Saisis au moins ' + src.minSearch + ' caractères pour lancer une recherche (actuellement ' + value.length + ').');
      search.focus();
      return;
    }
    setFieldError(search, '');
    catalog.q = value;
    refreshCatalog(false);
  });
  var timer = null;
  search.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      var value = search.value.trim();
      if (value === catalog.q || (value && value.length < src.minSearch)) return;
      setFieldError(search, '');
      catalog.q = value;
      refreshCatalog(false);
    }, CATALOG_SOURCE === 'partenaire' ? 250 : 600);
  });
  sortSelect.addEventListener('change', function () { catalog.sort = sortSelect.value; refreshCatalog(false); });
  form.addEventListener('change', function (e) {
    if (e.target.name === 'type') { catalog.type = e.target.value; refreshCatalog(false); }
    if (e.target.name === 'genre') {
      catalog.filters = Array.prototype.map.call(form.querySelectorAll('input[name="genre"]:checked'), function (i) { return i.value; });
      refreshCatalog(false);
    }
  });
  form.querySelector('[data-filters-reset]').addEventListener('click', function () {
    form.querySelectorAll('input[name="genre"]').forEach(function (i) { i.checked = false; });
    var all = form.querySelector('input[name="type"][value="all"]');
    if (all) all.checked = true;
    catalog.filters = [];
    catalog.type = 'all';
    refreshCatalog(false);
    search.focus();
  });
  more.addEventListener('click', function () {
    if (CATALOG_SOURCE === 'partenaire') { catalog.shown += CATALOG_PAGE_SIZE; renderPartner(true); }
    else if (!catalog.loading) loadAnilistCatalog(true);
  });

  var desktop = window.matchMedia('(min-width: 1024px)');
  function syncDrawer() { if (desktop.matches) drawer.open = true; }
  desktop.addEventListener('change', syncDrawer);
  syncDrawer();

  syncFilterCount();
  if (CATALOG_SOURCE === 'partenaire') loadPartner();
  else loadAnilistCatalog(false);
}

document.addEventListener('DOMContentLoaded', initCataloguePage);
