/* =========================================================
   LumaAnime — player.js
   Lecteur : métadonnées AniList (synopsis traduit en français) + vidéo de démonstration
   ========================================================= */

document.addEventListener('DOMContentLoaded', function () {
  var params = new URLSearchParams(location.search);
  var animeId = Number(params.get('id') || params.get('mal')) || 0;
  var player = document.querySelector('[data-player]');
  var video = player.querySelector('[data-video]');
  var $ = function (sel) { return player.querySelector(sel); };

  var titleEl = document.querySelector('[data-anime-title]');
  var metaEl = document.querySelector('[data-anime-meta]');
  var synopsisEl = document.querySelector('[data-anime-synopsis]');
  var synopsisNote = document.querySelector('[data-synopsis-note]');
  var actionsEl = document.querySelector('[data-anime-actions]');
  var playerTitle = $('[data-player-title]');
  var backLink = $('[data-back]');
  var infoBtn = $('[data-info]');
  var infoPanel = $('[data-info-panel]');
  var playBtn = $('[data-play]');
  var overlay = $('[data-overlay]');
  var flash = $('[data-flash]');
  var seek = $('[data-seek]');
  var tip = $('[data-seek-tip]');
  var timeEl = $('[data-time]');
  var muteBtn = $('[data-mute]');
  var volume = $('[data-volume]');
  var settingsBtn = $('[data-settings]');
  var settingsMenu = $('[data-settings-menu]');
  var castBtn = $('[data-cast]');
  var pipBtn = $('[data-pip]');
  var fsBtn = $('[data-fullscreen]');
  var currentMeta = null;

  /* ---- Métadonnées ---- */
  async function loadMeta() {
    if (!animeId) {
      titleEl.textContent = 'Vidéo de démonstration';
      metaEl.textContent = 'Aucun anime sélectionné : choisis une fiche dans le catalogue pour associer la progression à un titre.';
      return;
    }
    try {
      var m = await fetchAnimeDetails(params);
      var a = m && toAnime(m);
      if (!a || a.isAdult) {
        titleEl.textContent = 'Titre non disponible';
        metaEl.textContent = 'Ce titre n\'est pas affiché sur LumaAnime.';
        return;
      }
      if (params.get('mal')) history.replaceState(null, '', 'lecteur.html?id=' + Number(a.id));
      document.title = a.title + ' — Lecteur LumaAnime';
      if (typeof trackTitleView === 'function') trackTitleView(a.id, a.title);
      titleEl.textContent = a.title;
      playerTitle.textContent = a.title;
      backLink.href = detailsHref(a);
      var meta = [typeFr(a.format), a.episodes ? a.episodes + ' épisode' + (a.episodes > 1 ? 's' : '') : null, a.score ? 'Note AniList ' + scoreFr(a.score) + ' sur 10' : null, a.year].filter(Boolean).join(' · ');
      metaEl.textContent = meta;
      actionsEl.innerHTML = listToggleButtonHTML('watchlist', listAnime(a), 'btn-sm') + listToggleButtonHTML('favorites', listAnime(a), 'btn-sm') +
        '<a class="btn btn-sm btn-ghost" href="' + detailsHref(a) + '">' + icon('info') + '<span>Voir la fiche</span></a>';
      refreshListButtons();

      $('[data-info-title]').textContent = a.title;
      $('[data-info-meta]').textContent = meta;
      var infoLink = $('[data-info-link]');
      infoLink.href = detailsHref(a);
      infoLink.hidden = false;
      if (a.image) { var poster = $('[data-info-poster]'); poster.src = a.image; poster.hidden = false; }

      if (a.description) {
        synopsisEl.hidden = false;
        synopsisEl.textContent = 'Traduction du synopsis en cours…';
        applyFrenchSynopsis(synopsisEl, a.id, a.description, 700, function (translated) {
          $('[data-info-text]').textContent = truncate(synopsisEl.textContent, 260);
          $('[data-info-text]').setAttribute('lang', translated ? 'fr' : 'en');
          synopsisNote.hidden = false;
          synopsisNote.textContent = translated ? 'Synopsis traduit automatiquement de l\'anglais (source : AniList).' : 'Synopsis en anglais (source : AniList).';
        });
      }
      currentMeta = { id: a.id, src: 'anilist', malId: a.malId, title: a.title, image: a.image, type: a.format || 'TV' };
      tryResume();
    } catch (err) {
      titleEl.textContent = 'Informations indisponibles';
      metaEl.textContent = 'AniList ne répond pas. La vidéo de démonstration reste lisible.';
    }
  }

  /* ---- Affichage ---- */
  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = String(Math.floor(sec % 60)).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + s : m + ':' + s;
  }
  function setIcon(btn, name, label) {
    btn.innerHTML = icon(name, name === 'play' || name === 'pause' ? 'icon--fill' : '') + '<span class="sr-only">' + label + '</span>';
    btn.title = label;
  }
  function renderPlay() {
    var playing = !video.paused && !video.ended;
    player.classList.toggle('is-playing', playing);
    setIcon(playBtn, playing ? 'pause' : 'play', playing ? 'Mettre en pause' : 'Lire la vidéo');
  }
  function renderMute() {
    var muted = video.muted || video.volume === 0;
    setIcon(muteBtn, muted ? 'mute' : 'volume', muted ? 'Réactiver le son' : 'Couper le son');
    volume.value = muted ? 0 : video.volume;
    volume.style.setProperty('--pct', (volume.value * 100) + '%');
    volume.setAttribute('aria-valuetext', Math.round(volume.value * 100) + ' %');
  }
  function renderFullscreen() {
    var fs = document.fullscreenElement === player;
    player.classList.toggle('is-fullscreen', fs);
    setIcon(fsBtn, fs ? 'fullscreen-exit' : 'fullscreen', fs ? 'Quitter le plein écran' : 'Plein écran');
  }
  function renderTime() {
    var d = video.duration || 0;
    timeEl.innerHTML = fmt(video.currentTime) + ' <span>/ ' + fmt(d) + '</span>';
    if (document.activeElement !== seek) seek.value = video.currentTime;
    seek.style.setProperty('--pct', d ? (video.currentTime / d * 100) + '%' : '0%');
    seek.setAttribute('aria-valuetext', fmt(video.currentTime) + ' sur ' + fmt(d));
  }
  function renderBuffer() {
    var d = video.duration;
    if (!d || !video.buffered.length) return;
    var end = video.buffered.end(video.buffered.length - 1);
    seek.style.setProperty('--buf', Math.min(100, end / d * 100) + '%');
  }
  var flashTimer = null;
  function showFlash(text) {
    flash.textContent = text;
    flash.classList.add('is-on');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { flash.classList.remove('is-on'); }, 700);
  }

  /* ---- Actions ---- */
  function togglePlay() {
    if (video.paused || video.ended) video.play().catch(function () { showToast('La vidéo de démonstration ne peut pas être lue pour le moment.', 'error'); });
    else video.pause();
  }
  function skip(sec) {
    if (!isFinite(video.duration)) return;
    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + sec));
    renderTime();
    showFlash((sec > 0 ? '+' : '−') + Math.abs(sec) + ' s');
  }
  function toggleMute() {
    if (video.muted || video.volume === 0) { video.muted = false; if (video.volume === 0) video.volume = 0.6; }
    else video.muted = true;
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (player.requestFullscreen) player.requestFullscreen().catch(function () {});
  }
  function setPanel(open) {
    infoPanel.hidden = !open;
    infoBtn.setAttribute('aria-expanded', String(open));
    if (open) closeMenu();
  }
  function closeMenu() {
    settingsMenu.hidden = true;
    settingsBtn.setAttribute('aria-expanded', 'false');
  }

  var SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  function renderSpeeds() {
    $('[data-speeds]').innerHTML = SPEEDS.map(function (s) {
      var label = s === 1 ? 'Normale' : String(s).replace('.', ',') + '×';
      return '<button class="wp-option" type="button" role="radio" aria-checked="' + (video.playbackRate === s) + '" data-speed="' + s + '">' + label + '</button>';
    }).join('');
  }
  $('[data-speeds]').addEventListener('click', function (e) {
    var b = e.target.closest('[data-speed]');
    if (!b) return;
    video.playbackRate = Number(b.getAttribute('data-speed'));
    renderSpeeds();
    showFlash(video.playbackRate === 1 ? 'Vitesse normale' : 'Vitesse ' + String(video.playbackRate).replace('.', ',') + '×');
    closeMenu();
    settingsBtn.focus();
  });

  /* ---- Événements ---- */
  video.addEventListener('loadedmetadata', function () {
    seek.max = video.duration || 0;
    seek.disabled = false;
    renderTime();
    tryResume();
  });
  ['play', 'pause', 'ended'].forEach(function (t) { video.addEventListener(t, renderPlay); });
  video.addEventListener('timeupdate', renderTime);
  video.addEventListener('progress', renderBuffer);
  video.addEventListener('volumechange', renderMute);
  video.addEventListener('click', togglePlay);
  video.addEventListener('dblclick', toggleFullscreen);
  video.addEventListener('error', function () { showToast('La vidéo de démonstration est indisponible (serveur externe).', 'error'); }, true);

  overlay.addEventListener('click', togglePlay);
  playBtn.addEventListener('click', togglePlay);
  player.querySelectorAll('[data-skip]').forEach(function (b) {
    b.addEventListener('click', function () { skip(Number(b.getAttribute('data-skip'))); });
  });
  seek.addEventListener('input', function () { video.currentTime = Number(seek.value); renderTime(); });
  seek.addEventListener('pointermove', function (e) {
    var r = seek.getBoundingClientRect();
    var ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    tip.textContent = fmt(ratio * (video.duration || 0));
    tip.style.left = (ratio * 100) + '%';
    tip.hidden = !video.duration;
  });
  seek.addEventListener('pointerleave', function () { tip.hidden = true; });
  volume.addEventListener('input', function () {
    video.volume = Number(volume.value);
    video.muted = video.volume === 0;
  });
  muteBtn.addEventListener('click', toggleMute);
  fsBtn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', renderFullscreen);
  infoBtn.addEventListener('click', function () { setPanel(infoPanel.hidden); });
  settingsBtn.addEventListener('click', function () {
    var open = settingsMenu.hidden;
    settingsMenu.hidden = !open;
    settingsBtn.setAttribute('aria-expanded', String(open));
    if (open) { setPanel(false); renderSpeeds(); var cur = settingsMenu.querySelector('[aria-checked="true"]'); if (cur) cur.focus(); }
  });
  document.addEventListener('click', function (e) {
    if (!settingsMenu.hidden && !settingsMenu.contains(e.target) && !settingsBtn.contains(e.target)) closeMenu();
  });

  if (document.pictureInPictureEnabled && video.requestPictureInPicture) {
    pipBtn.hidden = false;
    pipBtn.addEventListener('click', function () {
      if (document.pictureInPictureElement) document.exitPictureInPicture().catch(function () {});
      else video.requestPictureInPicture().catch(function () { showToast('L\'image dans l\'image n\'est pas disponible ici.', 'warning'); });
    });
  }
  if (video.remote && video.remote.watchAvailability) {
    video.remote.watchAvailability(function (available) { castBtn.hidden = !available; }).catch(function () {});
    castBtn.addEventListener('click', function () { video.remote.prompt().catch(function () {}); });
  }

  player.addEventListener('keydown', function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var onRange = e.target === seek || e.target === volume;
    var key = e.key.toLowerCase();
    if (key === 'escape') { closeMenu(); setPanel(false); return; }
    if (onRange && (key === 'arrowleft' || key === 'arrowright' || key === 'arrowup' || key === 'arrowdown')) return;
    if (key === 'k' || (key === ' ' && (e.target === player || e.target === video))) { e.preventDefault(); togglePlay(); }
    else if (key === 'j' || key === 'arrowleft') { e.preventDefault(); skip(-10); }
    else if (key === 'l' || key === 'arrowright') { e.preventDefault(); skip(10); }
    else if (key === 'm') { e.preventDefault(); toggleMute(); }
    else if (key === 'f') { e.preventDefault(); toggleFullscreen(); }
    else if (key === 'i') { e.preventDefault(); setPanel(infoPanel.hidden); }
  });
  player.tabIndex = -1;

  var idleTimer = null;
  function wake() {
    player.classList.remove('is-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      if (settingsMenu.hidden && infoPanel.hidden && !player.querySelector('.wp-bar:hover, .wp-top:hover')) player.classList.add('is-idle');
    }, 2800);
  }
  player.addEventListener('mousemove', wake);
  player.addEventListener('focusin', wake);
  player.addEventListener('touchstart', wake, { passive: true });

  /* ---- Reprise de lecture ---- */
  var resumed = false;
  async function tryResume() {
    if (resumed || !currentMeta || !isFinite(video.duration)) return;
    resumed = true;
    var user = typeof getCurrentUser === 'function' ? await getCurrentUser() : null;
    var saved = ((user && user.continueWatching) || []).filter(function (x) { return sameContinueEntry(x, currentMeta); })[0];
    if (saved && saved.currentTime && saved.currentTime < video.duration - 2) {
      video.currentTime = saved.currentTime;
      showToast('Lecture reprise à ' + fmt(saved.currentTime) + '.', 'success');
    }
  }
  var lastSave = 0;
  function saveProgress() {
    if (!currentMeta || !video.duration || video.currentTime < 3 || typeof saveContinueWatching !== 'function') return;
    saveContinueWatching(Object.assign({}, currentMeta, { currentTime: video.currentTime, duration: video.duration }));
  }
  video.addEventListener('timeupdate', function () {
    if (Date.now() - lastSave > 5000) { lastSave = Date.now(); saveProgress(); }
  });
  video.addEventListener('pause', saveProgress);
  window.addEventListener('pagehide', saveProgress);

  seek.disabled = true;
  renderPlay();
  renderMute();
  renderFullscreen();
  renderTime();
  wake();
  loadMeta();
});
