// Outils partagés des fonctions Cloudflare de LumaAnime (aucun secret ici : tout vient des variables d'environnement)

const SUPABASE_URL_DEFAULT = 'https://phjpyaiheswpuqjpdfuo.supabase.co';
// Clé anon publique (la même que js/supabase-config.js) : jamais la clé service à sa place
const SUPABASE_ANON_KEY_DEFAULT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBoanB5YWloZXN3cHVxanBkZnVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2NzQxNTIsImV4cCI6MjEwNDI1MDE1Mn0.ky2HB5r2YoGZvNth5NCADAlqdz0vaZPXmPFD4rh2ua0';

export const TIERS = {
  soutien: { name: 'Soutien', amount: 3.9 },
  soutien_plus: { name: 'Soutien +', amount: 46.8 }
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }
  });
}

// Les secrets collés à la main contiennent parfois un espace ou un retour à la ligne : on les nettoie
const clean = (value) => String(value || '').trim().replace(/^["']|["']$/g, '');

export function config(env) {
  const supabaseUrl = clean(env.SUPABASE_URL) || SUPABASE_URL_DEFAULT;
  return {
    supabaseUrl,
    anonKey: clean(env.SUPABASE_ANON_KEY) || (supabaseUrl === SUPABASE_URL_DEFAULT ? SUPABASE_ANON_KEY_DEFAULT : ''),
    serviceKey: clean(env.SUPABASE_SERVICE_ROLE_KEY),
    sumupKey: clean(env.SUMUP_API_KEY),
    merchantCode: clean(env.SUMUP_MERCHANT_CODE).toUpperCase()
  };
}

export function paymentConfigured(cfg) {
  return Boolean(cfg.serviceKey && cfg.sumupKey);
}

// Nature de la clé SumUp, sans jamais afficher la clé elle-même
export function sumupKeyKind(key) {
  if (/^sup_sk_/.test(key)) return 'secret';
  if (/^sup_pk_/.test(key)) return 'public';
  return 'unknown';
}

function findMerchantCode(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return null;
  if (typeof value.merchant_code === 'string' && value.merchant_code) return value.merchant_code;
  for (const key of Object.keys(value)) {
    const found = findMerchantCode(value[key], depth + 1);
    if (found) return found;
  }
  return null;
}

// Code marchand : variable SUMUP_MERCHANT_CODE si elle existe, sinon demandé à SumUp avec la clé API.
// Renvoie { code, status, reason } ; reason explique l'échec sans exposer de donnée sensible.
let cachedMerchantCode = null;
export async function merchantCodeInfo(cfg) {
  if (cfg.merchantCode) return { code: cfg.merchantCode, status: 200, reason: 'variable' };
  if (cachedMerchantCode) return { code: cachedMerchantCode, status: 200, reason: 'cache' };
  if (sumupKeyKind(cfg.sumupKey) === 'public') return { code: null, status: 0, reason: 'public_key' };
  let status = 0;
  for (const path of ['me', 'me/merchant-profile']) {
    const res = await sumup(cfg, path).catch(() => null);
    if (!res) { status = status || -1; continue; }
    status = res.status;
    const data = await res.json().catch(() => null);
    if (res.status === 401 || res.status === 403) {
      console.error(`SumUp /${path} : accès refusé (HTTP ${res.status})`, data && (data.error_code || data.message));
      return { code: null, status: res.status, reason: 'key_refused' };
    }
    const code = res.ok ? findMerchantCode(data) : null;
    if (code) { cachedMerchantCode = code; return { code, status: res.status, reason: 'api' }; }
    console.error(`SumUp /${path} : pas de code marchand (HTTP ${res.status})`, data ? Object.keys(data).join(',') : 'réponse vide');
  }
  return { code: null, status, reason: 'not_found' };
}

export async function merchantCode(cfg) {
  return (await merchantCodeInfo(cfg)).code;
}

export function merchantProblem(info) {
  if (info.reason === 'public_key') return 'La clé SUMUP_API_KEY est la clé publique (sup_pk_…). Il faut une clé secrète (sup_sk_…) créée dans SumUp → Paramètres → Pour les développeurs → Clés API.';
  if (info.reason === 'key_refused') return `SumUp refuse la clé API (HTTP ${info.status}) : elle est incorrecte, révoquée ou mal collée. Crée une nouvelle clé secrète (sup_sk_…) et remplace SUMUP_API_KEY.`;
  if (info.status === -1) return 'SumUp ne répond pas pour le moment. Réessaie dans quelques minutes.';
  return 'SumUp accepte la clé mais ne donne pas ton code marchand : ajoute la variable SUMUP_MERCHANT_CODE (code qui commence par M).';
}

export async function readJson(request) {
  try {
    const data = await request.json();
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}

// Requête venue d'une page du site lui-même : un autre site ne peut pas faire agir ses visiteurs ici.
// Exige un corps JSON (un formulaire ou un fetch « simple » d'un autre site est refusé) et refuse toute
// origine différente (Origin ou Sec-Fetch-Site).
export function sameOriginJson(request) {
  const type = (request.headers.get('Content-Type') || '').toLowerCase();
  if (!type.startsWith('application/json')) return false;
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return false;
  return true;
}

// Une adresse IPv6 est ramenée à son préfixe /64 (un abonné en possède des milliards) ; IPv4 inchangée.
export function ipKey(ip) {
  const addr = String(ip || '').trim().split('%')[0];
  if (!addr.includes(':')) return addr;
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return mapped[1];
  const [head, tail] = addr.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const fill = addr.includes('::') ? Array(Math.max(0, 8 - h.length - t.length)).fill('0') : [];
  const groups = [...h, ...fill, ...t].map((g) => (parseInt(g || '0', 16) || 0).toString(16));
  return groups.slice(0, 4).join(':') + '::/64';
}

// Empreinte non réversible sans le secret ENGAGE_SALT : sert d'identité anonyme et de clé de limite.
// Uniquement cf-connecting-ip (posé par Cloudflare) : jamais un en-tête fourni par le client.
export async function ipBucket(request, env) {
  const ip = request.headers.get('cf-connecting-ip');
  if (!ip) return null;
  const secret = clean(env && env.ENGAGE_SALT);
  if (!secret && !ipBucket.warned) { ipBucket.warned = true; console.warn('ENGAGE_SALT absent : définis-le avec « npx wrangler secret put ENGAGE_SALT ».'); }
  const salt = secret || 'lumanime-engage-v1';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + ipKey(ip)));
  return 'ip:' + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

export async function rateOk(cfg, bucket, action, limit, seconds) {
  const res = await db(cfg, 'rpc/svc_rate_ok', { method: 'POST', body: JSON.stringify({ p_bucket: bucket, p_action: action, p_limit: limit, p_seconds: seconds }) }).catch(() => null);
  if (!res || !res.ok) return null;
  return (await res.json().catch(() => null)) === true;
}

export async function getUser(request, cfg) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ') || !cfg.anonKey) return null;
  const res = await fetch(`${cfg.supabaseUrl}/auth/v1/user`, { headers: { apikey: cfg.anonKey, Authorization: auth } }).catch(() => null);
  if (!res || !res.ok) return null;
  const user = await res.json().catch(() => null);
  return user && user.id ? user : null;
}

// Les anciennes clés Supabase (eyJ…) vont aussi dans Authorization ; les nouvelles (sb_secret_…) seulement dans apikey
export function db(cfg, path, init = {}) {
  const legacy = String(cfg.serviceKey || '').startsWith('eyJ');
  return fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: cfg.serviceKey,
      ...(legacy ? { Authorization: `Bearer ${cfg.serviceKey}` } : {}),
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
}

export function sumup(cfg, path, init = {}) {
  return fetch(`https://api.sumup.com/v0.1/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${cfg.sumupKey}`, 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
