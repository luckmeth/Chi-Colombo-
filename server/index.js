/* =========================================================
   Local development server.

   In production the same app is served by Vercel as a serverless
   function — see api/[[...path]].js. Nothing but the listen call
   lives here, so the two environments cannot drift apart.

     npm start        # this file
     npm run dev      # same, with --watch
   ========================================================= */

import app from './app.js';

const PORT = process.env.PORT ?? 8787;

app.listen(PORT, () => {
  console.log(`Chic Colombo API listening on http://localhost:${PORT}`);
});
