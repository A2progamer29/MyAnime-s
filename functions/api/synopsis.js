// GET /api/synopsis?ids=1,2,3 — synopsis AniList traduits en français.
// Le texte anglais est toujours relu chez AniList (jamais fourni par le navigateur), traduit une seule fois
// avec Workers AI, puis gardé dans la table Supabase synopsis_fr. Un texte obtenu via le mal du navigateur
// (repli si AniList est en panne) est marqué source_mal et n'est servi qu'aux requêtes avec ce même mal.
import { json, config, db, ipBucket, rateOk } from './_lib.js';

const MODEL = '@cf/meta/m2m100-1.2b';
const MAX_IDS = 12;
const CHUNK = 450;
// Plafond de traductions Workers AI par requête : le client redemande les identifiants absents
const MAX_TRANSLATIONS = 4;
// Plafond de morceaux envoyés à Workers AI par requête, par visiteur (minute) et pour tout le site (jour)
const MAX_PIECES = 24;
const PER_VISITOR = [20, 60];
const PER_DAY = 3000;

function cleanDescription(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\((Source|Sources)\s*:[^)]*\)/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function chunks(paragraph) {
  if (paragraph.length <= CHUNK) return [paragraph];
  const sentences = paragraph.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [paragraph];
  const out = [];
  let current = '';
  for (const s of sentences) {
    if ((current + s).length > CHUNK && current) { out.push(current.trim()); current = ''; }
    current += s;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

async function translate(env, text, budget) {
  const paragraphs = text.split(/\n\n/);
  const result = [];
  for (const p of paragraphs) {
    const lines = p.split('\n');
    const translatedLines = [];
    for (const line of lines) {
      if (!line.trim()) { translatedLines.push(''); continue; }
      const parts = [];
      for (const piece of chunks(line.trim())) {
        if (budget.pieces <= 0) throw new Error('budget');
        budget.pieces--;
        const res = await env.AI.run(MODEL, { text: piece, source_lang: 'english', target_lang: 'french' });
        parts.push(String((res && res.translated_text) || '').trim());
      }
      translatedLines.push(parts.join(' '));
    }
    result.push(translatedLines.join('\n'));
  }
  return result.join('\n\n').trim();
}

const USER_AGENT = 'LumaAnime/1.0 (+https://lumanime.online)';

async function fetchEnglish(ids) {
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({
      query: 'query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) { id idMal isAdult description(asHtml: false) } } }',
      variables: { ids }
    })
  });
  if (!res.ok) throw new Error('AniList HTTP ' + res.status);
  const data = await res.json();
  return (data.data && data.data.Page && data.data.Page.media) || [];
}

