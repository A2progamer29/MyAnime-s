/* =========================================================
   LumaAnime — ui.js
   Composants d'interface partagés : notifications, onglets,
   confirmation, formulaires, compteurs, règles d'upload
   ========================================================= */

/* ---- Annonces pour lecteurs d'écran ---- */
function announce(message) {
  var region = document.getElementById('sr-announcer');
  if (!region) {
    region = document.createElement('div');
    region.id = 'sr-announcer';
    region.className = 'sr-only';
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
  }
  region.textContent = '';
  setTimeout(function () { region.textContent = message; }, 60);
}

/* ---- Notifications ---- */
var TOAST_DURATIONS = { success: 5000, warning: 7000, error: 9000 };
var TOAST_ICONS = { success: 'check', warning: 'alert', error: 'alert' };

function showToast(message, type) {
  type = TOAST_DURATIONS[type] ? type : 'success';
  var container = document.querySelector('.toasts');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toasts';
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }
  var toast = document.createElement('div');
  toast.className = 'toast toast--' + type;
  if (type === 'error') toast.setAttribute('role', 'alert');
  toast.innerHTML = icon(TOAST_ICONS[type], 'toast-icon') +
    '<p class="toast-msg"></p>' +
    '<button class="icon-btn" type="button">' + icon('x') + '<span class="sr-only">Fermer la notification</span></button>';
  toast.querySelector('.toast-msg').textContent = message;
  container.appendChild(toast);

  var remaining = TOAST_DURATIONS[type];
  var started = Date.now();
  var timer = setTimeout(remove, remaining);
  function remove() {
    clearTimeout(timer);
    toast.classList.add('is-leaving');
    setTimeout(function () { toast.remove(); }, 260);
  }
  function pause() { clearTimeout(timer); remaining -= Date.now() - started; }
  function resume() { started = Date.now(); clearTimeout(timer); timer = setTimeout(remove, Math.max(remaining, 1500)); }
  toast.addEventListener('mouseenter', pause);
  toast.addEventListener('mouseleave', resume);
  toast.addEventListener('focusin', pause);
  toast.addEventListener('focusout', resume);
  toast.querySelector('button').addEventListener('click', remove);
}

/* ---- Bouton en cours de traitement ---- */
function setBusy(button, busy, busyLabel) {
  if (!button) return;
  if (busy) {
    if (button.dataset.idleLabel === undefined) button.dataset.idleLabel = button.innerHTML;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span><span>' + escapeHTML(busyLabel || 'Chargement…') + '</span>';
    announce(busyLabel || 'Chargement…');
  } else {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (button.dataset.idleLabel !== undefined) {
      button.innerHTML = button.dataset.idleLabel;
      delete button.dataset.idleLabel;
    }
  }
}

/* ---- Onglets (motif ARIA « tabs ») ---- */
function initTabs(tablist, options) {
  options = options || {};
  var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
  function select(tab, moveFocus) {
    tabs.forEach(function (t) {
      var selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
      var panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !selected;
    });
    if (moveFocus) tab.focus();
    if (options.onSelect) options.onSelect(tab);
  }
  tablist.addEventListener('click', function (e) {
    var tab = e.target.closest('[role="tab"]');
    if (tab) select(tab, false);
  });
  tablist.addEventListener('keydown', function (e) {
    var i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    var next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = tabs[(i + 1) % tabs.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = tabs[(i - 1 + tabs.length) % tabs.length];
    else if (e.key === 'Home') next = tabs[0];
    else if (e.key === 'End') next = tabs[tabs.length - 1];
    if (next) { e.preventDefault(); select(next, true); }
  });
  var initial = tabs.filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0] || tabs[0];
  if (initial) select(initial, false);
  return { select: select, tabs: tabs };
}

