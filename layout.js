/* =========================================================
   Chic Colombo — shared page chrome.

   Every page ships an empty <div id="siteHeader"> and
   <div id="siteFooter">; this fetches partials/header.html and
   partials/footer.html and fills them in, then wires the behaviour
   that belongs to the chrome rather than to any one page.

   Keeping the markup in .html files rather than JS template strings
   means it stays editable as markup — the footer alone carries a
   200-line inline logo.

   Page scripts await Chic.ready before touching anything in the
   chrome. Their own content lives in their own HTML, so they do not
   have to wait to render.
   ========================================================= */

window.Chic.ready = (async function layout() {
  'use strict';

  const { esc, safeHref, money, $, $$ } = window.Chic;

  document.documentElement.classList.add('js');

  /* ---------- inject ---------- */

  async function partial(name, target) {
    const host = document.getElementById(target);
    if (!host) return;
    try {
      const res = await fetch(`/partials/${name}.html`);
      if (res.ok) host.innerHTML = await res.text();
    } catch {
      /* leave the slot empty rather than blocking the page */
    }
  }

  await Promise.all([
    partial('header', 'siteHeader'),
    partial('footer', 'siteFooter')
  ]);

  /* ---------- real logo swap-in ----------
     The inline SVG marks are a stand-in. As soon as assets/logo.png
     exists it replaces them everywhere. */

  (function useRealLogo() {
    const img = new Image();

    img.onload = () => {
      /* src is assigned only now, so a missing file never 404s in the console */
      $$('.logo__img, .footer__logo-img').forEach((el) => { el.src = img.src; el.hidden = false; });
      $$('.logo__mark, .logo__type, .footer__logo > svg').forEach((el) => el.remove());
      document.documentElement.classList.add('has-logo');
    };

    img.onerror = () => {
      /* keep the SVG stand-in; drop the empty <img> so no broken icon shows */
      $$('.logo__img, .footer__logo-img').forEach((el) => el.remove());
    };

    img.src = '/assets/logo.png';
  })();

  /* ---------- announcement marquee ---------- */

  const NOTICES = [
    'FREE ISLANDWIDE DELIVERY OVER LKR 10,000',
    'CUT &amp; SEWN IN COLOMBO',
    'NEW — THE LEOPARD CAPSULE',
    'WORLDWIDE SHIPPING'
  ];

  function paintMarquee(list) {
    const track = $('#announceTrack');
    if (!track) return;
    /* doubled so the loop has no seam */
    const run = list.map((n) => `<b>${n}</b><i>&bull;</i>`).join('');
    track.innerHTML = run + run;
  }

  paintMarquee(NOTICES);

  /* ---------- drawers ---------- */

  const cartEl = $('#cart');
  const drawer = $('#drawer');
  const scrim = $('#scrim');
  const burger = $('#burger');

  function openCart() {
    cartEl.classList.add('is-open');
    cartEl.setAttribute('aria-hidden', 'false');
    scrim.classList.add('is-on');
    document.body.classList.add('is-locked');
  }

  function closeAll() {
    cartEl?.classList.remove('is-open');
    cartEl?.setAttribute('aria-hidden', 'true');
    drawer?.classList.remove('is-open');
    drawer?.setAttribute('aria-hidden', 'true');
    burger?.setAttribute('aria-expanded', 'false');
    scrim?.classList.remove('is-on');
    document.body.classList.remove('is-locked');
  }

  $('#cartBtn')?.addEventListener('click', openCart);
  $('#cartClose')?.addEventListener('click', closeAll);
  scrim?.addEventListener('click', closeAll);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });

  burger?.addEventListener('click', () => {
    const open = !drawer.classList.contains('is-open');
    drawer.classList.toggle('is-open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    scrim.classList.toggle('is-on', open);
    document.body.classList.toggle('is-locked', open);
    burger.setAttribute('aria-expanded', String(open));
  });

  $('#drawerClose')?.addEventListener('click', closeAll);

  /* the cart module needs these but should not own the chrome */
  window.Chic.openCart = openCart;
  window.Chic.closeDrawers = closeAll;

  /* ---------- search ---------- */

  $('#searchBtn')?.addEventListener('click', () => {
    const term = prompt('Search for a product');
    if (term && term.trim()) {
      location.href = '/search?q=' + encodeURIComponent(term.trim());
    }
  });

  /* ---------- mega menu ----------
     One panel, repainted per nav item from the collections table. */

  const mega = $('#mega');
  const header = $('#header');
  let megaTimer;

  const COLUMNS = [
    ['category', 'SHOP BY CATEGORY'],
    ['destination', 'SHOP BY DESTINATION'],
    ['featured', 'FEATURED']
  ];

  let collections = null;

  async function loadCollections() {
    if (collections) return collections;
    collections = (await window.ChicAPI?.collections()) ?? [];
    return collections;
  }

  function paintMega(audience) {
    const cols = $('#megaCols');
    const promos = $('#megaPromos');
    if (!cols || !collections) return;

    cols.innerHTML = COLUMNS.map(([kind, heading]) => {
      const items = collections
        .filter((c) => c.kind === kind)
        /* unisex collections belong under every nav item */
        .filter((c) => kind !== 'category' || c.audience === audience || c.audience === 'unisex')
        .slice(0, 8);

      if (!items.length) return '';

      return `
        <div class="mega__col">
          <h4>${heading}</h4>
          ${items.map((c) =>
            `<a href="/collections/${encodeURIComponent(c.handle)}">${esc(c.title)}</a>`).join('')}
          ${kind === 'category'
            ? `<a href="/shop${audience === 'unisex' ? '' : `?audience=${audience}`}">Shop All</a>`
            : ''}
        </div>`;
    }).join('');

    if (promos) {
      const featured = collections.filter((c) => c.kind === 'featured').slice(0, 2);
      promos.innerHTML = featured.map((c, i) => `
        <a class="mega__promo" href="/collections/${encodeURIComponent(c.handle)}">
          <span class="ph ph--p${i + 1}"${c.image_url ? ` style="background-image:url('${esc(c.image_url)}')"` : ''}></span>
          <em>${esc(c.title.toUpperCase())}</em>
        </a>`).join('');
    }
  }

  $$('.nav__link[data-mega]').forEach((link) => {
    link.addEventListener('mouseenter', async () => {
      clearTimeout(megaTimer);
      await loadCollections();
      paintMega(link.dataset.mega);
      mega.classList.add('is-open');
      header.classList.add('is-solid');
    });
  });

  [header, mega].filter(Boolean).forEach((zone) => {
    zone.addEventListener('mouseleave', () => {
      megaTimer = setTimeout(() => {
        mega.classList.remove('is-open');
        if (window.scrollY <= 60) header.classList.remove('is-solid');
      }, 120);
    });
    zone.addEventListener('mouseenter', () => clearTimeout(megaTimer));
  });

  /* ---------- header: solid after the hero, hides on scroll down ---------- */

  let lastY = window.scrollY;

  function onScroll() {
    if (!header) return;
    const y = window.scrollY;
    const menuOpen = mega?.classList.contains('is-open') || drawer?.classList.contains('is-open');

    /* interior pages have no hero to sit over, so the bar starts solid */
    const overHero = document.body.dataset.hero === 'true';

    header.classList.toggle('is-solid', !overHero || y > 60 || menuOpen);
    header.classList.toggle('is-up', y > 520 && y > lastY && !menuOpen);

    lastY = y;
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- newsletter ---------- */

  const form = $('#signupForm');

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#signupMsg');
    const value = $('#signupEmail').value.trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      msg.classList.add('is-error');
      msg.textContent = 'Enter a valid email address.';
      return;
    }

    msg.classList.remove('is-error');
    msg.textContent = 'Signing you up…';

    const res = window.ChicAPI ? await window.ChicAPI.subscribe(value) : { ok: false };

    /* the same acknowledgement either way, so the form can't be used to
       probe which addresses are already on the list */
    if (res.ok || res.status === 0 || !window.ChicAPI) {
      msg.textContent = "You're on the list. Check your inbox.";
      form.reset();
    } else {
      msg.classList.add('is-error');
      msg.textContent = res.error ?? 'Could not sign you up just now.';
    }
  });

  /* ---------- settings hydration ---------- */

  async function hydrateSettings() {
    const s = await window.ChicAPI?.settings();
    if (!s) return;

    if (Array.isArray(s.announcements) && s.announcements.length) {
      paintMarquee(s.announcements.map(esc));
    }

    if (Array.isArray(s.socials) && s.socials.length) {
      const col = $$('.footer__column').find((c) => c.querySelector('h4')?.textContent === 'Follow');
      if (col) {
        col.innerHTML = '<h4>Follow</h4>' + s.socials
          .map((l) => `<a href="${safeHref(l.url)}" rel="noopener">${esc(l.platform)}</a>`).join('');
      }
    }

    const note = $('.footer__note');
    if (note && s.footer_note) note.textContent = s.footer_note;

    /* checkout and the cart both need the shipping rules */
    window.Chic.settings = s;
  }

  /* ---------- scroll reveal ---------- */

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-in');
      io.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px' });

  window.Chic.reveal = (nodes) => nodes.forEach((el, i) => {
    el.classList.add('reveal');
    el.style.transitionDelay = ((i % 4) * 60) + 'ms';
    io.observe(el);
  });

  window.Chic.reveal($$('.section .wrap > *, .promo__content, .page__body'));

  const island = $('#island');
  if (island) io.observe(island);

  /* ---------- misc ---------- */

  const year = $('#year');
  if (year) year.textContent = new Date().getFullYear();

  /* Only genuine placeholders are suppressed now — everything else is a
     real destination. */
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href="#"]');
    if (a) e.preventDefault();
  });

  await hydrateSettings();
})();
