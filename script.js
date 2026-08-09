/* =========================================================
   Chic Colombo — storefront behaviour
   ========================================================= */

(function () {
  'use strict';

  /* Enables the scroll-reveal styles. Kept here so the page degrades to
     plain visible content if this script never runs. */
  document.documentElement.classList.add('js');

  /* ---------- data ---------- */

  const LATEST = [
    { name: "Ceylon Ringer Tee",     variant: "Palm Green",   price: 4550, badge: null },
    { name: "Monsoon Track Jacket",  variant: "Ceylon Brown", price: 9450, badge: 'NEW' },
    { name: "Sarong Short",          variant: "Coconut",      price: 3750, badge: null },
    { name: "Galle Face Linen Set",  variant: "Coconut",      price: 6450, badge: 'NEW' },
    { name: "Leopard Crest Tee",     variant: "Ceylon Brown", price: 5450, badge: 'NEW' },
    { name: "Mirissa Crew Tank",     variant: "Monsoon Grey", price: 4650, badge: 'NEW' },
    { name: "Colombo Longline Tee",  variant: "Coconut",      price: 4450, badge: 'NEW' },
    { name: "Pettah Panel Tank",     variant: "Indigo Batik", price: 5850, badge: null }
  ];

  const ACCESSORIES = [
    { name: "Batik Tote",     variant: "Indigo Batik", price: 5500,  badge: null },
    { name: "Palm Cap",       variant: "Ceylon Brown", price: 3650,  badge: null },
    { name: "Woven Belt",     variant: "Leopard Tan",  price: 4200,  badge: null },
    { name: "Island Sandals", variant: "Coconut",      price: 7500,  badge: 'NEW' }
  ];

  /* destination tiles per audience */
  const DESTINATIONS = {
    mens:   [['ARUGAM BAY', 'a1'], ['ELLA', 'a2'], ['GALLE FACE', 'a3'], ['PETTAH', 'a4']],
    womens: [['MIRISSA', 'c2'], ['CINNAMON GARDENS', 'c1'], ['ELLA', 'c3'], ['GALLE FACE', 'c5']]
  };

  const NOTICES = [
    'FREE ISLANDWIDE DELIVERY OVER LKR 10,000',
    'CUT &amp; SEWN IN COLOMBO',
    'NEW — THE LEOPARD CAPSULE',
    'WORLDWIDE SHIPPING'
  ];

  /* warm placeholder tones drawn from the brand palette */
  const TONES = [
    ['#e0d3ba', '#b09b7d'], ['#4a3a28', '#241811'], ['#c2a689', '#6f5a3f'],
    ['#d9c9ae', '#a8875f'], ['#b4703a', '#6b3d1c'], ['#55442f', '#251a10'],
    ['#f0e4d0', '#cbb99c'], ['#2e1c0c', '#120a04'], ['#97a08a', '#545f45'],
    ['#cdb99e', '#8a6f4e'], ['#5c6b4a', '#2c3626'], ['#e8dcc6', '#b3a184']
  ];

  const money = (n) =>
    'LKR ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const tone = (i, offset) => {
    const t = TONES[(i * 3 + offset) % TONES.length];
    return `linear-gradient(165deg, ${t[0]}, ${t[1]})`;
  };

  /* titles and image URLs arrive from the database, so anything interpolated
     into markup has to be escaped — a stray quote alone would break out of an
     attribute and mangle the card */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- real logo swap-in ----------
     The inline SVG marks are a stand-in. As soon as assets/logo.png exists
     it replaces them everywhere, so dropping the real file in is the only
     step needed — no markup changes. */

  (function useRealLogo() {
    const img = new Image();

    img.onload = () => {
      /* src is assigned only now, so a missing file never 404s in the console */
      document.querySelectorAll('.logo__img, .footer__logo-img')
        .forEach((el) => { el.src = img.src; el.hidden = false; });
      /* retire the stand-ins */
      document.querySelectorAll('.logo__mark, .logo__type, .footer__logo > svg')
        .forEach((el) => el.remove());
      document.documentElement.classList.add('has-logo');
    };

    img.onerror = () => {
      /* keep the SVG stand-in; drop the empty <img> so no broken icon shows */
      document.querySelectorAll('.logo__img, .footer__logo-img')
        .forEach((el) => el.remove());
    };

    img.src = 'assets/logo.png';
  })();

  /* ---------- hero slider ----------
     Slides come from /api/slides when the backend is up, otherwise from
     these defaults. A slide is either an image or a video; video slides
     hold until the clip ends rather than cutting away mid-shot. */

  const DEFAULT_SLIDES = [
    {
      kind: 'image',
      media_url: 'assets/hero-veranda.png',
      focal_point: 'center 42%',
      eyebrow: 'PREMIUM APPAREL · MADE IN SRI LANKA',
      title: 'Island State of Mind',
      subtitle: 'Made on the island, worn everywhere. Breathable cotton and linen built for the heat.',
      cta_label: 'SHOP MENS', cta_href: '#',
      cta2_label: 'SHOP WOMENS', cta2_href: '#'
    },
    {
      kind: 'video',
      media_url: 'assets/brand-film.mp4',
      poster_url: 'assets/video-poster.jpg',
      eyebrow: 'THE FILM',
      title: 'An Evening in the Dry Zone',
      subtitle: 'Shot on a veranda above the paddy fields.',
      cta_label: 'SHOP THE LOOK', cta_href: '#'
    }
  ];

  const SLIDE_MS = 6000;

  const heroSlider = (function () {
    const stage = document.getElementById('heroSlides');
    const dotsBox = document.getElementById('heroDots');
    const toggle = document.getElementById('heroToggle');
    if (!stage) return null;

    const calm = matchMedia('(prefers-reduced-motion: reduce)');
    let slides = [];
    let index = 0;
    let timer = null;
    let playing = !calm.matches;

    /* only allow hrefs we're happy to render — these can come from the DB */
    const safeHref = (h) => {
      const v = String(h ?? '#').trim();
      return /^(https?:\/\/|\/|#|mailto:|tel:)/i.test(v) ? v : '#';
    };

    function build(list) {
      slides = list;
      stage.innerHTML = '';
      dotsBox.innerHTML = '';

      list.forEach((s, i) => {
        const el = document.createElement('article');
        el.className = 'hero__slide' + (i === 0 ? ' is-active' : '');
        el.setAttribute('aria-hidden', String(i !== 0));

        const media = s.kind === 'video'
          ? `<video class="hero__video" muted loop playsinline preload="${i === 0 ? 'auto' : 'none'}"
                    ${s.poster_url ? `poster="${esc(s.poster_url)}"` : ''}>
               <source src="${esc(s.media_url)}" type="video/mp4">
             </video>`
          : `<div class="hero__media" style="background-image:url('${esc(s.media_url)}');
                    background-position:${esc(s.focal_point || 'center 42%')}"></div>`;

        const ctas = [
          s.cta_label ? `<a href="${esc(safeHref(s.cta_href))}" class="btn">${esc(s.cta_label)}</a>` : '',
          s.cta2_label ? `<a href="${esc(safeHref(s.cta2_href))}" class="btn btn--light">${esc(s.cta2_label)}</a>` : ''
        ].join('');

        el.innerHTML = `
          ${media}
          <div class="wrap hero__wrap">
            <div class="hero__content">
              ${s.eyebrow ? `<p class="hero__eyebrow">${esc(s.eyebrow)}</p>` : ''}
              ${s.title ? `<h1 class="hero__title">${esc(s.title)}</h1>` : ''}
              ${s.subtitle ? `<p class="hero__sub">${esc(s.subtitle)}</p>` : ''}
              ${ctas ? `<div class="hero__cta">${ctas}</div>` : ''}
            </div>
          </div>`;

        stage.appendChild(el);

        const dot = document.createElement('button');
        dot.className = 'hero__dot' + (i === 0 ? ' is-active' : '');
        dot.type = 'button';
        dot.setAttribute('role', 'tab');
        dot.setAttribute('aria-label', `Slide ${i + 1}`);
        dot.addEventListener('click', () => { go(i); restart(); });
        dotsBox.appendChild(dot);
      });

      /* a single slide needs no chrome */
      const solo = list.length < 2;
      dotsBox.hidden = solo;
      toggle.hidden = solo;
      document.getElementById('heroPrev').hidden = solo;
      document.getElementById('heroNext').hidden = solo;

      show(0);
    }

    const slideEls = () => [...stage.querySelectorAll('.hero__slide')];

    function show(i) {
      slideEls().forEach((el, n) => {
        const on = n === i;
        el.classList.toggle('is-active', on);
        el.setAttribute('aria-hidden', String(!on));

        const vid = el.querySelector('video');
        if (!vid) return;

        if (on) {
          vid.preload = 'auto';
          vid.currentTime = 0;
          const p = vid.play();
          if (p && p.catch) p.catch(() => {});
        } else {
          vid.pause();   /* never leave an off-screen clip running */
        }
      });

      [...dotsBox.children].forEach((d, n) => d.classList.toggle('is-active', n === i));
      index = i;
    }

    function go(i) { show((i + slides.length) % slides.length); }
    const next = () => go(index + 1);
    const prev = () => go(index - 1);

    /* Video slides advance on 'ended' instead of the timer, so a clip is
       never cut off partway. Everything else uses SLIDE_MS. */
    function schedule() {
      clearTimeout(timer);
      const dot = dotsBox.children[index];
      if (dot) {
        dot.classList.remove('is-timing');
        void dot.offsetWidth;
        if (playing) dot.classList.add('is-timing');
      }

      if (!playing || slides.length < 2) return;

      const current = slideEls()[index];
      const vid = current && current.querySelector('video');

      if (vid) {
        vid.loop = false;
        vid.onended = () => { if (playing) next(), schedule(); };
        /* a stalled video shouldn't strand the carousel */
        const guard = (vid.duration && isFinite(vid.duration) ? vid.duration * 1000 : SLIDE_MS) + 2000;
        timer = setTimeout(() => { if (playing) { next(); schedule(); } }, guard);
      } else {
        timer = setTimeout(() => { next(); schedule(); }, SLIDE_MS);
      }
    }

    function restart() { schedule(); }

    function setPlaying(on) {
      playing = on;
      toggle.setAttribute('aria-pressed', String(on));
      toggle.setAttribute('aria-label', on ? 'Pause slideshow' : 'Play slideshow');
      toggle.querySelector('.i-pause').toggleAttribute('hidden', !on);
      toggle.querySelector('.i-play').toggleAttribute('hidden', on);

      const vid = slideEls()[index]?.querySelector('video');
      if (vid) { if (on) { const p = vid.play(); if (p && p.catch) p.catch(() => {}); } else vid.pause(); }

      if (on) schedule(); else clearTimeout(timer);
    }

    document.getElementById('heroNext').addEventListener('click', () => { next(); restart(); });
    document.getElementById('heroPrev').addEventListener('click', () => { prev(); restart(); });
    toggle.addEventListener('click', () => setPlaying(!playing));

    /* keyboard, swipe, and don't run while the tab is hidden */
    document.getElementById('hero').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { next(); restart(); }
      if (e.key === 'ArrowLeft') { prev(); restart(); }
    });

    let touchX = null;
    stage.addEventListener('touchstart', (e) => { touchX = e.changedTouches[0].clientX; }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      if (touchX === null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 45) { dx < 0 ? next() : prev(); restart(); }
      touchX = null;
    }, { passive: true });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearTimeout(timer);
      else if (playing) schedule();
    });

    build(DEFAULT_SLIDES);
    setPlaying(!calm.matches);

    return {
      replace(list) {
        if (!Array.isArray(list) || !list.length) return;
        build(list);
        setPlaying(playing);
      }
    };
  })();

  /* ---------- announcement marquee ---------- */

  const track = document.getElementById('announceTrack');
  if (track) {
    /* duplicated so the -50% keyframe loops seamlessly */
    const run = NOTICES.map((n) => `<b>${n}</b><i>&bull;</i>`).join('');
    track.innerHTML = run + run;
  }

  /* ---------- product rendering ---------- */

  function cardEl(product, index) {
    /* no reveal class — cards live in a horizontal rail, so the observer
       would leave off-screen ones stuck at opacity 0 */
    const el = document.createElement('article');
    el.className = 'card';

    /* Real photography when the product has any, the woven gradient otherwise.
       The hover layer falls back to a tone so a product with a single photo
       still gets the two-layer hover treatment rather than a dead card. */
    const front = product.image
      ? `<img class="ph ph--main" src="${esc(product.image)}" alt="${esc(product.name)}" loading="lazy">`
      : `<span class="ph ph--main" style="background-image:${tone(index, 0)}"></span>`;

    const back = product.hover
      ? `<img class="ph ph--alt" src="${esc(product.hover)}" alt="" loading="lazy">`
      : `<span class="ph ph--alt" style="background-image:${tone(index, 5)}"></span>`;

    el.innerHTML = `
      <a class="card__media" href="#" aria-label="${esc(product.name)}">
        ${product.badge ? `<span class="card__badge">${esc(product.badge)}</span>` : ''}
        ${front}
        ${back}
        <span class="card__quick" role="button" tabindex="0">QUICK ADD</span>
      </a>
      <div class="card__info">
        <h3 class="card__name">${esc(product.name)}</h3>
        <p class="card__variant">${esc(product.variant)}</p>
        <p class="card__price">${money(product.price)}</p>
      </div>`;

    const quick = el.querySelector('.card__quick');
    const add = (e) => { e.preventDefault(); e.stopPropagation(); addToCart(product, index); };
    quick.addEventListener('click', add);
    quick.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') add(e); });
    el.querySelector('.card__media').addEventListener('click', (e) => e.preventDefault());

    return el;
  }

  function renderRail(id, list, offset) {
    const rail = document.getElementById(id);
    if (!rail) return;
    list.forEach((p, i) => rail.appendChild(cardEl(p, i + offset)));
  }

  renderRail('latestRail', LATEST, 0);
  renderRail('accRail', ACCESSORIES, 8);

  /* ---------- live catalogue ----------
     The rails render from the built-in arrays immediately so the page is
     never blank. If the API answers, its catalogue replaces them. */

  async function hydrateFromApi() {
    if (!window.ChicAPI || !(await window.ChicAPI.health())) return;

    const toCard = (row) => ({
      name: row.title,
      variant: row.default_colour ?? '',
      price: Math.round((row.price_cents ?? 0) / 100),
      badge: row.is_new ? 'NEW' : null,
      handle: row.handle,
      /* product_cards exposes the first two images by position */
      image: row.primary_image ?? null,
      hover: row.hover_image ?? null
    });

    const swap = async (railId, collection, offset) => {
      const rows = await window.ChicAPI.products({ collection, limit: 12 });
      if (!rows || !rows.length) return;

      const rail = document.getElementById(railId);
      rail.innerHTML = '';
      rows.map(toCard).forEach((p, i) => rail.appendChild(cardEl(p, i + offset)));
    };

    await Promise.all([
      swap('latestRail', 'latest', 0),
      swap('accRail', 'accessories', 8),
      hydrateSlides(),
      hydrateSettings()
    ]);

    document.documentElement.classList.add('api-live');
  }

  /* hero slides come from the admin panel once the backend is up */
  async function hydrateSlides() {
    const slides = await window.ChicAPI.slides();
    if (slides && slides.length && heroSlider) heroSlider.replace(slides);
  }

  /* contact details, socials and marquee copy are all admin-editable */
  async function hydrateSettings() {
    const s = await window.ChicAPI.settings();
    if (!s) return;

    if (Array.isArray(s.announcements) && s.announcements.length) {
      const run = s.announcements.map((n) => `<b>${n}</b><i>&bull;</i>`).join('');
      document.getElementById('announceTrack').innerHTML = run + run;
    }

    if (Array.isArray(s.socials) && s.socials.length) {
      const col = [...document.querySelectorAll('.footer__column')]
        .find((c) => c.querySelector('h4')?.textContent.trim() === 'Follow');

      if (col) {
        col.querySelectorAll('a').forEach((a) => a.remove());
        s.socials.forEach((link) => {
          const a = document.createElement('a');
          a.href = link.url;
          a.textContent = link.platform;
          a.rel = 'noopener noreferrer';
          a.target = '_blank';
          col.appendChild(a);
        });
      }
    }

    const bottom = document.querySelector('.footer__bottom p:first-child');
    if (bottom && s.footer_note) bottom.textContent = s.footer_note.toUpperCase();
  }

  hydrateFromApi();

  /* ---------- destination grid ---------- */

  const destGrid = document.getElementById('activityGrid');

  function paintDestinations(which) {
    destGrid.innerHTML = DESTINATIONS[which]
      .map(([label, cls]) =>
        `<a class="tile" href="#"><span class="ph ph--${cls}"></span><h3>${label}</h3></a>`)
      .join('');
  }

  paintDestinations('mens');

  document.getElementById('activityTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('#activityTabs .tab')
      .forEach((t) => t.classList.toggle('is-active', t === tab));
    paintDestinations(tab.dataset.tab);
  });

  /* ---------- carousel rails ---------- */

  const ARROW = (dir) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
       <path d="${dir === 'prev' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}"/>
     </svg>`;

  document.querySelectorAll('.arrows[data-rail]').forEach((box) => {
    const rail = document.getElementById(box.dataset.rail);
    if (!rail) return;

    box.innerHTML = `
      <button type="button" data-dir="prev" aria-label="Previous">${ARROW('prev')}</button>
      <button type="button" data-dir="next" aria-label="Next">${ARROW('next')}</button>`;

    const [prev, next] = box.querySelectorAll('button');

    const step = () => {
      const first = rail.firstElementChild;
      return first ? first.getBoundingClientRect().width + 4 : rail.clientWidth;
    };

    const sync = () => {
      const max = rail.scrollWidth - rail.clientWidth;
      prev.disabled = rail.scrollLeft <= 1;
      next.disabled = rail.scrollLeft >= max - 1;
    };

    box.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      rail.scrollBy({ left: btn.dataset.dir === 'next' ? step() : -step(), behavior: 'smooth' });
    });

    rail.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    sync();
    requestAnimationFrame(sync);
  });

  /* ---------- cart ---------- */

  const cart = [];
  const cartEl = document.getElementById('cart');
  const cartBody = document.getElementById('cartBody');
  const cartCount = document.getElementById('cartCount');
  const cartTotal = document.getElementById('cartTotal');
  const scrim = document.getElementById('scrim');
  const drawer = document.getElementById('drawer');

  function addToCart(product, index) {
    const existing = cart.find((l) => l.name === product.name);
    if (existing) existing.qty += 1;
    else cart.push({ name: product.name, variant: product.variant, price: product.price, qty: 1, index });
    paintCart();
    openCart();

    /* restart the badge pop */
    cartCount.classList.remove('pop');
    void cartCount.offsetWidth;
    cartCount.classList.add('pop');
  }

  function removeFromCart(name) {
    const i = cart.findIndex((l) => l.name === name);
    if (i > -1) cart.splice(i, 1);
    paintCart();
  }

  function paintCart() {
    const units = cart.reduce((n, l) => n + l.qty, 0);
    cartCount.textContent = units;
    cartCount.classList.toggle('is-on', units > 0);
    cartTotal.textContent = money(cart.reduce((n, l) => n + l.price * l.qty, 0));

    if (!cart.length) {
      cartBody.innerHTML = '<p class="cart__empty">Your cart is empty.</p>';
      return;
    }

    cartBody.innerHTML = '';
    cart.forEach((line) => {
      const row = document.createElement('div');
      row.className = 'cart-item';
      row.innerHTML = `
        <div class="cart-item__media"><span class="ph" style="background-image:${tone(line.index, 0)}"></span></div>
        <div>
          <p class="cart-item__name">${line.name}</p>
          <p class="cart-item__meta">${line.variant} &middot; Qty ${line.qty}</p>
          <p class="cart-item__price">${money(line.price * line.qty)}</p>
        </div>
        <button class="cart-item__remove" type="button">Remove</button>`;
      row.querySelector('.cart-item__remove')
        .addEventListener('click', () => removeFromCart(line.name));
      cartBody.appendChild(row);
    });
  }

  function openCart() {
    cartEl.classList.add('is-open');
    cartEl.setAttribute('aria-hidden', 'false');
    scrim.classList.add('is-on');
    document.body.classList.add('is-locked');
  }

  function closeAll() {
    cartEl.classList.remove('is-open');
    cartEl.setAttribute('aria-hidden', 'true');
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    document.getElementById('burger').setAttribute('aria-expanded', 'false');
    scrim.classList.remove('is-on');
    document.body.classList.remove('is-locked');
  }

  document.getElementById('cartBtn').addEventListener('click', openCart);
  document.getElementById('cartClose').addEventListener('click', closeAll);
  scrim.addEventListener('click', closeAll);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });

  paintCart();

  /* ---------- mobile drawer ---------- */

  const burger = document.getElementById('burger');
  burger.addEventListener('click', () => {
    const open = !drawer.classList.contains('is-open');
    drawer.classList.toggle('is-open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    scrim.classList.toggle('is-on', open);
    document.body.classList.toggle('is-locked', open);
    burger.setAttribute('aria-expanded', String(open));
  });
  document.getElementById('drawerClose').addEventListener('click', closeAll);

  /* ---------- mega menu ---------- */

  const mega = document.getElementById('mega');
  const header = document.getElementById('header');
  let megaTimer;

  document.querySelectorAll('.nav__link[data-mega]').forEach((link) => {
    link.addEventListener('mouseenter', () => {
      clearTimeout(megaTimer);
      mega.classList.add('is-open');
      header.classList.add('is-solid');
    });
  });

  [header, mega].forEach((zone) => {
    zone.addEventListener('mouseleave', () => {
      megaTimer = setTimeout(() => {
        mega.classList.remove('is-open');
        if (window.scrollY <= 60) header.classList.remove('is-solid');
      }, 120);
    });
    zone.addEventListener('mouseenter', () => clearTimeout(megaTimer));
  });

  /* ---------- header: solid after hero top, hides on scroll down ---------- */

  let lastY = window.scrollY;

  function onScroll() {
    const y = window.scrollY;
    const menuOpen = mega.classList.contains('is-open') || drawer.classList.contains('is-open');

    header.classList.toggle('is-solid', y > 60 || menuOpen);
    header.classList.toggle('is-up', y > 520 && y > lastY && !menuOpen);

    lastY = y;
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- brand film ----------
     Autoplay must be muted to be allowed at all, so sound is opt-in.
     Playback is tied to visibility so an off-screen video isn't burning
     battery or data on a phone. */

  (function brandFilm() {
    const video = document.getElementById('brandFilm');
    if (!video) return;

    const playBtn = document.getElementById('filmPlay');
    const soundBtn = document.getElementById('filmSound');
    const calm = matchMedia('(prefers-reduced-motion: reduce)');

    /* attribute, not the .hidden property — SVGElement doesn't implement it */
    const icon = (btn, showClass, hideClass) => {
      btn.querySelector(showClass).removeAttribute('hidden');
      btn.querySelector(hideClass).setAttribute('hidden', '');
    };

    const markPlaying = (playing) => {
      playBtn.setAttribute('aria-pressed', String(playing));
      playBtn.setAttribute('aria-label', playing ? 'Pause video' : 'Play video');
      if (playing) icon(playBtn, '.i-pause', '.i-play');
      else icon(playBtn, '.i-play', '.i-pause');
    };

    /* wantsPlay tracks intent, so scrolling away and back resumes only
       when the viewer hadn't deliberately paused */
    let wantsPlay = !calm.matches;

    const tryPlay = () => {
      const p = video.play();
      /* older Safari returns undefined rather than a promise */
      if (p && typeof p.catch === 'function') {
        p.then(() => markPlaying(true)).catch(() => markPlaying(false));
      } else {
        markPlaying(true);
      }
    };

    playBtn.addEventListener('click', () => {
      wantsPlay = video.paused;
      if (wantsPlay) tryPlay();
      else { video.pause(); markPlaying(false); }
    });

    soundBtn.addEventListener('click', () => {
      video.muted = !video.muted;
      soundBtn.setAttribute('aria-pressed', String(!video.muted));
      soundBtn.setAttribute('aria-label', video.muted ? 'Unmute video' : 'Mute video');
      if (video.muted) icon(soundBtn, '.i-muted', '.i-loud');
      else {
        icon(soundBtn, '.i-loud', '.i-muted');
        /* unmuting mid-pause should also start it */
        if (video.paused && wantsPlay) tryPlay();
      }
    });

    video.addEventListener('play', () => markPlaying(true));
    video.addEventListener('pause', () => markPlaying(false));

    /* pause off-screen, resume on return */
    const seen = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          if (wantsPlay && video.paused) tryPlay();
        } else if (!video.paused) {
          video.pause();
        }
      });
    }, { threshold: 0.25 });

    seen.observe(video);

    /* reduced motion: hold on the poster until asked */
    if (calm.matches) markPlaying(false);
    else tryPlay();
  })();

  /* ---------- newsletter ---------- */

  const form = document.getElementById('signupForm');
  const msg = document.getElementById('signupMsg');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = document.getElementById('signupEmail').value.trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      msg.classList.add('is-error');
      msg.textContent = 'Enter a valid email address.';
      return;
    }

    msg.classList.remove('is-error');
    msg.textContent = 'Signing you up…';

    /* persist when the API is up; still acknowledge when it isn't */
    const res = window.ChicAPI ? await window.ChicAPI.subscribe(value) : { ok: false };

    if (res.ok) {
      msg.textContent = "You're on the list. Check your inbox.";
      form.reset();
    } else if (res.status === 0 || !window.ChicAPI) {
      msg.textContent = "You're on the list. Check your inbox.";
      form.reset();
    } else {
      msg.classList.add('is-error');
      msg.textContent = res.error ?? 'Could not sign you up just now.';
    }
  });

  /* ---------- scroll reveal ---------- */

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-in');
      io.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px' });

  document.querySelectorAll('.section .wrap > *, .promo__content')
    .forEach((el, i) => {
      el.classList.add('reveal');
      /* light stagger within each section */
      el.style.transitionDelay = ((i % 4) * 60) + 'ms';
      io.observe(el);
    });

  /* the island band triggers the leopard walk once */
  const island = document.getElementById('island');
  if (island) io.observe(island);

  /* ---------- misc ---------- */

  document.getElementById('year').textContent = new Date().getFullYear();

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href="#"]');
    if (a) e.preventDefault();
  });

})();
