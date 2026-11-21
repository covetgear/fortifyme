// Checks a Contact form submission. Shared by server.mjs (saves to out/messages/) and
// api/contact.js (stores it in Supabase, table public.contact_messages).

export const TOPICS = ['general', 'bug', 'data', 'idea', 'sponsor', 'privacy', 'legal'];

// Returns { spam: true }, { error }, or { entry }.
export function cleanContact(msg) {
  if (!msg || typeof msg !== 'object') return { error: 'Bad request' };
  // Spam trap filled in: the caller pretends it worked and keeps nothing.
  if (msg.website) return { spam: true };
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  const entry = {
    received: new Date().toISOString(),
    topic: TOPICS.includes(msg.topic) ? msg.topic : 'general',
    name: str(msg.name, 80),
    email: str(msg.email, 200),
    message: str(msg.message, 5000),
    page: str(msg.page, 500),
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry.email)) return { error: 'Invalid email' };
  if (entry.message.length < 10) return { error: 'Message too short' };
  return { entry };
}
