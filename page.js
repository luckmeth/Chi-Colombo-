/* =========================================================
   Chic Colombo — content pages (/pages/<slug>).

   Terms, privacy, refunds, shipping, FAQ and so on. The copy lives in
   the content_pages table so it can be edited from the admin panel
   without a deploy.

   body_html is inserted as markup on purpose — that is the point of a
   rich text page. It is only ever written through the admin API, which
   sanitises it against an allow-list on save, so what reaches here has
   already been filtered.
   ========================================================= */

(function () {
  'use strict';

  const { $, esc, pathParam } = window.Chic;

  const slug = pathParam(1);
  const body = $('#pageBody');

  (async function init() {
    if (!slug) {
      body.setAttribute('aria-busy', 'false');
      body.innerHTML = '<p class="listing__msg">No page specified.</p>';
      return;
    }

    const page = await window.ChicAPI.page(slug);
    body.setAttribute('aria-busy', 'false');

    if (!page) {
      document.title = 'Not found | Chic Colombo';
      $('#pageTitle').textContent = 'Page not found';
      $('#crumbHere').textContent = 'Not found';
      body.innerHTML = `
        <p class="listing__msg">We couldn't find that page.</p>
        <p class="listing__msg"><a class="link-all" href="/">Back to the shop</a></p>`;
      return;
    }

    document.title = `${page.title} | Chic Colombo`;
    $('#pageTitle').textContent = page.title;
    $('#crumbHere').textContent = page.title;
    body.innerHTML = page.body_html;

    if (page.updated_at) {
      const when = new Date(page.updated_at).toLocaleDateString('en-GB',
        { day: 'numeric', month: 'long', year: 'numeric' });
      body.insertAdjacentHTML('beforeend',
        `<p class="page__updated">Last updated ${esc(when)}</p>`);
    }
  })();
})();
