var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// functions/api/_lib.js
var SUPABASE_URL_DEFAULT = "https://phjpyaiheswpuqjpdfuo.supabase.co";
var TIERS = {
  soutien: { name: "Soutien", amount: 3.9 },
  soutien_plus: { name: "Soutien +", amount: 46.8 }
};
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });
}
__name(json, "json");
var clean = /* @__PURE__ */ __name((value) => String(value || "").trim().replace(/^["']|["']$/g, ""), "clean");
function config(env) {
  return {
    supabaseUrl: clean(env.SUPABASE_URL) || SUPABASE_URL_DEFAULT,
    anonKey: clean(env.SUPABASE_ANON_KEY) || clean(env.SUPABASE_SERVICE_ROLE_KEY),
    serviceKey: clean(env.SUPABASE_SERVICE_ROLE_KEY),
    sumupKey: clean(env.SUMUP_API_KEY),
    merchantCode: clean(env.SUMUP_MERCHANT_CODE).toUpperCase()
  };
}
__name(config, "config");
function paymentConfigured(cfg) {
  return Boolean(cfg.serviceKey && cfg.sumupKey);
}
__name(paymentConfigured, "paymentConfigured");
function sumupKeyKind(key) {
  if (/^sup_sk_/.test(key)) return "secret";
  if (/^sup_pk_/.test(key)) return "public";
  return "unknown";
}
__name(sumupKeyKind, "sumupKeyKind");
function findMerchantCode(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 4) return null;
  if (typeof value.merchant_code === "string" && value.merchant_code) return value.merchant_code;
  for (const key of Object.keys(value)) {
    const found = findMerchantCode(value[key], depth + 1);
    if (found) return found;
  }
  return null;
}
__name(findMerchantCode, "findMerchantCode");
var cachedMerchantCode = null;
async function merchantCodeInfo(cfg) {
  if (cfg.merchantCode) return { code: cfg.merchantCode, status: 200, reason: "variable" };
  if (cachedMerchantCode) return { code: cachedMerchantCode, status: 200, reason: "cache" };
  if (sumupKeyKind(cfg.sumupKey) === "public") return { code: null, status: 0, reason: "public_key" };
  let status = 0;
  for (const path of ["me", "me/merchant-profile"]) {
    const res = await sumup(cfg, path).catch(() => null);
    if (!res) {
      status = status || -1;
      continue;
    }
    status = res.status;
    const data = await res.json().catch(() => null);
    if (res.status === 401 || res.status === 403) {
      console.error(`SumUp /${path} : acc\xE8s refus\xE9 (HTTP ${res.status})`, data && (data.error_code || data.message));
      return { code: null, status: res.status, reason: "key_refused" };
    }
    const code = res.ok ? findMerchantCode(data) : null;
    if (code) {
      cachedMerchantCode = code;
      return { code, status: res.status, reason: "api" };
    }
    console.error(`SumUp /${path} : pas de code marchand (HTTP ${res.status})`, data ? Object.keys(data).join(",") : "r\xE9ponse vide");
  }
  return { code: null, status, reason: "not_found" };
}
__name(merchantCodeInfo, "merchantCodeInfo");
function merchantProblem(info) {
  if (info.reason === "public_key") return "La cl\xE9 SUMUP_API_KEY est la cl\xE9 publique (sup_pk_\u2026). Il faut une cl\xE9 secr\xE8te (sup_sk_\u2026) cr\xE9\xE9e dans SumUp \u2192 Param\xE8tres \u2192 Pour les d\xE9veloppeurs \u2192 Cl\xE9s API.";
  if (info.reason === "key_refused") return `SumUp refuse la cl\xE9 API (HTTP ${info.status}) : elle est incorrecte, r\xE9voqu\xE9e ou mal coll\xE9e. Cr\xE9e une nouvelle cl\xE9 secr\xE8te (sup_sk_\u2026) et remplace SUMUP_API_KEY.`;
  if (info.status === -1) return "SumUp ne r\xE9pond pas pour le moment. R\xE9essaie dans quelques minutes.";
  return "SumUp accepte la cl\xE9 mais ne donne pas ton code marchand : ajoute la variable SUMUP_MERCHANT_CODE (code qui commence par M).";
}
__name(merchantProblem, "merchantProblem");
async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
__name(readJson, "readJson");
async function getUser(request, cfg) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const res = await fetch(`${cfg.supabaseUrl}/auth/v1/user`, { headers: { apikey: cfg.anonKey, Authorization: auth } });
  if (!res.ok) return null;
  const user = await res.json();
  return user && user.id ? user : null;
}
__name(getUser, "getUser");
function db(cfg, path, init = {}) {
  const legacy = String(cfg.serviceKey || "").startsWith("eyJ");
  return fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: cfg.serviceKey,
      ...legacy ? { Authorization: `Bearer ${cfg.serviceKey}` } : {},
      "Content-Type": "application/json",
      ...init.headers || {}
    }
  });
}
__name(db, "db");
function sumup(cfg, path, init = {}) {
  return fetch(`https://api.sumup.com/v0.1/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${cfg.sumupKey}`, "Content-Type": "application/json", ...init.headers || {} }
  });
}
__name(sumup, "sumup");
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// functions/api/catalogue.js
var BASE = "https://watch.scoope.fr/api/partner";
var CP850_HIGH = "\xC7\xFC\xE9\xE2\xE4\xE0\xE5\xE7\xEA\xEB\xE8\xEF\xEE\xEC\xC4\xC5\xC9\xE6\xC6\xF4\xF6\xF2\xFB\xF9\xFF\xD6\xDC\xF8\xA3\xD8\xD7\u0192\xE1\xED\xF3\xFA\xF1\xD1\xAA\xBA\xBF\xAE\xAC\xBD\xBC\xA1\xAB\xBB\u2591\u2592\u2593\u2502\u2524\xC1\xC2\xC0\xA9\u2563\u2551\u2557\u255D\xA2\xA5\u2510\u2514\u2534\u252C\u251C\u2500\u253C\xE3\xC3\u255A\u2554\u2569\u2566\u2560\u2550\u256C\xA4\xF0\xD0\xCA\xCB\xC8\u0131\xCD\xCE\xCF\u2518\u250C\u2588\u2584\xA6\xCC\u2580\xD3\xDF\xD4\xD2\xF5\xD5\xB5\xFE\xDE\xDA\xDB\xD9\xFD\xDD\xAF\xB4\xAD\xB1\u2017\xBE\xB6\xA7\xF7\xB8\xB0\xA8\xB7\xB9\xB3\xB2\u25A0\xA0";
function repairText(value) {
  const text = String(value || "");
  if (!/[├┬┼]/.test(text)) return text;
  const bytes = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 128) {
      bytes.push(code);
      continue;
    }
    const index = CP850_HIGH.indexOf(ch);
    if (index === -1) return text;
    bytes.push(128 + index);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return text;
  }
}
__name(repairText, "repairText");
function tmdbImage(url, size) {
  const value = String(url || "");
  if (!/^https:\/\/image\.tmdb\.org\/t\/p\//.test(value)) return null;
  return value.replace(/\/t\/p\/[^/]+\//, `/t/p/${size}/`);
}
__name(tmdbImage, "tmdbImage");
function toItem(raw) {
  const series = raw.type === "series";
  return {
    id: String(raw.id),
    type: series ? "series" : "movie",
    title: repairText(raw.title),
    year: Number(raw.year) || null,
    poster: tmdbImage(raw.poster_url, "w342"),
    backdrop: tmdbImage(raw.backdrop_url, "w1280"),
    genres: Array.isArray(raw.genres) ? [...new Set(raw.genres.map(repairText))].slice(0, 6) : [],
    rating: typeof raw.rating === "number" ? Math.round(raw.rating * 10) / 10 : null,
    overview: repairText(raw.overview),
    seasons: series ? Number(raw.seasons) || null : null,
    episodes: series ? Number(raw.episodes_count) || null : null
  };
}
__name(toItem, "toItem");
async function onRequestGet({ request, env }) {
  if (!env.UQFLEX_API_KEY) return json({ error: "Le catalogue partenaire n\u2019est pas configur\xE9." }, 503);
  const res = await fetch(`${BASE}/v1/catalog`, {
    headers: { "x-api-key": env.UQFLEX_API_KEY },
    cf: { cacheTtl: 600, cacheEverything: true }
  });
  if (!res.ok) return json({ error: "Le catalogue partenaire ne r\xE9pond pas." }, 502);
  const data = await res.json();
  const items = (data.items || []).map(toItem).filter((item) => item.title);
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const item = items.find((i) => i.id === id);
    return item ? json({ item }, 200, { "Cache-Control": "public, max-age=600" }) : json({ error: "Titre introuvable." }, 404);
  }
  const list = items.map(({ overview, backdrop, ...rest }) => rest);
  return json({ items: list }, 200, { "Cache-Control": "public, max-age=600" });
}
__name(onRequestGet, "onRequestGet");

// functions/api/synopsis.js
var MODEL = "@cf/meta/m2m100-1.2b";
var MAX_IDS = 12;
var CHUNK = 450;
function cleanDescription(html) {
  return String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\((Source|Sources)\s*:[^)]*\)/gi, "").replace(/\n{3,}/g, "\n\n").trim();
}
__name(cleanDescription, "cleanDescription");
function chunks(paragraph) {
  if (paragraph.length <= CHUNK) return [paragraph];
  const sentences = paragraph.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [paragraph];
  const out = [];
  let current = "";
  for (const s of sentences) {
    if ((current + s).length > CHUNK && current) {
      out.push(current.trim());
      current = "";
    }
    current += s;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}
__name(chunks, "chunks");
async function translate(env, text) {
  const paragraphs = text.split(/\n\n/);
  const result = [];
  for (const p of paragraphs) {
    const lines = p.split("\n");
    const translatedLines = [];
    for (const line of lines) {
      if (!line.trim()) {
        translatedLines.push("");
        continue;
      }
      const parts = [];
      for (const piece of chunks(line.trim())) {
        const res = await env.AI.run(MODEL, { text: piece, source_lang: "english", target_lang: "french" });
        parts.push(String(res && res.translated_text || "").trim());
      }
      translatedLines.push(parts.join(" "));
    }
    result.push(translatedLines.join("\n"));
  }
  return result.join("\n\n").trim();
}
__name(translate, "translate");
async function fetchEnglish(ids) {
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      query: "query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) { id isAdult description(asHtml: false) } } }",
      variables: { ids }
    })
  });
  if (!res.ok) throw new Error("AniList HTTP " + res.status);
  const data = await res.json();
  return data.data && data.data.Page && data.data.Page.media || [];
}
__name(fetchEnglish, "fetchEnglish");
async function onRequestGet2({ request, env, ctx }) {
  if (!env.AI) return json({ code: "not_configured", error: "La traduction automatique n\u2019est pas activ\xE9e." }, 503);
  const url = new URL(request.url);
  const ids = [...new Set((url.searchParams.get("ids") || "").split(",").map(Number))].filter((n) => Number.isInteger(n) && n > 0 && n < 1e7).slice(0, MAX_IDS);
  if (!ids.length) return json({ error: "Aucun identifiant valide." }, 400);
  const cfg = config(env);
  const items = {};
  let missing = ids;
  if (cfg.serviceKey) {
    const cached = await db(cfg, `synopsis_fr?select=anilist_id,text_fr&anilist_id=in.(${ids.join(",")})`).catch(() => null);
    if (cached && cached.ok) {
      for (const row of await cached.json()) items[row.anilist_id] = row.text_fr;
      missing = ids.filter((id) => !(id in items));
    }
  }
  if (missing.length) {
    let media = [];
    try {
      media = await fetchEnglish(missing);
    } catch {
      return json({ items }, 200, { "Cache-Control": "no-store" });
    }
    const rows = [];
    for (const m of media) {
      const english = m.isAdult ? "" : cleanDescription(m.description);
      if (!english) {
        items[m.id] = null;
        continue;
      }
      try {
        const french = await translate(env, english);
        if (french) {
          items[m.id] = french;
          rows.push({ anilist_id: m.id, text_fr: french });
        }
      } catch {
        items[m.id] = null;
      }
    }
    if (rows.length && cfg.serviceKey) {
      const save = db(cfg, "synopsis_fr?on_conflict=anilist_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows)
      }).catch(() => null);
      if (ctx && ctx.waitUntil) ctx.waitUntil(save);
      else await save;
    }
  }
  return json({ items }, 200, { "Cache-Control": "public, max-age=86400" });
}
__name(onRequestGet2, "onRequestGet");

