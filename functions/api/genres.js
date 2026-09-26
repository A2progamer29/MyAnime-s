// GET /api/genres — liste des images de genres réellement présentes dans assets/ (<nom>-banner.png).
// La vérification se fait côté serveur : le navigateur ne demande jamais une image absente.
import { json } from './_lib.js';

const SLUGS = ['action', 'romance', 'comedie', 'isekai', 'seinen', 'sport', 'horreur', 'tranche-de-vie', 'fantasy', 'mecha'];

export async function onRequestGet({ request, env }) {
  const origin = new URL(request.url).origin;
  const found = await Promise.all(SLUGS.map(async (slug) => {
    try {
      const res = await env.ASSETS.fetch(new Request(`${origin}/assets/${slug}-banner.png`, { method: 'HEAD' }));
      return res.ok ? slug : null;
    } catch {
      return null;
    }
  }));
  return json({ banners: found.filter(Boolean) }, 200, { 'Cache-Control': 'public, max-age=300' });
}
