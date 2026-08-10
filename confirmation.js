/* =========================================================
   Chic Colombo — order confirmation (/order/<number>).

   Reached two ways: PayHere's return_url after a payment, and directly
   if the handoff to the gateway failed. Payment status is whatever the
   webhook recorded — the return URL itself proves nothing, since the
   shopper's browser is not a trustworthy source for "I paid".
   ========================================================= */

(function () {
  'use strict';

  const { esc, $, pathParam, query } = window.Chic;

  const view = $('#view');
  const number = pathParam(1);

  function shell(title, body, eyebrow = '') {
    view.innerHTML = `
      <header class="page__head">
        ${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}
        <h1 class="page__title">${esc(title)}</h1>
      </header>
      <div class="page__body">${body}</div>`;
  }

  (async function init() {
    view.setAttribute('aria-busy', 'false');

    if (!number) {
      shell('Order not found', '<p>No order number in the link.</p>');
      return;
    }

    /* The cart was consumed by checkout_cart; clear the local pointer so the
       shopper does not come back to a cart that no longer exists. */
    await window.Chic.ready;
    await window.ChicCart.refresh();

    const failed = query('payment') === 'failed';

    shell(
      failed ? 'Order placed — payment not completed' : 'Thank you — your order is placed',
      `
      <p>Your order number is <strong>#${esc(number)}</strong>. Keep it safe;
         you will need it to track your order.</p>

      ${failed ? `
        <p>We could not hand you over to the payment page. The order is saved
           and nothing has been charged. Contact us with your order number and
           we will send you a payment link.</p>` : `
        <p>A confirmation is on its way to the email address you gave us.
           Payment is confirmed by our payment provider, so the status below
           may take a moment to update.</p>`}

      <p>
        <a class="btn btn--primary" href="/track?order=${encodeURIComponent(number)}">TRACK THIS ORDER</a>
        <a class="btn btn--light" href="/shop">KEEP SHOPPING</a>
      </p>

      <p>Questions? <a href="/pages/contact">Contact us</a> — quote order
         #${esc(number)} and we will pick it up from there.</p>
      `,
      'Order #' + number
    );
  })();
})();
