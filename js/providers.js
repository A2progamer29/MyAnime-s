/* =========================================================
   LumaAnime — providers.js
   Lecteurs vidéo (providers) : reconnaissance d'un lien collé par l'admin, contrôle des adresses
   d'intégration et création sûre des iframes. La configuration (hôtes autorisés, priorité, format)
   vient de la base (table providers) ; ce fichier ne contient que ce qui est propre à chaque lecteur.
   Chaque lecteur expose la même interface : key, name, parse(url), embedUrl(id), checkAvailability.
   checkAvailability vaut null quand le lecteur ne documente aucun moyen officiel de vérifier un fichier.
   ========================================================= */

var LumaProviders = (function () {
  // Lecteurs connus. Seuls les formats documentés ou observés sur les liens du lecteur sont reconnus.
  var KNOWN = {
    voe: {
      key: 'voe',
      name: 'VOE',
      parse: function (u) {
        if (!/(^|\.)voe\.sx$/.test(u.hostname)) return null;
        var m = u.pathname.match(/^\/(?:e\/)?([A-Za-z0-9]{8,16})\/?$/);
        return m ? { id: m[1] } : null;
      },
      embedUrl: function (id) { return 'https://voe.sx/e/' + encodeURIComponent(id); },
      checkAvailability: null
    },
    vidmoly: {
      key: 'vidmoly',
      name: 'Vidmoly',
      // Pas de format d'intégration officiel publié : on garde le lien d'intégration copié chez Vidmoly
      parse: function (u) {
        if (!/(^|\.)vidmoly\.(to|me)$/.test(u.hostname)) return null;
        return { url: u.href };
      },
      embedUrl: null,
      checkAvailability: null
    },
    lumaanime: {
      key: 'lumaanime',
      name: 'LumaAnime',
      // Fichier vidéo direct (MP4/WebM) hébergé par LumaAnime : lu dans le lecteur du site
      parse: function (u) { return /\.(mp4|webm|m4v)(\?|$)/i.test(u.pathname + u.search) ? { url: u.href } : null; },
      embedUrl: null,
      checkAvailability: null
    }
  };

  function toUrl(raw) {
    var text = String(raw || '').trim();
    var src = text.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (src) text = src[1];
    try { return new URL(text); } catch (e) { return null; }
  }

  function hostAllowed(host, provider) {
    // Jamais le site lui-même dans une iframe : le bac à sable ne protégerait plus rien
    if (typeof location !== 'undefined' && location.hostname && host === location.hostname.toLowerCase()) return false;
    var hosts = (provider && provider.hosts) || [];
    if (!hosts.length) return provider && provider.kind === 'direct';
    return hosts.indexOf(host) !== -1;
  }

  // Adresse sûre pour une iframe ou une balise vidéo : https, sans identifiants ni port, hôte autorisé.
  function safeEmbedUrl(raw, provider) {
    var u = toUrl(raw);
    if (!u || u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    if (!provider || !hostAllowed(u.hostname.toLowerCase(), provider)) return null;
    return u.href;
  }

  // Reconnaît le lecteur d'un lien collé (page de visionnage, lien d'intégration ou code <iframe>).
  // providers = liste venant de la base ({ key, kind, hosts, embed_template, … }).
  function parse(raw, providers) {
    var u = toUrl(raw);
    if (!u || u.protocol !== 'https:') return null;
    var host = u.hostname.toLowerCase();
    var list = providers || [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!hostAllowed(host, p)) continue;
      var known = KNOWN[p.key];
      var got = known ? known.parse(u) : null;
      if (got && got.id) return { provider: p.key, id: got.id, url: known.embedUrl ? known.embedUrl(got.id) : null };
      if (got && got.url) return { provider: p.key, id: null, url: got.url };
      if (!known && p.embed_template) {
        var re = new RegExp('^' + p.embed_template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{id\\}', '([A-Za-z0-9_-]{1,64})') + '$');
        var m = u.href.match(re);
        if (m) return { provider: p.key, id: m[1], url: u.href };
      }
      if (!known && p.kind === 'direct' && !((p.hosts || []).length) && !/\.(mp4|webm|m4v)(\?|$)/i.test(u.pathname + u.search)) continue;
      if (!known) return { provider: p.key, id: null, url: u.href };
    }
    return null;
  }

  // Iframe créée sans innerHTML. Le bac à sable (sandbox) bloque les fenêtres surgissantes et la
  // navigation de la page par le lecteur ; il se désactive par lecteur dans l'admin s'il gêne la lecture.
  function createFrame(src, source) {
    var frame = document.createElement('iframe');
    frame.src = src;
    frame.title = 'Lecteur ' + ((source && source.provider_name) || 'vidéo');
    frame.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media');
    frame.setAttribute('allowfullscreen', '');
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    frame.setAttribute('loading', 'eager');
    if (!source || source.sandbox !== false) frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-forms');
    return frame;
  }

  return { known: KNOWN, parse: parse, safeEmbedUrl: safeEmbedUrl, createFrame: createFrame, toUrl: toUrl };
})();

/* ---- Versions linguistiques ----
   Le libellé (VF, VOSTFR…) est toujours calculé par le serveur ; ces préréglages servent seulement à
   remplir rapidement le formulaire de l'admin avec des valeurs structurées. « original » = langue
   d'origine de l'anime (ex. japonais). */
var LANGUAGE_PRESETS = [
  { code: 'VOSTFR', audio_kind: 'original', audio_lang: null, subtitle_kind: 'hard', subtitle_lang: 'fr' },
  { code: 'VF', audio_kind: 'dub', audio_lang: 'fr', subtitle_kind: 'none', subtitle_lang: null },
  { code: 'VO', audio_kind: 'original', audio_lang: null, subtitle_kind: 'none', subtitle_lang: null },
  { code: 'VOSTEN', audio_kind: 'original', audio_lang: null, subtitle_kind: 'hard', subtitle_lang: 'en' },
  { code: 'VOSTES', audio_kind: 'original', audio_lang: null, subtitle_kind: 'hard', subtitle_lang: 'es' },
  { code: 'VOSTDE', audio_kind: 'original', audio_lang: null, subtitle_kind: 'hard', subtitle_lang: 'de' },
  { code: 'VOSTIT', audio_kind: 'original', audio_lang: null, subtitle_kind: 'hard', subtitle_lang: 'it' },
  { code: 'VOSTPT', audio_kind: 'original', audio_lang: null, subtitle_kind: 'hard', subtitle_lang: 'pt' },
  { code: 'VOSTNL', audio_kind: 'original', audio_lang: null, subtitle_kind: 'hard', subtitle_lang: 'nl' }
];

function languagePreset(code, originalLang) {
  var p = LANGUAGE_PRESETS.filter(function (x) { return x.code === code; })[0];
  if (!p) return null;
  return {
    audio_kind: p.audio_kind,
    audio_lang: p.audio_kind === 'original' ? (originalLang || null) : p.audio_lang,
    subtitle_kind: p.subtitle_kind,
    subtitle_lang: p.subtitle_lang
  };
}
