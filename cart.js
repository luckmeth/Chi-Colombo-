/* =========================================================
   Chic Colombo — the cart.

   State lives on the server. The browser keeps only a cart id and a
   session token in localStorage (see api.js), so the cart survives a
   refresh, and stock is checked by the API on every change rather
   than trusted from the page.

   Exposes window.ChicCart for the card renderer, the cart page and
   checkout.
   ========================================================= */

window.ChicCart = (function () {
  'use strict';

  const { money, esc, tone, $, $$, toast } = window.Chic;

  let state = { items: [], subtotal_cents: 0 };
  const listeners = new Set();

  const units = () => state.items.reduce((n, i) => n + i.qty, 0);

  /** Anything that renders the cart registers here and gets repainted. */
  function subscribe(fn) {
    listeners.add(fn);
    fn(state);
    return () => listeners.delete(fn);
  }

  function publish() {
    paintBadge();
    paintDrawer();
    listeners.forEach((fn) => fn(state));
  }

  async function refresh() {
    const data = await window.ChicAPI?.getCart();
    state = data ?? { items: [], subtotal_cents: 0 };
    publish();
    return state;
  }

  /* ---------- mutations ---------- */

  async function add(variantId, qty = 1, { open = true } = {}) {
    const res = await window.ChicAPI.addItem(variantId, qty);

    if (!res.ok) {
      toast(res.error ?? 'Could not add that to your cart', true);
      return false;
    }

    await refresh();
    popBadge();
    if (open) window.Chic.openCart?.();
    return true;
  }

  async function setQty(itemId, qty) {
    const res = await window.ChicAPI.setQty(itemId, qty);
    if (!res.ok) {
      toast(res.error ?? 'Could not update the quantity', true);
      /* the server refused, so put the displayed numbers back */
      await refresh();
      return false;
    }
    await refresh();
    return true;
  }

  async function remove(itemId) {
    const res = await window.ChicAPI.removeItem(itemId);
    if (!res.ok) {
      toast(res.error ?? 'Could not remove that item', true);
      return false;
    }
    await refresh();
    return true;
  }

  /* ---------- quick add ----------
     A card carries no variant, and apparel here is sized. Rather than
     guess a size on the shopper's behalf, send them to the product page
     unless there is genuinely only one thing to choose. */

  async function quickAdd(product) {
    if (!product?.handle) return;

    const full = await window.ChicAPI.product(product.handle);
    if (!full) {
      toast('Could not open that product', true);
      return;
    }

    const variants = (full.product_variants ?? [])
      .filter((v) => v.is_active && v.inventory_qty > 0);

    if (!variants.length) {
      toast('Sold out');
      return;
    }

    if (variants.length === 1) {
      await add(variants[0].id);
      return;
    }

    location.href = `/products/${encodeURIComponent(product.handle)}`;
  }

  /* ---------- painting ---------- */

  function popBadge() {
    const badge = $('#cartCount');
    if (!badge) return;
    /* restart the animation */
    badge.classList.remove('pop');
    void badge.offsetWidth;
    badge.classList.add('pop');
  }

  function paintBadge() {
    const badge = $('#cartCount');
    if (!badge) return;
    const n = units();
    badge.textContent = n;
    badge.classList.toggle('is-on', n > 0);
  }

  function lineHTML(line, i) {
    const media = line.image
      ? `<img src="${esc(line.image)}" alt="" loading="lazy">`
      : `<span class="ph" style="background-image:${tone(i, 0)}"></span>`;

    return `
      <div class="cart-item" data-item="${line.item_id}">
        <a class="cart-item__media" href="/products/${encodeURIComponent(line.handle)}">${media}</a>
        <div>
          <a class="cart-item__name" href="/products/${encodeURIComponent(line.handle)}">${esc(line.title)}</a>
          <p class="cart-item__meta">${esc(line.colour)} &middot; ${esc(line.size)}</p>
          <div class="qty" role="group" aria-label="Quantity">
            <button type="button" data-step="-1" aria-label="Reduce quantity">&minus;</button>
            <span class="qty__n">${line.qty}</span>
            <button type="button" data-step="1" aria-label="Increase quantity"
              ${line.qty >= line.inventory_qty ? 'disabled' : ''}>+</button>
          </div>
          <p class="cart-item__price">${money(line.line_total_cents)}</p>
        </div>
        <button class="cart-item__remove" type="button" data-remove>Remove</button>
      </div>`;
  }

  function paintDrawer() {
    const body = $('#cartBody');
    const total = $('#cartTotal');
    const checkout = $('#cartCheckout');
    if (!body) return;

    body.innerHTML = state.items.length
      ? state.items.map(lineHTML).join('')
      : '<p class="cart__empty">Your cart is empty.</p>';

    if (total) total.textContent = money(state.subtotal_cents);

    /* nothing to check out with — don't offer the door */
    if (checkout) {
      checkout.classList.toggle('is-disabled', !state.items.length);
      checkout.setAttribute('aria-disabled', String(!state.items.length));
    }
  }

  /* One delegated listener covers the drawer and the cart page, so a
     repaint never leaves a dead button behind. */
  document.addEventListener('click', async (e) => {
    const row = e.target.closest('.cart-item');
    if (!row) return;

    const itemId = row.dataset.item;

    if (e.target.closest('[data-remove]')) {
      await remove(itemId);
      return;
    }

    const step = e.target.closest('[data-step]');
    if (!step) return;

    const line = state.items.find((i) => i.item_id === itemId);
    if (!line) return;

    const next = line.qty + Number(step.dataset.step);
    /* the API removes the line at 0, which is what we want here too */
    await setQty(itemId, Math.max(0, next));
  });

  /* A disabled anchor is still an anchor; stop the navigation. */
  document.addEventListener('click', (e) => {
    const a = e.target.closest('#cartCheckout');
    if (a && a.classList.contains('is-disabled')) {
      e.preventDefault();
      toast('Your cart is empty');
    }
  });

  /* Only load once the chrome exists, or there is nothing to paint into. */
  window.Chic.ready.then(refresh);

  return { refresh, add, setQty, remove, quickAdd, subscribe, get state() { return state; }, units };
})();
