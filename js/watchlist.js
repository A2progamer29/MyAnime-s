/* =========================================================
   LumaAnime — watchlist.js
   Boutons watchlist / favoris et listes de la page Paramètres
   ========================================================= */

var LIST_LABELS = {
  watchlist: { icon: 'bookmark', add: 'Ajouter à ma watchlist', remove: 'Retirer de ma watchlist', short: 'Watchlist', added: 'Ajouté à ta watchlist.', removed: 'Retiré de ta watchlist.' },
  favorites: { icon: 'heart', add: 'Ajouter à mes favoris', remove: 'Retirer de mes favoris', short: 'Favoris', added: 'Ajouté à tes favoris.', removed: 'Retiré de tes favoris.' }
};

function animeDataAttrs(anime) {
  return ' data-anilist-id="' + (Number(anime.anilist_id) || '') + '" data-mal-id="' + (Number(anime.mal_id) || '') + '" data-title="' + escapeHTML(anime.title || '') + '" data-image="' + escapeHTML(safeImageUrl(anime.image)) + '"';
}

function listDataAttrs(kind, anime) {
  return ' data-list-toggle="' + kind + '"' + animeDataAttrs(anime);
}

function animeFromButton(btn) {
  return {
    anilist_id: Number(btn.getAttribute('data-anilist-id')) || null,
    mal_id: Number(btn.getAttribute('data-mal-id')) || null,
    title: btn.getAttribute('data-title'),
    image: btn.getAttribute('data-image')
  };
}

function savedItemHref(item) {
  return item.anilist_id ? 'details.html?id=' + Number(item.anilist_id) : 'details.html?mal=' + Number(item.mal_id);
}

// Variante icône (cartes) : bouton bascule avec aria-pressed, nom constant
function listToggleIconHTML(kind, anime) {
  var l = LIST_LABELS[kind];
  return '<button class="icon-btn" type="button" aria-pressed="false" title="' + l.add + '"' + listDataAttrs(kind, anime) + '>' +
    icon(l.icon) + '<span class="sr-only">' + l.short + ' : ' + escapeHTML(anime.title || '') + '</span>' +
  '</button>';
}

// Variante avec libellé (fiche, lecteur, héros) : le texte décrit l'action
function listToggleButtonHTML(kind, anime, extraClass) {
  var l = LIST_LABELS[kind];
  return '<button class="btn' + (extraClass ? ' ' + extraClass : '') + '" type="button" data-labelled' + listDataAttrs(kind, anime) + '>' +
    icon(l.icon) + '<span data-list-label>' + l.add + '</span>' +
  '</button>';
}

function setListButtonState(btn, active) {
  var l = LIST_LABELS[btn.getAttribute('data-list-toggle')];
  if (!l) return;
  if (btn.hasAttribute('data-labelled')) {
    btn.classList.toggle('is-active', active);
    var label = btn.querySelector('[data-list-label]');
    if (label) label.textContent = active ? l.remove : l.add;
  } else {
    btn.setAttribute('aria-pressed', String(active));
    btn.title = active ? l.remove : l.add;
  }
}

async function refreshListButtons(user) {
  if (user === undefined) user = typeof getCurrentUser === 'function' ? await getCurrentUser() : null;
  document.querySelectorAll('[data-list-toggle]').forEach(function (btn) {
    var kind = btn.getAttribute('data-list-toggle');
    var anime = animeFromButton(btn);
    var list = user ? (kind === 'watchlist' ? user.watchlist : user.favorites) || [] : [];
    setListButtonState(btn, list.some(function (a) { return sameAnime(a, anime); }));
  });
}
window.refreshListButtons = refreshListButtons;

