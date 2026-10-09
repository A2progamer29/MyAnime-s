// POST /api/checkout/create — crée une commande et un paiement SumUp pour une clé Premium
import { TIERS, json, config, paymentConfigured, readJson, getUser, db, sumup, merchantCodeInfo, merchantProblem } from '../_lib.js';

// Les détails de configuration restent dans les journaux du Worker, jamais dans la réponse
const UNAVAILABLE = 'Le paiement est momentanément indisponible. Réessaie plus tard.';

export async function onRequestPost({ request, env }) {
  const cfg = config(env);
  if (!paymentConfigured(cfg)) {
    console.error('Paiement non configuré : clé SumUp ou clé service Supabase absente.');
    return json({ code: 'not_configured', error: UNAVAILABLE }, 503);
  }

  const user = await getUser(request, cfg);
  if (!user) return json({ error: 'Connecte-toi pour acheter une clé.' }, 401);

  const body = await readJson(request);
  const tierId = body && typeof body.tier === 'string' ? body.tier : '';
  if (!Object.hasOwn(TIERS, tierId)) return json({ error: 'Cette offre Premium n’existe pas.' }, 400);
  const tier = TIERS[tierId];

  const info = await merchantCodeInfo(cfg);
  const merchant = info.code;
  if (!merchant) {
    console.error('Code marchand SumUp indisponible :', info.reason, merchantProblem(info));
    return json({ code: 'not_configured', error: UNAVAILABLE }, 503);
  }

  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const recent = await db(cfg, `premium_orders?select=id&user_id=eq.${user.id}&created_at=gt.${encodeURIComponent(since)}`);
  if (recent.ok && (await recent.json()).length >= 5) {
    return json({ error: 'Trop de paiements commencés en peu de temps. Réessaie dans quelques minutes.' }, 429);
  }

  const orderRes = await db(cfg, 'premium_orders', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: user.id, tier: tierId, amount: tier.amount, currency: 'EUR' })
  });
  if (!orderRes.ok) {
    const detail = await orderRes.text().catch(() => '');
    if (detail.includes('too_many_orders')) return json({ error: 'Trop de paiements commencés en peu de temps. Réessaie dans quelques minutes.' }, 429);
    return json({ error: 'La commande n’a pas pu être créée. Réessaie.' }, 502);
  }
  const [order] = await orderRes.json();

  const markFailed = () => db(cfg, `premium_orders?id=eq.${order.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed' }) }).catch(() => null);

  const checkoutRes = await sumup(cfg, 'checkouts', {
    method: 'POST',
    body: JSON.stringify({
      checkout_reference: order.id,
      amount: tier.amount,
      currency: 'EUR',
      merchant_code: merchant,
      description: `LumaAnime - cle ${tier.name}`
    })
  }).catch(() => null);
  const checkout = checkoutRes ? await checkoutRes.json().catch(() => ({})) : {};
  if (!checkoutRes || !checkoutRes.ok || !checkout.id) {
    await markFailed();
    console.error('SumUp checkout refusé', checkoutRes ? checkoutRes.status : 'sans réponse', JSON.stringify(checkout).slice(0, 500));
    return json({ error: UNAVAILABLE }, 502);
  }

  // Sans checkout_id enregistré, le paiement ne pourrait pas être rattaché à la commande : on annule tout
  const linkRes = await db(cfg, `premium_orders?id=eq.${order.id}`, { method: 'PATCH', body: JSON.stringify({ checkout_id: checkout.id }) }).catch(() => null);
  if (!linkRes || !linkRes.ok) {
    console.error('Enregistrement du checkout_id impossible', linkRes ? linkRes.status : 'sans réponse', order.id);
    const cancel = await sumup(cfg, `checkouts/${encodeURIComponent(checkout.id)}`, { method: 'DELETE' }).catch(() => null);
    if (!cancel || !cancel.ok) console.error('Désactivation du checkout SumUp impossible', cancel ? cancel.status : 'sans réponse', checkout.id);
    await markFailed();
    return json({ error: UNAVAILABLE }, 502);
  }

  return json({ orderId: order.id, checkoutId: checkout.id, amount: tier.amount });
}
