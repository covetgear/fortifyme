// One-click "turn off wishlist alerts" link from alert emails.
// GET  ?token=<uuid>  (someone clicks the link)   -> turns alerts off, redirects to the site's confirmation page
// POST ?token=<uuid>  (mail app's unsubscribe button, RFC 8058) -> turns alerts off, returns 200
// Deployed with verify_jwt off: email links can't carry a login. The token is the secret.
// (Supabase serves function HTML as plain text, so the confirmation page lives on the site.)
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SITE_URL = (Deno.env.get('SITE_URL') || 'http://localhost:5173').replace(/\/+$/, '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  let ok = false;
  if (UUID.test(token)) {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data, error } = await db.rpc('unsubscribe_alerts', { p_token: token });
    if (error) console.error(error.message);
    ok = data === true;
  }
  if (req.method === 'POST') return new Response(ok ? 'Unsubscribed' : 'Unknown link', { status: ok ? 200 : 404 });
  return new Response(null, { status: 303, headers: { Location: `${SITE_URL}/alerts-off${ok ? '' : '?bad=1'}` } });
});
