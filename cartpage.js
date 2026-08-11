/* =========================================================
   Chic Colombo — full cart page.

   Renders the same .cart-item markup the drawer uses, so the delegated
   quantity and remove handlers in cart.js work here without knowing
   this page exists.
   ========================================================= */

(function () {
  'use strict';

  const { money, esc, tone, $ } = window.Chic;

  const host = $('#cartPage');

  /* Shipping is quoted from the same settings the checkout charges from,
     so the number here is not a guess that changes at the last step. */
  function shipping(subtotal) {
    const s = window.Chic.settings;
    if (!s) return null;
    const free = s.free_shipping_threshold_cents ?? 0;
    if (free && subtotal >= free) return 0;
    return s.flat_shipping_cents ?? 0;
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
          <p class="cart-item__meta">${money(line.unit_price_cents)} each</p>
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

  function render(state) {
    host.setAttribute('aria-busy', 'false');

    if (!state.items.length) {
      host.innerHTML = `
        <div class="cartpage__empty">
          <p class="listing__msg">Your cart is empty.</p>
          <a class="btn btn--primary" href="/shop">START SHOPPING</a>
        </div>`;
      return;
    }

    const ship = shipping(state.subtotal_cents);

    host.innerHTML = `
      <div class="cartpage__lines">
        ${state.items.map(lineHTML).join('')}
      </div>

      <aside class="cartpage__summary">
        <h2>Order summary</h2>
        <div class="cart__row"><span>Subtotal</span><strong>${money(state.subtotal_cents)}</strong></div>
        <div class="cart__row">
          <span>Delivery</span>
          <strong>${ship === null ? '—' : ship === 0 ? 'Free' : money(ship)}</strong>
        </div>
        <div class="cart__row cart__row--total">
          <span>Total</span>
          <strong>${money(state.subtotal_cents + (ship ?? 0))}</strong>
        </div>
        <a class="btn btn--primary btn--full" href="/checkout">CHECKOUT</a>
        <a class="cart__viewall" href="/shop">Continue shopping</a>
      </aside>`;
  }

  /* subscribe paints immediately and again after every change */
  window.Chic.ready.then(() => window.ChicCart.subscribe(render));
})();
