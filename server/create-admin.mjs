#!/usr/bin/env node
/* =========================================================
   Create (or link) the admin account — one command.

     cd server
     node create-admin.mjs

   Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env, which
   you have already set up for the API. Prompts for the email and
   password interactively.

   The password is typed straight into Supabase. It is never written
   to disk, never placed in an environment variable, and never appears
   in your shell history.

   Does two things, both idempotent:
     1. creates the auth.users account (pre-confirmed, so no email step)
     2. adds it to site_admins, so the server-side admin check passes
   ========================================================= */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

function die(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  die('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing.\n' +
      '  Copy .env.example to .env and fill it in first.');
}

const rl = createInterface({ input: stdin, output: stdout });
const ask = (q) => new Promise((res) => rl.question(q, (a) => res(a.trim())));

/* Reads without echoing, so the password never shows on screen. */
function askSecret(prompt) {
  return new Promise((resolve) => {
    stdout.write(prompt);
    const onData = (chunk) => {
      /* swallow the echo readline would otherwise print */
      const s = chunk.toString();
      if (s === '\r' || s === '\n' || s === '\r\n') stdin.removeListener('data', onData);
      else stdout.write('*');
    };
    stdin.on('data', onData);

    rl.question('', (answer) => {
      stdin.removeListener('data', onData);
      stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

console.log('\n  Chic Colombo — create admin\n');

const email = await ask('  Admin email: ');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) die('That is not a valid email address.');

const password = await askSecret('  Password (min 8 chars, hidden): ');
if (password.length < 8) die('Password must be at least 8 characters.');

const confirm = await askSecret('  Confirm password: ');
if (password !== confirm) die('Passwords do not match.');

rl.close();

console.log('\n  Working…\n');

/* ---- 1. the auth account ---- */
let userId = null;

const { data: created, error: createErr } = await sb.auth.admin.createUser({
  email,
  password,
  email_confirm: true          /* skip the verification email */
});

if (created?.user) {
  userId = created.user.id;
  console.log('  ✓ Auth account created');
} else if (createErr) {
  /* already registered is fine — we just link it */
  const already = /already|exists|registered/i.test(createErr.message);
  if (!already) die(`Could not create the account: ${createErr.message}`);

  console.log('  · Auth account already exists — linking it instead');

  const { data: list, error: listErr } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) die(`Could not look up existing users: ${listErr.message}`);

  const found = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!found) die('The account exists but could not be found. Check the Supabase dashboard.');

  userId = found.id;
}

/* ---- 2. the site_admins allow-list row ---- */
const { data: existing } = await sb
  .from('site_admins')
  .select('id, user_id')
  .or(`user_id.eq.${userId},email.ilike.${email}`)
  .maybeSingle();

if (existing) {
  /* backfill user_id if the row was seeded email-only by 03_admin.sql */
  if (!existing.user_id) {
    const { error } = await sb.from('site_admins')
      .update({ user_id: userId, email }).eq('id', existing.id);
    if (error) die(`Could not link the admin row: ${error.message}`);
    console.log('  ✓ Linked the seeded site_admins row to this account');
  } else {
    console.log('  · Already in site_admins');
  }
} else {
  const { error } = await sb.from('site_admins')
    .insert({ user_id: userId, email, label: 'Master admin' });
  if (error) die(`Could not add to site_admins: ${error.message}`);
  console.log('  ✓ Added to site_admins');
}

console.log(
  '\n  Done. Sign in at admin.html with:\n' +
  `    ${email}\n` +
  '    (the password you just typed)\n'
);

process.exit(0);
