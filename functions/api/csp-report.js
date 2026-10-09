// POST /api/csp-report — rapports de la politique de sécurité du contenu (mode Report-Only).
// Sert à relever les domaines réellement utilisés (lecteurs vidéo, redirections) avant d'appliquer la
// politique. Seuls la directive et le domaine bloqué sont journalisés (jamais l'adresse complète).
export async function onRequestPost({ request }) {
  const text = (await request.text().catch(() => '')).slice(0, 8000);
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  const reports = Array.isArray(data) ? data.map((r) => r && r.body).filter(Boolean) : [data && data['csp-report']].filter(Boolean);
  for (const r of reports.slice(0, 10)) {
    const directive = String(r['violated-directive'] || r.effectiveDirective || '').slice(0, 40);
    let host = String(r['blocked-uri'] || r.blockedURL || '').slice(0, 300);
    try { host = new URL(host).host; } catch { host = host.slice(0, 40); }
    if (directive || host) console.log('csp', directive, host);
  }
  return new Response(null, { status: 204 });
}
