// POST /api/checkout/cancel — annule un paiement en attente du membre connecté.
// Le paiement est d'abord vérifié chez SumUp : s'il a déjà été encaissé, rien n'est annulé (le membre récupère sa clé).
import { json, config, paymentConfigured, readJson, getUser, db, sumup, UUID_RE } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  const cfg = config(env);
  if (!paymentConfigured(cfg)) {
    return json({ code: 'not_configured', error: "Le paiement en ligne n'est pas encore configuré sur le site." }, 503);
  }

  const user = await getUser(request, cfg);
  if (!user) return json({ error: 'Connecte-toi pour gérer tes paiements.' }, 401);

  const { orderId } = await readJson(request);
  if (!UUID_RE.test(String(orderId || ''))) return json({ error: 'Commande introuvable.' }, 400);

  const orderRes = await db(cfg, `premium_orders?select=*&id=eq.${orderId}&user_id=eq.${user.id}`);
  const [order] = orderRes.ok ? await orderRes.json() : [];
  if (!order) return json({ error: 'Commande introuvable.' }, 404);
  if (order.status !== 'pending') return json({ error: 'Ce paiement n’est plus en attente : il ne peut pas être annulé.', status: order.status }, 409);

  if (order.checkout_id) {
    const checkoutRes = await sumup(cfg, `checkouts/${encodeURIComponent(order.checkout_id)}`);
    const checkout = await checkoutRes.json().catch(() => ({}));
    if (!checkoutRes.ok && checkoutRes.status !== 404) {
      return json({ error: 'SumUp ne répond pas : impossible de vérifier ce paiement avant de l’annuler. Réessaie dans quelques minutes.' }, 502);
    }
    if (checkout.status === 'PAID') {
      return json({ code: 'already_paid', error: 'Ce paiement a déjà été encaissé : il ne peut pas être annulé. Clique sur « Vérifier le paiement » pour récupérer ta clé.' }, 409);
    }
    // Désactive le paiement chez SumUp pour qu'il ne puisse plus être réglé (sans effet s'il a déjà expiré)
    await sumup(cfg, `checkouts/${encodeURIComponent(order.checkout_id)}`, { method: 'DELETE' }).catch(() => null);
  }

  const now = new Date().toISOString();
  let update = await db(cfg, `premium_orders?id=eq.${order.id}&status=eq.pending`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'cancelled', cancelled_at: now })
  });
  // Si le script SQL v12 n'est pas encore installé, le statut « cancelled » n'existe pas : on marque la commande comme échouée
  if (!update.ok) {
    update = await db(cfg, `premium_orders?id=eq.${order.id}&status=eq.pending`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'failed' })
    });
  }
  if (!update.ok) return json({ error: 'L’annulation n’a pas pu être enregistrée. Réessaie.' }, 502);
  const changed = await update.json().catch(() => []);
  if (!Array.isArray(changed) || !changed.length) {
    // La commande a changé d'état entre-temps (paiement terminé à l'instant) : on renvoie son état réel
    const again = await db(cfg, `premium_orders?select=status&id=eq.${order.id}&user_id=eq.${user.id}`);
    const [now2] = again.ok ? await again.json().catch(() => []) : [];
    const status = now2 ? now2.status : 'unknown';
    if (status === 'paid') return json({ code: 'already_paid', error: 'Ce paiement vient d’être encaissé : il ne peut pas être annulé. Clique sur « Vérifier le paiement » pour récupérer ta clé.', status }, 409);
    return json({ error: 'Ce paiement n’est plus en attente : il ne peut pas être annulé.', status }, 409);
  }
  return json({ cancelled: true });
}
