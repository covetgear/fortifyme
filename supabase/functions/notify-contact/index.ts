// Emails the site owner a copy of each Contact form message (table public.contact_messages).
// Called by the database trigger contact_messages_notify (migration contact_notify) with {"id": <row id>}.
// Each message is emailed once: the row's notified_at is set after a successful send, so a repeat call does nothing.
// Reply-To is the sender's address, so replying in your mail app answers them directly.
//
// Secrets: RESEND_API_KEY (shared with send-alerts) and CONTACT_TO (where messages go).
// Optional: CONTACT_FROM (default "FortifyMe <no-reply@fortifyme.gg>").
// Without CONTACT_TO it does nothing; messages are still saved in the table.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const CONTACT_TO = Deno.env.get('CONTACT_TO');
const CONTACT_FROM = Deno.env.get('CONTACT_FROM') || 'FortifyMe <no-reply@fortifyme.gg>';

const TOPICS: Record<string, string> = {
  general: 'General', bug: 'Bug report', data: 'Wrong shop data', idea: 'Feature idea',
  sponsor: 'Sponsorship', privacy: 'Privacy request', legal: 'Legal',
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  const { id } = await req.json().catch(() => ({}));
  if (!Number.isSafeInteger(id) || id < 1) return json({ error: 'Bad id' }, 400);
  if (!RESEND_API_KEY || !CONTACT_TO) return json({ skipped: 'CONTACT_TO or RESEND_API_KEY not set' });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: m, error } = await db.from('contact_messages').select('*').eq('id', id).is('notified_at', null).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!m) return json({ skipped: 'not found or already sent' });

  const topic = TOPICS[m.topic] ?? m.topic;
  const who = m.name ? `${m.name} <${m.email}>` : m.email;
  const subject = `[FortifyMe] ${topic}${m.name ? ` from ${m.name}` : ''}`.replace(/[\r\n]+/g, ' ').slice(0, 150);
  const text = `${topic} from ${who}\nPage: ${m.page || '-'}\nReceived: ${m.received_at}\n\n${m.message}\n\nReply to this email to answer them.`;
  const html = `<div style="font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#111827">
    <p style="margin:0 0 4px"><b>${esc(topic)}</b> from ${esc(who)}</p>
    <p style="margin:0 0 16px;color:#6b7280;font-size:12px">Page: ${esc(m.page || '-')} · Received: ${esc(String(m.received_at))}</p>
    <div style="white-space:pre-wrap;border-left:3px solid #d7fb76;padding:4px 0 4px 12px">${esc(m.message)}</div>
    <p style="margin:16px 0 0;color:#6b7280;font-size:12px">Reply to this email to answer them.</p></div>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: CONTACT_FROM, to: CONTACT_TO, reply_to: m.email, subject, text, html }),
  });
  if (!r.ok) {
    const detail = await r.text();
    console.error(`Contact email failed for ${m.id}: ${r.status} ${detail}`);
    return json({ error: `Resend ${r.status}` }, 502);
  }
  await db.from('contact_messages').update({ notified_at: new Date().toISOString() }).eq('id', m.id);
  return json({ sent: true });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
