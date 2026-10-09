/* =========================================================
   LumaAnime — pages/paiement.js
   Achat d'une clé Premium — étapes 2 et 3 : formulaire de carte SumUp, puis remise de la clé
   ========================================================= */

var SUMUP_SDK = 'https://gateway.sumup.com/gateway/ecom/card/v2/sdk.js';

function loadScriptOnce(src) {
  return new Promise(function (resolve, reject) {
    if (document.querySelector('script[src="' + src + '"]')) { resolve(); return; }
    var s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = function () { reject(new Error('sdk')); };
    document.head.appendChild(s);
  });
}

function setPayStep(n) {
  document.querySelectorAll('.checkout-stepper li').forEach(function (li, i) {
    if (i + 1 === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    li.classList.toggle('is-done', i + 1 < n);
  });
}

document.addEventListener('myanimes:user', async function (e) {
  var content = document.querySelector('[data-pay-content]');
  if (!content) return;
  var guard = document.querySelector('[data-pay-guard]');
  var orderId = new URLSearchParams(location.search).get('commande') || '';
  var order = null;
  try { order = JSON.parse(sessionStorage.getItem('lum_checkout_' + orderId) || 'null'); } catch (err) { order = null; }

  function stop(title, text, actions) {
    guard.hidden = false;
    guard.innerHTML = '<div class="state">' + icon('card') + '<strong>' + escapeHTML(title) + '</strong><p>' + escapeHTML(text) + '</p>' + actions + '</div>';
  }

  if (!e.detail) {
    stop('Connexion nécessaire', 'Connecte-toi pour reprendre ton paiement.', '<a class="btn btn-primary btn-sm" href="connexion.html?next=' + encodeURIComponent('acheter.html') + '">Se connecter</a>');
    return;
  }
  var tier = order && PREMIUM_TIERS[order.tier];
  if (!/^[0-9a-f-]{36}$/i.test(orderId) || !order || !order.checkoutId || !tier) {
    stop('Paiement introuvable', 'Cette session de paiement a expiré ou a été ouverte dans un autre onglet. Si ton compte a déjà été débité, ta clé apparaîtra dans « Mes clés achetées » (Paramètres → Premium).',
      '<div class="action-row"><a class="btn btn-primary btn-sm" href="acheter.html">Recommencer l\'achat</a><a class="btn btn-sm" href="parametres.html#premium">Mes clés achetées</a></div>');
    return;
  }

  var back = 'acheter.html?offre=' + encodeURIComponent(order.tier) + (order.gift ? '&cadeau=1' : '');
  document.querySelectorAll('[data-pay-back], [data-pay-back-crumb]').forEach(function (a) { a.href = back; });
  document.querySelector('[data-pay-recap]').innerHTML =
    '<p class="eyebrow">Ta commande</p>' +
    '<h2 class="section-title">Clé ' + escapeHTML(tier.name) + '</h2>' +
    '<p class="plan-price">' + escapeHTML(tier.priceLabel.replace(' €', '€')) + ' <small>/ ' + escapeHTML(tier.durationLabel) + '</small></p>' +
    '<ul class="perk-list">' + tier.perks.map(function (p) { return '<li>' + icon('check') + escapeHTML(p) + '</li>'; }).join('') + '</ul>' +
    '<p class="pay-recap-note">' + icon(order.gift ? 'gift' : 'user') + '<span>' + (order.gift ? 'Clé à offrir : elle ne sera pas activée sur ton compte.' : 'Tu pourras activer la clé sur ton compte juste après le paiement.') + '</span></p>';
  content.hidden = false;

  var alertBox = document.querySelector('[data-pay-alert]');
  var loading = document.querySelector('[data-pay-loading]');
  var panel = document.querySelector('[data-pay-panel]');
  var reveal = document.querySelector('[data-key-reveal]');

  async function finalize() {
    alertBox.textContent = '';
    loading.hidden = false;
    loading.textContent = 'Vérification du paiement auprès de SumUp…';
    var res = null;
    for (var attempt = 0; attempt < 6; attempt++) {
      res = await completeCheckout(orderId);
      if (res.ok || res.status !== 409) break;
      await new Promise(function (r) { setTimeout(r, 2500); });
    }
    loading.hidden = true;
    if (!res.ok) {
      alertBox.textContent = (res.error || 'Le paiement n\'a pas pu être vérifié.') + ' Si ton compte a été débité, ta clé apparaîtra dans « Mes clés achetées » (Paramètres → Premium) dès que SumUp aura confirmé le paiement.';
      return;
    }
    try { sessionStorage.removeItem('lum_checkout_' + orderId); } catch (err) {}
    document.getElementById('sumup-card').innerHTML = '';
    panel.hidden = true;
    reveal.hidden = false;
    setPayStep(3);
    var code = formatKey(res.key);
    reveal.querySelector('[data-key-value]').textContent = code;
    reveal.querySelector('[data-copy-key]').addEventListener('click', function () { copyText(code); });
    var activate = reveal.querySelector('[data-activate-key]');
    var note = reveal.querySelector('[data-key-note]');
    if (order.gift) {
      note.textContent = 'Transmets cette clé à la personne de ton choix : elle l\'activera dans Paramètres → Premium. Elle reste aussi visible dans tes clés achetées.';
    } else {
      activate.hidden = false;
      note.textContent = 'Tu peux l\'activer tout de suite ou plus tard : elle reste visible dans tes clés achetées.';
      activate.addEventListener('click', async function () {
        setBusy(activate, true, 'Activation…');
        var r = await redeemPremiumKey(res.key);
        if (!r.ok) { setBusy(activate, false); note.textContent = r.error; return; }
        activate.hidden = true;
        note.innerHTML = 'Premium activé ' + (r.until ? 'jusqu\'au ' + escapeHTML(formatDateFr(r.until)) : 'à vie') + ' ! <a class="link" href="mon-premium.html">Voir mon Premium</a>';
        renderAccount(await refreshedUser());
      });
    }
    reveal.querySelector('h1').focus();
  }

  try {
    await loadScriptOnce(SUMUP_SDK);
  } catch (err) {
    loading.hidden = true;
    alertBox.textContent = 'Le formulaire de paiement SumUp n\'a pas pu se charger (bloqueur de publicité ou connexion ?). Désactive le bloqueur pour ce site puis recharge la page.';
    return;
  }
  loading.hidden = true;
  window.SumUpCard.mount({
    id: 'sumup-card',
    checkoutId: order.checkoutId,
    locale: 'fr-FR',
    onResponse: function (type) {
      if (type === 'success') finalize();
      else if (type === 'error' || type === 'fail') alertBox.textContent = 'Le paiement a été refusé ou interrompu. Aucune clé n\'a été créée ; tu peux réessayer avec le formulaire ci-dessous.';
    }
  });
  document.getElementById('pay-title').focus();
}, { once: true });
