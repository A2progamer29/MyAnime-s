// Installe les modèles d'e-mails LumaAnime dans Supabase (Authentication → Emails) en une commande.
// Utilisation (PowerShell) :
//   $env:SUPABASE_ACCESS_TOKEN = "ton_jeton"; node supabase/emails/installer-modeles.mjs
// Ajoute --essai pour voir ce qui serait modifié sans rien envoyer.
// Le jeton se crée sur https://supabase.com/dashboard/account/tokens et n'est jamais enregistré par ce script.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'phjpyaiheswpuqjpdfuo';
const TOKEN = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();
const DRY_RUN = process.argv.includes('--essai');
const DIR = dirname(fileURLToPath(import.meta.url));
const API = `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`;

const TEMPLATES = [
  { file: '1-confirmation-inscription.html', subject: 'Ton code d\'inscription LumaAnime', subjectKey: 'mailer_subjects_confirmation', contentKey: 'mailer_templates_confirmation_content' },
  { file: '2-invitation.html', subject: 'Ton invitation sur LumaAnime', subjectKey: 'mailer_subjects_invite', contentKey: 'mailer_templates_invite_content' },
  { file: '3-lien-de-connexion.html', subject: 'Ton lien de connexion LumaAnime', subjectKey: 'mailer_subjects_magic_link', contentKey: 'mailer_templates_magic_link_content' },
  { file: '4-changement-adresse.html', subject: 'Confirme ta nouvelle adresse e-mail', subjectKey: 'mailer_subjects_email_change', contentKey: 'mailer_templates_email_change_content' },
  { file: '5-reinitialisation-mot-de-passe.html', subject: 'Réinitialise ton mot de passe LumaAnime', subjectKey: 'mailer_subjects_recovery', contentKey: 'mailer_templates_recovery_content' },
  { file: '6-code-de-verification.html', subject: 'Ton code de vérification LumaAnime', subjectKey: 'mailer_subjects_reauthentication', contentKey: 'mailer_templates_reauthentication_content' },
  { file: '7-mot-de-passe-modifie.html', subject: 'Ton mot de passe LumaAnime a été modifié', subjectKey: 'mailer_subjects_password_changed_notification', contentKey: 'mailer_templates_password_changed_notification_content', enableKey: 'mailer_notifications_password_changed_enabled' },
  { file: '8-adresse-modifiee.html', subject: 'L\'adresse e-mail de ton compte LumaAnime a changé', subjectKey: 'mailer_subjects_email_changed_notification', contentKey: 'mailer_templates_email_changed_notification_content', enableKey: 'mailer_notifications_email_changed_enabled' },
  { file: '9-connexion-associee.html', subject: 'Nouveau moyen de connexion sur ton compte LumaAnime', subjectKey: 'mailer_subjects_identity_linked_notification', contentKey: 'mailer_templates_identity_linked_notification_content', enableKey: 'mailer_notifications_identity_linked_enabled' },
  { file: '10-connexion-retiree.html', subject: 'Moyen de connexion retiré de ton compte LumaAnime', subjectKey: 'mailer_subjects_identity_unlinked_notification', contentKey: 'mailer_templates_identity_unlinked_notification_content', enableKey: 'mailer_notifications_identity_unlinked_enabled' }
];

function fail(message) {
  console.error('\n✖ ' + message + '\n');
  process.exit(1);
}

async function api(method, body) {
  const res = await fetch(API, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (res.status === 401 || res.status === 403) fail('Jeton refusé par Supabase (' + res.status + '). Vérifie-le ou crée-en un nouveau.');
  if (!res.ok) fail('Supabase a répondu ' + res.status + ' : ' + text.slice(0, 300));
  return text ? JSON.parse(text) : {};
}

if (!TOKEN) {
  fail('Jeton manquant. Crée un jeton sur https://supabase.com/dashboard/account/tokens puis lance :\n  $env:SUPABASE_ACCESS_TOKEN = "ton_jeton"; node supabase/emails/installer-modeles.mjs');
}

const current = await api('GET');
const patch = {};
const skipped = [];

for (const t of TEMPLATES) {
  if (!(t.contentKey in current)) { skipped.push(t.file); continue; }
  patch[t.subjectKey] = t.subject;
  patch[t.contentKey] = await readFile(join(DIR, t.file), 'utf8');
  if (t.enableKey && t.enableKey in current) patch[t.enableKey] = true;
  console.log('✔ ' + t.file.padEnd(38) + ' → ' + t.subject);
}
for (const f of skipped) console.log('– ' + f.padEnd(38) + ' → non proposé par ce projet Supabase, ignoré');

if (!Object.keys(patch).length) fail('Aucun modèle à installer.');
if (DRY_RUN) {
  console.log('\nMode essai : rien n\'a été envoyé. Relance sans --essai pour installer.');
  process.exit(0);
}

await api('PATCH', patch);
console.log('\nModèles installés dans Supabase. Envoie-toi un e-mail de test pour vérifier.');