// functions/api/genres.js
var SLUGS = ["action", "romance", "comedie", "isekai", "seinen", "sport", "horreur", "tranche-de-vie", "fantasy", "mecha"];
async function onRequestGet3({ request, env }) {
  const origin = new URL(request.url).origin;
  const found = await Promise.all(SLUGS.map(async (slug) => {
    try {
      const res = await env.ASSETS.fetch(new Request(`${origin}/assets/${slug}-banner.png`, { method: "HEAD" }));
      return res.ok ? slug : null;
    } catch {
      return null;
    }
  }));
  return json({ banners: found.filter(Boolean) }, 200, { "Cache-Control": "public, max-age=300" });
}
__name(onRequestGet3, "onRequestGet");

// functions/api/checkout/status.js
async function onRequestGet4({ request, env }) {
  const cfg = config(env);
  const checks = [];
  const add = /* @__PURE__ */ __name((key, ok, text) => checks.push({ key, ok, text }), "add");
  add(
    "secrets",
    Boolean(cfg.serviceKey && cfg.sumupKey),
    cfg.serviceKey && cfg.sumupKey ? "Cl\xE9s SUMUP_API_KEY et SUPABASE_SERVICE_ROLE_KEY pr\xE9sentes." : `Cl\xE9 manquante : ${[!cfg.sumupKey && "SUMUP_API_KEY", !cfg.serviceKey && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean).join(", ")}.`
  );
  if (!cfg.serviceKey) return json({ ready: false, checks });
  const user = await getUser(request, cfg);
  if (!user) return json({ error: "Connecte-toi avec un compte administrateur." }, 401);
  const roleRes = await db(cfg, `profiles?select=role&id=eq.${user.id}`);
  const [profile] = roleRes.ok ? await roleRes.json() : [];
  if (!profile || profile.role !== "admin") return json({ error: "R\xE9serv\xE9 aux administrateurs." }, 403);
  if (cfg.sumupKey) {
    const kind = sumupKeyKind(cfg.sumupKey);
    add("key_kind", kind !== "public", kind === "secret" ? "La cl\xE9 SUMUP_API_KEY est bien une cl\xE9 secr\xE8te (sup_sk_\u2026)." : kind === "public" ? "La cl\xE9 SUMUP_API_KEY est la cl\xE9 publique (sup_pk_\u2026) : remplace-la par une cl\xE9 secr\xE8te (sup_sk_\u2026)." : "La cl\xE9 SUMUP_API_KEY ne ressemble pas \xE0 une cl\xE9 SumUp (elle devrait commencer par sup_sk_).");
    const me = kind === "public" ? null : await sumup(cfg, "me").catch(() => null);
    const data = me && me.ok ? await me.json().catch(() => ({})) : {};
    const mp = data.merchant_profile || {};
    if (me) add("sumup_key", me.ok, me.ok ? "Cl\xE9 API SumUp accept\xE9e par SumUp." : `SumUp a r\xE9pondu HTTP ${me.status} \xE0 la v\xE9rification de la cl\xE9.`);
    const info = await merchantCodeInfo(cfg);
    add("merchant", Boolean(info.code), info.code ? `Compte marchand ${info.code}${info.reason === "variable" ? " (variable SUMUP_MERCHANT_CODE)" : ""}${mp.country ? " \u2014 " + mp.country : ""}${mp.default_currency ? ", devise " + mp.default_currency : ""}.` : merchantProblem(info));
    if (mp.default_currency && mp.default_currency !== "EUR") {
      add("currency", false, `La devise du compte SumUp est ${mp.default_currency} : les cl\xE9s sont vendues en EUR.`);
    }
  }
  const probe = await db(cfg, "rpc/fulfill_order", { method: "POST", body: JSON.stringify({ p_order: "00000000-0000-0000-0000-000000000000" }) });
  const probeText = await probe.text();
  add("sql", probeText.includes("order_not_found"), probeText.includes("order_not_found") ? "Fonction SQL de d\xE9livrance des cl\xE9s install\xE9e." : "Fonction SQL fulfill_order absente : ex\xE9cute supabase/premium-coins.sql.");
  return json({ ready: checks.every((c) => c.ok), checks });
}
__name(onRequestGet4, "onRequestGet");

