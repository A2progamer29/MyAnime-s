// GET /api/checkout/status — diagnostic des paiements, réservé aux administrateurs.
// Vérifie la configuration, la clé SumUp, le compte marchand et la fonction SQL qui délivre les clés.
// Aucun paiement n'est créé et aucune donnée n'est modifiée.
import { json, config, getUser, db, sumup, merchantCodeInfo, merchantProblem, sumupKeyKind } from '../_lib.js';

// Rôle lu avec la clé service si elle existe, sinon avec le jeton de l'utilisateur (soumis aux règles RLS)
async function userRole(request, cfg, user) {
  const path = `profiles?select=role&id=eq.${encodeURIComponent(user.id)}`;
  const res = cfg.serviceKey
    ? await db(cfg, path).catch(() => null)
    : await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
      headers: { apikey: cfg.anonKey, Authorization: request.headers.get('Authorization') || '' }
    }).catch(() => null);
  if (!res || !res.ok) return null;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows[0] ? rows[0].role : null;
}

export async function onRequestGet({ request, env }) {
  const cfg = config(env);

  // Authentification et rôle admin avant tout contrôle : rien ne fuit vers un anonyme ou un membre
  const user = await getUser(request, cfg);
  if (!user) return json({ error: 'Connecte-toi avec un compte administrateur.' }, 401);
  if ((await userRole(request, cfg, user)) !== 'admin') return json({ error: 'Réservé aux administrateurs.' }, 403);

  const checks = [];
  const add = (key, ok, text) => checks.push({ key, ok, text });

  add('secrets', Boolean(cfg.serviceKey && cfg.sumupKey),
    cfg.serviceKey && cfg.sumupKey ? 'Clés SUMUP_API_KEY et SUPABASE_SERVICE_ROLE_KEY présentes.'
      : `Clé manquante : ${[!cfg.sumupKey && 'SUMUP_API_KEY', !cfg.serviceKey && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean).join(', ')}.`);
  if (!cfg.serviceKey) return json({ ready: false, checks });

  if (cfg.sumupKey) {
    const kind = sumupKeyKind(cfg.sumupKey);
    add('key_kind', kind !== 'public', kind === 'secret' ? 'La clé SUMUP_API_KEY est bien une clé secrète (sup_sk_…).'
      : kind === 'public' ? 'La clé SUMUP_API_KEY est la clé publique (sup_pk_…) : remplace-la par une clé secrète (sup_sk_…).'
      : 'La clé SUMUP_API_KEY ne ressemble pas à une clé SumUp (elle devrait commencer par sup_sk_).');
    const me = kind === 'public' ? null : await sumup(cfg, 'me').catch(() => null);
    const data = me && me.ok ? await me.json().catch(() => ({})) : {};
    const mp = data.merchant_profile || {};
    if (me) add('sumup_key', me.ok, me.ok ? 'Clé API SumUp acceptée par SumUp.' : `SumUp a répondu HTTP ${me.status} à la vérification de la clé.`);
    const info = await merchantCodeInfo(cfg);
    add('merchant', Boolean(info.code), info.code
      ? `Compte marchand ${info.code}${info.reason === 'variable' ? ' (variable SUMUP_MERCHANT_CODE)' : ''}${mp.country ? ' — ' + mp.country : ''}${mp.default_currency ? ', devise ' + mp.default_currency : ''}.`
      : merchantProblem(info));
    if (mp.default_currency && mp.default_currency !== 'EUR') {
      add('currency', false, `La devise du compte SumUp est ${mp.default_currency} : les clés sont vendues en EUR.`);
    }
  }

  const probe = await db(cfg, 'rpc/fulfill_order', { method: 'POST', body: JSON.stringify({ p_order: '00000000-0000-0000-0000-000000000000' }) });
  const probeText = await probe.text();
  add('sql', probeText.includes('order_not_found'), probeText.includes('order_not_found')
    ? 'Fonction SQL de délivrance des clés installée.'
    : 'Fonction SQL fulfill_order absente : exécute supabase/premium-coins.sql.');

  return json({ ready: checks.every((c) => c.ok), checks });
}