/* ---- Confirmation (boîte de dialogue native) ---- */
var dialogCount = 0;
function confirmDialog(opts) {
  return new Promise(function (resolve) {
    var id = 'dlg-' + (++dialogCount);
    var previous = document.activeElement;
    var dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    dlg.setAttribute('aria-labelledby', id + '-title');
    dlg.setAttribute('aria-describedby', id + '-text');
    dlg.innerHTML =
      '<div class="dialog-body">' +
        '<h2 class="dialog-title" id="' + id + '-title">' + escapeHTML(opts.title) + '</h2>' +
        '<p class="dialog-text" id="' + id + '-text">' + escapeHTML(opts.message) + '</p>' +
      '</div>' +
      '<div class="dialog-actions">' +
        '<button class="btn btn-ghost" type="button" data-answer="no">' + escapeHTML(opts.cancelLabel || 'Annuler') + '</button>' +
        '<button class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" type="button" data-answer="yes">' + escapeHTML(opts.confirmLabel || 'Confirmer') + '</button>' +
      '</div>';
    document.body.appendChild(dlg);
    var done = false;
    function finish(answer) {
      if (done) return;
      done = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      if (previous && previous.focus) previous.focus();
      resolve(answer);
    }
    dlg.addEventListener('click', function (e) {
      var b = e.target.closest('[data-answer]');
      if (b) finish(b.getAttribute('data-answer') === 'yes');
    });
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); finish(false); });
    dlg.showModal();
    dlg.querySelector('[data-answer="no"]').focus();
  });
}

/* ---- Champs de formulaire ---- */
function setFieldError(input, message) {
  if (!input) return;
  var errorEl = document.getElementById(input.id + '-error');
  if (message) {
    input.setAttribute('aria-invalid', 'true');
    if (errorEl) errorEl.textContent = message;
  } else {
    input.removeAttribute('aria-invalid');
    if (errorEl) errorEl.textContent = '';
  }
}

function focusFirstInvalid(form) {
  var first = form.querySelector('[aria-invalid="true"]');
  if (first) first.focus();
  return !!first;
}

function initCounters(root) {
  (root || document).querySelectorAll('[data-counter]').forEach(function (input) {
    var out = document.querySelector('[data-counter-for="' + input.id + '"]');
    var max = Number(input.getAttribute('maxlength')) || 0;
    if (!out || !max) return;
    var warned = false;
    function update() {
      var len = input.value.length;
      var left = max - len;
      out.textContent = len + ' / ' + max;
      var near = left <= Math.max(3, Math.round(max * 0.1));
      out.classList.toggle('is-near', near);
      if (near && !warned) { announce('Plus que ' + left + ' caractère' + (left > 1 ? 's' : '') + ' possible' + (left > 1 ? 's' : '') + '.'); warned = true; }
      if (!near) warned = false;
    }
    input.addEventListener('input', update);
    update();
  });
}

function initPasswordToggles(root) {
  (root || document).querySelectorAll('[data-password-toggle]').forEach(function (btn) {
    var input = document.getElementById(btn.getAttribute('data-password-toggle'));
    if (!input) return;
    function render() {
      var shown = input.type === 'text';
      btn.setAttribute('aria-pressed', String(shown));
      btn.innerHTML = icon(shown ? 'eye-off' : 'eye') + '<span class="sr-only">' + (shown ? 'Masquer le mot de passe' : 'Afficher le mot de passe') + '</span>';
    }
    btn.addEventListener('click', function () {
      input.type = input.type === 'password' ? 'text' : 'password';
      render();
    });
    render();
  });
}

