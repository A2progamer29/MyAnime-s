/* =========================================================
   LumaAnime — pages/mon-premium.js
   Espace personnel des membres Premium
   ========================================================= */

document.addEventListener('myanimes:user', function (e) {
  var user = e.detail;
  var guard = document.querySelector('[data-mp-guard]');
  var statusEl = document.querySelector('[data-mp-status]');
  if (!guard) return;

  if (!user) {
    statusEl.textContent = 'Connecte-toi pour voir ton Premium.';
    guard.hidden = false;
    guard.innerHTML = '<div class="state">' + icon('user') + '<strong>Connexion nécessaire</strong>' +
      '<p>Ton espace Premium est lié à ton compte.</p>' +
      '<a class="btn btn-primary btn-sm" href="connexion.html?next=mon-premium.html">Se connecter</a></div>';
    return;
  }
  var status = premiumStatus(user);
  if (!status.active) { location.replace('premium.html'); return; }
  renderMyPremium(user, status);
}, { once: true });

function renderMyPremium(user, st) {
  var tier = st.tier;
  document.querySelector('[data-mp-content]').hidden = false;
  document.querySelector('[data-mp-title]').textContent = tier.name;
  document.querySelector('[data-mp-badge]').textContent = st.lifetime ? 'Premium à vie' : 'Premium actif';
  document.title = 'Mon Premium ' + tier.name + ' — LumaAnime';

  var statusEl = document.querySelector('[data-mp-status]');
  if (st.legacy) statusEl.textContent = 'Premium attribué avant le système de clés : aucune date d\'expiration n\'est enregistrée.';
  else if (st.lifetime) statusEl.textContent = 'Accès sans limite de durée' + (st.since ? ', activé le ' + formatDateFr(st.since) : '') + '.';
  else statusEl.textContent = 'Actif jusqu\'au ' + formatDateFr(st.until, true) + '.';

  var remaining = document.querySelector('[data-mp-remaining]');
  var remainingValue = document.querySelector('[data-mp-remaining-value]');
  var meter = document.querySelector('[data-mp-meter]');
  function tick() {
    var ms = st.until ? st.until.getTime() - Date.now() : null;
    remainingValue.textContent = formatRemaining(ms);
    if (st.until) {
      var start = st.since ? st.since.getTime() : st.until.getTime() - 30 * 86400000;
      var pct = Math.max(0, Math.min(100, (ms / (st.until.getTime() - start)) * 100));
      meter.style.width = pct + '%';
    }
    var factLeft = document.querySelector('[data-fact-left]');
    if (factLeft) factLeft.textContent = formatRemaining(ms);
  }
  remaining.hidden = !st.until;

  document.querySelector('[data-mp-facts]').innerHTML = [
    ['Niveau', tier.name],
    ['Activé le', st.since ? formatDateFr(st.since, false, true) : 'Non renseigné'],
    ['Expire le', st.until ? formatDateFr(st.until, false, true) : (st.legacy ? 'Non renseigné' : 'Jamais (à vie)')],
    ['Temps restant', '']
  ].map(function (f, i) {
    return '<li><span class="split-num"' + (i === 3 ? ' data-fact-left' : '') + '>' + escapeHTML(f[1]) + '</span><span class="split-label">' + f[0] + '</span></li>';
  }).join('');
  tick();
  setInterval(tick, 60000);

  document.querySelector('[data-mp-perks]').innerHTML = tier.perks.map(function (p) {
    return '<li>' + icon('check') + escapeHTML(p) + '</li>';
  }).join('');

  var infos = [];
  if (st.lifetime) {
    infos.push('Ton accès Soutien + n\'expire jamais.');
    infos.push('Les clés que tu achètes ne peuvent plus s\'activer sur ton compte : garde-les pour les offrir.');
  } else {
    infos.push('Le Premium n\'est jamais renouvelé automatiquement : sans nouvelle clé, il s\'arrête à la date d\'expiration.');
    infos.push('Pour prolonger, active une clé Soutien ou échange tes Anime Coins contre 30, 60 ou 90 jours : ils s\'ajoutent à ta date d\'expiration.');
    infos.push('Tu peux passer à Soutien + (à vie) à tout moment ; ton accès devient alors sans limite de durée.');
  }
  infos.push('Chaque clé ne fonctionne qu\'une seule fois, sur un seul compte.');
  infos.push('Le badge Premium apparaît sur ton profil public si celui-ci est visible.');
  document.querySelector('[data-mp-infos]').innerHTML = infos.map(function (t) { return '<li>' + escapeHTML(t) + '</li>'; }).join('');

  document.querySelector('[data-mp-actions]').innerHTML = st.lifetime
    ? '<a class="btn" href="parametres.html#premium">' + icon('key') + '<span>Activer une clé</span></a>'
    : '<a class="btn btn-primary" href="parametres.html#premium">' + icon('key') + '<span>Prolonger avec une clé</span></a>' +
      '<a class="btn" href="coins.html#boutique">' + icon('coin') + '<span>Prolonger avec mes Anime Coins</span></a>' +
      '<a class="btn btn-ghost" href="acheter.html?offre=soutien_plus">' + icon('crown') + '<span>Passer à Soutien +</span></a>';

  document.querySelector('[data-mp-gift]').innerHTML = Object.keys(PREMIUM_TIERS).map(function (k) {
    var t = PREMIUM_TIERS[k];
    return '<li><h3>' + escapeHTML(t.name) + '</h3>' +
      '<p class="plan-price">' + t.priceLabel.replace(' €', '€') + ' <small>/ ' + t.durationLabel + '</small></p>' +
      '<p>' + escapeHTML(t.perks.join(' · ')) + '</p>' +
      '<a class="btn" href="acheter.html?offre=' + k + '&amp;cadeau=1">' + icon('gift') + '<span>Offrir ' + escapeHTML(t.name) + '</span></a></li>';
  }).join('');

  loadMyKeys();
}

async function loadMyKeys() {
  var list = document.querySelector('[data-mp-keys]');
  var keys = await listMyKeys();
  list.innerHTML = keys.length
    ? keys.map(keyItemHTML).join('')
    : '<li class="state">' + icon('key') + '<strong>Aucune clé achetée</strong><p>Les clés que tu achètes pour toi ou pour offrir apparaîtront ici.</p></li>';
  renderPendingOrders(document.querySelector('[data-mp-pending]'), loadMyKeys);
}
