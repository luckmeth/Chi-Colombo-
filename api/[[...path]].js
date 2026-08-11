/* =========================================================
   Vercel serverless entry point.

   The optional catch-all filename is load-bearing. Vercel routes every
   /api/* request here AND leaves the full original path on req.url, so
   the routes declared in server/app.js ("/api/products", "/api/cart/:id"
   and so on) keep matching exactly as they do locally.

   A plain api/index.js plus a rewrite would deliver "/api" to the app
   instead, and every route would 404.
   ========================================================= */

export { default } from '../server/app.js';
