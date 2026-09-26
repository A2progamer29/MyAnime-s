/* =========================================================
   LumaAnime — preload.js
   Écran de chargement du premier affichage de la session : précharge en une fois
   les données les plus consultées (accueil, calendrier du jour, saison, catalogue,
   synopsis français) pour que la navigation soit ensuite instantanée.
   ========================================================= */

(function () {
  var root = document.documentElement;
  if (!root.classList.contains('is-preloading')) return;

  var MAX_WAIT = 12000;
  var TASK_WAIT = 8000;
  var logo = 'assets/logos/logo-' + (root.getAttribute('data-logo') || 'original') + '.png';

  var overlay = document.createElement('div');
  overlay.className = 'preloader';
  overlay.innerHTML =
    '<div class="brand preloader-brand" aria-hidden="true">' +
      (window.MA_BRAND_IMAGE ? '<img class="brand-logo" src="' + logo + '" alt="" width="40" height="40">' : '<span class="brand-letter">L</span>') +
      '<span class="brand-word">umaAnime</span></div>' +
    '<div class="preloader-bar" role="progressbar" aria-label="Chargement de LumaAnime" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div>' +
    '<p class="preloader-pct" aria-hidden="true">0 %</p>' +
    '<p class="preloader-step" aria-live="polite">Préparation…</p>';
  document.body.appendChild(overlay);
  var main = document.getElementById('contenu');
  if (main) main.setAttribute('aria-busy', 'true');

  var bar = overlay.querySelector('.preloader-bar');
  var fill = bar.querySelector('span');
  var pctEl = overlay.querySelector('.preloader-pct');
  var stepEl = overlay.querySelector('.preloader-step');
  var shown = 0;
  var target = 0;
  var finished = false;

  function paint() {
    shown += Math.max(1, (target - shown) * 0.18);
    if (shown > target) shown = target;
    var value = Math.round(shown);
    fill.style.width = value + '%';
    pctEl.textContent = value + ' %';
    bar.setAttribute('aria-valuenow', String(value));
    if (shown < target) schedulePaint();
    else if (finished) close();
  }

  function schedulePaint() {
    if (document.hidden) { shown = target; paint(); }
    else requestAnimationFrame(paint);
  }

  function withTimeout(promise) {
    return Promise.race([
      Promise.resolve(promise).catch(function () {}),
      new Promise(function (r) { setTimeout(r, TASK_WAIT); })
    ]);
  }

  function preloadImages(urls) {
    return Promise.all(urls.filter(Boolean).slice(0, 8).map(function (src) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = img.onerror = resolve;
        img.decoding = 'async';
        img.src = src;
      });
    }));
  }

  var home = typeof loadHomeData === 'function' ? loadHomeData() : Promise.resolve(null);
  var tasks = [
    { label: 'Polices et interface', run: document.fonts ? document.fonts.ready : Promise.resolve() },
    { label: 'Tendances et classement', run: home },
    { label: 'Calendrier du jour', run: typeof loadDayData === 'function' ? loadDayData(todayIndex(), 1) : null },
    { label: 'Animes de la saison', run: typeof loadSeasonData === 'function' ? loadSeasonData(currentSeasonIndex(), 1) : null },
    { label: 'Catalogue', run: typeof loadCatalogData === 'function' ? loadCatalogData({ page: 1 }) : null },
    { label: 'Synopsis en français', run: home.then(function (d) {
      if (!d || typeof frenchSynopses !== 'function') return null;
      return frenchSynopses(d.hero.media.filter(function (m) { return !m.isAdult && m.description; }).slice(0, 10).map(function (m) { return m.id; }));
    }) },
    { label: 'Images', run: home.then(function (d) {
      if (!d) return null;
      var first = d.hero.media[0] || {};
      var urls = [first.bannerImage, first.coverImage && first.coverImage.extraLarge]
        .concat(d.top.media.slice(0, 3).map(function (m) { return m.coverImage && m.coverImage.extraLarge; }))
        .concat(d.season.media.slice(0, 3).map(function (m) { return m.coverImage && m.coverImage.large; }));
      return preloadImages(urls);
    }) }
  ];

  var done = 0;
  tasks.forEach(function (task) {
    withTimeout(task.run).then(function () {
      task.finished = true;
      done += 1;
      target = Math.round((done / tasks.length) * 100);
      var pending = tasks.filter(function (t) { return !t.finished; })[0];
      stepEl.textContent = pending ? pending.label + '…' : 'Prêt';
      if (done === tasks.length) finished = true;
      schedulePaint();
    });
  });
  stepEl.textContent = tasks[0].label + '…';

  setTimeout(function () { if (!finished) { target = 100; finished = true; schedulePaint(); } }, MAX_WAIT);

  function close() {
    if (overlay.classList.contains('is-done')) return;
    try { sessionStorage.setItem('ma_ready', '1'); } catch (e) {}
    overlay.classList.add('is-done');
    root.classList.remove('is-preloading');
    if (main) main.removeAttribute('aria-busy');
    setTimeout(function () { overlay.remove(); }, 450);
  }
})();
