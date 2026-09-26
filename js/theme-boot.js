/* =========================================================
   LumaAnime — theme-boot.js
   Chargé dans <head> : applique le thème mis en cache avant l'affichage
   ========================================================= */

(function () {
  // Lien de réinitialisation du mot de passe : si Supabase renvoie ailleurs (adresse de retour non autorisée),
  // on redirige vers la page prévue avant que la bibliothèque Supabase ne lise puis efface le lien.
  window.MA_INITIAL_HASH = location.hash;
  if (/type=recovery/.test(location.hash) && !/\/mot-de-passe(\.html)?\/?$/.test(location.pathname)) {
    location.replace('mot-de-passe.html' + location.hash);
    return;
  }

  var INK = '#0D0D13';
  var PAPER = '#F4F1EA';
  var SURFACE = '#1C1C26';

  var PRESETS = {
    original:  { name: 'Original',  color: '#FF4D6D', dim: '#C93A54', light: '#FFC2CE', logo: 'assets/logos/logo-original.png' },
    sakura:    { name: 'Sakura',    color: '#F472B6', dim: '#DB2777', light: '#FBCFE8', logo: 'assets/logos/logo-sakura.png' },
    amethyste: { name: 'Améthyste', color: '#A855F7', dim: '#7E22CE', light: '#D8B4FE', logo: 'assets/logos/logo-amethyste.png' },
    ocean:     { name: 'Océan',     color: '#22D3EE', dim: '#0891B2', light: '#A5F3FC', logo: 'assets/logos/logo-ocean.png' },
    emeraude:  { name: 'Émeraude',  color: '#10B981', dim: '#047857', light: '#A7F3D0', logo: 'assets/logos/logo-emeraude.png' },
    flamme:    { name: 'Flamme',    color: '#F97316', dim: '#C2410C', light: '#FED7AA', logo: 'assets/logos/logo-flamme.png' }
  };

  function luminance(hex) {
    var c = String(hex || '').replace('#', '');
    if (c.length === 3) c = c.split('').map(function (x) { return x + x; }).join('');
    if (!/^[0-9a-f]{6}$/i.test(c)) return 0;
    var rgb = [0, 2, 4].map(function (i) {
      var v = parseInt(c.substr(i, 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  }

  function contrast(a, b) {
    var x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  function apply(settings) {
    var s = settings || {};
    var preset = PRESETS[s.themePreset] || null;
    var color = s.color || (preset && preset.color) || PRESETS.original.color;
    var dim = s.colorDim || (preset && preset.dim) || color;
    var light = s.colorLight || (preset && preset.light) || color;
    var root = document.documentElement.style;
    root.setProperty('--accent', color);
    root.setProperty('--accent-strong', dim);
    root.setProperty('--accent-soft', light);
    root.setProperty('--on-accent', contrast(color, INK) >= contrast(color, PAPER) ? INK : PAPER);
    root.setProperty('--accent-text', contrast(color, SURFACE) >= 4.5 ? color : light);
    var logo = (preset && preset.logo) || PRESETS.original.logo;
    window.MA_BRAND_LOGO = logo;
    document.documentElement.setAttribute('data-logo', preset ? s.themePreset : 'original');
    document.querySelectorAll('[data-brand-logo]').forEach(function (img) { img.src = logo; });
  }

  window.MyAnimesTheme = { presets: PRESETS, apply: apply, contrast: contrast };

  // Passer à true quand les images du logo « L » sont en place dans assets/logos/
  window.MA_BRAND_IMAGE = false;

  var cached = null;
  try {
    cached = JSON.parse(localStorage.getItem('myanimes_theme_cache'));
    localStorage.removeItem('myanimes_preloaded');
  } catch (e) {}
  apply(cached);

  // Écran de chargement : seulement au premier affichage de la session, sur les pages qui le prévoient
  try {
    var html = document.documentElement;
    if (html.hasAttribute('data-preload') && !sessionStorage.getItem('ma_ready')) {
      html.classList.add('is-preloading');
      setTimeout(function () { html.classList.remove('is-preloading'); }, 15000);
    }
  } catch (e) {}
})();
