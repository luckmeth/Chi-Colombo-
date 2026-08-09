#!/usr/bin/env node
/* =========================================================
   Apply setup_all.sql to a Supabase project.

   Reads your credentials from the environment — nothing is stored
   in this repo, and no token is ever written to disk.

     $env:SUPABASE_ACCESS_TOKEN = "sbp_..."      # PowerShell
     $env:SUPABASE_PROJECT_REF  = "abcdefgh..."
     node supabase/apply.mjs

   Get a token at  https://supabase.com/dashboard/account/tokens
   The project ref is the subdomain of your project URL:
     https://<PROJECT_REF>.supabase.co

   Pass --dry-run to print what would happen without sending anything.
   ========================================================= */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes('--dry-run');

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!DRY && !TOKEN) {
  die('SUPABASE_ACCESS_TOKEN is not set.\n' +
      '  PowerShell:  $env:SUPABASE_ACCESS_TOKEN = "sbp_..."');
}

if (!DRY && !REF) {
  die('SUPABASE_PROJECT_REF is not set.\n' +
      '  It is the subdomain of your project URL: https://<REF>.supabase.co');
}

const sql = await readFile(join(HERE, 'setup_all.sql'), 'utf8');

console.log(`\n  setup_all.sql — ${sql.split('\n').length} lines, ${(sql.length / 1024).toFixed(1)} KB`);

if (DRY) {
  console.log(`  Dry run: would POST to project "${REF ?? '<unset>'}"\n`);
  process.exit(0);
}

console.log(`  Applying to project ${REF} …\n`);

/* The Management API query endpoint runs SQL as the project owner —
   the same thing the dashboard SQL Editor does. */
const res = await fetch(
  `https://api.supabase.com/v1/projects/${REF}/database/query`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: sql })
  }
).catch((err) => die(`Network error: ${err.message}`));

const text = await res.text();

if (!res.ok) {
  console.error(`  FAILED (HTTP ${res.status})\n`);
  console.error(text.slice(0, 4000));
  console.error(
    '\n  If this endpoint is unavailable on your plan, paste setup_all.sql\n' +
    '  into the dashboard SQL Editor instead — same result.\n'
  );
  process.exit(1);
}

console.log('  Applied successfully.\n');
if (text.trim() && text.trim() !== '[]') console.log(text.slice(0, 2000));

console.log(
  '  Next:\n' +
  '   1. Supabase → Authentication → Users → add your admin account\n' +
  '   2. Confirm that email is in the site_admins table\n' +
  '   3. Put SUPABASE_URL / keys in server/.env, then: cd server && npm start\n'
);
