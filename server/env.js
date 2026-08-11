/* =========================================================
   Loads server/.env no matter where the process was started from.

   `dotenv/config` resolves against the working directory, and the npm
   scripts now run from the repo root while the env file still lives
   beside the server code — so the bare import would silently find
   nothing and every Supabase call would fail on missing credentials.

   On Vercel there is no .env file at all; the platform injects the
   variables directly, so finding nothing here is the expected case.
   ========================================================= */

import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/* server/.env first, then the repo root. dotenv never overwrites a variable
   that is already set, so the first file to define a key wins and anything
   already in the real environment beats both. The root is checked too because
   package.json lives there now, which makes it the obvious place to put one. */
config({ path: join(HERE, '.env') });
config({ path: join(HERE, '..', '.env') });
