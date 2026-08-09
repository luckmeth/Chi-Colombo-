/* =========================================================
   Chic Colombo — product detail.

   This page is where a variant_id first exists. Cards elsewhere carry
   only a product, and the cart is keyed on variants, so every add to
   cart either happens here or is sent here by cart.js.
   ========================================================= */

(function () {
  'use strict';

  const { esc, money, tone, cardEl, toCard, $, $$, toast, pathParam } = window.Chic;

  const host = $('#product');
  const handle = pathParam(1);

  /* colour + size are chosen separately; a variant is the pair */
  let product = null;
  let colour = null;
  let size = null;

  const active = () => (product?.product_variants ?? []).filter((v) => v.is_active);

  const colours = () => [...new Map(active().map((v) => [v.colour_name, v])).values()];

  const sizesFor = (colourName) => active()
    .filter((v) => v.colour_name === colourName)
    .sort((a, b) => a.position - b.position);

  const current = () => active().find((v) => v.colour_name === colour && v.size === size) ?? null;

  /* ---------- render ---------- */

  function gallery() {
    const images = [...(product.product_images ?? [])].sort((a, b) => a.position - b.position);

    if (!images.length) {
      return `<div class="pdp__figure"><span class="ph" style="background-image:${tone(2, 0)}"></span></div>`;
    }

    return `
      <div class="pdp__figure">
        <img id="pdpMain" src="${esc(images[0].url)}" alt="${esc(product.title)}">
      </div>
      ${images.length > 1 ? `
        <div class="pdp__thumbs">
          ${images.map((img, i) => `
            <button type="button" class="pdp__thumb${i === 0 ? ' is-on' : ''}"
                    data-src="${esc(img.url)}" aria-label="View image ${i + 1}">
              <img src="${esc(img.url)}" alt="" loading="lazy">
            </button>`).join('')}
        </div>` : ''}`;
  }

  function controls() {
    const list = sizesFor(colour);
    const variant = current();

    /* out of stock is a real state, not an error — say which one applies */
    const stock = !variant ? null : variant.inventory_qty;
    const soldOut = stock !== null && stock <= 0;

    return `
      <div class="pdp__row">
        <span class="pdp__label">Colour</span>
        <div class="swatches">
          ${colours().map((v) => `
            <button type="button" class="swatch${v.colour_name === colour ? ' is-on' : ''}"
                    data-colour="${esc(v.colour_name)}" title="${esc(v.colour_name)}"
                    aria-pressed="${v.colour_name === colour}">
              <i style="background:${esc(v.colour_hex ?? '#ccc')}"></i>
              <span>${esc(v.colour_name)}</span>
            </button>`).join('')}
        </div>
      </div>

      <div class="pdp__row">
        <span class="pdp__label">Size</span>
        <div class="sizes">
          ${list.map((v) => `
            <button type="button" class="size${v.size === size ? ' is-on' : ''}"
                    data-size="${esc(v.size)}" ${v.inventory_qty <= 0 ? 'disabled' : ''}
                    aria-pressed="${v.size === size}"
                    title="${v.inventory_qty <= 0 ? 'Sold out' : `${v.inventory_qty} in stock`}">
              ${esc(v.size)}
            </button>`).join('')}
        </div>
      </div>

      <p class="pdp__stock" role="status">
        ${soldOut ? 'Sold out in this size.'
          : stock !== null && stock <= 5 ? `Only ${stock} left.`
          : stock !== null ? 'In stock.' : 'Choose a size.'}
      </p>

      <button class="btn btn--primary btn--full" id="addToCart" ${soldOut || !variant ? 'disabled' : ''}>
        ${soldOut ? 'SOLD OUT' : 'ADD TO CART'}
      </button>`;
  }

  function paint() {
    const variant = current();
    const price = variant?.price_cents ?? product.price_cents;

    host.setAttribute('aria-busy', 'false');
    host.className = 'pdp';
    host.innerHTML = `
      <div class="pdp__media">${gallery()}</div>

      <div class="pdp__info">
        ${product.is_new ? '<span class="card__badge card__badge--static">NEW</span>' : ''}
        <h1 class="pdp__title">${esc(product.title)}</h1>
        <p class="pdp__price" id="pdpPrice">${money(price)}
          ${product.compare_at_cents
            ? `<s>${money(product.compare_at_cents)}</s>` : ''}</p>

        ${product.description ? `<p class="pdp__desc">${esc(product.description)}</p>` : ''}

        <div id="pdpControls">${controls()}</div>

        <ul class="pdp__meta">
          <li>Free islandwide delivery over LKR 10,000</li>
          <li>Cut &amp; sewn in Colombo</li>
          <li><a href="/pages/refund-policy">Returns &amp; exchanges</a></li>
        </ul>
      </div>`;
  }

  /** Repaints just the controls, so choosing a size doesn't reload the gallery. */
  function repaintControls() {
    $('#pdpControls').innerHTML = controls();
    const variant = current();
    $('#pdpPrice').innerHTML = money(variant?.price_cents ?? product.price_cents) +
      (product.compare_at_cents ? `<s>${money(product.compare_at_cents)}</s>` : '');
  }

  /* ---------- events ---------- */

  host.addEventListener('click', async (e) => {
    const thumb = e.target.closest('.pdp__thumb');
    if (thumb) {
      $('#pdpMain').src = thumb.dataset.src;
      $$('.pdp__thumb').forEach((t) => t.classList.toggle('is-on', t === thumb));
      return;
    }

    const swatch = e.target.closest('.swatch');
    if (swatch) {
      colour = swatch.dataset.colour;
      /* the chosen size may not exist in the new colour */
      const list = sizesFor(colour);
      if (!list.some((v) => v.size === size)) {
        size = (list.find((v) => v.inventory_qty > 0) ?? list[0])?.size ?? null;
      }
      repaintControls();
      return;
    }

    const sizeBtn = e.target.closest('.size');
    if (sizeBtn && !sizeBtn.disabled) {
      size = sizeBtn.dataset.size;
      repaintControls();
      return;
    }

    if (e.target.closest('#addToCart')) {
      const variant = current();
      if (!variant) return toast('Choose a size first', true);

      const btn = e.target.closest('#addToCart');
      btn.disabled = true;
      const added = await window.ChicCart.add(variant.id);
      btn.disabled = false;

      if (added) {
        /* the API is the source of truth for stock; pull the new number in */
        const fresh = await window.ChicAPI.product(handle);
        if (fresh) { product = fresh; repaintControls(); }
      }
    }
  });

  /* ---------- also like ---------- */

  async function alsoLike() {
    const rows = await window.ChicAPI.products({ collection: 'latest', limit: 12 });
    if (!rows || rows.length < 2) return;

    const rail = $('#alsoRail');
    rows.map(toCard)
      .filter((p) => p.handle !== handle)
      .slice(0, 8)
      .forEach((p, i) => rail.appendChild(cardEl(p, i)));

    $('#alsoSection').hidden = false;
  }

  /* ---------- boot ---------- */

  (async function init() {
    if (!handle) {
      host.innerHTML = '<p class="listing__msg">No product specified.</p>';
      return;
    }

    product = await window.ChicAPI.product(handle);

    if (!product) {
      host.setAttribute('aria-busy', 'false');
      host.innerHTML = `
        <p class="listing__msg">We couldn't find that product.</p>
        <p class="listing__msg"><a class="link-all" href="/shop">Browse everything</a></p>`;
      return;
    }

    document.title = `${product.title} | Chic Colombo`;
    $('#crumbHere').textContent = product.title;

    /* open on the first colour that actually has stock */
    const inStock = active().find((v) => v.inventory_qty > 0) ?? active()[0];
    colour = inStock?.colour_name ?? null;
    size = inStock?.size ?? null;

    paint();
    alsoLike();
  })();
})();
