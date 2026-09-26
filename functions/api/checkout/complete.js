// POST /api/checkout/complete — vérifie le paiement auprès de SumUp puis délivre la clé (une seule clé par commande)
import { json, config, paymentConfigured, readJson, getUser, db, sumup, UUID_RE } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  const cfg = config(env);
  if (!paymentConfigured(cfg)) {
    return json({ code: 'not_configured', error: "Le paiement en ligne n'est pas encore configuré sur le site." }, 503);
  }

  const user = await getUser(request, cfg);
  if (!user) return json({ error: 'Connecte-toi pour récupérer ta clé.' }, 401);

  const { orderId } = await readJson(request);
  if (!UUID_RE.test(String(orderId || ''))) return json({ error: 'Commande introuvable.' }, 400);

  const orderRes = await db(cfg, `premium_orders?select=*&id=eq.${orderId}&user_id=eq.${user.id}`);
  const [order] = orderRes.ok ? await orderRes.json() : [];
  if (!order) return json({ error: 'Commande introuvable.' }, 404);
  if (!order.checkout_id) return json({ error: 'Aucun paiement n’est associé à cette commande.' }, 409);

  const checkoutRes = await sumup(cfg, `checkouts/${encodeURIComponent(order.checkout_id)}`);
  const checkout = await checkoutRes.json().catch(() => ({}));
  if (!checkoutRes.ok) return json({ error: 'SumUp ne répond pas. Réessaie dans quelques minutes.' }, 502);

  const paid = checkout.status === 'PAID'
    && Number(checkout.amount) === Number(order.amount)
    && checkout.currency === order.currency
    && checkout.checkout_reference === order.id;

  if (!paid) {
    if (checkout.status === 'FAILED' && order.status === 'pending') {
      await db(cfg, `premium_orders?id=eq.${order.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed' }) });
    }
    return json({ error: 'Le paiement n’est pas encore confirmé par SumUp.', status: checkout.status || 'UNKNOWN' }, 409);
  }

  const keyRes = await db(cfg, 'rpc/fulfill_order', { method: 'POST', body: JSON.stringify({ p_order: order.id }) });
  if (!keyRes.ok) return json({ error: 'Paiement confirmé, mais la clé n’a pas pu être générée. Recharge la page Mon Premium pour réessayer.' }, 502);
  const key = await keyRes.json();
  return json({ key, tier: order.tier });
}