// functions/api/checkout/create.js
async function onRequestPost({ request, env }) {
  const cfg = config(env);
  if (!paymentConfigured(cfg)) {
    return json({ code: "not_configured", error: "Le paiement en ligne n'est pas encore configur\xE9 sur le site." }, 503);
  }
  const user = await getUser(request, cfg);
  if (!user) return json({ error: "Connecte-toi pour acheter une cl\xE9." }, 401);
  const body = await readJson(request);
  const tier = TIERS[body.tier];
  if (!tier) return json({ error: "Cette offre Premium n\u2019existe pas." }, 400);
  const info = await merchantCodeInfo(cfg);
  const merchant = info.code;
  if (!merchant) {
    return json({ code: "not_configured", reason: info.reason, error: "Paiement indisponible : " + merchantProblem(info) }, 503);
  }
  const since = new Date(Date.now() - 10 * 60 * 1e3).toISOString();
  const recent = await db(cfg, `premium_orders?select=id&user_id=eq.${user.id}&created_at=gt.${encodeURIComponent(since)}`);
  if (recent.ok && (await recent.json()).length >= 5) {
    return json({ error: "Trop de paiements commenc\xE9s en peu de temps. R\xE9essaie dans quelques minutes." }, 429);
  }
  const orderRes = await db(cfg, "premium_orders", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ user_id: user.id, tier: body.tier, amount: tier.amount, currency: "EUR" })
  });
  if (!orderRes.ok) return json({ error: "La commande n\u2019a pas pu \xEAtre cr\xE9\xE9e. R\xE9essaie." }, 502);
  const [order] = await orderRes.json();
  const checkoutRes = await sumup(cfg, "checkouts", {
    method: "POST",
    body: JSON.stringify({
      checkout_reference: order.id,
      amount: tier.amount,
      currency: "EUR",
      merchant_code: merchant,
      description: `LumaAnime - cle ${tier.name}`
    })
  });
  const checkout = await checkoutRes.json().catch(() => ({}));
  if (!checkoutRes.ok || !checkout.id) {
    await db(cfg, `premium_orders?id=eq.${order.id}`, { method: "PATCH", body: JSON.stringify({ status: "failed" }) });
    const detail = Array.isArray(checkout) ? checkout[0] || {} : checkout;
    const code = detail.error_code || `HTTP_${checkoutRes.status}`;
    console.error("SumUp checkout refus\xE9", checkoutRes.status, JSON.stringify(checkout).slice(0, 500));
    return json({ error: `SumUp a refus\xE9 la cr\xE9ation du paiement (code ${code}). R\xE9essaie plus tard.`, sumup: code, sumupMessage: String(detail.message || "").slice(0, 200) }, 502);
  }
  await db(cfg, `premium_orders?id=eq.${order.id}`, { method: "PATCH", body: JSON.stringify({ checkout_id: checkout.id }) });
  return json({ orderId: order.id, checkoutId: checkout.id, amount: tier.amount });
}
__name(onRequestPost, "onRequestPost");

