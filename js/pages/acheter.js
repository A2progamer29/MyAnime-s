/* =========================================================
   LumaAnime — pages/acheter.js
   Achat d'une clé Premium — étape 1 : options. Le paiement SumUp se fait sur paiement.html
   ========================================================= */

function checkoutTierKey() {
  var offre = new URLSearchParams(location.search).get('offre');
  return PREMIUM_TIERS[offre] ? offre : 'soutien';
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
  var cgv = form.elements.cgv;
  var delivery = form.elements.delivery;

  form.hidden = false;
  form.querySelector('[data-pay-label]').textContent = 'Continuer vers le paiement (' + tier.priceLabel + ')';
  gift.checked = new URLSearchParams(location.search).get('cadeau') === '1';
  if (status.active && status.lifetime) {
    gift.checked = true;
    gift.disabled = true;
    gift.closest('.check').insertAdjacentHTML('afterend', '<p class="field-hint">Tu as déjà Soutien + à vie : cette clé sera forcément à offrir.</p>');
  }
  [cgv, delivery].forEach(function (c) { c.addEventListener('change', function () { if (c.checked) setFieldError(c, ''); }); });

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
    // La commande est créée : la page de paiement la retrouve grâce à son numéro (rien de sensible dans l'adresse)
    try {
      sessionStorage.setItem('lum_checkout_' + start.orderId, JSON.stringify({ checkoutId: start.checkoutId, tier: tierKey, gift: gift.checked, amount: start.amount }));
    } catch (err) {}
    location.href = 'paiement.html?commande=' + encodeURIComponent(start.orderId);
  });
}, { once: true });
