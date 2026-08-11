import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;

/* Supabase calls this the "service_role" key, and it gets written down under
   several near-miss names. Accept the common ones: a key that is present under
   a slightly different name is a typo, not a decision, and failing on it costs
   an afternoon to discover. SUPABASE_SERVICE_ROLE_KEY stays the documented
   name — the rest are just tolerated. */
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  '';

const missing = [
  ['SUPABASE_URL', SUPABASE_URL],
  ['SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY]
].filter(([, value]) => !value).map(([name]) => name);

/* This module is imported at cold start. Throwing here takes the whole function
   down before any route runs, and a serverless host reports that as an opaque
   500 with the real cause buried in a log you may not be reading — which is
   exactly how a missing variable turned into an afternoon of guesswork.
   So: fail soft here, and let /api/health say what is wrong. */
export const configError = missing.length
  ? `Supabase credentials missing on this host: ${missing.join(', ')}. ` +
    'Locally, fill in server/.env. On Vercel, Project Settings -> Environment ' +
    'Variables, and make sure they are ticked for the Production environment.'
  : null;

if (configError) console.error('[api]', configError);

/** Which variables the process can see. Names only — never the values. */
export const envReport = {
  SUPABASE_URL: Boolean(SUPABASE_URL),
  SUPABASE_ANON_KEY: Boolean(SUPABASE_ANON_KEY),
  SUPABASE_SERVICE_ROLE_KEY: Boolean(SUPABASE_SERVICE_ROLE_KEY),

  /* Every SUPABASE_* name the process actually has. If one is expected but
     missing, this shows whether it arrived under a slightly different name —
     a typo in the key is invisible otherwise, because the variable simply
     is not there under the name we look for. Names only; no values. */
  seen: Object.keys(process.env).filter((k) => k.toUpperCase().startsWith('SUPABASE')).sort()
};

/* Stand-in so importing this module never explodes. Any route that slips past
   the guard in app.js gets a message naming the cause instead of
   "cannot read properties of undefined". */
const unconfigured = new Proxy({}, {
  get() { throw new Error(configError ?? 'Supabase client is not configured'); }
});

/**
 * Service-role client. Bypasses RLS, so it must never be exposed to the browser
 * and must only be reached through the validated routes in this server.
 *
 * Guest carts have no customer_id and are therefore invisible to RLS by design —
 * they can only be driven through here.
 */
export const admin = configError
  ? unconfigured
  : createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
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
