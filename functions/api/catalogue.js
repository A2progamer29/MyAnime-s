// GET /api/catalogue — relais vers le catalogue partenaire UQFlex.
// La clé reste côté serveur (variable UQFLEX_API_KEY). Seules les métadonnées d'affichage sont renvoyées :
// aucun lien de lecture, de téléchargement ou d'intégration n'est transmis au navigateur.
import { json } from './_lib.js';

const BASE = 'https://watch.scoope.fr/api/partner';

// Certains textes du catalogue arrivent doublement encodés (UTF-8 relu en CP850, ex. « Cin├®ma ») : on les répare
const CP850_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ';

function repairText(value) {
  const text = String(value || '');
  if (!/[├┬┼]/.test(text)) return text;
  const bytes = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 0x80) { bytes.push(code); continue; }
    const index = CP850_HIGH.indexOf(ch);
    if (index === -1) return text;
    bytes.push(0x80 + index);
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)); } catch { return text; }
}

function tmdbImage(url, size) {
  const value = String(url || '');
  if (!/^https:\/\/image\.tmdb\.org\/t\/p\//.test(value)) return null;
  return value.replace(/\/t\/p\/[^/]+\//, `/t/p/${size}/`);
}

function toItem(raw) {
  const series = raw.type === 'series';
  return {
    id: String(raw.id),
    type: series ? 'series' : 'movie',
    title: repairText(raw.title),
    year: Number(raw.year) || null,
    poster: tmdbImage(raw.poster_url, 'w342'),
    backdrop: tmdbImage(raw.backdrop_url, 'w1280'),
    genres: Array.isArray(raw.genres) ? [...new Set(raw.genres.map(repairText))].slice(0, 6) : [],
    rating: typeof raw.rating === 'number' ? Math.round(raw.rating * 10) / 10 : null,
    overview: repairText(raw.overview),
    seasons: series ? Number(raw.seasons) || null : null,
    episodes: series ? Number(raw.episodes_count) || null : null
  };
}

export async function onRequestGet({ request, env }) {
  if (!env.UQFLEX_API_KEY) return json({ error: 'Le catalogue partenaire n’est pas configuré.' }, 503);

  const res = await fetch(`${BASE}/v1/catalog`, {
    headers: { 'x-api-key': env.UQFLEX_API_KEY },
    cf: { cacheTtl: 600, cacheEverything: true }
  });
  if (!res.ok) return json({ error: 'Le catalogue partenaire ne répond pas.' }, 502);

  const data = await res.json();
  const items = (data.items || []).map(toItem).filter((item) => item.title);
  const id = new URL(request.url).searchParams.get('id');

  if (id) {
    const item = items.find((i) => i.id === id);
    return item ? json({ item }, 200, { 'Cache-Control': 'public, max-age=600' }) : json({ error: 'Titre introuvable.' }, 404);
  }
  const list = items.map(({ overview, backdrop, ...rest }) => rest);
  return json({ items: list }, 200, { 'Cache-Control': 'public, max-age=600' });
}
