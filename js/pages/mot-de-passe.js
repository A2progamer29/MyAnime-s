/* =========================================================
   LumaAnime — pages/mot-de-passe.js
   Demande de lien de réinitialisation, puis choix du nouveau mot de passe
   ========================================================= */

document.addEventListener('DOMContentLoaded', function () {
  var requestForm = document.getElementById('reset-request-form');
  var updateForm = document.getElementById('reset-update-form');
  if (!requestForm || !updateForm) return;
  var title = document.querySelector('[data-reset-title]');
  var intro = document.querySelector('[data-reset-intro]');

  function showUpdateMode() {
    requestForm.hidden = true;
    updateForm.hidden = false;
    title.textContent = 'Choisis un nouveau mot de passe';
    intro.textContent = 'Le lien reçu par e-mail est valide. Saisis ton nouveau mot de passe deux fois pour le confirmer.';
    updateForm.elements.password.focus();
  }

  // Le lien est lu depuis l'adresse de départ : la bibliothèque Supabase l'efface de la barre d'adresse après l'avoir traité
  var hash = window.MA_INITIAL_HASH || location.hash || '';
  var query = new URLSearchParams(location.search);
  if (hash.indexOf('type=recovery') !== -1 || query.get('code')) showUpdateMode();
  if (hash.indexOf('error=') !== -1 || query.get('error')) {
    var params = new URLSearchParams(hash.indexOf('error=') !== -1 ? hash.slice(1) : location.search);
    var expired = params.get('error_code') === 'otp_expired' || /expired|invalid/i.test(params.get('error_description') || '');
    requestForm.querySelector('[data-form-alert]').textContent = expired
      ? 'Ce lien de réinitialisation a expiré ou a déjà été utilisé. Demande un nouveau lien ci-dessous : il arrive en quelques secondes.'
      : 'Ce lien de réinitialisation n\'est pas valide. Demande un nouveau lien ci-dessous.';
  }
  if (typeof sb !== 'undefined' && sb) {
    sb.auth.onAuthStateChange(function (event) { if (event === 'PASSWORD_RECOVERY') showUpdateMode(); });
  }

  var email = requestForm.elements.email;
  email.addEventListener('input', function () { if (email.getAttribute('aria-invalid')) setFieldError(email, ''); });
  requestForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var alertBox = requestForm.querySelector('[data-form-alert]');
    var submit = requestForm.querySelector('[type="submit"]');
    alertBox.textContent = '';
    alertBox.classList.remove('form-alert--success');
    setFieldError(email, validateEmail(email.value));
    if (focusFirstInvalid(requestForm)) return;
    setBusy(submit, true, 'Envoi du lien…');
    var res = await requestPasswordReset(email.value.trim());
    setBusy(submit, false);
    if (!res.ok) { alertBox.textContent = res.error; return; }
    alertBox.classList.add('form-alert--success');
    alertBox.textContent = 'Si un compte existe pour ' + email.value.trim() + ', un e-mail contenant un lien de réinitialisation vient d\'être envoyé. Pense à vérifier tes courriers indésirables. Le lien n\'est valable que pendant une durée limitée.';
  });

  var pw = updateForm.elements.password;
  var confirm = updateForm.elements.confirm;
  [pw, confirm].forEach(function (input) {
    input.addEventListener('input', function () { if (input.getAttribute('aria-invalid')) setFieldError(input, ''); });
  });
  updateForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var alertBox = updateForm.querySelector('[data-form-alert]');
    var submit = updateForm.querySelector('[type="submit"]');
    alertBox.textContent = '';
    setFieldError(pw, validatePassword(pw.value));
    setFieldError(confirm, !confirm.value ? 'Saisis à nouveau le mot de passe.' : confirm.value !== pw.value ? 'Les deux mots de passe ne sont pas identiques.' : '');
    if (focusFirstInvalid(updateForm)) return;
    setBusy(submit, true, 'Enregistrement…');
    var res = await updatePassword(pw.value);
    if (!res.ok) { setBusy(submit, false); alertBox.textContent = res.error; return; }
    if (typeof invalidateUser === 'function') invalidateUser();
    if (typeof renderAccount === 'function' && typeof getCurrentUser === 'function') renderAccount(await getCurrentUser());
    try { history.replaceState(null, '', location.pathname); } catch (err) {}
    updateForm.hidden = true;
    var done = document.querySelector('[data-reset-done]');
    done.hidden = false;
    done.querySelector('h2').focus();
  });
});
