/* =========================================================
   LumaAnime — pages/connexion.js
   ========================================================= */

document.addEventListener('DOMContentLoaded', function () {
  var form = document.getElementById('login-form');
  if (!form) return;
  var email = form.elements.email;
  var password = form.elements.password;
  var alertBox = form.querySelector('[data-form-alert]');
  var submit = form.querySelector('[type="submit"]');
  var next = safeNextUrl(new URLSearchParams(location.search).get('next'));

  document.addEventListener('myanimes:user', function (e) {
    var user = e.detail;
    var already = document.querySelector('[data-already]');
    if (!user || !already) return;
    already.querySelector('[data-already-name]').textContent = user.pseudo;
    already.hidden = false;
    form.hidden = true;
    var logout = already.querySelector('[data-already-logout]');
    logout.addEventListener('click', async function () {
      setBusy(logout, true, 'Déconnexion…');
      await logoutUser();
      window.location.reload();
    });
  });

  [email, password].forEach(function (input) {
    input.addEventListener('input', function () { if (input.getAttribute('aria-invalid')) setFieldError(input, ''); });
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    alertBox.textContent = '';
    setFieldError(email, validateEmail(email.value));
    setFieldError(password, password.value ? '' : 'Saisis ton mot de passe.');
    if (focusFirstInvalid(form)) return;

    setBusy(submit, true, 'Connexion en cours…');
    var res = await loginUser(email.value.trim(), password.value);
    if (!res.ok) {
      setBusy(submit, false);
      alertBox.textContent = res.error;
      if (res.unconfirmed) {
        try { sessionStorage.setItem('lum_confirm_email', email.value.trim()); } catch (err) {}
        alertBox.insertAdjacentHTML('beforeend', ' <a class="link" href="inscription.html?confirmer=1">Saisir mon code</a>');
      }
      password.focus();
      return;
    }
    cacheThemeForNextLoad(res.user);
    window.location.href = next || (isAdmin(res.user) ? 'admin.html' : 'index.html');
  });
});
