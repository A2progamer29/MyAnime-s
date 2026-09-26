/* =========================================================
   LumaAnime — pages/acheter.js
   Achat d'une clé Premium via le formulaire de carte SumUp
   ========================================================= */

var SUMUP_SDK = 'https://gateway.sumup.com/gateway/ecom/card/v2/sdk.js';

function checkoutTierKey() {
  var offre = new URLSearchParams(location.search).get('offre');
  return PREMIUM_TIERS[offre] ? offre : 'soutien';
}

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

function renderCheckoutSummary(tierKey) {
  var t = PREMIUM_TIERS[tierKey];
  var other = tierKey === 'soutien' ? 'soutien_plus' : 'soutien';
  document.querySelector('[data-checkout-summary]').innerHTML =
    '<p class="eyebrow">Récapitulatif</p>' +
    '<h2 class="section-title">Clé ' + escapeHTML(t.name) + '</h2>' +
    '<p class="plan-price">' + t.priceLabel.replace(' €', '€') + ' <small>/ ' + t.durationLabel + '</small></p>' +
    '<ul class="perk-list">' + t.perks.map(function (p) { return '<li>' + icon('check') + escapeHTML(p) + '</li>'; }).join('') + '</ul>' +
    '<p class="field-hint">' + (t.durationDays ? 'La période de 30 jours commence quand la clé est activée, pas au moment de l\'achat.' : 'Accès sans limite de durée dès l\'activation de la clé.') + ' Paiement unique : aucun renouvellement automatique.</p>' +
    '<a class="link" href="acheter.html?offre=' + other + '">Choisir plutôt ' + escapeHTML(PREMIUM_TIERS[other].name) + '</a>';
  document.title = 'Acheter une clé ' + t.name + ' — LumaAnime';
}

document.addEventListener('myanimes:user', function (e) {
  var form = document.getElementById('checkout-form');
  if (!form) return;
  var tierKey = checkoutTierKey();
  var tier = PREMIUM_TIERS[tierKey];
  var user = e.detail;
  renderCheckoutSummary(tierKey);

  if (!user) {
    var guard = document.querySelector('[data-checkout-guard]');
    guard.hidden = false;
    guard.innerHTML = '<div class="state">' + icon('user') + '<strong>Connexion nécessaire</strong>' +
      '<p>La clé est rattachée à ton compte pour que tu puisses toujours la retrouver, même si tu l\'offres.</p>' +
      '<a class="btn btn-primary btn-sm" href="connexion.html?next=' + encodeURIComponent('acheter.html?offre=' + tierKey) + '">Se connecter pour acheter</a></div>';
    return;
  }

  var status = premiumStatus(user);
  var gift = form.elements.gift;
  var alertBox = form.querySelector('[data-form-alert]');
  var payBtn = form.querySelector('[data-pay-btn]');
  var reveal = document.querySelector('[data-key-reveal]');
  var cgv = form.elements.cgv;
  var delivery = form.elements.delivery;

  form.hidden = false;
  form.querySelector('[data-pay-label]').textContent = 'Payer ' + tier.priceLabel + ' avec SumUp';
  gift.checked = new URLSearchParams(location.search).get('cadeau') === '1';
  if (status.active && status.lifetime) {
    gift.checked = true;
    gift.disabled = true;
    gift.closest('.check').insertAdjacentHTML('afterend', '<p class="field-hint">Tu as déjà Soutien + à vie : cette clé sera forcément à offrir.</p>');
  }
  [cgv, delivery].forEach(function (c) { c.addEventListener('change', function () { if (c.checked) setFieldError(c, ''); }); });

  var orderId = null;

  async function finalize() {
    alertBox.textContent = '';
    var res = null;
    for (var attempt = 0; attempt < 6; attempt++) {
      res = await completeCheckout(orderId);
      if (res.ok || res.status !== 409) break;
      await new Promise(function (r) { setTimeout(r, 2500); });
    }
    if (!res.ok) {
      alertBox.textContent = (res.error || 'Le paiement n\'a pas pu être vérifié.') + ' Si ton compte a été débité, ta clé apparaîtra dans « Mes clés achetées » (Paramètres → Premium) dès que SumUp aura confirmé le paiement.';
      return;
    }
    document.getElementById('sumup-card').innerHTML = '';
    form.hidden = true;
    reveal.hidden = false;
    var code = formatKey(res.key);
    reveal.querySelector('[data-key-value]').textContent = code;
    reveal.querySelector('[data-copy-key]').addEventListener('click', function () { copyText(code); });
    var activate = reveal.querySelector('[data-activate-key]');
    var note = reveal.querySelector('[data-key-note]');
    if (gift.checked) {
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
    reveal.querySelector('h2').focus();
  }

  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    alertBox.textContent = '';
    setFieldError(cgv, cgv.checked ? '' : 'Accepte les conditions de vente pour continuer.');
    setFieldError(delivery, delivery.checked ? '' : 'Cette confirmation est nécessaire pour recevoir la clé immédiatement.');
    if (focusFirstInvalid(form)) return;

    setBusy(payBtn, true, 'Préparation du paiement…');
    var start = await startCheckout(tierKey);
    if (!start.ok) {
      setBusy(payBtn, false);
      alertBox.textContent = start.status === 404
        ? 'Le paiement en ligne n\'est pas encore activé sur le site. Réessaie plus tard.'
        : (start.error || 'Le paiement n\'a pas pu démarrer. Réessaie.');
      return;
    }
    orderId = start.orderId;
    try {
      await loadScriptOnce(SUMUP_SDK);
    } catch (err) {
      setBusy(payBtn, false);
      alertBox.textContent = 'Le formulaire de paiement SumUp n\'a pas pu se charger (bloqueur de publicité ou connexion ?). Désactive le bloqueur pour ce site puis réessaie.';
      return;
    }
    setBusy(payBtn, false);
    payBtn.hidden = true;
    [gift, cgv, delivery].forEach(function (c) { c.disabled = true; });
    announce('Formulaire de paiement SumUp affiché sous le récapitulatif.');
    window.SumUpCard.mount({
      id: 'sumup-card',
      checkoutId: start.checkoutId,
      locale: 'fr-FR',
      onResponse: function (type) {
        if (type === 'success') finalize();
        else if (type === 'error' || type === 'fail') alertBox.textContent = 'Le paiement a été refusé ou interrompu. Aucune clé n\'a été créée ; tu peux réessayer avec le formulaire ci-dessous.';
      }
    });
  });
}, { once: true });
