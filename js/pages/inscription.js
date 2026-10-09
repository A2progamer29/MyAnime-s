/* =========================================================
   LumaAnime — pages/inscription.js
   Inscription en 3 étapes : compte, photo (facultative), bannière (facultative)
   ========================================================= */

document.addEventListener('DOMContentLoaded', function () {
  var form = document.getElementById('register-form');
  if (!form) return;

  var steps = Array.prototype.slice.call(form.querySelectorAll('[data-step]'));
  var stepperItems = document.querySelectorAll('[data-stepper] li');
  var alertBox = form.querySelector('[data-form-alert]');
  var fields = {
    pseudo: form.elements.pseudo,
    email: form.elements.email,
    password: form.elements.password,
    terms: form.elements.terms
  };
  var files = { avatar: null, banner: null };
  var current = 1;

  function goTo(n, silent) {
    current = n;
    steps.forEach(function (s) { s.hidden = Number(s.getAttribute('data-step')) !== n; });
    stepperItems.forEach(function (li, i) {
      var pos = i + 1;
      if (pos === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      li.classList.toggle('is-done', pos < n);
    });
    var heading = form.querySelector('[data-step="' + n + '"] h2');
    if (heading && !silent) heading.focus();
  }

  function validateStep1() {
    setFieldError(fields.pseudo, validatePseudo(fields.pseudo.value));
    setFieldError(fields.email, validateEmail(fields.email.value));
    setFieldError(fields.password, validatePassword(fields.password.value));
    setFieldError(fields.terms, fields.terms.checked ? '' : 'Tu dois accepter les conditions d\'utilisation pour créer un compte.');
    return !focusFirstInvalid(form);
  }

  Object.keys(fields).forEach(function (k) {
    var input = fields[k];
    input.addEventListener(k === 'terms' ? 'change' : 'input', function () {
      if (input.getAttribute('aria-invalid')) setFieldError(input, '');
    });
  });

  var pwRule = form.querySelector('[data-pw-rule]');
  fields.password.addEventListener('input', function () {
    var ok = fields.password.value.length >= TEXT_RULES.password.min;
    pwRule.classList.toggle('is-ok', ok);
    pwRule.querySelector('[data-pw-icon]').innerHTML = icon(ok ? 'check' : 'x');
  });

  form.querySelectorAll('[data-go]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = Number(btn.getAttribute('data-go'));
      if (current === 1 && target > 1 && !validateStep1()) return;
      goTo(target);
    });
  });

  /* ---- Images facultatives ---- */
  function setupPicker(kind) {
    var zone = form.querySelector('[data-drop="' + kind + '"]');
    var input = zone.querySelector('input[type="file"]');
    var error = document.getElementById(kind + '-upload-error');
    var title = zone.querySelector('.dropzone-title');
    var clear = form.querySelector('[data-clear="' + kind + '"]');
    var idleTitle = title.textContent;

    function reset() {
      files[kind] = null;
      var old = zone.querySelector('.dropzone-preview');
      if (old) { URL.revokeObjectURL(old.src); old.remove(); }
      zone.classList.remove('has-preview');
      title.textContent = idleTitle;
      clear.hidden = true;
    }

    bindImageDrop(zone, input, async function (file) {
      error.textContent = '';
      var check = await prepareProfileImage(file, kind);
      if (check.cancelled) return;
      if (!check.ok) { error.textContent = check.message; return; }
      file = check.file;
      reset();
      files[kind] = file;
      var img = document.createElement('img');
      img.className = 'dropzone-preview';
      img.alt = '';
      img.src = check.previewUrl;
      zone.appendChild(img);
      zone.classList.add('has-preview');
      title.textContent = 'Image choisie : ' + check.width + ' × ' + check.height + ' px, ' + formatBytes(file.size) + '. Clique pour la remplacer.';
      clear.hidden = false;
      announce('Image acceptée pour ' + IMAGE_RULES[kind].name + '.');
    });
    clear.addEventListener('click', function () { reset(); input.focus(); announce('Image retirée.'); });
  }
  setupPicker('avatar');
  setupPicker('banner');

  /* ---- Création du compte ---- */
  var submit = form.querySelector('[type="submit"]');
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (current < 3) {
      if (current === 1 && !validateStep1()) return;
      if (current === 1 && !(await isPseudoAvailable(fields.pseudo.value.trim()))) {
        setFieldError(fields.pseudo, 'Ce pseudo est déjà utilisé par un autre membre. Choisis-en un autre.');
        fields.pseudo.focus();
        return;
      }
      goTo(current + 1);
      return;
    }
    if (!validateStep1()) { goTo(1); validateStep1(); return; }
    alertBox.textContent = '';
    setBusy(submit, true, 'Création du compte…');

    var res = await registerUser({
      pseudo: fields.pseudo.value.trim(),
      email: fields.email.value.trim(),
      password: fields.password.value
    });
    if (!res.ok) {
      setBusy(submit, false);
      goTo(1);
      alertBox.textContent = res.error;
      return;
    }

    if (res.needsConfirmation) {
      showCodeStep(fields.email.value.trim());
      return;
    }
    await finishRegistration();
  });

  var done = document.querySelector('[data-register-done]');
  var doneText = done.querySelector('[data-done-text]');

  function showDone(text, button) {
    doneText.textContent = text;
    done.querySelector(button).hidden = false;
    form.hidden = true;
    codeForm.hidden = true;
    document.querySelector('[data-stepper]').hidden = true;
    done.hidden = false;
    done.querySelector('h2').focus();
  }

  async function finishRegistration() {
    var problems = [];
    var btn = codeForm.hidden ? submit : codeSubmit;
    if (files.avatar) {
      setBusy(btn, true, 'Envoi de la photo de profil…');
      var a = await uploadAvatar(files.avatar);
      if (a.error) problems.push('Photo de profil : ' + a.error);
    }
    if (files.banner) {
      setBusy(btn, true, 'Envoi de la bannière…');
      var b = await uploadBanner(files.banner);
      if (b.error) problems.push('Bannière : ' + b.error);
    }
    if (problems.length) {
      showDone('Ton compte est créé et tu es connecté. Certaines images n\'ont pas pu être envoyées — ' + problems.join(' ') + ' Tu peux réessayer depuis tes paramètres.', '[data-done-settings]');
      return;
    }
    window.location.href = safeNextUrl(new URLSearchParams(location.search).get('next')) || 'index.html';
  }

  /* ---- Code de confirmation reçu par e-mail ---- */
  var codeForm = document.querySelector('[data-register-code]');
  var codeInput = codeForm.elements.code;
  var codeStatus = codeForm.querySelector('[data-code-status]');
  var codeSubmit = codeForm.querySelector('[type="submit"]');
  var resendBtn = codeForm.querySelector('[data-code-resend]');
  var codeEmail = '';
  var resendTimer = null;

  function startResendCooldown(seconds) {
    clearInterval(resendTimer);
    var left = seconds;
    resendBtn.disabled = true;
    resendBtn.textContent = 'Renvoyer le code (' + left + ' s)';
    resendTimer = setInterval(function () {
      left -= 1;
      if (left > 0) { resendBtn.textContent = 'Renvoyer le code (' + left + ' s)'; return; }
      clearInterval(resendTimer);
      resendBtn.disabled = false;
      resendBtn.textContent = 'Renvoyer le code';
    }, 1000);
  }

  function showCodeStep(email) {
    codeEmail = email;
    try { sessionStorage.setItem('lum_confirm_email', email); } catch (err) {}
    codeForm.querySelector('[data-code-text]').textContent = 'Un code de confirmation a été envoyé à ' + email + '. Saisis-le ci-dessous pour activer ton compte.';
    form.hidden = true;
    document.querySelector('[data-stepper]').hidden = true;
    codeForm.hidden = false;
    startResendCooldown(60);
    codeInput.focus();
  }

  codeInput.addEventListener('input', function () {
    var digits = codeInput.value.replace(/\D/g, '').slice(0, 10);
    if (digits !== codeInput.value) codeInput.value = digits;
    if (codeInput.getAttribute('aria-invalid')) setFieldError(codeInput, '');
  });

  codeForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    codeStatus.textContent = '';
    codeStatus.classList.remove('form-alert--success');
    var code = codeInput.value.trim();
    var error = /^\d{6,10}$/.test(code) ? '' : 'Saisis le code à chiffres reçu par e-mail.';
    setFieldError(codeInput, error);
    if (error) { codeInput.focus(); return; }
    setBusy(codeSubmit, true, 'Vérification…');
    var res = await verifySignupCode(codeEmail, code);
    if (!res.ok) {
      setBusy(codeSubmit, false);
      setFieldError(codeInput, res.error);
      codeInput.focus();
      return;
    }
    await finishRegistration();
  });

  resendBtn.addEventListener('click', async function () {
    codeStatus.textContent = '';
    codeStatus.classList.remove('form-alert--success');
    setBusy(resendBtn, true, 'Envoi…');
    var res = await resendSignupCode(codeEmail);
    setBusy(resendBtn, false);
    if (!res.ok) { codeStatus.textContent = res.error; return; }
    codeStatus.classList.add('form-alert--success');
    codeStatus.textContent = 'Nouveau code envoyé à ' + codeEmail + '. Seul le dernier code reçu est valable.';
    codeInput.value = '';
    codeInput.focus();
    startResendCooldown(60);
  });

  document.addEventListener('myanimes:user', function (e) {
    var already = document.querySelector('[data-already]');
    if (!e.detail || !already) return;
    already.querySelector('[data-already-name]').textContent = e.detail.pseudo;
    already.hidden = false;
    form.hidden = true;
    document.querySelector('[data-stepper]').hidden = true;
  });

  goTo(1, true);

  if (new URLSearchParams(location.search).get('confirmer')) {
    var pendingEmail = '';
    try { pendingEmail = sessionStorage.getItem('lum_confirm_email') || ''; } catch (err) {}
    if (pendingEmail) {
      showCodeStep(pendingEmail);
      codeForm.querySelector('[data-code-text]').textContent = 'Saisis le code reçu à ' + pendingEmail + ' pour activer ton compte. Tu ne le trouves plus ? Demande un nouveau code.';
      clearInterval(resendTimer);
      resendBtn.disabled = false;
      resendBtn.textContent = 'Renvoyer le code';
    }
  }
});
