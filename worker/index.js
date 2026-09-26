// Point d'entrée du Worker « test » : les routes /api/* passent par les fonctions serveur,
// tout le reste est servi tel quel depuis les fichiers du site.
import { onRequestGet as catalogue } from '../functions/api/catalogue.js';
import { onRequestGet as synopsis } from '../functions/api/synopsis.js';
import { onRequestGet as genres } from '../functions/api/genres.js';
import { onRequestGet as checkoutStatus } from '../functions/api/checkout/status.js';
import { onRequestPost as checkoutCreate } from '../functions/api/checkout/create.js';
import { onRequestPost as checkoutComplete } from '../functions/api/checkout/complete.js';

const ROUTES = {
  'GET /api/catalogue': catalogue,
  'GET /api/synopsis': synopsis,
  'GET /api/genres': genres,
  'GET /api/checkout/status': checkoutStatus,
  'POST /api/checkout/create': checkoutCreate,
  'POST /api/checkout/complete': checkoutComplete
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const handler = ROUTES[`${request.method} ${url.pathname}`];
    if (handler) return handler({ request, env, ctx });
    if (url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Route inconnue.' }), { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }
    return env.ASSETS.fetch(request);
  }
};
