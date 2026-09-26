// GET /api/synopsis?ids=1,2,3 — synopsis AniList traduits en français.
// Le texte anglais est toujours relu chez AniList (jamais fourni par le navigateur), traduit une seule fois
// avec Workers AI, puis gardé dans la table Supabase synopsis_fr.
import { json, config, db } from './_lib.js';

const MODEL = '@cf/meta/m2m100-1.2b';
const MAX_IDS = 12;
const CHUNK = 450;

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

async function translate(env, text) {
  const paragraphs = text.split(/\n\n/);
  const result = [];
  for (const p of paragraphs) {
    const lines = p.split('\n');
    const translatedLines = [];
    for (const line of lines) {
      if (!line.trim()) { translatedLines.push(''); continue; }
      const parts = [];
      for (const piece of chunks(line.trim())) {
        const res = await env.AI.run(MODEL, { text: piece, source_lang: 'english', target_lang: 'french' });
        parts.push(String((res && res.translated_text) || '').trim());
      }
      translatedLines.push(parts.join(' '));
    }
    result.push(translatedLines.join('\n'));
  }
  return result.join('\n\n').trim();
}

async function fetchEnglish(ids) {
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      query: 'query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) { id isAdult description(asHtml: false) } } }',
      variables: { ids }
    })
  });
  if (!res.ok) throw new Error('AniList HTTP ' + res.status);
  const data = await res.json();
  return (data.data && data.data.Page && data.data.Page.media) || [];
}

export async function onRequestGet({ request, env, ctx }) {
  if (!env.AI) return json({ code: 'not_configured', error: 'La traduction automatique n’est pas activée.' }, 503);
  const url = new URL(request.url);
  const ids = [...new Set((url.searchParams.get('ids') || '').split(',').map(Number))]
    .filter((n) => Number.isInteger(n) && n > 0 && n < 10000000)
    .slice(0, MAX_IDS);
  if (!ids.length) return json({ error: 'Aucun identifiant valide.' }, 400);

  const cfg = config(env);
  const items = {};
  let missing = ids;

  if (cfg.serviceKey) {
    const cached = await db(cfg, `synopsis_fr?select=anilist_id,text_fr&anilist_id=in.(${ids.join(',')})`).catch(() => null);
    if (cached && cached.ok) {
      for (const row of await cached.json()) items[row.anilist_id] = row.text_fr;
      missing = ids.filter((id) => !(id in items));
    }
  }

  if (missing.length) {
    let media = [];
    try { media = await fetchEnglish(missing); } catch { return json({ items }, 200, { 'Cache-Control': 'no-store' }); }
    const rows = [];
    for (const m of media) {
      const english = m.isAdult ? '' : cleanDescription(m.description);
      if (!english) { items[m.id] = null; continue; }
      try {
        const french = await translate(env, english);
        if (french) { items[m.id] = french; rows.push({ anilist_id: m.id, text_fr: french }); }
      } catch {
        items[m.id] = null;
      }
    }
    if (rows.length && cfg.serviceKey) {
      const save = db(cfg, 'synopsis_fr?on_conflict=anilist_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows)
      }).catch(() => null);
      if (ctx && ctx.waitUntil) ctx.waitUntil(save); else await save;
    }
  }

  return json({ items }, 200, { 'Cache-Control': 'public, max-age=86400' });
}
