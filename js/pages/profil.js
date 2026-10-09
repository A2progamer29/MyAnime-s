/* =========================================================
   LumaAnime — pages/profil.js
   Profil public (identifiant dans l'adresse, jamais l'e-mail)
   ========================================================= */

document.addEventListener('DOMContentLoaded', async function () {
  var root = document.querySelector('[data-profile-root]');
  if (!root) return;
  var params = new URLSearchParams(location.search);

  function problem(title, text) {
    document.title = title + ' — LumaAnime';
    root.innerHTML = '<div class="wrap section"><div class="state">' + icon('user') +
      '<h1 class="section-title">' + escapeHTML(title) + '</h1><p>' + escapeHTML(text) + '</p>' +
      '<a class="btn btn-sm" href="index.html">Retourner à l\'accueil</a></div></div>';
  }

  if (!params.get('id')) {
    if (params.get('user')) problem('Lien de profil obsolète', 'Les profils ne sont plus identifiés par une adresse e-mail. Demande le nouveau lien à la personne concernée (Paramètres → Profil public).');
    else problem('Profil introuvable', 'Aucun profil n\'est indiqué dans l\'adresse de la page.');
    return;
  }

  var result = await fetchPublicProfile(params.get('id'));
  if (result.status === 'not-found') { problem('Profil introuvable', 'Ce profil n\'existe pas ou a été supprimé.'); return; }
  if (result.status === 'private') { problem('Ce profil est privé', 'Son propriétaire a choisi de ne pas le rendre public.'); return; }
  if (result.status !== 'ok') { problem('Profil indisponible', 'Le service de comptes ne répond pas. Réessaie dans quelques minutes.'); return; }

  var p = result.profile;
  var extras = (typeof publicProfileExtras === 'function' ? await publicProfileExtras(p.id) : null) || {};
  var badges = extras.badges || [];
  var shownBadges = badges.slice(0, 5);
  var banner = profileImageUrl(p.bannerUrl);
  var joined = p.joinedAt ? new Date(p.joinedAt).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : '';
  document.title = p.pseudo + ' — profil LumaAnime';
  root.innerHTML =
    '<div class="profile-banner">' + (banner ? '<img src="' + escapeHTML(banner) + '" alt="">' : '') + decorationBannerHTML(extras.decoration) + '</div>' +
    '<div class="profile-bar"><div class="wrap">' +
      '<div class="profile-card">' +
        decoratedAvatarHTML(p, extras.decoration) +
        '<div>' +
          '<h1>' + escapeHTML(p.pseudo) + '</h1>' +
          (joined ? '<p class="profile-meta">Membre depuis ' + escapeHTML(joined) + '</p>' : '') +
          '<div class="badge-row">' +
            '<span class="badge badge--muted">' + (p.role === 'admin' ? 'Administrateur' : 'Membre') + '</span>' +
            (p.premium ? '<span class="badge badge--gold">' + icon('crown') + 'Premium</span>' : '') +
          '</div>' +
          (badges.length ? '<div class="profile-badges" aria-label="Badges de succès">' + shownBadges.map(badgeHTML).join('') +
            (badges.length > 5 ? '<button class="profile-badges-more" type="button" data-badges-more aria-haspopup="dialog" title="Voir tous les badges">…<span class="sr-only"> voir les ' + badges.length + ' badges</span></button>' : '') +
          '</div>' : '') +
        '</div>' +
      '</div>' +
    '</div></div>';

  var more = root.querySelector('[data-badges-more]');
  if (more) more.addEventListener('click', function () {
    var dlg = document.createElement('dialog');
    dlg.className = 'dialog badges-dialog';
    dlg.setAttribute('aria-labelledby', 'badges-dialog-title');
    dlg.innerHTML = '<div class="dialog-body"><h2 class="dialog-title" id="badges-dialog-title">Badges de ' + escapeHTML(p.pseudo) + ' (' + badges.length + ')</h2>' +
      '<ul class="badges-all">' + badges.map(function (b) {
        return '<li>' + badgeHTML(b) + '<span class="badges-all-date">' + escapeHTML(new Date(b.obtained_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })) + '</span></li>';
      }).join('') + '</ul></div>' +
      '<div class="dialog-actions"><button class="btn btn-primary" type="button" data-close>Fermer</button></div>';
    document.body.appendChild(dlg);
    function close() { dlg.close(); }
    dlg.querySelector('[data-close]').addEventListener('click', close);
    dlg.addEventListener('close', function () { dlg.remove(); more.focus(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });
    dlg.showModal();
  });
});
