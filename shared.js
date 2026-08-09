/* =========================================================
   Chic Colombo — helpers shared by every page.

   Loaded after config.js and api.js, before layout.js. Everything
   here hangs off window.Chic so the page scripts can stay small.

   Money is integer cents everywhere, matching the database. The only
   place rupees exist is the moment before they are printed.
   ========================================================= */

window.Chic = (function () {
  'use strict';

  /* ---------- formatting ---------- */

  const money = (cents) =>
    'LKR ' + ((cents ?? 0) / 100).toLocaleString('en-US',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /** Two decimals, no separators — what payment gateways want to sign. */
  const amount = (cents) => ((cents ?? 0) / 100).toFixed(2);

  /* Titles, URLs and addresses all arrive from the database. A stray quote
     alone would break out of an attribute and mangle the markup. */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Only hrefs we are happy to render — these can come from the DB. */
  const safeHref = (h) => {
    const v = String(h ?? '#').trim();
    return /^(https?:\/\/|\/|#|mailto:|tel:)/i.test(v) ? v : '#';
  };

  /* ---------- placeholder art ----------
     Warm tones from the brand palette, used until a product has photography. */

  const TONES = [
    ['#e0d3ba', '#b09b7d'], ['#4a3a28', '#241811'], ['#c2a689', '#6f5a3f'],
    ['#d9c9ae', '#a8875f'], ['#b4703a', '#6b3d1c'], ['#55442f', '#251a10'],
    ['#f0e4d0', '#cbb99c'], ['#2e1c0c', '#120a04'], ['#97a08a', '#545f45'],
    ['#cdb99e', '#8a6f4e'], ['#5c6b4a', '#2c3626'], ['#e8dcc6', '#b3a184']
  ];

  const tone = (i, offset = 0) => {
    const t = TONES[Math.abs(i * 3 + offset) % TONES.length];
    return `linear-gradient(165deg, ${t[0]}, ${t[1]})`;
  };

  /* ---------- dom ---------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /** Reads a route parameter out of the path, e.g. /products/<handle>. */
  const pathParam = (index = 1) =>
    decodeURIComponent((location.pathname.split('/').filter(Boolean)[index] ?? ''));

  const query = (key) => new URLSearchParams(location.search).get(key);

  /* ---------- product card ----------
     One renderer, used by the home rails, collection pages and search. */

  function cardEl(product, index = 0) {
    const el = document.createElement('article');
    el.className = 'card';

    const href = product.handle ? `/products/${encodeURIComponent(product.handle)}` : '#';

    /* Real photography when the product has any, the woven gradient otherwise.
       The hover layer falls back to a tone so a product with a single photo
       still gets the two-layer treatment rather than a dead card. */
    const front = product.image
      ? `<img class="ph ph--main" src="${esc(product.image)}" alt="${esc(product.name)}" loading="lazy">`
      : `<span class="ph ph--main" style="background-image:${tone(index, 0)}"></span>`;

    const back = product.hover
      ? `<img class="ph ph--alt" src="${esc(product.hover)}" alt="" loading="lazy">`
      : `<span class="ph ph--alt" style="background-image:${tone(index, 5)}"></span>`;

    el.innerHTML = `
      <a class="card__media" href="${href}" aria-label="${esc(product.name)}">
        ${product.badge ? `<span class="card__badge">${esc(product.badge)}</span>` : ''}
        ${front}
        ${back}
        <span class="card__quick" role="button" tabindex="0">QUICK ADD</span>
      </a>
      <div class="card__info">
        <a class="card__name" href="${href}">${esc(product.name)}</a>
        <p class="card__variant">${esc(product.variant)}</p>
        <p class="card__price">${money(product.price_cents)}</p>
      </div>`;

    const quick = el.querySelector('.card__quick');
    const add = (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.ChicCart?.quickAdd(product);
    };
    quick.addEventListener('click', add);
    quick.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') add(e);
    });

    return el;
  }

  /** Maps a product_cards row into what cardEl expects. */
  const toCard = (row) => ({
    id: row.id,
    name: row.title,
    variant: row.default_colour ?? '',
    price_cents: row.price_cents ?? 0,
    badge: row.is_new ? 'NEW' : null,
    handle: row.handle,
    /* product_cards exposes the first two images by position */
    image: row.primary_image ?? null,
    hover: row.hover_image ?? null,
    total_inventory: row.total_inventory
  });

  /* ---------- toast ---------- */

  let toastTimer;
  function toast(message, bad = false) {
    let el = $('#toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.toggle('is-bad', bad);
    el.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-on'), 3200);
  }

  return { money, amount, esc, safeHref, tone, $, $$, pathParam, query, cardEl, toCard, toast };
})();
