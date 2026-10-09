/* =========================================================
   LumaAnime — pages/wishboard.js
   Propositions d'animes et upvotes (sans compte pour voter, avec compte pour proposer)
   ========================================================= */

document.addEventListener('DOMContentLoaded', function () {
  var list = document.querySelector('[data-wish-list]');
  if (!list) return;

  var state = { items: [], status: 'all', sort: 'top', filter: '', user: null, pending: {} };
  var countEl = document.querySelector('[data-wish-count]');
  var STATUS = { pending: 'En attente', accepted: 'Accepté' };
  var SEARCH_QUERY = 'query ($q: String) { Page(perPage: 8) { media(search: $q, type: ANIME, isAdult: false, sort: SEARCH_MATCH) { id idMal title { romaji english native } coverImage { large extraLarge } format seasonYear episodes isAdult } } }';

  function plural(n, word) { return Number(n).toLocaleString('fr-FR') + ' ' + word + (n > 1 ? 's' : ''); }

  function sorted() {
    var q = state.filter.toLowerCase();
    var items = state.items.filter(function (w) {
      return (state.status === 'all' || w.status === state.status) && (!q || String(w.title).toLowerCase().indexOf(q) !== -1);
    });
    var by = {
      top: function (a, b) { return b.votes - a.votes || new Date(a.created_at) - new Date(b.created_at); },
      low: function (a, b) { return a.votes - b.votes || new Date(b.created_at) - new Date(a.created_at); },
      new: function (a, b) { return new Date(b.created_at) - new Date(a.created_at); },
      old: function (a, b) { return new Date(a.created_at) - new Date(b.created_at); }
    }[state.sort];
    return items.sort(by);
  }

  function voteButton(w) {
    var closed = w.status !== 'pending';
    var label = closed ? 'Votes fermés : anime accepté' : (w.voted ? 'Retirer mon vote pour ' : 'Voter pour ') + w.title;
    return '<button class="wish-vote' + (w.voted ? ' is-voted' : '') + '" type="button" data-wish-vote="' + escapeHTML(w.id) + '"' +
      ' aria-pressed="' + (w.voted ? 'true' : 'false') + '"' + (closed ? ' disabled' : '') + ' title="' + escapeHTML(closed ? 'Votes fermés' : (w.voted ? 'Retirer mon vote' : 'Voter')) + '">' +
      icon('arrow-up') + '<span class="wish-votes">' + Number(w.votes).toLocaleString('fr-FR') + '</span><span class="sr-only"> ' + escapeHTML(label) + '</span>' +
    '</button>';
  }

  function rankLabel(i) {
    return state.sort === 'top' && state.status !== 'accepted' && !state.filter ? i + 1 : 0;
  }

  function statusBadge(w) {
    return '<span class="badge ' + (w.status === 'accepted' ? 'badge--accent' : 'badge--muted') + '">' + (w.status === 'accepted' ? icon('check') : '') + escapeHTML(STATUS[w.status] || w.status) + '</span>';
  }

  // Les 5 premiers : présentation mise en avant
  function topItemHTML(w, i) {
    var img = safeImageUrl(w.image);
    var rank = rankLabel(i);
    var meta = [w.format ? typeFr(w.format) : '', w.year || ''].filter(Boolean).join(' · ');
    return '<li class="wish-top-item' + (w.status === 'accepted' ? ' is-accepted' : '') + (i === 0 ? ' is-first' : '') + '">' +
      '<a class="wish-top-poster" href="details.html?id=' + Number(w.anilist_id) + '" tabindex="-1" aria-hidden="true">' +
        (img ? '<img src="' + escapeHTML(img) + '" alt="" loading="lazy" width="230" height="325">' : '<span class="card-placeholder">' + icon('image') + '</span>') +
        (rank ? '<span class="wish-top-rank">' + rank + '</span>' : '') +
      '</a>' +
      '<div class="wish-top-body">' +
        (rank ? '<p class="eyebrow">N°' + rank + ' des souhaits</p>' : '') +
        '<h3 class="wish-top-title"><a href="details.html?id=' + Number(w.anilist_id) + '">' + escapeHTML(w.title) + '</a></h3>' +
        (meta ? '<p class="wish-meta">' + escapeHTML(meta) + '</p>' : '') +
        '<div class="wish-top-actions">' + voteButton(w) + statusBadge(w) + '</div>' +
      '</div>' +
    '</li>';
  }

  // À partir du 6e : la carte du catalogue, avec le bouton de vote dans ses actions
  function cardItemHTML(w, i) {
    var a = { id: w.anilist_id, malId: null, title: w.title, image: safeImageUrl(w.image), format: w.format, score: null, episodes: null,
      genres: [w.year ? String(w.year) : '', w.status === 'accepted' ? 'Accepté' : ''].filter(Boolean) };
    var rank = rankLabel(i);
    return animeCardHTML(a, i)
      .replace('<li class="card"', '<li class="card wish-card' + (w.status === 'accepted' ? ' is-accepted' : '') + '"')
      .replace('<div class="card-poster">', '<div class="card-poster">' + (rank ? '<span class="wish-card-rank">' + rank + '</span>' : ''))
      .replace('<div class="card-actions">', '<div class="card-actions">' + voteButton(w));
  }

  function render() {
    var items = sorted();
    var pendingCount = state.items.filter(function (w) { return w.status === 'pending'; }).length;
    var acceptedCount = state.items.length - pendingCount;
    countEl.textContent = plural(pendingCount, 'proposition') + ' en attente · ' + plural(acceptedCount, 'acceptée');
    if (!items.length) {
      list.innerHTML = '<p class="catalog-status">' + (state.items.length ? 'Aucune proposition ne correspond à ces filtres.' : 'Aucune proposition pour le moment. Sois le premier à proposer un anime !') + '</p>';
      return;
    }
    var top = items.slice(0, 5);
    var rest = items.slice(5);
    list.innerHTML =
      '<ol class="wish-top" aria-label="Les 5 premières propositions">' + top.map(topItemHTML).join('') + '</ol>' +
      (rest.length ? '<h3 class="wish-rest-title">Les autres propositions</h3><ul class="card-grid wish-grid" aria-label="Autres propositions">' +
        rest.map(function (w, j) { return cardItemHTML(w, j + 5); }).join('') + '</ul>' : '');
    if (typeof refreshListButtons === 'function') refreshListButtons();
  }

  async function load() {
    var res = await wishList();
    if (!res.ok) {
      list.innerHTML = '<p class="catalog-status">' + escapeHTML(res.error) + '</p>';
      countEl.textContent = '';
      return;
    }
    state.items = res.items;
    render();
  }

  list.addEventListener('click', async function (e) {
    var btn = e.target.closest('[data-wish-vote]');
    if (!btn || btn.disabled) return;
    var id = btn.getAttribute('data-wish-vote');
    if (state.pending[id]) return;
    var w = state.items.filter(function (x) { return x.id === id; })[0];
    if (!w) return;
    state.pending[id] = true;
    var before = { voted: w.voted, votes: w.votes };
    w.voted = !w.voted;
    w.votes += w.voted ? 1 : -1;
    render();
    var res = await wishVote(id, w.voted);
    delete state.pending[id];
    if (!res.ok) {
      w.voted = before.voted;
      w.votes = before.votes;
      render();
      showToast(res.error, 'warning');
      return;
    }
    w.voted = !!res.voted;
    w.votes = Number(res.votes) || 0;
    render();
    var again = list.querySelector('[data-wish-vote="' + id + '"]');
    if (again) again.focus();
  });

  document.querySelector('[data-wish-tabs]').addEventListener('click', function (e) {
    var tab = e.target.closest('[data-status]');
    if (!tab) return;
    state.status = tab.getAttribute('data-status');
    this.querySelectorAll('[data-status]').forEach(function (t) { t.setAttribute('aria-selected', String(t === tab)); });
    render();
  });
  document.querySelector('[data-wish-sort]').addEventListener('change', function () { state.sort = this.value; render(); });
  document.querySelector('[data-wish-filter]').addEventListener('input', function () { state.filter = this.value.trim(); render(); });

  /* ---- Proposer un anime ---- */
  var searchForm = document.querySelector('[data-wish-search]');
  var results = document.querySelector('[data-wish-results]');
  var status = document.querySelector('[data-wish-search-status]');
  var loginNote = document.querySelector('[data-wish-login]');
  var found = [];

  function existing(id) { return state.items.filter(function (w) { return w.anilist_id === id; })[0]; }

  function renderResults() {
    results.innerHTML = found.map(function (a, i) {
      var w = existing(a.id);
      var action = w
        ? '<span class="badge badge--muted">' + (w.status === 'accepted' ? 'Déjà accepté' : 'Déjà proposé') + '</span>'
        : (state.user
          ? '<button class="btn btn-primary btn-sm" type="button" data-wish-add="' + i + '">' + icon('plus') + '<span>Proposer</span></button>'
          : '<a class="btn btn-ghost btn-sm" href="connexion.html?next=wishboard.html">Se connecter pour proposer</a>');
      return '<li class="wish-result">' +
        (a.image ? '<img src="' + escapeHTML(a.image) + '" alt="" loading="lazy" width="48" height="68">' : '<span class="wish-result-noimg"></span>') +
        '<div class="wish-body"><strong>' + escapeHTML(a.title) + '</strong><span class="wish-meta">' + escapeHTML([typeFr(a.format), a.year].filter(Boolean).join(' · ')) + '</span></div>' +
        action +
      '</li>';
    }).join('');
  }

  searchForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var q = searchForm.elements.q.value.trim();
    if (q.length < 2) { status.textContent = 'Tape au moins 2 caractères.'; results.innerHTML = ''; return; }
    status.textContent = 'Recherche en cours…';
    results.innerHTML = '';
    try {
      var data = await anilist(SEARCH_QUERY, { q: q }, 10 * 60 * 1000);
      found = data.Page.media.map(toAnime).filter(function (a) { return !a.isAdult; });
    } catch (err) {
      status.textContent = 'AniList ne répond pas pour le moment. Réessaie dans un instant.';
      return;
    }
    status.textContent = found.length ? plural(found.length, 'résultat') + '.' : 'Aucun anime trouvé pour « ' + q + ' ».';
    renderResults();
  });

  results.addEventListener('click', async function (e) {
    var btn = e.target.closest('[data-wish-add]');
    if (!btn) return;
    var a = found[Number(btn.getAttribute('data-wish-add'))];
    if (!a) return;
    setBusy(btn, true, 'Envoi…');
    var res = await wishAdd({ id: a.id, title: a.title, image: a.image, year: a.year, format: a.format });
    if (!res.ok) { setBusy(btn, false); showToast(res.error, 'warning'); return; }
    if (res.existing) {
      showToast(res.status === 'pending' || res.status === 'accepted' ? '« ' + a.title + ' » est déjà sur le Wishboard.' : '« ' + a.title + ' » a déjà été examiné par l\'équipe.', 'warning');
    } else {
      showToast('« ' + a.title + ' » est proposé ! Ton vote est déjà compté.', 'success');
    }
    await load();
    renderResults();
  });

  document.addEventListener('myanimes:user', function (e) {
    state.user = e.detail || null;
    loginNote.hidden = !!state.user;
    if (found.length) renderResults();
    load();
  });
  loginNote.hidden = false;
  load();
});
