/* =========================================================
   Chic Colombo — product listing.

   Serves three routes off one page:
     /collections/:handle   a collection from the database
     /shop?audience=mens    everything, optionally by audience
     /search?q=linen        a title search

   Which one is in play is read from the URL rather than passed in, so
   the rewrites in vercel.json are the only routing table.
   ========================================================= */

(function () {
  'use strict';

  const { esc, cardEl, toCard, $, query } = window.Chic;

  const listing = $('#listing');
  const title = $('#listTitle');
  const countEl = $('#listCount');
  const crumb = $('#crumbHere');

  const AUDIENCE_LABEL = { mens: "Men's", womens: "Women's", unisex: 'Everything' };

  /** Works out what to fetch and what to call it. */
  async function resolveView() {
    const path = location.pathname;

    if (path.startsWith('/search')) {
      const q = (query('q') ?? '').trim();
      return {
        heading: q ? `Search: ${q}` : 'Search',
        crumb: 'Search',
        empty: q ? `Nothing matched “${q}”.` : 'Type something to search for.',
        fetch: () => (q ? window.ChicAPI.products({ q, limit: 60 }) : Promise.resolve([]))
      };
    }

    if (path.startsWith('/collections/')) {
      const handle = decodeURIComponent(path.split('/')[2] ?? '');

      /* the collection's own title is nicer than its handle, and confirms
         the collection actually exists */
      const all = await window.ChicAPI.collections();
      const found = (all ?? []).find((c) => c.handle === handle);

      return {
        heading: found?.title ?? handle,
        crumb: found?.title ?? handle,
        missing: !found,
        empty: 'Nothing in this collection yet.',
        fetch: () => window.ChicAPI.products({ collection: handle, limit: 60 })
      };
    }

    const audience = query('audience');
    return {
      heading: AUDIENCE_LABEL[audience] ?? 'Shop All',
      crumb: AUDIENCE_LABEL[audience] ?? 'Shop All',
      empty: 'Nothing here yet.',
      fetch: () => window.ChicAPI.products({ audience: audience || undefined, limit: 60 })
    };
  }

  function paint(rows, view) {
    listing.setAttribute('aria-busy', 'false');

    if (!rows || !rows.length) {
      listing.innerHTML = `
        <p class="listing__msg">${esc(view.empty)}</p>
        <p class="listing__msg"><a class="link-all" href="/shop">Browse everything</a></p>`;
      countEl.textContent = '';
      return;
    }

    listing.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'grid';
    rows.map(toCard).forEach((p, i) => grid.appendChild(cardEl(p, i)));
    listing.appendChild(grid);

    countEl.textContent = `${rows.length} ${rows.length === 1 ? 'piece' : 'pieces'}`;
  }

  (async function init() {
    const view = await resolveView();

    document.title = `${view.heading} | Chic Colombo`;
    title.textContent = view.heading;
    crumb.textContent = view.crumb;

    if (view.missing) {
      listing.setAttribute('aria-busy', 'false');
      listing.innerHTML = `
        <p class="listing__msg">That collection doesn't exist.</p>
        <p class="listing__msg"><a class="link-all" href="/shop">Browse everything</a></p>`;
      return;
    }

    const rows = await view.fetch();

    /* fetch() returns null when the API is unreachable — say so rather than
       claiming the collection is empty */
    if (rows === null) {
      listing.setAttribute('aria-busy', 'false');
      listing.innerHTML = '<p class="listing__msg">The shop is offline for a moment. Please refresh.</p>';
      return;
    }

    paint(rows, view);
  })();
})();
