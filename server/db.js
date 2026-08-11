import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY } = process.env;

/* This module is imported at cold start, so a missing variable takes the whole
   function down before any route runs — on a platform that means an opaque 500
   with the real cause buried in the build log. Name every missing variable at
   once, and say where it is meant to come from in each environment. */
const missing = [
  ['SUPABASE_URL', SUPABASE_URL],
  ['SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY]
].filter(([, value]) => !value).map(([name]) => name);

if (missing.length) {
  throw new Error(
    `Supabase credentials missing: ${missing.join(', ')}.\n` +
    '  Locally:  copy server/.env.example to server/.env and fill it in.\n' +
    '  On Vercel: Project Settings -> Environment Variables.\n' +
    '  Values are in Supabase -> Project Settings -> API.'
  );
}

/**
 * Service-role client. Bypasses RLS, so it must never be exposed to the browser
 * and must only be reached through the validated routes in this server.
 *
 * Guest carts have no customer_id and are therefore invisible to RLS by design —
 * they can only be driven through here.
 */
export const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

/**
 * Builds a client scoped to an end user's access token, so RLS applies as that
 * user. Use for anything acting on behalf of a signed-in customer.
 */
export function asUser(accessToken) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY ?? SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
}

/** Resolves the caller's user id from a bearer token, or null when anonymous. */
export async function currentUser(req) {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;

  const { data, error } = await admin.auth.getUser(token);
  if (error) return null;
  return data.user ?? null;
}
