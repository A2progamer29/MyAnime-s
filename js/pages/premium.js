/* =========================================================
   LumaAnime — pages/premium.js
   Page des offres : les membres Premium sont renvoyés vers leur espace
   ========================================================= */

document.addEventListener('myanimes:user', function (e) {
  var user = e.detail;
  if (user && premiumStatus(user).active) { location.replace('mon-premium.html'); return; }
  if (user) return;
  document.querySelectorAll('[data-premium-cta]').forEach(function (a) {
    var offer = a.getAttribute('data-premium-cta');
    a.href = 'connexion.html?next=' + encodeURIComponent('acheter.html?offre=' + offer);
    a.querySelector('[data-cta-label]').textContent = 'Se connecter pour acheter ' + PREMIUM_TIERS[offer].name;
  });
});
