// Outils partagés des fonctions Cloudflare de LumaAnime (aucun secret ici : tout vient des variables d'environnement)

const SUPABASE_URL_DEFAULT = 'https://phjpyaiheswpuqjpdfuo.supabase.co';

export const TIERS = {
  soutien: { name: 'Soutien', amount: 3.9 },
  soutien_plus: { name: 'Soutien +', amount: 46.8 }
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
}

// Les secrets collés à la main contiennent parfois un espace ou un retour à la ligne : on les nettoie
const clean = (value) => String(value || '').trim().replace(/^["']|["']$/g, '');

export function config(env) {
  return {
    supabaseUrl: clean(env.SUPABASE_URL) || SUPABASE_URL_DEFAULT,
    anonKey: clean(env.SUPABASE_ANON_KEY) || clean(env.SUPABASE_SERVICE_ROLE_KEY),
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
  try { return await request.json(); } catch { return {}; }
}

export async function getUser(request, cfg) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const res = await fetch(`${cfg.supabaseUrl}/auth/v1/user`, { headers: { apikey: cfg.anonKey, Authorization: auth } });
  if (!res.ok) return null;
  const user = await res.json();
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
