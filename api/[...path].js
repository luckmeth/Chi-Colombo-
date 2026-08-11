/* =========================================================
   Vercel serverless entry point.

   The filename is load-bearing. `[...path]` is Vercel's catch-all for
   Functions, and it matches /api/anything at any depth while leaving
   the full original path on req.url — so the routes declared in
   server/app.js ("/api/products", "/api/cart/:id/items") keep matching
   exactly as they do locally.

   It was `[[...path]]` at first. That is Next.js's *optional* catch-all
   syntax, and on a non-Next project Vercel matched only one segment:
   /api/health reached the app but /api/admin/status and
   /api/products/:handle both 404'd before ever getting here.
   ========================================================= */

export { default } from '../server/app.js';