// Résumé anglais de MyAnimeList via Jikan (idMal donné par AniList, ou mal du navigateur si AniList est en panne)
async function fetchEnglishFromMal(malId) {
  const res = await fetch(`https://api.jikan.moe/v4/anime/${malId}`, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
  if (!res.ok) return null;
  const data = (await res.json()).data || {};
  if (data.rating && /^(Rx|R\+)/i.test(data.rating)) return { isAdult: true, description: '' };
  const text = String(data.synopsis || '').replace(/\[Written by MAL Rewrite\]\s*$/i, '').trim();
  return { isAdult: false, description: text };
}

// Texte anglais d'un identifiant : { english, sourceMal } ; sourceMal n'est rempli que pour le repli non vérifié
async function englishFor(id, anilist, malById) {
  if (anilist) {
    const m = anilist.get(id);
    if (!m) return null;
    if (m.isAdult) return { english: '', sourceMal: null };
    let english = cleanDescription(m.description);
    if (!english && Number.isInteger(m.idMal) && m.idMal > 0) {
      const mal = await fetchEnglishFromMal(m.idMal).catch(() => null);
      if (mal && mal.isAdult) return { english: '', sourceMal: null };
      english = mal ? cleanDescription(mal.description) : '';
    }
    return { english, sourceMal: null };
  }
  const malId = malById[id];
  if (!malId) return null;
  const mal = await fetchEnglishFromMal(malId).catch(() => null);
  if (!mal) return null;
  return { english: mal.isAdult ? '' : cleanDescription(mal.description), sourceMal: malId };
}

// Lecture du cache ; si la colonne source_mal n'existe pas encore (SQL v13 pas exécuté), lecture sans elle
async function readCache(cfg, ids) {
  const list = ids.join(',');
  let res = await db(cfg, `synopsis_fr?select=anilist_id,text_fr,source_mal&anilist_id=in.(${list})`).catch(() => null);
  if (res && res.status === 400) res = await db(cfg, `synopsis_fr?select=anilist_id,text_fr&anilist_id=in.(${list})`).catch(() => null);
  if (!res || !res.ok) return null;
  const rows = await res.json().catch(() => null);
  return Array.isArray(rows) ? rows : null;
}

function postRows(cfg, rows, resolution) {
  return db(cfg, 'synopsis_fr?on_conflict=anilist_id', {
    method: 'POST',
    headers: { Prefer: `resolution=${resolution},return=minimal` },
    body: JSON.stringify(rows)
  }).catch(() => null);
}

// Traductions AniList : source_mal à null, elles remplacent un éventuel repli.
// Traductions du repli : marquées avec le mal utilisé, n'écrasent jamais une ligne existante,
// et ne sont pas gardées si la colonne source_mal manque.
async function saveRows(cfg, rows) {
  const trusted = rows.filter((r) => r.source_mal === null);
  const fallback = rows.filter((r) => r.source_mal !== null);
  if (trusted.length) {
    const res = await postRows(cfg, trusted, 'merge-duplicates');
    if (!res || !res.ok) await postRows(cfg, trusted.map(({ anilist_id, text_fr }) => ({ anilist_id, text_fr })), 'merge-duplicates');
  }
  if (fallback.length) await postRows(cfg, fallback, 'ignore-duplicates');
}

export async function onRequestGet({ request, env, ctx }) {
  if (!env.AI) return json({ code: 'not_configured', error: 'La traduction automatique n’est pas activée.' }, 503);
  const url = new URL(request.url);
  const ids = [...new Set((url.searchParams.get('ids') || '').split(',').map(Number))]
    .filter((n) => Number.isInteger(n) && n > 0 && n < 10000000)
    .slice(0, MAX_IDS);
  if (!ids.length) return json({ error: 'Aucun identifiant valide.' }, 400);
  const malList = (url.searchParams.get('mal') || '').split(',').map(Number);
  const allIds = (url.searchParams.get('ids') || '').split(',').map(Number);
  const malById = {};
  allIds.forEach((id, i) => {
    const mal = malList[i];
    if (ids.includes(id) && Number.isInteger(mal) && mal > 0 && mal < 10000000) malById[id] = mal;
  });

  const cfg = config(env);
  const items = {};

  // Sans clé service, aucun cache possible : on ne traduit rien pour ne pas payer Workers AI à chaque visite
  if (cfg.serviceKey) {
    const cached = await readCache(cfg, ids);
    for (const row of cached || []) {
      const sourceMal = row.source_mal == null ? null : Number(row.source_mal);
      if (sourceMal === null || sourceMal === malById[row.anilist_id]) items[row.anilist_id] = row.text_fr;
    }
    const missing = ids.filter((id) => !(id in items));

    const visitor = missing.length ? await ipBucket(request, env) : null;
    const allowed = visitor && (await rateOk(cfg, visitor, 'synopsis', PER_VISITOR[0], PER_VISITOR[1])) === true;
    if (missing.length && allowed) {
      const budget = { pieces: MAX_PIECES };
      const anilist = await fetchEnglish(missing).then((list) => new Map(list.map((m) => [m.id, m]))).catch(() => null);
      const rows = [];
      let translations = 0;
      for (const id of missing) {
        if (translations >= MAX_TRANSLATIONS) break;
        const source = await englishFor(id, anilist, malById);
        if (!source) continue;
        if (!source.english) { items[id] = null; continue; }
        // Budget du site décompté par traduction réellement lancée (un identifiant inconnu ne coûte rien)
        if ((await rateOk(cfg, 'site', 'synopsis_ai', PER_DAY, 86400)) !== true) break;
        translations++;
        try {
          const french = await translate(env, source.english, budget);
          if (french) { items[id] = french; rows.push({ anilist_id: id, text_fr: french, source_mal: source.sourceMal }); }
          else items[id] = null;
        } catch {
          items[id] = null;
        }
      }
      if (rows.length) {
        const save = saveRows(cfg, rows);
        if (ctx && ctx.waitUntil) ctx.waitUntil(save); else await save;
      }
    }
  }

  const complete = ids.every((id) => typeof items[id] === 'string');
  return json({ items }, 200, { 'Cache-Control': complete ? 'public, max-age=86400' : 'public, max-age=300' });
}