document.addEventListener('click', async function (e) {
  var btn = e.target.closest('[data-list-toggle]');
  if (!btn) return;
  e.preventDefault();
  if (btn.getAttribute('aria-busy') === 'true') return;
  var kind = btn.getAttribute('data-list-toggle');
  var anime = animeFromButton(btn);
  if (!anime.anilist_id && !anime.mal_id) return;

  btn.setAttribute('aria-busy', 'true');
  var res = await toggleListItem(kind, anime);
  btn.removeAttribute('aria-busy');

  if (res.needsLogin) {
    var go = await confirmDialog({
      title: 'Connexion nécessaire',
      message: 'Pour enregistrer « ' + anime.title + ' » dans ' + (kind === 'watchlist' ? 'ta watchlist' : 'tes favoris') + ', connecte-toi ou crée un compte gratuit.',
      confirmLabel: 'Aller à la connexion',
      cancelLabel: 'Plus tard'
    });
    if (go) window.location.href = 'connexion.html?next=' + encodeURIComponent(currentRelativeUrl());
    return;
  }
  if (!res.ok) { showToast(res.error, 'error'); return; }
  refreshListButtons(await getCurrentUser());
  showToast(res.added ? LIST_LABELS[kind].added : LIST_LABELS[kind].removed, 'success');
  document.dispatchEvent(new CustomEvent('myanimes:lists-changed', { detail: { kind: kind } }));
});

document.addEventListener('myanimes:user', function (e) { refreshListButtons(e.detail); });

/* ---- Listes de la page Paramètres ---- */
function savedCardHTML(item, kind, index) {
  var l = LIST_LABELS[kind];
  var img = safeImageUrl(item.image);
  var title = escapeHTML(item.title || 'Titre inconnu');
  return '<li class="card" style="--i:' + index + '">' +
    '<div class="card-media"><div class="card-poster">' +
      (img ? '<img src="' + escapeHTML(img) + '" alt="" loading="lazy" decoding="async" width="225" height="318">' : '<span class="card-placeholder">' + icon('image') + '</span>') +
    '</div></div>' +
    '<div class="card-body"><h3 class="card-title"><a class="card-link" href="' + savedItemHref(item) + '">' + title + '</a></h3></div>' +
    '<div class="card-actions">' +
      '<button class="btn btn-danger btn-sm" type="button" data-remove-item="' + kind + '"' + animeDataAttrs(item) + '>' +
        icon('trash') + '<span>Retirer<span class="sr-only"> « ' + title + ' » ' + (kind === 'watchlist' ? 'de ma watchlist' : 'de mes favoris') + '</span></span>' +
      '</button>' +
    '</div>' +
  '</li>';
}

function renderSavedList(container, items, kind) {
  if (!container) return;
  if (!items || !items.length) {
    container.innerHTML = '<li class="state state--full">' + icon(LIST_LABELS[kind].icon) +
      '<strong>' + (kind === 'watchlist' ? 'Ta watchlist est vide' : 'Aucun favori pour le moment') + '</strong>' +
      '<p>Parcours le catalogue et utilise le bouton ' + (kind === 'watchlist' ? '« watchlist »' : '« favoris »') + ' sur une fiche pour l\'ajouter ici.</p>' +
      '<a class="btn btn-sm" href="catalogue.html">Parcourir le catalogue</a></li>';
    return;
  }
  container.innerHTML = items.map(function (item, i) { return savedCardHTML(item, kind, i); }).join('');
}

document.addEventListener('click', async function (e) {
  var btn = e.target.closest('[data-remove-item]');
  if (!btn) return;
  var kind = btn.getAttribute('data-remove-item');
  var container = btn.closest('[data-saved-list]');
  var anime = animeFromButton(btn);
  setBusy(btn, true, 'Retrait…');
  var res = await toggleListItem(kind, anime);
  if (!res.ok) { setBusy(btn, false); showToast(res.error || 'Impossible de retirer cet anime.', 'error'); return; }
  var items = Array.prototype.slice.call(container.querySelectorAll('[data-remove-item]'));
  var index = items.indexOf(btn);
  renderSavedList(container, res.list, kind);
  var next = container.querySelectorAll('[data-remove-item]')[Math.min(index, res.list.length - 1)];
  if (next) next.focus();
  else { var cta = container.querySelector('a'); if (cta) cta.focus(); }
  showToast('« ' + anime.title + ' » ' + (kind === 'watchlist' ? 'retiré de ta watchlist.' : 'retiré de tes favoris.'), 'success');
});
