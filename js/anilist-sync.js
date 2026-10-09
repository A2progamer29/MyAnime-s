/* =========================================================
   LumaAnime — anilist-sync.js
   Appels AniList de l'administration : recherche d'un anime, lecture des fiches et
   synchronisation des animes présents sur LumaAnime. AniList refuse les serveurs Cloudflare :
   tout passe par le navigateur de l'admin, une requête à la fois, 2,5 s au moins entre deux
   (24 requêtes par minute au plus, sous la limite de 30). Seuls les animes du site sont lus,
   jamais le catalogue entier (conditions d'utilisation d'AniList).
   ========================================================= */

(function () {
  var ENDPOINT = 'https://graphql.anilist.co';
  var GAP_MS = 2500;
  var TIMEOUT_MS = 12000;
  var BATCH = 50;

  var SEARCH_QUERY = 'query ($q: String) { Page(perPage: 8) { media(search: $q, type: ANIME, isAdult: false, sort: SEARCH_MATCH) { id title { romaji english native } coverImage { medium large } format status seasonYear episodes } } }';
  var MEDIA_QUERY = 'query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) { id idMal title { romaji english native } synonyms format status episodes duration season seasonYear countryOfOrigin isAdult genres updatedAt coverImage { large } bannerImage nextAiringEpisode { episode airingAt } relations { edges { relationType node { id type format title { romaji english } } } } } } }';

  var queue = Promise.resolve();
  var lastCallAt = 0;

  function abortError() {
    var err = new Error('Synchronisation annulée.');
    err.name = 'AbortError';
    return err;
  }

  function wait(ms, signal) {
    return new Promise(function (resolve, reject) {
      if (signal && signal.aborted) { reject(abortError()); return; }
      var timer = setTimeout(done, Math.max(0, ms));
      function done() {
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve();
      }
      function onAbort() {
        clearTimeout(timer);
        reject(abortError());
      }
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  // Un appel HTTP, coupé au bout de 12 s ou dès que l'admin annule
  async function send(query, variables, signal) {
    var ctrl = new AbortController();
    var timedOut = false;
    var timer = setTimeout(function () { timedOut = true; ctrl.abort(); }, TIMEOUT_MS);
    var onAbort = function () { ctrl.abort(); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    try {
      return await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: query, variables: variables || {} }),
        signal: ctrl.signal
      });
    } catch (err) {
      if (signal && signal.aborted) throw abortError();
      if (timedOut) throw new Error("AniList n'a pas répondu à temps (12 secondes). Réessaie dans un moment.");
      throw new Error("AniList est injoignable : vérifie ta connexion ou désactive le bloqueur de contenu pour cette page.");
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  async function run(query, variables, signal) {
    for (var attempt = 0; attempt < 2; attempt++) {
      await wait(lastCallAt + GAP_MS - Date.now(), signal);
      lastCallAt = Date.now();
      var res;
      try { res = await send(query, variables, signal); } finally { lastCallAt = Date.now(); }
      if (res.status === 429 && attempt === 0) {
        // Trop de requêtes : on attend le délai demandé par AniList, puis un seul nouvel essai
        var after = Number(res.headers.get('Retry-After'));
        await wait((after > 0 ? Math.min(after, 120) : 60) * 1000, signal);
        continue;
      }
      var json = null;
      try { json = await res.json(); } catch (e) { json = null; }
      if (res.status === 429) throw new Error('AniList limite le nombre de requêtes : réessaie dans une minute.');
      var apiError = json && json.errors && json.errors[0] && json.errors[0].message;
      if (!res.ok || !json || apiError) {
        throw new Error('AniList a refusé la demande' + (apiError ? ' : ' + String(apiError).slice(0, 200) : ' (erreur ' + res.status + ')') + '.');
      }
      return json.data || {};
    }
    throw new Error('AniList limite le nombre de requêtes : réessaie dans une minute.');
  }

  // File d'attente : un seul appel à la fois, dans l'ordre des demandes
  function request(query, variables, signal) {
    var job = queue.then(function () { return run(query, variables, signal); });
    queue = job.catch(function () {});
    return job;
  }

  async function anilistSearchAnime(text, signal) {
    var q = String(text || '').trim().slice(0, 100);
    if (q.length < 2) return [];
    var data = await request(SEARCH_QUERY, { q: q }, signal);
    return (data.Page && data.Page.media) || [];
  }

  async function anilistFetchMedia(ids, signal) {
    var seen = {};
    var list = (ids || []).map(Number).filter(function (n) {
      if (!Number.isInteger(n) || n < 1 || n > 10000000 || seen[n]) return false;
      seen[n] = true;
      return true;
    });
    var out = [];
    for (var i = 0; i < list.length; i += BATCH) {
      var data = await request(MEDIA_QUERY, { ids: list.slice(i, i + BATCH) }, signal);
      out = out.concat((data.Page && data.Page.media) || []);
    }
    return out;
  }

  function mediaTitle(m) {
    return (m && m.title && (m.title.english || m.title.romaji || m.title.native)) || ('Anime #' + (m && m.id));
  }

  // Synchronise les animes du site qui en ont besoin (liste choisie par le serveur).
  // Une erreur sur un anime n'arrête pas la synchro ; l'admin peut annuler à tout moment.
  async function runAnilistSync(opts) {
    opts = opts || {};
    var signal = opts.signal;
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};
    var stats = { total: 0, done: 0, failed: 0, created: 0 };
    var errors = [];
    var fatal = null;

    function progress(current) {
      try { onProgress({ total: stats.total, done: stats.done, failed: stats.failed, created: stats.created, current: current || '' }); } catch (e) {}
    }
    function note(message) {
      if (errors.length < 5 && errors.indexOf(message) === -1) errors.push(message);
    }

    var list = await adminAnimesToSync(100);
    if (!list.ok) {
      fatal = list.error || 'Liste des animes à synchroniser indisponible.';
    } else {
      var ids = (list.ids || []).map(Number).filter(function (n) { return Number.isInteger(n) && n > 0; });
      stats.total = ids.length;
      progress('');
      for (var i = 0; i < ids.length; i += BATCH) {
        if (signal && signal.aborted) break;
        var chunk = ids.slice(i, i + BATCH);
        var medias;
        try {
          medias = await anilistFetchMedia(chunk, signal);
        } catch (err) {
          if (err && err.name === 'AbortError') break;
          stats.failed += chunk.length;
          note(err.message);
          progress('');
          continue;
        }
        var byId = {};
        medias.forEach(function (m) { if (m && m.id) byId[m.id] = m; });
        for (var j = 0; j < chunk.length; j++) {
          if (signal && signal.aborted) break;
          var media = byId[chunk[j]];
          if (!media) {
            stats.failed++;
            note('Anime n°' + chunk[j] + ' introuvable sur AniList.');
            if (typeof adminSyncFailed === 'function') await adminSyncFailed(chunk[j], 'Introuvable sur AniList');
            progress('');
            continue;
          }
          var res = await adminSyncAnime(media, !!opts.createMissing);
          if (res.ok) {
            stats.done++;
            stats.created += Number(res.created) || 0;
          } else {
            stats.failed++;
            note(mediaTitle(media) + ' : ' + (res.error || 'refusé par le serveur'));
            if (typeof adminSyncFailed === 'function') await adminSyncFailed(chunk[j], res.error || 'refusé par le serveur');
          }
          progress(mediaTitle(media));
        }
      }
      if (stats.total > 0 && stats.done === 0 && stats.failed > 0) fatal = errors[0] || 'Aucun anime n\'a pu être synchronisé.';
    }

    var cancelled = !!(signal && signal.aborted);
    var ok = !cancelled && !fatal;
    var message = cancelled ? 'Synchronisation annulée.' : fatal || (stats.failed ? stats.failed + ' anime(s) en échec : ' + errors.join(' · ') : null);
    var info = { done: stats.done, failed: stats.failed, created: stats.created, total: stats.total };
    if (errors.length) info.errors = errors;
    await adminSyncLog(ok, ok ? null : message, info);
    return { ok: ok, cancelled: cancelled, error: message, errors: errors, total: stats.total, done: stats.done, failed: stats.failed, created: stats.created };
  }

  window.anilistSearchAnime = anilistSearchAnime;
  window.anilistFetchMedia = anilistFetchMedia;
  window.runAnilistSync = runAnilistSync;
})();
