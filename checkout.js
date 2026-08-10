/* =========================================================
   Chic Colombo — checkout.

   Collects the delivery address, creates the order, then hands off to
   the payment provider. The order exists as 'pending' before payment
   starts, so an abandoned payment leaves a record we can cancel and
   restock rather than a silent gap.

   Shipping shown here is a quote from the API. The API charges its own
   figure at checkout regardless — the number on this page can be
   edited by anyone with dev tools, so it is never the one that counts.
   ========================================================= */

(function () {
  'use strict';

  const { money, esc, $, $$, toast, query } = window.Chic;

  const host = $('#checkout');
  let shippingCents = 0;
  let submitting = false;

  const FIELDS = [
    ['email',      'Email',            'email',  true,  'you@example.com', 'email'],
    ['full_name',  'Full name',        'text',   true,  'Nimal Perera',    'name'],
    ['phone',      'Phone',            'tel',    true,  '07X XXX XXXX',    'tel'],
    ['line1',      'Address',          'text',   true,  'House / street',  'address-line1'],
    ['line2',      'Apartment, floor (optional)', 'text', false, '',       'address-line2'],
    ['city',       'City',             'text',   true,  'Colombo',         'address-level2'],
    ['district',   'District',         'text',   false, 'Western',         'address-level1'],
    ['postal_code', 'Postal code',     'text',   false, '00100',           'postal-code']
  ];

  const field = ([name, label, type, required, placeholder, autocomplete]) => `
    <label class="field${name === 'line1' || name === 'line2' ? ' field--wide' : ''}">
      <span>${esc(label)}${required ? ' <b aria-hidden="true">*</b>' : ''}</span>
      <input class="input" name="${name}" type="${type}" autocomplete="${autocomplete}"
             placeholder="${esc(placeholder)}" ${required ? 'required' : ''}>
    </label>`;

  function summary(state) {
    return `
      <aside class="checkout__summary">
        <h2>Your order</h2>

        <div class="checkout__lines">
          ${state.items.map((i) => `
            <div class="checkout__line">
              <span>${esc(i.title)}<em>${esc(i.colour)} · ${esc(i.size)} × ${i.qty}</em></span>
              <strong>${money(i.line_total_cents)}</strong>
            </div>`).join('')}
        </div>

        <div class="cart__row"><span>Subtotal</span><strong>${money(state.subtotal_cents)}</strong></div>
        <div class="cart__row">
          <span>Delivery</span>
          <strong>${shippingCents === 0 ? 'Free' : money(shippingCents)}</strong>
        </div>
        <div class="cart__row cart__row--total">
          <span>Total</span>
          <strong>${money(state.subtotal_cents + shippingCents)}</strong>
        </div>

        <a class="cart__viewall" href="/cart">Edit cart</a>
      </aside>`;
  }

  function render(state) {
    host.setAttribute('aria-busy', 'false');

    if (!state.items.length) {
      host.innerHTML = `
        <div class="cartpage__empty">
          <p class="listing__msg">Your cart is empty, so there is nothing to check out.</p>
          <a class="btn btn--primary" href="/shop">START SHOPPING</a>
        </div>`;
      return;
    }

    host.innerHTML = `
      <form class="checkout__form" id="checkoutForm" novalidate>
        <h2>Delivery details</h2>
        <div class="fields">${FIELDS.map(field).join('')}</div>

        <label class="field field--wide">
          <span>Order notes (optional)</span>
          <textarea class="input" name="note" rows="3"
                    placeholder="Landmark, delivery instructions…"></textarea>
        </label>

        <h2>Payment</h2>
        <div class="paymethods" id="payMethods">
          <p class="listing__msg">Checking available payment methods…</p>
        </div>

        <p class="checkout__msg" id="checkoutMsg" role="alert"></p>

        <button class="btn btn--primary btn--full" type="submit" id="placeOrder">
          PLACE ORDER
        </button>

        <p class="checkout__fine">
          By placing this order you agree to our
          <a href="/pages/terms">Terms</a> and
          <a href="/pages/refund-policy">Returns policy</a>.
        </p>
      </form>

      ${summary(state)}`;

    paintMethods();
  }

  /* ---------- payment methods ----------
     Which providers are live is the server's answer, not the page's. An
     unconfigured provider is shown but not selectable, so it is obvious
     what is missing rather than silently absent. */

  let methods = null;

  async function loadMethods() {
    const res = await fetch(window.CHIC_API_BASE + '/api/payments/methods').catch(() => null);
    methods = res && res.ok ? await res.json().catch(() => null) : null;
  }

  function paintMethods() {
    const box = $('#payMethods');
    if (!box) return;

    if (!methods || !methods.length) {
      box.innerHTML = `
        <p class="checkout__warn">
          No payment method is configured yet. Add your PayHere keys in the
          admin panel under <strong>Payments</strong> and this page will work.
        </p>`;
      return;
    }

    box.innerHTML = methods.map((m, i) => `
      <label class="paymethod${m.enabled ? '' : ' is-off'}">
        <input type="radio" name="provider" value="${esc(m.id)}"
               ${m.enabled && !methods.slice(0, i).some((p) => p.enabled) ? 'checked' : ''}
               ${m.enabled ? '' : 'disabled'}>
        <span>
          <strong>${esc(m.label)}</strong>
          <em>${esc(m.note)}</em>
        </span>
      </label>`).join('');
  }

  /* ---------- submit ---------- */

  async function submit(e) {
    e.preventDefault();
    if (submitting) return;

    const form = e.target;
    const msg = $('#checkoutMsg');
    const data = Object.fromEntries(new FormData(form).entries());

    const missing = FIELDS.filter(([name, , , required]) => required && !String(data[name] ?? '').trim());
    if (missing.length) {
      msg.textContent = `Please fill in: ${missing.map(([, label]) => label).join(', ')}.`;
      form.querySelector(`[name="${missing[0][0]}"]`)?.focus();
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) {
      msg.textContent = 'That email address does not look right.';
      form.querySelector('[name="email"]').focus();
      return;
    }

    const provider = data.provider;
    if (!provider) {
      msg.textContent = 'Choose a payment method.';
      return;
    }

    submitting = true;
    msg.textContent = '';
    const btn = $('#placeOrder');
    btn.disabled = true;
    btn.textContent = 'PLACING ORDER…';

    const res = await window.ChicAPI.checkout({
      email: data.email.trim(),
      address: {
        full_name: data.full_name.trim(),
        phone: data.phone.trim(),
        line1: data.line1.trim(),
        line2: data.line2?.trim() || null,
        city: data.city.trim(),
        district: data.district?.trim() || null,
        postal_code: data.postal_code?.trim() || null,
        country: 'LK',
        note: data.note?.trim() || null
      }
    });

    if (!res.ok) {
      submitting = false;
      btn.disabled = false;
      btn.textContent = 'PLACE ORDER';
      msg.textContent = res.error ?? 'We could not place that order.';
      /* a stock failure means the cart is stale — show the real numbers */
      if (res.status === 409) window.ChicCart.refresh();
      return;
    }

    /* The order exists and stock is held. Hand off to the gateway. */
    btn.textContent = 'REDIRECTING TO PAYMENT…';
    await startPayment(provider, res.data.order_id, res.data.order_number);
  }

  /** Builds the provider's form server-side and posts the browser to it. */
  async function startPayment(provider, orderId, orderNumber) {
    const msg = $('#checkoutMsg');

    const res = await fetch(window.CHIC_API_BASE + `/api/payments/${provider}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId })
    }).catch(() => null);

    const body = res ? await res.json().catch(() => null) : null;

    if (!res || !res.ok || !body?.action) {
      /* The order is placed; only the handoff failed. Send them to the
         confirmation page, which shows how to pay or contact us — do not
         strand them on a dead checkout. */
      location.href = `/order/${orderNumber}?payment=failed`;
      return;
    }

    /* auto-submitted form, because PayHere expects a POST with signed fields */
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = body.action;
    form.style.display = 'none';

    Object.entries(body.fields).forEach(([name, value]) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value ?? '';
      form.appendChild(input);
    });

    document.body.appendChild(form);
    form.submit();
  }

  host.addEventListener('submit', submit);

  /* ---------- boot ---------- */

  (async function init() {
    await window.Chic.ready;

    if (query('cancelled')) {
      toast('Payment cancelled — your cart is still here');
    }

    const state = await window.ChicCart.refresh();

    /* ask the API what delivery costs rather than duplicating the rule */
    const quote = await fetch(
      window.CHIC_API_BASE + `/api/shipping-quote?subtotal_cents=${state.subtotal_cents}`
    ).then((r) => (r.ok ? r.json() : null)).catch(() => null);

    shippingCents = quote?.shipping_cents ?? 0;

    await loadMethods();
    render(state);
  })();
})();
