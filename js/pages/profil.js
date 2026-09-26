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
  var banner = safeImageUrl(p.bannerUrl);
  var joined = p.joinedAt ? new Date(p.joinedAt).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : '';
  document.title = p.pseudo + ' — profil LumaAnime';
  root.innerHTML =
    '<div class="profile-banner">' + (banner ? '<img src="' + escapeHTML(banner) + '" alt="">' : '') + '</div>' +
    '<div class="profile-bar"><div class="wrap">' +
      '<div class="profile-card">' +
        avatarHTML(p) +
        '<div>' +
          '<h1>' + escapeHTML(p.pseudo) + '</h1>' +
          (joined ? '<p class="profile-meta">Membre depuis ' + escapeHTML(joined) + '</p>' : '') +
          '<div class="badge-row">' +
            '<span class="badge badge--muted">' + (p.role === 'admin' ? 'Administrateur' : 'Membre') + '</span>' +
            (p.premium ? '<span class="badge badge--gold">' + icon('crown') + 'Premium</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div></div>';
});
