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

config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') });
