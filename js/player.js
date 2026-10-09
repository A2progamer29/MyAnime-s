/* =========================================================
   LumaAnime — player.js
   Lecteur vidéo + AniList
   ========================================================= */

document.addEventListener(
  'DOMContentLoaded',
  function () {
    var params =
      new URLSearchParams(
        location.search
      );

    // Paramètres : id (AniList) ou mal (MyAnimeList), season, episode, lang (VOSTFR…), player (voe…)
    function urlNumber(value, max) {
      if (value === null || !/^\d{1,4}$/.test(value)) return null;
      var n = Number(value);
      return n <= max ? n : null;
    }

    function cleanLang(value) {
      var v = String(value || '').trim().toUpperCase();
      return /^[A-Z0-9]{2,12}$/.test(v) ? v : null;
    }

    function cleanPlayer(value) {
      var v = String(value || '').trim().toLowerCase();
      return /^[a-z0-9_]{2,30}$/.test(v) ? v : null;
    }

    function urlId(value) {
      return value !== null && /^\d{1,9}$/.test(value) ? Number(value) : 0;
    }

    var animeId =
      urlId(params.get('id'));

    var malId =
      animeId
        ? 0
        : urlId(params.get('mal'));

    var season =
      urlNumber(params.get('season'), 99);

    var episode =
      urlNumber(params.get('episode'), 5000);

    if (episode !== null && season === null) {
      season = 1;
    }

    var wantLang =
      cleanLang(params.get('lang'));

    var wantPlayer =
      cleanPlayer(params.get('player'));

    // Aperçu administrateur (bouton « Tester » de l'admin) : sources non publiées visibles, vérifié côté serveur
    var adminPreview = params.get('apercu') === '1' && typeof adminEpisodePlayback === 'function';

    var player =
      document.querySelector(
        '[data-player]'
      );

    if (!player) {
      return;
    }

    var video =
      player.querySelector(
        '[data-video]'
      );

    var $ =
      function (sel) {
        return player.querySelector(
          sel
        );
      };

    var titleEl =
      document.querySelector(
        '[data-anime-title]'
      );

    var metaEl =
      document.querySelector(
        '[data-anime-meta]'
      );

    var synopsisEl =
      document.querySelector(
        '[data-anime-synopsis]'
      );

    var synopsisNote =
      document.querySelector(
        '[data-synopsis-note]'
      );

    var actionsEl =
      document.querySelector(
        '[data-anime-actions]'
      );

    var playerTitle =
      $('[data-player-title]');

    var backLink =
      $('[data-back]');

    var infoBtn =
      $('[data-info]');

    var infoPanel =
      $('[data-info-panel]');

    var playBtn =
      $('[data-play]');

    var overlay =
      $('[data-overlay]');

    var flash =
      $('[data-flash]');

    var seek =
      $('[data-seek]');

    var tip =
      $('[data-seek-tip]');

    var timeEl =
      $('[data-time]');

    var muteBtn =
      $('[data-mute]');

    var volume =
      $('[data-volume]');

    var settingsBtn =
      $('[data-settings]');

    var settingsMenu =
      $('[data-settings-menu]');

    var castBtn =
      $('[data-cast]');

    var pipBtn =
      $('[data-pip]');

    var fsBtn =
      $('[data-fullscreen]');

    var currentMeta = null;

    function fmt(sec) {
      if (
        !isFinite(sec) ||
        sec < 0
      ) {
        sec = 0;
      }

      var h =
        Math.floor(
          sec / 3600
        );

      var m =
        Math.floor(
          (sec % 3600) / 60
        );

      var s =
        String(
          Math.floor(
            sec % 60
          )
        ).padStart(
          2,
          '0'
        );

      return h
        ? h +
            ':' +
            String(m).padStart(
              2,
              '0'
            ) +
            ':' +
            s
        : m +
            ':' +
            s;
    }

    function setIcon(
      btn,
      name,
      label
    ) {
      btn.innerHTML =
        icon(
          name,
          name === 'play' ||
          name === 'pause'
            ? 'icon--fill'
            : ''
        ) +
        '<span class="sr-only">' +
        label +
        '</span>';

      btn.title = label;
    }

    function renderPlay() {
      var playing =
        !video.paused &&
        !video.ended;

      player.classList.toggle(
        'is-playing',
        playing
      );

      setIcon(
        playBtn,
        playing
          ? 'pause'
          : 'play',
        playing
          ? 'Mettre en pause'
          : 'Lire la vidéo'
      );
    }

    function renderMute() {
      var muted =
        video.muted ||
        video.volume === 0;

      setIcon(
        muteBtn,
        muted
          ? 'mute'
          : 'volume',
        muted
          ? 'Réactiver le son'
          : 'Couper le son'
      );

      volume.value =
        muted
          ? 0
          : video.volume;

      volume.style.setProperty(
        '--pct',
        volume.value * 100 +
          '%'
      );

      volume.setAttribute(
        'aria-valuetext',
        Math.round(
          volume.value * 100
        ) +
          ' %'
      );
    }

    function renderFullscreen() {
      var fs =
        document.fullscreenElement ===
        player;

      player.classList.toggle(
        'is-fullscreen',
        fs
      );

      setIcon(
        fsBtn,
        fs
          ? 'fullscreen-exit'
          : 'fullscreen',
        fs
          ? 'Quitter le plein écran'
          : 'Plein écran'
      );
    }

    function renderTime() {
      var d =
        video.duration || 0;

      timeEl.innerHTML =
        fmt(video.currentTime) +
        ' <span>/ ' +
        fmt(d) +
        '</span>';

      if (
        document.activeElement !==
        seek
      ) {
        seek.value =
          video.currentTime;
      }

      seek.style.setProperty(
        '--pct',
        d
          ? video.currentTime /
              d *
              100 +
              '%'
          : '0%'
      );

      seek.setAttribute(
        'aria-valuetext',
        fmt(
          video.currentTime
        ) +
          ' sur ' +
          fmt(d)
      );
    }

    function renderBuffer() {
      var d =
        video.duration;

      if (
        !d ||
        !video.buffered.length
      ) {
        return;
      }

      var end =
        video.buffered.end(
          video.buffered.length - 1
        );

      seek.style.setProperty(
        '--buf',
        Math.min(
          100,
          end / d * 100
        ) + '%'
      );
    }

    var flashTimer = null;

    function showFlash(text) {
      flash.textContent =
        text;

      flash.classList.add(
        'is-on'
      );

      clearTimeout(
        flashTimer
      );

      flashTimer =
        setTimeout(
          function () {
            flash.classList.remove(
              'is-on'
            );
          },
          700
        );
    }

    function togglePlay() {
      if (mode !== 'direct') {
        return;
      }

      if (
        video.paused ||
        video.ended
      ) {
        video
          .play()
          .catch(
            function () {
              showToast(
                'La vidéo ne peut pas être lue pour le moment.',
                'error'
              );
            }
          );
      } else {
        video.pause();
      }
    }

    function skip(sec) {
      if (
        mode !== 'direct' ||
        !isFinite(
          video.duration
        )
      ) {
        return;
      }

      video.currentTime =
        Math.max(
          0,
          Math.min(
            video.duration,
            video.currentTime +
              sec
          )
        );

      renderTime();

      showFlash(
        (sec > 0
          ? '+'
          : '−') +
          Math.abs(sec) +
          ' s'
      );
    }

    function toggleMute() {
      if (mode !== 'direct') {
        return;
      }

      if (
        video.muted ||
        video.volume === 0
      ) {
        video.muted = false;

        if (
          video.volume === 0
        ) {
          video.volume = 0.6;
        }
      } else {
        video.muted = true;
      }
    }

    function toggleFullscreen() {
      if (
        document.fullscreenElement
      ) {
        document.exitFullscreen();
      } else if (
        player.requestFullscreen
      ) {
        player
          .requestFullscreen()
          .catch(
            function () {}
          );
      }
    }

    function setPanel(open) {
      infoPanel.hidden =
        !open;

      infoBtn.setAttribute(
        'aria-expanded',
        String(open)
      );

      if (open) {
        closeMenu();
      }
    }

    function closeMenu() {
      settingsMenu.hidden =
        true;

      settingsBtn.setAttribute(
        'aria-expanded',
        'false'
      );
    }

    var SPEEDS = [
      0.5,
      0.75,
      1,
      1.25,
      1.5,
      2
    ];

    function renderSpeeds() {
      $('[data-speeds]')
        .innerHTML =
        SPEEDS.map(
          function (s) {
            var label =
              s === 1
                ? 'Normale'
                : String(s).replace(
                    '.',
                    ','
                  ) + '×';

            return (
              '<button class="wp-option" type="button" role="radio" aria-checked="' +
              (video.playbackRate === s) +
              '" data-speed="' +
              s +
              '">' +
              label +
              '</button>'
            );
          }
        )
        .join('');
    }

    $('[data-speeds]')
      .addEventListener(
        'click',
        function (e) {
          var b =
            e.target.closest(
              '[data-speed]'
            );

          if (!b) {
            return;
          }

          video.playbackRate =
            Number(
              b.getAttribute(
                'data-speed'
              )
            );

          renderSpeeds();

          showFlash(
            video.playbackRate ===
              1
              ? 'Vitesse normale'
              : 'Vitesse ' +
                  String(
                    video.playbackRate
                  ).replace(
                    '.',
                    ','
                  ) +
                  '×'
          );

          closeMenu();

          settingsBtn.focus();
        }
      );

    /* ---- Épisodes, langues et lecteurs ----
       Les vidéos restent chez les lecteurs (VOE, Vidmoly…) : un lecteur « embed » s'affiche dans une
       iframe, un fichier « direct » est lu par la balise <video> du site avec tous ses contrôles. */
    var KIND_LABELS = {
      special: 'Spécial',
      ova: 'OAV',
      ona: 'ONA',
      movie: 'Film',
      recap: 'Récap'
    };

    var stageMsg = $('[data-stage-msg]');
    var sourcesBox = $('[data-sources]');
    var langsBox = $('[data-langs]');
    var hostsBox = $('[data-hosts]');
    var reportBtn = $('[data-report-source]');
    var otherBtn = $('[data-other-source]');
    var prevLink = $('[data-prev]');
    var nextLink = $('[data-next]');
    var noticeEl = document.querySelector('[data-player-notice]');

    var seasonsList = [];
    var playback = null;
    var currentEpisode = null;
    var currentLang = null;
    var currentSource = null;
    var mode = 'direct';
    var frame = null;
    var reported = {};
    var reporting = false;
    var embedSaved = false;
    var carryTime = 0;
    var replay = false;

    function storageGet(key) {
      try { return localStorage.getItem(key); } catch (e) { return null; }
    }

    function storageSet(key, value) {
      try { localStorage.setItem(key, value); } catch (e) {}
    }

    // Langue mise dans les liens d'épisodes : celle choisie (ou demandée), pas un repli automatique
    var preferredLang = wantLang || cleanLang(storageGet('luma.lang'));

    function seasonName(n) {
      return Number(n) === 0 ? 'Spéciaux' : 'Saison ' + Number(n);
    }

    function episodeLabel(e) {
      var n = Number(e.number);
      var kind = e.kind && e.kind !== 'episode' && KIND_LABELS[e.kind];
      var base = Number(e.season) === 0
        ? (kind || 'Spécial') + ' ' + n
        : 'S' + Number(e.season) + ' · ' + (kind || 'Épisode') + ' ' + n;
      return base + (e.title ? ' — ' + e.title : '');
    }

    function frDate(value) {
      var d = new Date(value);
      if (!value || isNaN(d.getTime())) return '';
      try { return d.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }); } catch (e) { return d.toLocaleDateString('fr-FR'); }
    }

    function pageQuery(s, n, langCode, playerKey) {
      var q = '?id=' + Number(animeId);
      if (s !== null && s !== undefined) q += '&season=' + Number(s);
      if (n !== null && n !== undefined) q += '&episode=' + Number(n);
      if (langCode) q += '&lang=' + encodeURIComponent(langCode);
      if (playerKey) q += '&player=' + encodeURIComponent(playerKey);
      if (adminPreview) q += '&apercu=1';
      return q;
    }

    function linkLang() {
      return preferredLang || (currentLang && currentLang.code) || '';
    }

    function episodeHref(e) {
      return 'lecteur.html' + pageQuery(e.season, e.number, linkLang(), null);
    }

    function setQuery(q) {
      if (location.search !== q) {
        try { history.replaceState(null, '', location.pathname + q + location.hash); } catch (e) {}
      }
      params = new URLSearchParams(q);
    }

    function syncUrl() {
      if (!currentEpisode) return;
      setQuery(pageQuery(currentEpisode.season, currentEpisode.number, currentLang && currentLang.code, currentSource && currentSource.provider));
    }

    function allEpisodes() {
      var out = [];
      seasonsList.forEach(function (s) { (s.episodes || []).forEach(function (e) { out.push(e); }); });
      return out;
    }

    function findEpisode(s, n) {
      return allEpisodes().filter(function (e) { return Number(e.season) === Number(s) && Number(e.number) === Number(n); })[0] || null;
    }

    function showNotice(iconName, html) {
      if (!noticeEl) return;
      noticeEl.hidden = false;
      noticeEl.innerHTML = icon(iconName) + '<div class="notice-body">' + html + '</div>';
    }

    function showStageMessage(html) {
      stageMsg.innerHTML = html;
      stageMsg.hidden = false;
    }

    function stageText(title, text) {
      return '<p class="wp-stage-title">' + escapeHTML(title) + '</p>' + (text ? '<p>' + escapeHTML(text) + '</p>' : '');
    }

    function setMode(m) {
      mode = m;
      player.classList.toggle('is-embed', m === 'embed');
      player.classList.toggle('is-blocked', m === 'blocked');
      if (m !== 'direct') {
        closeMenu();
        player.classList.remove('is-playing', 'is-idle');
        seek.disabled = true;
      }
    }

    function showNoVideo() {
      setMode('blocked');
      if (sourcesBox) sourcesBox.hidden = true;
      showStageMessage(stageText('Aucune vidéo disponible', ''));
      showNotice('info', '<p><strong>Aucune vidéo disponible</strong> · Ce titre n’a pas encore d’épisode en ligne sur LumaAnime.</p>');
    }

    function showUnavailable(message) {
      setMode('blocked');
      if (sourcesBox) sourcesBox.hidden = true;
      showStageMessage(stageText('Épisode indisponible', message || 'Choisis un autre épisode dans la liste.'));
      showNotice('info', '<p><strong>Épisode indisponible</strong> · ' + escapeHTML(message || 'Cet épisode n’est plus disponible. Choisis-en un autre dans la liste.') + '</p>');
    }

    async function showPremiumOnly(res) {
      setMode('blocked');
      if (sourcesBox) sourcesBox.hidden = true;
      var date = frDate(res.until);
      var user = null;
      try { user = typeof getCurrentUser === 'function' ? await getCurrentUser() : null; } catch (e) {}
      var here = typeof currentRelativeUrl === 'function' ? currentRelativeUrl() : 'lecteur.html' + location.search;
      showStageMessage(
        icon('lock', 'wp-stage-icon') +
        '<p class="wp-stage-title">Accès anticipé Premium</p>' +
        '<p>Épisode en accès anticipé pour les membres Premium' + (date ? ' jusqu’au ' + escapeHTML(date) : '') + '.</p>' +
        '<p class="wp-stage-actions">' +
          '<a class="btn btn-primary btn-sm" href="premium.html">Découvrir Premium</a>' +
          (user ? '' : '<a class="btn btn-ghost btn-sm" href="' + escapeHTML('connexion.html?next=' + encodeURIComponent(here)) + '">Se connecter</a>') +
        '</p>'
      );
    }

    function clearStage() {
      if (mode === 'direct' && video.getAttribute('src')) {
        carryTime = video.currentTime > 3 ? video.currentTime : 0;
        replay = !video.paused && !video.ended;
        saveProgress();
        video.pause();
      }
      video.removeAttribute('src');
      video.load();
      seek.max = 0;
      seek.disabled = true;
      renderTime();
      renderPlay();
      if (frame) {
        frame.remove();
        frame = null;
      }
      stageMsg.hidden = true;
      stageMsg.innerHTML = '';
    }

    function otherSources() {
      return currentLang ? (currentLang.sources || []).filter(function (s) { return s !== currentSource; }) : [];
    }

    function playSource(src) {
      clearStage();
      currentSource = src || null;
      var kind = src && (src.kind === 'direct' || src.kind === 'embed') ? src.kind : null;
      var url = kind && window.LumaProviders
        ? LumaProviders.safeEmbedUrl(src.url, { kind: kind, hosts: src.hosts || [] })
        : null;

      if (!url) {
        carryTime = 0;
        setMode('blocked');
        showStageMessage(stageText(
          'Ce lecteur ne peut pas être affiché',
          otherSources().length ? 'Choisis un autre lecteur juste en dessous.' : 'Signale-le pour que l’équipe le corrige.'
        ));
      } else if (kind === 'direct') {
        setMode('direct');
        if (carryTime) resumed = true;
        video.src = url;
        video.load();
        if (replay) video.play().catch(function () {});
      } else {
        carryTime = 0;
        setMode('embed');
        frame = LumaProviders.createFrame(url, src);
        frame.className = 'wp-frame';
        video.insertAdjacentElement('afterend', frame);
        saveEmbedProgress();
      }
      replay = false;
      renderSources();
      syncUrl();
    }

    function chipHTML(attr, index, pressed, label, extra) {
      return '<button class="wp-chip" type="button" ' + attr + '="' + index + '" aria-pressed="' + (pressed ? 'true' : 'false') + '">' +
        escapeHTML(label) + (extra || '') + '</button>';
    }

    function renderSources() {
      var langs = (playback && playback.languages) || [];
      if (!langs.length) {
        sourcesBox.hidden = true;
        return;
      }
      sourcesBox.hidden = false;
      langsBox.innerHTML = langs.map(function (l, i) {
        return chipHTML('data-lang-index', i, l === currentLang, l.name || l.code);
      }).join('');
      var list = (currentLang && currentLang.sources) || [];
      hostsBox.innerHTML = list.map(function (s, i) {
        return chipHTML('data-source-index', i, s === currentSource, s.provider_name || s.provider || 'Lecteur ' + (i + 1),
          s.subtitle_kind === 'soft'
            ? '<span class="wp-chip-badge" aria-hidden="true">Sous-titres à activer</span><span class="sr-only"> (sous-titres à activer dans le lecteur)</span>'
            : '');
      }).join('');
      otherBtn.hidden = list.length < 2;
      renderReportButton();
      renderNav();
    }

    function renderReportButton() {
      var done = !!(currentSource && reported[currentSource.id]);
      reportBtn.hidden = !currentSource || !currentSource.id;
      reportBtn.setAttribute('aria-disabled', done || reporting ? 'true' : 'false');
      reportBtn.querySelector('[data-report-label]').textContent = done ? 'Lecteur signalé, merci' : 'Signaler un lecteur cassé';
      reportBtn.setAttribute('aria-label', (done ? 'Lecteur signalé, merci' : 'Signaler un lecteur cassé') +
        (currentSource ? ' : ' + (currentSource.provider_name || currentSource.provider || '') : ''));
    }

    function setNavLink(a, ep, label) {
      if (!ep) {
        a.hidden = true;
        a.removeAttribute('href');
        return;
      }
      var full = label + ' : ' + episodeLabel(findEpisode(ep.season, ep.number) || ep);
      a.hidden = false;
      a.href = episodeHref(ep);
      a.title = full;
      a.querySelector('.sr-only').textContent = full;
    }

    function renderNav() {
      setNavLink(prevLink, playback && playback.prev, 'Épisode précédent');
      setNavLink(nextLink, playback && playback.next, 'Épisode suivant');
    }

    function focusPressed(box) {
      var b = box.querySelector('[aria-pressed="true"]');
      if (b) b.focus();
    }

    function pickLanguage(langs) {
      function find(code) {
        return code ? langs.filter(function (l) { return l.code === code; })[0] : null;
      }
      var stored = cleanLang(storageGet('luma.lang'));
      var chosen = find(wantLang) || find(stored) || langs[0] || null;
      var wanted = wantLang || stored;
      if (chosen && wanted && chosen.code !== wanted) {
        showToast(wanted + ' indisponible pour cet épisode : lecture en ' + (chosen.name || chosen.code), 'warning');
      }
      return chosen;
    }

    // Lecteur choisi via « Essaie un autre lecteur » : retenu pour cette visite seulement
    var sessionPlayer = {};

    function pickSource(lang, explicitKey) {
      var list = (lang && lang.sources) || [];
      function find(key) {
        return key ? list.filter(function (s) { return s.provider === key; })[0] : null;
      }
      return find(explicitKey) || find(sessionPlayer[lang.code]) || find(cleanPlayer(storageGet('luma.player.' + lang.code))) || list[0] || null;
    }

    function saveEmbedProgress() {
      if (embedSaved || mode !== 'embed' || !currentMeta || typeof saveContinueWatching !== 'function') return;
      embedSaved = true;
      saveContinueWatching(Object.assign({}, currentMeta, { embed: true }));
    }

    langsBox.addEventListener('click', function (e) {
      var b = e.target.closest('[data-lang-index]');
      var l = b && playback && playback.languages[Number(b.getAttribute('data-lang-index'))];
      if (!l || l === currentLang) return;
      currentLang = l;
      preferredLang = l.code;
      storageSet('luma.lang', l.code);
      playSource(pickSource(l, null));
      renderEpisodeList();
      focusPressed(langsBox);
    });

    hostsBox.addEventListener('click', function (e) {
      var b = e.target.closest('[data-source-index]');
      var s = b && currentLang && (currentLang.sources || [])[Number(b.getAttribute('data-source-index'))];
      if (!s || s === currentSource) return;
      storageSet('luma.player.' + currentLang.code, s.provider);
      playSource(s);
      focusPressed(hostsBox);
    });

    otherBtn.addEventListener('click', function () {
      var list = (currentLang && currentLang.sources) || [];
      if (list.length < 2) return;
      var next = list[(list.indexOf(currentSource) + 1) % list.length];
      sessionPlayer[currentLang.code] = next.provider;
      playSource(next);
      if (typeof announce === 'function') announce('Lecteur : ' + (next.provider_name || next.provider));
    });

    reportBtn.addEventListener('click', async function () {
      var src = currentSource;
      if (!src || !src.id || reported[src.id] || reporting || typeof reportBrokenSource !== 'function') return;
      reporting = true;
      renderReportButton();
      var res = null;
      try { res = await reportBrokenSource(src.id); } catch (e) {}
      reporting = false;
      if (res && res.ok) {
        reported[src.id] = true;
        showToast('Merci : le lecteur ' + (src.provider_name || src.provider) + ' a été signalé à l’équipe.', 'success');
      } else {
        showToast((res && res.error) || 'Signalement impossible pour le moment.', 'error');
      }
      renderReportButton();
    });

    function episodeItemHTML(e) {
      var current = currentEpisode && Number(e.season) === Number(currentEpisode.season) && Number(e.number) === Number(currentEpisode.number);
      var labels = (e.labels || []).filter(Boolean);
      var until = e.premium_until ? frDate(e.premium_until) : '';
      var kind = e.kind && e.kind !== 'episode' && KIND_LABELS[e.kind];
      return '<li><a class="watch-episode' + (current ? ' is-current' : '') + '" href="' + escapeHTML(episodeHref(e)) + '"' + (current ? ' aria-current="true"' : '') + '>' +
        '<span class="watch-episode-num">' + Number(e.number) + '</span>' +
        '<span class="watch-episode-name">' + escapeHTML(e.title || ((kind || 'Épisode') + ' ' + Number(e.number))) + '</span>' +
        (until
          ? '<span class="watch-episode-lock" title="' + escapeHTML('Accès anticipé Premium jusqu’au ' + until) + '">' + icon('lock') +
            '<span class="sr-only"> (accès anticipé Premium jusqu’au ' + escapeHTML(until) + ')</span></span>'
          : '') +
        (labels.length
          ? '<span class="watch-episode-langs"><span class="sr-only">Langues : </span>' + labels.map(function (l) {
              return '<span class="watch-lang">' + escapeHTML(l) + '</span>';
            }).join('<span class="sr-only">, </span>') + '</span>'
          : '') +
        (e.duration_sec ? '<span class="watch-episode-time">' + Math.round(e.duration_sec / 60) + ' min</span>' : '') +
        (current ? '<span class="sr-only"> (en cours)</span>' : '') +
      '</a></li>';
    }

    function renderEpisodeList() {
      var box = document.querySelector('[data-episodes]');
      if (!box || !allEpisodes().length) return;
      var shown = seasonsList.filter(function (s) { return (s.episodes || []).length; });
      var multi = shown.length > 1;
      box.hidden = false;
      box.innerHTML = '<h2 class="watch-episodes-title">Épisodes</h2>' + shown.map(function (s) {
        return (multi
            ? '<h3 class="watch-season">' + escapeHTML(seasonName(s.number)) +
              (s.title ? '<span class="watch-season-sub"> · ' + escapeHTML(s.title) + '</span>' : '') + '</h3>'
            : '') +
          '<ol class="watch-episode-list">' + s.episodes.map(episodeItemHTML).join('') + '</ol>';
      }).join('');
      if (!listScrolled) {
        var cur = box.querySelector('.watch-episode.is-current');
        if (cur && cur.scrollIntoView) { cur.scrollIntoView({ block: 'nearest' }); listScrolled = true; }
      }
    }
    var listScrolled = false;

    // ?mal= → fiche AniList ; fiche AniList qui est la saison N d'une autre série → série + saison N
    async function resolveAnime() {
      if (!animeId && malId) {
        try {
          var m = await fetchAnimeDetails(new URLSearchParams('mal=' + Number(malId)));
          animeId = (m && Number(m.id)) || 0;
        } catch (e) {
          animeId = 0;
        }
        if (animeId) setQuery(pageQuery(season, episode, wantLang, wantPlayer));
      }
      if (!animeId || typeof publicAvailableAnimes !== 'function') return;
      var res = await publicAvailableAnimes([animeId]);
      var hit = res && res.ok
        ? (res.items || []).filter(function (x) { return Number(x.anilist_id) === animeId; })[0]
        : null;
      if (hit && Number(hit.root) && Number(hit.root) !== animeId) {
        var requestedId = animeId;
        animeId = Number(hit.root);
        if (typeof removeContinueWatching === 'function') removeContinueWatching('a' + requestedId).then(function () {}, function () {});
        if (hit.season !== null && hit.season !== undefined) {
          season = Number(hit.season);
          if (episode === null && hit.first && Number(hit.first.season) === season) episode = Number(hit.first.number);
        }
        setQuery(pageQuery(season, episode, wantLang, wantPlayer));
      }
    }

    async function loadEpisodes() {
      try {
        await resolveAnime();
        if (!animeId || typeof publicEpisodeList !== 'function' || typeof publicEpisodePlayback !== 'function') {
          showNoVideo();
          return;
        }

        var list = await publicEpisodeList(animeId);
        seasonsList = list.ok && Array.isArray(list.seasons) ? list.seasons : [];
        var flat = allEpisodes();
        var target = null;

        if (adminPreview) {
          // Aperçu admin : l'épisode demandé, même s'il n'est pas encore public (jamais un autre)
          target = findEpisode(season === null ? 1 : season, episode === null ? 1 : episode) ||
            { season: season === null ? 1 : season, number: episode === null ? 1 : episode };
        } else if (flat.length) {
          var sameSeason = season === null ? [] : flat.filter(function (e) { return Number(e.season) === season; });
          if (season === null && episode === null) target = flat[0];
          else if (episode === null) target = sameSeason[0] || null;
          else target = findEpisode(season, episode);
          if (!target) {
            target = sameSeason[0] || flat[0];
            showToast('Épisode introuvable : lecture de l’épisode ' + Number(target.number) +
              (Number(target.season) === 1 ? '' : ' (' + seasonName(target.season).toLowerCase() + ')'), 'warning');
          }
        } else if (!list.ok) {
          // Liste indisponible : on tente l'épisode demandé
          target = { season: season === null ? 1 : season, number: episode === null ? 1 : episode };
        } else {
          showNoVideo();
          return;
        }

        season = Number(target.season);
        episode = Number(target.number);
        currentEpisode = target;

        var res = null;
        if (adminPreview) {
          res = await adminEpisodePlayback(animeId, season, episode);
          if (res.ok) showToast('Aperçu administrateur : les sources non publiées ou à vérifier sont visibles ici uniquement.', 'warning');
          else if (res.reason !== 'not_found') { adminPreview = false; res = null; }
        }
        if (!res) res = await publicEpisodePlayback(animeId, season, episode);

        if (!res.ok) {
          currentEpisode = Object.assign({}, target, res.episode || {});
          setQuery(pageQuery(season, episode, wantLang, wantPlayer));
          renderEpisodeList();
          if (res.reason === 'premium_only') await showPremiumOnly(res);
          else if (res.reason === 'not_found' && !flat.length) showNoVideo();
          else showUnavailable(res.reason === 'not_found' ? '' : res.error);
          return;
        }

        playback = res;
        playerTitle.textContent = episodeLabel(Object.assign({}, target, res.episode || {}));
        playback.languages = (res.languages || []).filter(function (l) { return l && (l.sources || []).length; });
        currentEpisode = Object.assign({}, target, res.episode || {});
        currentLang = pickLanguage(playback.languages);
        if (!currentLang) {
          showNoVideo();
          return;
        }
        playSource(pickSource(currentLang, wantPlayer));
        renderEpisodeList();
      } catch (err) {
        console.error('Lecteur :', err);
        showNoVideo();
      }
    }

    video.addEventListener('ended', function () {
      var next = playback && playback.next;
      if (mode !== 'direct' || !next) return;
      if (Number(next.season) === 0 || (next.kind && next.kind !== 'episode')) {
        showToast('Épisode terminé. La suite est un épisode spécial : choisis-le dans la liste si tu veux le voir.', 'success');
        return;
      }
      showToast('Épisode suivant : ' + episodeLabel(findEpisode(next.season, next.number) || next) + '.', 'success');
      setTimeout(function () { location.href = episodeHref(next); }, 1500);
    });

    async function loadMeta() {
      if (!animeId) {
        titleEl.textContent =
          'Titre non disponible';

        metaEl.textContent =
          'Aucun anime sélectionné.';

        return;
      }

      try {
        var m =
          await fetchAnimeDetails(
            params
          );

        var a =
          m &&
          toAnime(m);

        if (
          !a ||
          a.isAdult
        ) {
          titleEl.textContent =
            'Titre non disponible';

          metaEl.textContent =
            'Ce titre n’est pas affiché sur LumaAnime.';

          return;
        }

        document.title =
          a.title +
          ' — Lecteur LumaAnime';

        if (
          typeof trackTitleView ===
          'function'
        ) {
          trackTitleView(
            a.id,
            a.title
          );
        }

        titleEl.textContent =
          a.title;

        playerTitle.textContent =
          a.title +
          (currentEpisode
            ? ' · ' + episodeLabel(currentEpisode)
            : '');

        backLink.href =
          detailsHref(a);

        var meta =
          [
            typeFr(a.format),
            a.episodes
              ? a.episodes +
                ' épisode' +
                (a.episodes > 1
                  ? 's'
                  : '')
              : null,
            a.score
              ? 'Note AniList ' +
                scoreFr(
                  a.score
                ) +
                '/100'
              : null,
            a.year
          ]
            .filter(Boolean)
            .join(' · ');

        metaEl.textContent =
          meta;

        actionsEl.innerHTML =
          listToggleButtonHTML(
            'watchlist',
            listAnime(a),
            'btn-sm'
          ) +
          listToggleButtonHTML(
            'favorites',
            listAnime(a),
            'btn-sm'
          ) +
          '<a class="btn btn-sm btn-ghost" href="' +
          detailsHref(a) +
          '">' +
          icon('info') +
          '<span>Voir la fiche</span></a>';

        refreshListButtons();

        $('[data-info-title]')
          .textContent =
          a.title;

        $('[data-info-meta]')
          .textContent =
          meta;

        var infoLink =
          $('[data-info-link]');

        infoLink.href =
          detailsHref(a);

        infoLink.hidden =
          false;

        if (a.image) {
          var poster =
            $('[data-info-poster]');

          poster.src =
            a.image;

          poster.hidden =
            false;
        }

        if (a.description) {
          synopsisEl.hidden =
            false;

          synopsisEl.textContent =
            'Traduction du synopsis en cours…';

          applyFrenchSynopsis(
            synopsisEl,
            a.id,
            a.description,
            700,
            function (
              translated
            ) {
              $('[data-info-text]')
                .textContent =
                truncate(
                  synopsisEl.textContent,
                  260
                );

              $('[data-info-text]')
                .setAttribute(
                  'lang',
                  translated
                    ? 'fr'
                    : 'en'
                );

              synopsisNote.hidden =
                false;

              synopsisNote.textContent =
                translated
                  ? 'Synopsis traduit automatiquement de l’anglais (source : AniList).'
                  : 'Synopsis en anglais (source : AniList).';
            }
          );
        }

        currentMeta = {
          id: a.id,
          src: 'anilist',
          malId: a.malId,
          title: a.title,
          image: a.image,
          type:
            a.format ||
            'TV',
          season: season,
          episode: episode
        };

        tryResume();

        saveEmbedProgress();
      } catch (err) {
        titleEl.textContent =
          'Informations indisponibles';

        metaEl.textContent =
          'AniList ne répond pas actuellement.';
      }
    }

    video.addEventListener(
      'loadedmetadata',
      function () {
        seek.max =
          video.duration || 0;

        seek.disabled =
          false;

        renderTime();

        // Changement de lecteur ou de langue : on reprend au même moment
        if (carryTime) {
          if (carryTime < video.duration - 2) {
            video.currentTime = carryTime;
          }

          carryTime = 0;
          renderTime();
        }

        tryResume();
      }
    );

    [
      'play',
      'pause',
      'ended'
    ].forEach(
      function (t) {
        video.addEventListener(
          t,
          renderPlay
        );
      }
    );

    video.addEventListener(
      'timeupdate',
      renderTime
    );

    video.addEventListener(
      'progress',
      renderBuffer
    );

    video.addEventListener(
      'volumechange',
      renderMute
    );

    video.addEventListener(
      'click',
      togglePlay
    );

    video.addEventListener(
      'dblclick',
      toggleFullscreen
    );

    video.addEventListener(
      'error',
      function () {
        if (mode !== 'direct' || !video.getAttribute('src')) {
          return;
        }

        showToast(
          'La vidéo est indisponible ou n’a pas pu être chargée.',
          'error'
        );
      },
      true
    );

    overlay.addEventListener(
      'click',
      togglePlay
    );

    playBtn.addEventListener(
      'click',
      togglePlay
    );

    player
      .querySelectorAll(
        '[data-skip]'
      )
      .forEach(
        function (b) {
          b.addEventListener(
            'click',
            function () {
              skip(
                Number(
                  b.getAttribute(
                    'data-skip'
                  )
                )
              );
            }
          );
        }
      );

    seek.addEventListener(
      'input',
      function () {
        video.currentTime =
          Number(
            seek.value
          );

        renderTime();
      }
    );

    seek.addEventListener(
      'pointermove',
      function (e) {
        var r =
          seek.getBoundingClientRect();

        var ratio =
          Math.max(
            0,
            Math.min(
              1,
              (e.clientX -
                r.left) /
                r.width
            )
          );

        tip.textContent =
          fmt(
            ratio *
              (video.duration ||
                0)
          );

        tip.style.left =
          ratio * 100 +
          '%';

        tip.hidden =
          !video.duration;
      }
    );

    seek.addEventListener(
      'pointerleave',
      function () {
        tip.hidden = true;
      }
    );

    volume.addEventListener(
      'input',
      function () {
        video.volume =
          Number(
            volume.value
          );

        video.muted =
          video.volume === 0;
      }
    );

    muteBtn.addEventListener(
      'click',
      toggleMute
    );

    fsBtn.addEventListener(
      'click',
      toggleFullscreen
    );

    document.addEventListener(
      'fullscreenchange',
      renderFullscreen
    );

    infoBtn.addEventListener(
      'click',
      function () {
        setPanel(
          infoPanel.hidden
        );
      }
    );

    settingsBtn.addEventListener(
      'click',
      function () {
        var open =
          settingsMenu.hidden;

        settingsMenu.hidden =
          !open;

        settingsBtn.setAttribute(
          'aria-expanded',
          String(open)
        );

        if (open) {
          setPanel(false);

          renderSpeeds();

          var cur =
            settingsMenu.querySelector(
              '[aria-checked="true"]'
            );

          if (cur) {
            cur.focus();
          }
        }
      }
    );

    document.addEventListener(
      'click',
      function (e) {
        if (
          !settingsMenu.hidden &&
          !settingsMenu.contains(
            e.target
          ) &&
          !settingsBtn.contains(
            e.target
          )
        ) {
          closeMenu();
        }
      }
    );

    if (
      document.pictureInPictureEnabled &&
      video.requestPictureInPicture
    ) {
      pipBtn.hidden =
        false;

      pipBtn.addEventListener(
        'click',
        function () {
          if (
            document.pictureInPictureElement
          ) {
            document
              .exitPictureInPicture()
              .catch(
                function () {}
              );
          } else {
            video
              .requestPictureInPicture()
              .catch(
                function () {
                  showToast(
                    'L’image dans l’image n’est pas disponible ici.',
                    'warning'
                  );
                }
              );
          }
        }
      );
    }

    if (
      video.remote &&
      video.remote.watchAvailability
    ) {
      video.remote
        .watchAvailability(
          function (
            available
          ) {
            castBtn.hidden =
              !available;
          }
        )
        .catch(
          function () {}
        );

      castBtn.addEventListener(
        'click',
        function () {
          video.remote
            .prompt()
            .catch(
              function () {}
            );
        }
      );
    }

    player.addEventListener(
      'keydown',
      function (e) {
        if (
          e.altKey ||
          e.ctrlKey ||
          e.metaKey
        ) {
          return;
        }

        var onRange =
          e.target === seek ||
          e.target === volume;

        var key =
          e.key.toLowerCase();

        if (
          key === 'escape'
        ) {
          closeMenu();
          setPanel(false);
          return;
        }

        if (
          mode !== 'direct' &&
          key !== 'f' &&
          key !== 'i'
        ) {
          return;
        }

        if (
          onRange &&
          [
            'arrowleft',
            'arrowright',
            'arrowup',
            'arrowdown'
          ].includes(key)
        ) {
          return;
        }

        if (
          key === 'k' ||
          (
            key === ' ' &&
            (
              e.target ===
                player ||
              e.target ===
                video
            )
          )
        ) {
          e.preventDefault();
          togglePlay();
        } else if (
          key === 'j' ||
          key === 'arrowleft'
        ) {
          e.preventDefault();
          skip(-10);
        } else if (
          key === 'l' ||
          key === 'arrowright'
        ) {
          e.preventDefault();
          skip(10);
        } else if (
          key === 'm'
        ) {
          e.preventDefault();
          toggleMute();
        } else if (
          key === 'f'
        ) {
          e.preventDefault();
          toggleFullscreen();
        } else if (
          key === 'i'
        ) {
          e.preventDefault();
          setPanel(
            infoPanel.hidden
          );
        }
      }
    );

    player.tabIndex = -1;

    var idleTimer = null;

    function wake() {
      player.classList.remove(
        'is-idle'
      );

      clearTimeout(
        idleTimer
      );

      idleTimer =
        setTimeout(
          function () {
            if (
              settingsMenu.hidden &&
              infoPanel.hidden &&
              !player.querySelector(
                '.wp-bar:hover, .wp-top:hover'
              )
            ) {
              player.classList.add(
                'is-idle'
              );
            }
          },
          2800
        );
    }

    player.addEventListener(
      'mousemove',
      wake
    );

    player.addEventListener(
      'focusin',
      wake
    );

    player.addEventListener(
      'touchstart',
      wake,
      {
        passive: true
      }
    );

    var resumed = false;

    // Numéro de saison/épisode d'une entrée « Reprendre » : 0 est valide (spéciaux), seul l'absent vaut 1
    function resumeNum(v) {
      var n = Number(v);
      return v === null || v === undefined || v === '' || !Number.isInteger(n) ? 1 : n;
    }

    async function tryResume() {
      if (
        resumed ||
        !currentMeta ||
        !isFinite(
          video.duration
        )
      ) {
        return;
      }

      resumed = true;

      var user =
        typeof getCurrentUser ===
        'function'
          ? await getCurrentUser()
          : null;

      var saved =
        (
          (user &&
            user.continueWatching) ||
          []
        ).filter(
          function (x) {
            return sameContinueEntry(
              x,
              currentMeta
            ) &&
              resumeNum(x.season) === resumeNum(currentMeta.season) &&
              resumeNum(x.episode) === resumeNum(currentMeta.episode);
          }
        )[0];

      if (
        saved &&
        saved.currentTime &&
        saved.currentTime <
          video.duration - 2
      ) {
        video.currentTime =
          saved.currentTime;

        showToast(
          'Lecture reprise à ' +
            fmt(
              saved.currentTime
            ) +
            '.',
          'success'
        );
      }
    }

    var lastSave = 0;

    function saveProgress() {
      if (
        !currentMeta ||
        !video.duration ||
        video.currentTime < 3 ||
        typeof saveContinueWatching !==
          'function'
      ) {
        return;
      }

      saveContinueWatching(
        Object.assign(
          {},
          currentMeta,
          {
            currentTime:
              video.currentTime,
            duration:
              video.duration
          }
        )
      );
    }

    video.addEventListener(
      'timeupdate',
      function () {
        if (
          Date.now() -
            lastSave >
          5000
        ) {
          lastSave =
            Date.now();

          saveProgress();
        }
      }
    );

    video.addEventListener(
      'pause',
      saveProgress
    );

    window.addEventListener(
      'pagehide',
      saveProgress
    );

    seek.disabled = true;

    renderPlay();
    renderMute();
    renderFullscreen();
    renderTime();
    wake();

    loadEpisodes().then(loadMeta, loadMeta);
  }
);