// functions/api/checkout/complete.js
async function onRequestPost2({ request, env }) {
  const cfg = config(env);
  if (!paymentConfigured(cfg)) {
    return json({ code: "not_configured", error: "Le paiement en ligne n'est pas encore configur\xE9 sur le site." }, 503);
  }
  const user = await getUser(request, cfg);
  if (!user) return json({ error: "Connecte-toi pour r\xE9cup\xE9rer ta cl\xE9." }, 401);
  const { orderId } = await readJson(request);
  if (!UUID_RE.test(String(orderId || ""))) return json({ error: "Commande introuvable." }, 400);
  const orderRes = await db(cfg, `premium_orders?select=*&id=eq.${orderId}&user_id=eq.${user.id}`);
  const [order] = orderRes.ok ? await orderRes.json() : [];
  if (!order) return json({ error: "Commande introuvable." }, 404);
  if (!order.checkout_id) return json({ error: "Aucun paiement n\u2019est associ\xE9 \xE0 cette commande." }, 409);
  const checkoutRes = await sumup(cfg, `checkouts/${encodeURIComponent(order.checkout_id)}`);
  const checkout = await checkoutRes.json().catch(() => ({}));
  if (!checkoutRes.ok) return json({ error: "SumUp ne r\xE9pond pas. R\xE9essaie dans quelques minutes." }, 502);
  const paid = checkout.status === "PAID" && Number(checkout.amount) === Number(order.amount) && checkout.currency === order.currency && checkout.checkout_reference === order.id;
  if (!paid) {
    if (checkout.status === "FAILED" && order.status === "pending") {
      await db(cfg, `premium_orders?id=eq.${order.id}`, { method: "PATCH", body: JSON.stringify({ status: "failed" }) });
    }
    return json({ error: "Le paiement n\u2019est pas encore confirm\xE9 par SumUp.", status: checkout.status || "UNKNOWN" }, 409);
  }
  const keyRes = await db(cfg, "rpc/fulfill_order", { method: "POST", body: JSON.stringify({ p_order: order.id }) });
  if (!keyRes.ok) return json({ error: "Paiement confirm\xE9, mais la cl\xE9 n\u2019a pas pu \xEAtre g\xE9n\xE9r\xE9e. Recharge la page Mon Premium pour r\xE9essayer." }, 502);
  const key = await keyRes.json();
  return json({ key, tier: order.tier });
}
__name(onRequestPost2, "onRequestPost");

// worker/index.js
var ROUTES = {
  "GET /api/catalogue": onRequestGet,
  "GET /api/synopsis": onRequestGet2,
  "GET /api/genres": onRequestGet3,
  "GET /api/checkout/status": onRequestGet4,
  "POST /api/checkout/create": onRequestPost,
  "POST /api/checkout/complete": onRequestPost2
};
var index_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const handler = ROUTES[`${request.method} ${url.pathname}`];
    if (handler) return handler({ request, env, ctx });
    if (url.pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "Route inconnue." }), { status: 404, headers: { "Content-Type": "application/json; charset=utf-8" } });
    }
    return env.ASSETS.fetch(request);
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