// N'accepte qu'une page interne du site comme destination après connexion
function safeNextUrl(value) {
  var v = String(value || '');
  return /^[a-z0-9-]+\.html(\?[^#<>"']*)?$/i.test(v) ? v : '';
}

/* ---- Règles communes des champs texte ---- */
var TEXT_RULES = {
  pseudo: { min: 3, max: 20, pattern: /^[\p{L}\p{N} _.\-]+$/u },
  email: { max: 254 },
  password: { min: 8, max: 72 },
  search: { max: 100 }
};

function validatePseudo(value) {
  var v = value.trim();
  if (!v) return 'Choisis un pseudo.';
  if (v.length < TEXT_RULES.pseudo.min) return 'Ton pseudo doit contenir au moins ' + TEXT_RULES.pseudo.min + ' caractères (actuellement ' + v.length + ').';
  if (v.length > TEXT_RULES.pseudo.max) return 'Ton pseudo ne peut pas dépasser ' + TEXT_RULES.pseudo.max + ' caractères.';
  if (!TEXT_RULES.pseudo.pattern.test(v)) return 'Utilise uniquement des lettres, des chiffres, des espaces et les signes _ . -';
  return '';
}

function validateEmail(value) {
  var v = value.trim();
  if (!v) return 'Indique ton adresse e-mail.';
  if (v.length > TEXT_RULES.email.max) return 'Cette adresse e-mail est trop longue (254 caractères maximum).';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return 'Cette adresse e-mail n\'est pas valide. Exemple attendu : prenom@exemple.fr';
  return '';
}

function validatePassword(value) {
  if (!value) return 'Choisis un mot de passe.';
  if (value.length < TEXT_RULES.password.min) return 'Le mot de passe doit contenir au moins ' + TEXT_RULES.password.min + ' caractères (actuellement ' + value.length + ').';
  if (value.length > TEXT_RULES.password.max) return 'Le mot de passe ne peut pas dépasser ' + TEXT_RULES.password.max + ' caractères.';
  return '';
}

/* ---- Règles d'upload d'images ---- */
var IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
var IMAGE_EXTENSIONS_OK = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
var IMAGE_RULES = {
  avatar: {
    name: 'la photo de profil',
    typesLabel: 'JPG, PNG, WebP ou GIF',
    maxBytes: 2 * 1024 * 1024,
    sourceMaxBytes: 15 * 1024 * 1024,
    minWidth: 128, minHeight: 128,
    maxWidth: 6000, maxHeight: 6000
  },
  banner: {
    name: 'la bannière',
    typesLabel: 'JPG, PNG, WebP ou GIF',
    maxBytes: 5 * 1024 * 1024,
    sourceMaxBytes: 15 * 1024 * 1024,
    minWidth: 900, minHeight: 300,
    maxWidth: 8000, maxHeight: 6000,
    recommended: '1500 × 500 px'
  }
};

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' Ko';
  return (bytes / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Mo';
}

function readImageSize(file) {
  return new Promise(function (resolve) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () { resolve({ width: img.naturalWidth, height: img.naturalHeight, url: url }); };
    img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

async function checkImageFile(file, kind) {
  var rules = IMAGE_RULES[kind];
  var ext = (file.name.split('.').pop() || '').toLowerCase();
  var typeOk = IMAGE_TYPES.indexOf(file.type) !== -1 || (!file.type && IMAGE_EXTENSIONS_OK.indexOf(ext) !== -1);
  if (!typeOk) {
    return { ok: false, message: 'Format non accepté' + (ext ? ' (.' + ext + ')' : '') + '. Formats acceptés pour ' + rules.name + ' : ' + rules.typesLabel + '.' };
  }
  var limit = rules.sourceMaxBytes || rules.maxBytes;
  if (file.size > limit) {
    return { ok: false, message: 'Fichier trop lourd : ' + formatBytes(file.size) + '. Taille maximale pour ' + rules.name + ' : ' + formatBytes(limit) + '.' };
  }
  var size = await readImageSize(file);
  if (!size) return { ok: false, message: 'Impossible de lire cette image : le fichier est peut-être endommagé ou n\'est pas une vraie image.' };
  if (size.width < rules.minWidth || size.height < rules.minHeight) {
    URL.revokeObjectURL(size.url);
    return { ok: false, message: 'Image trop petite : ' + size.width + ' × ' + size.height + ' px. Minimum pour ' + rules.name + ' : ' + rules.minWidth + ' × ' + rules.minHeight + ' px.' };
  }
  if (size.width > rules.maxWidth || size.height > rules.maxHeight) {
    URL.revokeObjectURL(size.url);
    return { ok: false, message: 'Image trop grande : ' + size.width + ' × ' + size.height + ' px. Maximum pour ' + rules.name + ' : ' + rules.maxWidth + ' × ' + rules.maxHeight + ' px.' };
  }
  return { ok: true, width: size.width, height: size.height, previewUrl: size.url };
}

function bindImageDrop(zone, input, onFile) {
  function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1; }
  ['dragenter', 'dragover'].forEach(function (type) {
    zone.addEventListener(type, function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      zone.classList.add('is-dragover');
    });
  });
  zone.addEventListener('dragleave', function (e) {
    if (!zone.contains(e.relatedTarget)) zone.classList.remove('is-dragover');
  });
  zone.addEventListener('drop', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove('is-dragover');
    var files = e.dataTransfer.files;
    if (files.length > 1) showToast('Une seule image à la fois : seule la première a été prise en compte.', 'warning');
    if (files[0]) onFile(files[0]);
  });
  input.addEventListener('change', function () {
    var file = input.files[0];
    input.value = '';
    if (file) onFile(file);
  });
}

/* ---- Copier dans le presse-papiers ---- */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copié dans le presse-papiers : ' + text, 'success');
    return true;
  } catch (e) {
    showToast('La copie automatique a échoué. Sélectionne le texte et copie-le manuellement.', 'warning');
    return false;
  }
}

