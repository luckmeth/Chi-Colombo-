/* =========================================================
   Chic Colombo — order tracking.

   Guest checkout means there is no account to log into, so an order is
   looked up by its number plus the email it was placed with. The API
   answers identically for "no such order" and "wrong email", so this
   page cannot be used to find out which order numbers exist.
   ========================================================= */

(function () {
  'use strict';

  const { money, esc, $, query } = window.Chic;

  const view = $('#view');

  const STATUS_LABEL = {
    pending: 'Awaiting payment',
    paid: 'Paid',
    fulfilled: 'On its way',
    cancelled: 'Cancelled',
    refunded: 'Refunded'
  };

  /* the journey we show, in order; anything else appears as its own step */
  const TIMELINE = ['pending', 'paid', 'fulfilled'];

  const form = (values = {}, error = '') => `
    <header class="page__head">
      <h1 class="page__title">Track your order</h1>
      <p class="page__sub">Enter your order number and the email you ordered with.</p>
    </header>

    <form class="track__form" id="trackForm" novalidate>
      <div class="fields">
        <label class="field">
          <span>Order number</span>
          <input class="input" name="order_number" inputmode="numeric"
                 placeholder="1001" value="${esc(values.order_number ?? '')}" required>
        </label>
        <label class="field">
          <span>Email</span>
          <input class="input" name="email" type="email" autocomplete="email"
                 placeholder="you@example.com" value="${esc(values.email ?? '')}" required>
        </label>
      </div>
      ${error ? `<p class="checkout__msg" role="alert">${esc(error)}</p>` : ''}
      <button class="btn btn--primary" type="submit">FIND MY ORDER</button>
    </form>

    <p class="page__sub" style="margin-top:22px">
      Your order number is in your confirmation email. Can't find it?
      <a href="/pages/contact">Contact us</a>.
    </p>`;

  function timeline(order) {
    const events = order.events ?? [];
    const seen = new Set(events.map((e) => e.status));

    /* the canonical steps, plus anything real that happened outside them */
    const steps = TIMELINE
      .filter((s) => seen.has(s) || TIMELINE.indexOf(s) <= TIMELINE.indexOf(order.status))
      .map((status) => ({
        status,
        done: seen.has(status),
        event: events.find((e) => e.status === status)
      }));

    const extras = events.filter((e) => !TIMELINE.includes(e.status));

    const when = (iso) => iso
      ? new Date(iso).toLocaleString('en-GB',
        { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';

    return `
      <ol class="timeline">
        ${steps.map((s) => `
          <li class="timeline__step${s.done ? ' is-done' : ''}">
            <strong>${esc(STATUS_LABEL[s.status] ?? s.status)}</strong>
            ${s.event ? `<em>${esc(when(s.event.created_at))}</em>` : '<em>Not yet</em>'}
            ${s.event?.note ? `<span>${esc(s.event.note)}</span>` : ''}
          </li>`).join('')}
        ${extras.map((e) => `
          <li class="timeline__step is-done timeline__step--extra">
            <strong>${esc(STATUS_LABEL[e.status] ?? e.status)}</strong>
            <em>${esc(when(e.created_at))}</em>
            ${e.note ? `<span>${esc(e.note)}</span>` : ''}
          </li>`).join('')}
      </ol>`;
  }

  function result(order) {
    const placed = new Date(order.placed_at).toLocaleDateString('en-GB',
      { day: 'numeric', month: 'long', year: 'numeric' });

    return `
      <header class="page__head">
        <p class="eyebrow">Order #${order.order_number}</p>
        <h1 class="page__title">${esc(STATUS_LABEL[order.status] ?? order.status)}</h1>
        <p class="page__sub">Placed ${esc(placed)}${order.city ? ` · delivering to ${esc(order.city)}` : ''}</p>
      </header>

      ${order.tracking_number ? `
        <div class="track__courier">
          <strong>${esc(order.courier ?? 'Courier')}</strong>
          <span>Tracking number: ${esc(order.tracking_number)}</span>
          ${order.tracking_url
            ? `<a class="link-all" href="${esc(order.tracking_url)}" rel="noopener">Track with the courier</a>`
            : ''}
        </div>` : ''}

      ${timeline(order)}

      <h2 class="track__h2">Items</h2>
      <div class="track__items">
        ${(order.order_items ?? []).map((i) => `
          <div class="checkout__line">
            <span>${esc(i.title_snapshot)}<em>${esc(i.variant_snapshot ?? '')} × ${i.qty}</em></span>
            <strong>${money(i.line_total_cents)}</strong>
          </div>`).join('')}
      </div>

      <div class="cart__row"><span>Subtotal</span><strong>${money(order.subtotal_cents)}</strong></div>
      <div class="cart__row"><span>Delivery</span>
        <strong>${order.shipping_cents === 0 ? 'Free' : money(order.shipping_cents)}</strong></div>
      <div class="cart__row cart__row--total"><span>Total</span>
        <strong>${money(order.total_cents)}</strong></div>

      <p class="page__sub" style="margin-top:26px">
        <a class="link-all" href="/track">Look up another order</a>
      </p>`;
  }

  async function lookup(orderNumber, email) {
    const res = await fetch(window.CHIC_API_BASE + '/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_number: Number(orderNumber), email })
    }).catch(() => null);

    if (!res) return { error: 'We could not reach the shop. Please try again.' };
    if (res.status === 429) return { error: 'Too many attempts. Please wait a minute and try again.' };

    const body = await res.json().catch(() => null);
    if (!res.ok) return { error: body?.error ?? 'No order matches that number and email address.' };
    return { order: body };
  }

  view.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());

    if (!data.order_number || !data.email) {
      view.innerHTML = form(data, 'Both fields are needed.');
      return;
    }

    const btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'LOOKING…';

    const { order, error } = await lookup(data.order_number, data.email.trim());
    view.innerHTML = order ? result(order) : form(data, error);
  });

  /* ---------- boot ----------
     Deep links from the confirmation email arrive with both values. */

  (async function init() {
    view.setAttribute('aria-busy', 'false');

    const number = query('order');
    const email = query('email');

    if (number && email) {
      const { order, error } = await lookup(number, email);
      view.innerHTML = order ? result(order) : form({ order_number: number, email }, error);
      return;
    }

    view.innerHTML = form({ order_number: number ?? '' });
  })();
})();
