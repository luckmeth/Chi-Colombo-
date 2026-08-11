/* =========================================================
   Vercel serverless entry point — every /api/* request lands here.

   Routing note, learned the hard way. Catch-all *filenames*
   (api/[...path].js, api/[[...path]].js) are a framework convention.
   On this project — plain static files, no framework — Vercel honoured
   neither: it matched a single segment, so /api/health reached the app
   while /api/admin/status and /api/products/:handle 404'd before
   getting near it.

   So the path is carried explicitly instead. vercel.json rewrites
   /api/:path* to /api?__vpath=:path*, and this restores it onto
   req.url before Express sees the request. That works whether Vercel
   hands us the original URL or the rewrite destination, which is the
   part that could not be pinned down from outside.

   Locally there is no rewrite and no __vpath, so this is a no-op and
   `npm start` behaves exactly as before.
   ========================================================= */

import app from '../server/app.js';

export default function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const vpath = url.searchParams.get('__vpath');

  if (vpath !== null) {
    url.searchParams.delete('__vpath');
    const query = url.searchParams.toString();
    req.url = `/api${vpath ? `/${vpath}` : ''}${query ? `?${query}` : ''}`;
  }

  return app(req, res);
}