document.addEventListener('click', function (e) {
  var btn = e.target.closest('[data-copy]');
  if (btn) copyText(btn.getAttribute('data-copy'));
});

/* Un fichier lâché à côté d'une zone ne doit pas faire quitter la page */
['dragover', 'drop'].forEach(function (type) {
  window.addEventListener(type, function (e) {
    if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1) e.preventDefault();
  });
});

document.addEventListener('DOMContentLoaded', function () {
  initCounters();
  initPasswordToggles();
});

/* ---- Défilement horizontal au glisser (souris) ; le doigt utilise le défilement natif ---- */
function enableDragScroll(el) {
  if (!el || el.hasAttribute('data-drag-ready')) return;
  el.setAttribute('data-drag-ready', '');
  var pointerId = null;
  var startX = 0;
  var startLeft = 0;
  var moved = false;

  function updateEdges() {
    var max = el.scrollWidth - el.clientWidth;
    el.classList.toggle('can-left', el.scrollLeft > 2);
    el.classList.toggle('can-right', el.scrollLeft < max - 2);
  }
  el.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startLeft = el.scrollLeft;
    moved = false;
  });
  el.addEventListener('pointermove', function (e) {
    if (e.pointerId !== pointerId) return;
    var dx = e.clientX - startX;
    if (!moved && Math.abs(dx) > 6) {
      moved = true;
      el.setPointerCapture(pointerId);
      el.classList.add('is-dragging');
      el.dispatchEvent(new CustomEvent('dragscroll'));
    }
    if (moved) el.scrollLeft = startLeft - dx;
  });
  function end(e) {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    el.classList.remove('is-dragging');
  }
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('click', function (e) {
    if (!moved) return;
    e.preventDefault();
    e.stopPropagation();
    moved = false;
  }, true);
  el.addEventListener('dragstart', function (e) { e.preventDefault(); });
  el.addEventListener('scroll', updateEdges, { passive: true });
  window.addEventListener('resize', updateEdges);
  updateEdges();
}

/* ---- Recadrage avant envoi (photo de profil et bannière) ---- */
var CROP_OUTPUT = {
  avatar: { width: 512, height: 512, title: 'Recadrer ta photo de profil', shape: 'rond' },
  banner: { width: 1500, height: 500, title: 'Recadrer ta bannière', shape: 'bannière' }
};

function canvasToBlob(canvas, type, quality) {
  return new Promise(function (resolve) { canvas.toBlob(resolve, type, quality); });
}

async function exportCrop(img, rect, out, sourceType) {
  var canvas = document.createElement('canvas');
  canvas.width = out.width;
  canvas.height = out.height;
  var ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, out.width, out.height);
  var blob = await canvasToBlob(canvas, 'image/webp', 0.9);
  if (!blob || blob.type !== 'image/webp') {
    var keepAlpha = /png|gif|webp/.test(sourceType || '');
    blob = await canvasToBlob(canvas, keepAlpha ? 'image/png' : 'image/jpeg', 0.9);
  }
  if (!blob) return null;
  var ext = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' }[blob.type] || 'png';
  return new File([blob], 'recadrage.' + ext, { type: blob.type });
}

