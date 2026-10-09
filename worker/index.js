import { onRequestGet as catalogue } from '../functions/api/catalogue.js';
import { onRequestGet as synopsis } from '../functions/api/synopsis.js';
import { onRequestGet as checkoutStatus } from '../functions/api/checkout/status.js';
import { onRequestPost as checkoutCreate } from '../functions/api/checkout/create.js';
import { onRequestPost as checkoutComplete } from '../functions/api/checkout/complete.js';
import { onRequestPost as checkoutCancel } from '../functions/api/checkout/cancel.js';
import { onRequestPost as engage } from '../functions/api/engage.js';
import { onRequestPost as cspReport } from '../functions/api/csp-report.js';

const ROUTES = {
  'GET /api/catalogue': catalogue,
  'GET /api/synopsis': synopsis,
  'GET /api/checkout/status': checkoutStatus,
  'POST /api/checkout/create': checkoutCreate,
  'POST /api/checkout/complete': checkoutComplete,
  'POST /api/checkout/cancel': checkoutCancel,
  'POST /api/engage': engage,
  'POST /api/csp-report': cspReport
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
