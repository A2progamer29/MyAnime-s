// POST /api/checkout/create — crée une commande et un paiement SumUp pour une clé Premium
import { TIERS, json, config, paymentConfigured, readJson, getUser, db, sumup, merchantCodeInfo, merchantProblem } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  const cfg = config(env);
  if (!paymentConfigured(cfg)) {
    return json({ code: 'not_configured', error: "Le paiement en ligne n'est pas encore configuré sur le site." }, 503);
  }

  const user = await getUser(request, cfg);
  if (!user) return json({ error: 'Connecte-toi pour acheter une clé.' }, 401);

  const body = await readJson(request);
  const tier = TIERS[body.tier];
  if (!tier) return json({ error: 'Cette offre Premium n’existe pas.' }, 400);

  const info = await merchantCodeInfo(cfg);
  const merchant = info.code;
  if (!merchant) {
    return json({ code: 'not_configured', reason: info.reason, error: 'Paiement indisponible : ' + merchantProblem(info) }, 503);
  }

  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const recent = await db(cfg, `premium_orders?select=id&user_id=eq.${user.id}&created_at=gt.${encodeURIComponent(since)}`);
  if (recent.ok && (await recent.json()).length >= 5) {
    return json({ error: 'Trop de paiements commencés en peu de temps. Réessaie dans quelques minutes.' }, 429);
  }

  const orderRes = await db(cfg, 'premium_orders', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: user.id, tier: body.tier, amount: tier.amount, currency: 'EUR' })
  });
  if (!orderRes.ok) return json({ error: 'La commande n’a pas pu être créée. Réessaie.' }, 502);
  const [order] = await orderRes.json();

  const checkoutRes = await sumup(cfg, 'checkouts', {
    method: 'POST',
    body: JSON.stringify({
      checkout_reference: order.id,
      amount: tier.amount,
      currency: 'EUR',
      merchant_code: merchant,
      description: `LumaAnime - cle ${tier.name}`
    })
  });
  const checkout = await checkoutRes.json().catch(() => ({}));
  if (!checkoutRes.ok || !checkout.id) {
    await db(cfg, `premium_orders?id=eq.${order.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed' }) });
    const detail = Array.isArray(checkout) ? checkout[0] || {} : checkout;
    const code = detail.error_code || `HTTP_${checkoutRes.status}`;
    console.error('SumUp checkout refusé', checkoutRes.status, JSON.stringify(checkout).slice(0, 500));
    return json({ error: `SumUp a refusé la création du paiement (code ${code}). Réessaie plus tard.`, sumup: code, sumupMessage: String(detail.message || '').slice(0, 200) }, 502);
  }

  await db(cfg, `premium_orders?id=eq.${order.id}`, { method: 'PATCH', body: JSON.stringify({ checkout_id: checkout.id }) });
  return json({ orderId: order.id, checkoutId: checkout.id, amount: tier.amount });
}