// Ouvre la fenêtre de recadrage. Résout avec { file, previewUrl }, { keepOriginal: true } (GIF animé gardé tel quel) ou null (annulé).
function openImageCropper(url, kind, opts) {
  opts = opts || {};
  var out = CROP_OUTPUT[kind];
  return new Promise(function (resolve) {
    var dlg = document.createElement('dialog');
    dlg.className = 'dialog cropper';
    dlg.setAttribute('aria-labelledby', 'cropper-title');
    dlg.innerHTML =
      '<div class="dialog-body">' +
        '<h2 class="dialog-title" id="cropper-title">' + out.title + '</h2>' +
        '<p class="dialog-text">Fais glisser l\'image pour la placer, puis zoome avec le curseur, la molette ou deux doigts. Au clavier : flèches pour déplacer, + et − pour zoomer.</p>' +
        '<div class="cropper-stage cropper-stage--' + kind + '" tabindex="0" role="application" aria-label="Zone de recadrage">' +
          '<img class="cropper-img" src="' + url + '" alt="" draggable="false">' +
          '<span class="cropper-mask" aria-hidden="true"></span>' +
        '</div>' +
        '<div class="cropper-zoom">' +
          '<button class="icon-btn" type="button" data-zoom="-1">' + icon('minus') + '<span class="sr-only">Dézoomer</span></button>' +
          '<input class="cropper-range" type="range" min="1" max="4" step="0.01" value="1" aria-label="Zoom">' +
          '<button class="icon-btn" type="button" data-zoom="1">' + icon('plus') + '<span class="sr-only">Zoomer</span></button>' +
        '</div>' +
        '<p class="field-hint cropper-warn" data-crop-warn hidden>Zoom très fort : l\'image risque d\'être floue une fois publiée.</p>' +
        (opts.isGif ? '<p class="field-hint">GIF animé : une fois recadré, il devient une image fixe. Pour garder l\'animation, publie-le sans recadrer.</p>' : '') +
      '</div>' +
      '<div class="dialog-actions">' +
        '<button class="btn btn-ghost" type="button" data-crop-cancel>Annuler</button>' +
        (opts.isGif ? '<button class="btn" type="button" data-crop-keep>Publier sans recadrer</button>' : '') +
        '<button class="btn btn-primary" type="button" data-crop-ok>' + icon('check') + '<span>Valider et publier</span></button>' +
      '</div>';
    document.body.appendChild(dlg);

    var stage = dlg.querySelector('.cropper-stage');
    var img = dlg.querySelector('.cropper-img');
    var range = dlg.querySelector('.cropper-range');
    var warn = dlg.querySelector('[data-crop-warn]');
    var st = { W: 0, H: 0, s0: 1, z: 1, x: 0, y: 0 };
    var settled = false;

    function finish(value) {
      if (settled) return;
      settled = true;
      dlg.close();
      dlg.remove();
      resolve(value);
    }
    function clamp() {
      var dw = img.naturalWidth * st.s0 * st.z;
      var dh = img.naturalHeight * st.s0 * st.z;
      st.x = Math.min(0, Math.max(st.W - dw, st.x));
      st.y = Math.min(0, Math.max(st.H - dh, st.y));
    }
    function render() {
      clamp();
      var scale = st.s0 * st.z;
      img.style.width = img.naturalWidth * scale + 'px';
      img.style.height = img.naturalHeight * scale + 'px';
      img.style.transform = 'translate(' + st.x + 'px, ' + st.y + 'px)';
      range.value = st.z;
      range.setAttribute('aria-valuetext', Math.round(st.z * 100) + ' %');
      warn.hidden = (st.W / scale) >= out.width * 0.6;
    }
    function zoomTo(z, px, py) {
      z = Math.min(4, Math.max(1, z));
      if (px === undefined) { px = st.W / 2; py = st.H / 2; }
      st.x = px - (px - st.x) * (z / st.z);
      st.y = py - (py - st.y) * (z / st.z);
      st.z = z;
      render();
    }
    function layout() {
      var r = stage.getBoundingClientRect();
      var cx = st.W ? (st.W / 2 - st.x) / (st.s0 * st.z) : img.naturalWidth / 2;
      var cy = st.H ? (st.H / 2 - st.y) / (st.s0 * st.z) : img.naturalHeight / 2;
      st.W = r.width;
      st.H = r.height;
      st.s0 = Math.max(st.W / img.naturalWidth, st.H / img.naturalHeight);
      st.x = st.W / 2 - cx * st.s0 * st.z;
      st.y = st.H / 2 - cy * st.s0 * st.z;
      render();
    }

    var pointers = {};
    var pinch = null;
    stage.addEventListener('pointerdown', function (e) {
      stage.setPointerCapture(e.pointerId);
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), z: st.z };
      }
      stage.classList.add('is-dragging');
    });
    stage.addEventListener('pointermove', function (e) {
      var p = pointers[e.pointerId];
      if (!p) return;
      var ids = Object.keys(pointers);
      if (ids.length === 2 && pinch) {
        pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var r = stage.getBoundingClientRect();
        zoomTo(pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        return;
      }
      st.x += e.clientX - p.x;
      st.y += e.clientY - p.y;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      render();
    });
    function release(e) {
      delete pointers[e.pointerId];
      if (Object.keys(pointers).length < 2) pinch = null;
      if (!Object.keys(pointers).length) stage.classList.remove('is-dragging');
    }
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = stage.getBoundingClientRect();
      zoomTo(st.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    stage.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 40 : 10;
      var moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      if (moves[e.key]) { e.preventDefault(); st.x += moves[e.key][0]; st.y += moves[e.key][1]; render(); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomTo(st.z * 1.1); }
      else if (e.key === '-') { e.preventDefault(); zoomTo(st.z / 1.1); }
    });
    range.addEventListener('input', function () { zoomTo(Number(range.value)); });
    dlg.querySelectorAll('[data-zoom]').forEach(function (b) {
      b.addEventListener('click', function () { zoomTo(st.z * (b.getAttribute('data-zoom') === '1' ? 1.15 : 1 / 1.15)); });
    });
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); finish(null); });
    dlg.querySelector('[data-crop-cancel]').addEventListener('click', function () { finish(null); });
    var keep = dlg.querySelector('[data-crop-keep]');
    if (keep) keep.addEventListener('click', function () { finish({ keepOriginal: true }); });
    dlg.querySelector('[data-crop-ok]').addEventListener('click', async function () {
      var btn = this;
      setBusy(btn, true, 'Préparation…');
      var scale = st.s0 * st.z;
      var file = await exportCrop(img, { sx: -st.x / scale, sy: -st.y / scale, sw: st.W / scale, sh: st.H / scale }, out, opts.sourceType);
      if (!file) { setBusy(btn, false); showToast('Le recadrage a échoué. Réessaie avec une autre image.', 'error'); return; }
      finish({ file: file, previewUrl: URL.createObjectURL(file) });
    });
    window.addEventListener('resize', function onResize() {
      if (settled) { window.removeEventListener('resize', onResize); return; }
      layout();
    });

    dlg.showModal();
    function start() { layout(); stage.focus(); }
    if (img.complete && img.naturalWidth) start(); else img.addEventListener('load', start, { once: true });
  });
}

