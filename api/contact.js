// POST /api/contact: stores a Contact form message in Supabase (table public.contact_messages,
// read it in the dashboard's Table editor). The submit_contact function validates again and
// caps the site at 100 messages an hour.
import { cleanContact } from '../lib/contact.mjs';
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';

export async function POST(request) {
  let msg;
  try {
    const text = await request.text();
    if (text.length > 20_000) return Response.json({ error: 'Too large' }, { status: 413 });
    msg = JSON.parse(text);
  } catch { return Response.json({ error: 'Bad request' }, { status: 400 }); }

  const { spam, error, entry } = cleanContact(msg);
  if (spam) return Response.json({ ok: true });
  if (error) return Response.json({ error }, { status: 400 });

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_contact`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_topic: entry.topic, p_name: entry.name, p_email: entry.email, p_message: entry.message, p_page: entry.page }),
  }).catch(() => null);
  if (!res?.ok) {
    console.error('submit_contact failed', res?.status, await res?.text().catch(() => ''));
    return Response.json({ error: 'Could not send right now' }, { status: res?.status === 400 ? 400 : 503 });
  }
  return Response.json({ ok: true });
}

export function GET() {
  return Response.json({ error: 'Use POST' }, { status: 405 });
}
