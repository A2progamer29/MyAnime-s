// POST /api/engage — actions légères (vote Wishboard, j'aime, vue, présence).
// L'identité vient du serveur : le compte connecté (jeton vérifié) ou, pour un anonyme, une empreinte de
// son adresse IP (préfixe /64 en IPv6), jamais un identifiant fourni par le navigateur. Une limite par
// identité est appliquée et les écritures passent par des fonctions SQL réservées au rôle service (svc_*).
import { json, config, readJson, getUser, db, sameOriginJson, ipBucket, rateOk, UUID_RE } from './_lib.js';

// Limites par identité (IP ou compte) et par action : [nombre max, fenêtre en secondes]
const LIMITS = {
  wish_vote: [20, 60],
  like: [30, 60],
  view: [120, 60],
  visit: [160, 60],
  report: [10, 3600]
};

const REFUSALS = {
  wish_not_found: [404, "Cette proposition n'existe plus."],
  wish_closed: [409, "Les votes sont fermés pour cet anime : il a déjà été traité par l'équipe."],
  like_daily_limit: [429, "Tu as atteint la limite de 100 j'aime par jour. Reviens demain."],
  invalid_anime: [400, 'Anime introuvable.'],
  source_not_found: [404, "Ce lecteur n'est plus disponible."],
  missing_voter: [400, 'Action impossible pour le moment.']
};

async function rpc(cfg, name, body) {
  const res = await db(cfg, 'rpc/' + name, { method: 'POST', body: JSON.stringify(body) }).catch(() => null);
  if (!res) return { ok: false, status: 0, data: null };
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

function answer(r) {
  if (!r.ok) return json({ error: 'Action impossible pour le moment.' }, 502);
  if (r.data && r.data.ok === false) {
    const [status, error] = REFUSALS[r.data.reason] || [400, 'Action impossible pour le moment.'];
    return json({ reason: r.data.reason, error }, status);
  }
  return json(r.data);
}

const wanted = (value) => (typeof value === 'boolean' ? value : null);

export async function onRequestPost({ request, env }) {
  if (!sameOriginJson(request)) return json({ error: 'Requête refusée.' }, 403);
  const cfg = config(env);
  if (!cfg.serviceKey) return json({ error: 'Service indisponible.' }, 503);

  const body = await readJson(request);
  const action = String(body.action || '');
  const limit = LIMITS[action];
  if (!limit) return json({ error: 'Action inconnue.' }, 400);

  // Jeton présent mais refusé : le membre doit rafraîchir sa session (jamais de repli silencieux sur l'IP)
  const hasToken = (request.headers.get('Authorization') || '').startsWith('Bearer ');
  const user = hasToken ? await getUser(request, cfg) : null;
  if (hasToken && !user) return json({ reason: 'session_expired', error: 'Ta session a expiré. Reconnecte-toi puis réessaie.' }, 401);
  const bucket = user ? 'u:' + user.id : await ipBucket(request, env);
  if (!bucket) return json({ error: 'Requête refusée.' }, 400);

  const gate = await rateOk(cfg, bucket, action, limit[0], limit[1]);
  if (gate === null) return json({ error: 'Service momentanément indisponible.' }, 502);
  if (!gate) return json({ reason: 'rate_limited', error: 'Trop d’actions en peu de temps. Patiente un instant.' }, 429);

  // Session d'onglet (statistiques admin seulement) : jamais utilisée pour les votes, likes ou vues
  const tab = UUID_RE.test(String(body.sid || '')) ? String(body.sid) : '';
  const presence = tab ? bucket + '|' + tab : bucket;

  try {
    if (action === 'wish_vote') {
      if (!UUID_RE.test(String(body.wish || ''))) return json({ error: 'Proposition introuvable.' }, 400);
      return answer(await rpc(cfg, 'svc_wish_vote', { p_voter: bucket, p_wish: body.wish, p_on: wanted(body.on) }));
    }
    if (action === 'like') {
      const anime = Number(body.anime);
      if (!Number.isInteger(anime) || anime <= 0 || anime > 10000000) return json({ error: 'Anime introuvable.' }, 400);
      return answer(await rpc(cfg, 'svc_toggle_like', { p_voter: bucket, p_anime: anime, p_on: wanted(body.on) }));
    }
    if (action === 'view') {
      const anime = Number(body.anime);
      if (!Number.isInteger(anime) || anime <= 0 || anime > 10000000) return json({ ok: true });
      const title = user ? String(body.title || '').slice(0, 200) : null;
      const r = await rpc(cfg, 'svc_track_view', { p_viewer: bucket, p_anime: anime, p_title: title, p_presence: presence });
      if (!r.ok) console.error('engage view', r.status);
      return json({ ok: true });
    }
    if (action === 'report') {
      if (!UUID_RE.test(String(body.source || ''))) return json({ error: 'Lecteur introuvable.' }, 400);
      return answer(await rpc(cfg, 'svc_report_source', { p_reporter: bucket, p_source: body.source }));
    }
    if (action === 'visit') {
      const r = await rpc(cfg, 'svc_track_visit', { p_session: presence, p_page: String(body.page || '').slice(0, 40), p_new_page: body.newPage === true, p_user: user ? user.id : null, p_viewer: bucket });
      if (!r.ok) console.error('engage visit', r.status);
      return json({ ok: true });
    }
  } catch (err) {
    console.error('engage', action, err && err.message);
    return json({ error: 'Action impossible pour le moment.' }, 502);
  }
  return json({ error: 'Action inconnue.' }, 400);
}