// Vérifie l'image choisie puis propose le recadrage. Résultat : { ok, file, previewUrl } ou { ok: false, message } ou { cancelled: true }
async function prepareProfileImage(file, kind) {
  var check = await checkImageFile(file, kind);
  if (!check.ok) return check;
  var isGif = file.type === 'image/gif';
  var crop = await openImageCropper(check.previewUrl, kind, { isGif: isGif, sourceType: file.type });
  if (!crop) { URL.revokeObjectURL(check.previewUrl); return { cancelled: true }; }
  if (crop.keepOriginal) {
    var rules = IMAGE_RULES[kind];
    if (file.size > rules.maxBytes) {
      URL.revokeObjectURL(check.previewUrl);
      return { ok: false, message: 'Ce GIF pèse ' + formatBytes(file.size) + ' : pour le garder animé, il doit faire moins de ' + formatBytes(rules.maxBytes) + '. Recadre-le (il deviendra fixe) ou choisis un fichier plus léger.' };
    }
    return { ok: true, file: file, previewUrl: check.previewUrl, width: check.width, height: check.height };
  }
  URL.revokeObjectURL(check.previewUrl);
  return { ok: true, file: crop.file, previewUrl: crop.previewUrl, width: CROP_OUTPUT[kind].width, height: CROP_OUTPUT[kind].height };
}
