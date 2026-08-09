/* =========================================================
   Chic Colombo — home page.

   Chrome (header, footer, cart drawer, menus) lives in layout.js and
   is shared with every other page. What is left here is only what the
   home page has: the hero slider, the product rails, the destination
   grid and the brand film.
   ========================================================= */

(function () {
  'use strict';

  const { esc, safeHref, cardEl, toCard, $, $$ } = window.Chic;

  /* ---------- fallback catalogue ----------
     Rendered immediately so the page is never blank, then replaced by the
     live catalogue when the API answers. Prices are integer cents, as in
     the database. */

  const LATEST = [
    { name: "Ceylon Ringer Tee",     variant: "Palm Green",   price_cents: 455000, badge: null,  handle: 'ceylon-ringer-tee' },
    { name: "Monsoon Track Jacket",  variant: "Ceylon Brown", price_cents: 945000, badge: 'NEW', handle: 'monsoon-track-jacket' },
    { name: "Sarong Short",          variant: "Coconut",      price_cents: 375000, badge: null,  handle: 'sarong-short' },
    { name: "Galle Face Linen Set",  variant: "Coconut",      price_cents: 645000, badge: 'NEW', handle: 'galle-face-linen-set' },
    { name: "Leopard Crest Tee",     variant: "Ceylon Brown", price_cents: 545000, badge: 'NEW', handle: 'leopard-crest-tee' },
    { name: "Mirissa Crew Tank",     variant: "Monsoon Grey", price_cents: 465000, badge: 'NEW', handle: 'mirissa-crew-tank' },
    { name: "Colombo Longline Tee",  variant: "Coconut",      price_cents: 445000, badge: 'NEW', handle: 'colombo-longline-tee' },
    { name: "Pettah Panel Tank",     variant: "Indigo Batik", price_cents: 585000, badge: null,  handle: 'pettah-panel-tank' }
  ];

  const ACCESSORIES = [
    { name: "Batik Tote",     variant: "Indigo Batik", price_cents: 550000, badge: null,  handle: 'batik-tote' },
    { name: "Palm Cap",       variant: "Ceylon Brown", price_cents: 365000, badge: null,  handle: 'palm-cap' },
    { name: "Woven Belt",     variant: "Leopard Tan",  price_cents: 420000, badge: null,  handle: 'woven-belt' },
    { name: "Island Sandals", variant: "Coconut",      price_cents: 750000, badge: 'NEW', handle: 'island-sandals' }
  ];

  /* destination tiles per audience — [label, tone class, collection handle] */
  const DESTINATIONS = {
    mens: [
      ['ARUGAM BAY', 'a1', 'd-arugam-bay'], ['ELLA', 'a2', 'd-ella'],
      ['GALLE FACE', 'a3', 'd-galle-face'], ['PETTAH', 'a4', 'd-pettah']
    ],
    womens: [
      ['MIRISSA', 'c2', 'd-mirissa'], ['CINNAMON GARDENS', 'c1', 'd-cinnamon-gardens'],
      ['ELLA', 'c3', 'd-ella'], ['GALLE FACE', 'c5', 'd-galle-face']
    ]
  };

  /* ---------- hero slider ----------
     Slides come from /api/slides when the backend is up, otherwise from
     these defaults. A slide is either an image or a video; video slides
     hold until the clip ends rather than cutting away mid-shot. */

  const DEFAULT_SLIDES = [
    {
      kind: 'image',
      media_url: '/assets/hero-veranda.png',
      focal_point: 'center 42%',
      eyebrow: 'PREMIUM APPAREL · MADE IN SRI LANKA',
      title: 'Island State of Mind',
      subtitle: 'Made on the island, worn everywhere. Breathable cotton and linen built for the heat.',
      cta_label: 'SHOP MENS', cta_href: '/shop?audience=mens',
      cta2_label: 'SHOP WOMENS', cta2_href: '/shop?audience=womens'
    },
    {
      kind: 'video',
      media_url: '/assets/brand-film.mp4',
      poster_url: '/assets/video-poster.jpg',
      eyebrow: 'THE FILM',
      title: 'An Evening in the Dry Zone',
      subtitle: 'Shot on a veranda above the paddy fields.',
      cta_label: 'SHOP THE LOOK', cta_href: '/collections/latest'
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

  /* ---------- product rails ---------- */

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
      hydrateSlides()
    ]);

    document.documentElement.classList.add('api-live');
  }

  /* hero slides come from the admin panel once the backend is up */
  async function hydrateSlides() {
    const slides = await window.ChicAPI.slides();
    if (slides && slides.length && heroSlider) heroSlider.replace(slides);
  }

  hydrateFromApi();

  /* ---------- destination grid ---------- */

  const destGrid = $('#activityGrid');

  function paintDestinations(which) {
    destGrid.innerHTML = DESTINATIONS[which]
      .map(([label, cls, handle]) =>
        `<a class="tile" href="/collections/${handle}">
           <span class="ph ph--${cls}"></span><h3>${label}</h3>
         </a>`)
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

})();
