/* =========================================================
   Chic Colombo — browser configuration.

   Loaded first on every page, before api.js / script.js / admin.js.
   Everything the client needs to find a backend lives here and only
   here, so there is one place to change when the project moves.

   Nothing secret belongs in this file. It is served to every visitor.
   ========================================================= */

(function () {
  'use strict';

  /* ---------- where the API lives ----------
     In production the API is served by the same deployment under /api,
     so an empty base means "same origin" — no absolute URL to keep in
     sync, and no CORS preflight.

     In development the storefront is served by a static file server on
     its own port while the API runs on 8787, so they are different
     origins and the base has to be explicit. */
  function apiBase() {
    /* an explicit override always wins — handy for pointing a local page
       at a deployed API, or the other way round */
    if (typeof window.CHIC_API_BASE === 'string') return window.CHIC_API_BASE;

    const { protocol, hostname, port } = window.location;

    /* opened straight off disk: there is no origin to be relative to */
    if (protocol === 'file:') return 'http://localhost:8787';

    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

    /* served by the API itself? then same-origin already points at it */
    if (isLocal && port !== '8787') return 'http://localhost:8787';

    return '';
  }

  window.CHIC_API_BASE = apiBase();

  /* ---------- Supabase ----------
     The anon key is designed to be public: it identifies the project and
     nothing more, and every table it can reach is behind row-level
     security. The service-role key is the one that must never appear
     here — it lives only in the API's environment. */
  window.CHIC_SUPABASE_URL ??= 'https://dvvpwmmhybttrijbnakf.supabase.co';
  window.CHIC_SUPABASE_ANON_KEY ??= 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2dnB3bW1oeWJ0dHJpamJuYWtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyNzE4OTksImV4cCI6MjEwMTg0Nzg5OX0.R26fhWrsrpivAwdAoSsA_a9hXfwWr_SdJaovxNsTmjw';
})();
