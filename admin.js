/* =========================================================
   Chic Colombo — admin panel
   Auth via Supabase; every write goes through /api/admin, which
   re-checks site_admins server-side. The client never holds the
   service-role key.
   ========================================================= */

(function () {
  'use strict';

  const API = window.CHIC_API_BASE ?? 'http://localhost:8787';

  /* Anon key only — safe in a browser, RLS still applies.
     Replace with your project's values. */
  const SUPABASE_URL = window.CHIC_SUPABASE_URL ?? 'https://YOUR-PROJECT-REF.supabase.co';
  const SUPABASE_ANON_KEY = window.CHIC_SUPABASE_ANON_KEY ?? 'YOUR-ANON-KEY';

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const money = (cents) =>
    'LKR ' + ((cents ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });

  /* ---------- toast ---------- */

  let toastTimer;
  function toast(message, bad = false) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.toggle('is-bad', bad);
    el.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-on'), 3200);
  }

  /* ---------- authed fetch ---------- */

  async function api(path, options = {}) {
    const { data: { session } } = await sb.auth.getSession();

    const res = await fetch(API + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        ...(options.headers ?? {})
      }
    }).catch(() => null);

    if (!res) { toast('API unreachable — is the server running?', true); return null; }
    if (res.status === 204) return { ok: true };

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      /* an expired session should bounce back to the gate, not fail silently */
      if (res.status === 401) { showGate('Session expired — sign in again.'); return null; }
      toast(body?.error ?? `Request failed (${res.status})`, true);
      return null;
    }
    return body;
  }

  /* ---------- gate ---------- */

  function showGate(message) {
    $('#shell').hidden = true;
    $('#gate').hidden = false;
    if (message) {
      const m = $('#gateMsg');
      m.textContent = message;
      m.classList.remove('is-ok');
    }
  }

  async function showPanel(email) {
    $('#gate').hidden = true;
    $('#shell').hidden = false;
    $('#whoami').textContent = email ?? '';
    await loadOverview();
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#gateMsg');
    const btn = $('#loginBtn');

    msg.textContent = 'Signing in…';
    msg.classList.add('is-ok');
    btn.disabled = true;

    const { error } = await sb.auth.signInWithPassword({
      email: $('#email').value.trim(),
      password: $('#password').value
    });

    btn.disabled = false;

    if (error) {
      msg.classList.remove('is-ok');
      msg.textContent = error.message;
      return;
    }

    const status = await api('/api/admin/status');
    if (!status?.isAdmin) {
      await sb.auth.signOut();
      msg.classList.remove('is-ok');
      msg.textContent = 'That account is not an admin. Add it to site_admins.';
      return;
    }

    msg.textContent = '';
    showPanel(status.email);
  });

  $('#signOut').addEventListener('click', async () => {
    await sb.auth.signOut();
    showGate('Signed out.');
  });

  /* ---------- navigation ---------- */

  const loaders = {
    overview: loadOverview,
    products: loadProducts,
    slides: loadSlides,
    orders: loadOrders,
    contact: loadContact,
    subscribers: loadSubscribers
  };

  $('#nav').addEventListener('click', (e) => {
    const btn = e.target.closest('.side__link');
    if (!btn) return;

    const view = btn.dataset.view;
    $$('.side__link').forEach((b) => b.classList.toggle('is-active', b === btn));
    $$('.view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === view));
    loaders[view]?.();
  });

  /* ---------- overview ---------- */

  async function loadOverview() {
    const data = await api('/api/admin/overview');
    if (!data) return;

    $('#stats').innerHTML = [
      ['Products', data.products],
      ['Orders', data.orders],
      ['Revenue', money(data.revenue_cents)],
      ['Subscribers', data.subscribers]
    ].map(([label, value]) =>
      `<div class="stat"><b>${esc(value)}</b><span>${esc(label)}</span></div>`).join('');

    const rows = data.low_stock ?? [];
    $('#lowStock').innerHTML = rows.length
      ? `<thead><tr><th>Product</th><th>Variant</th><th>SKU</th><th>Qty</th></tr></thead>
         <tbody>${rows.map((v) => `
           <tr>
             <td>${esc(v.products?.title ?? '—')}</td>
             <td>${esc(v.colour_name)} / ${esc(v.size)}</td>
             <td>${esc(v.sku ?? '—')}</td>
             <td><span class="chip ${v.inventory_qty === 0 ? 'chip--bad' : 'chip--warn'}">${v.inventory_qty}</span></td>
           </tr>`).join('')}</tbody>`
      : '<tbody><tr><td class="empty">Everything is well stocked.</td></tr></tbody>';
  }

  /* ---------- products & stock ---------- */

  async function loadProducts() {
    const list = await api('/api/admin/products');
    if (!list) return;

    const box = $('#productList');
    box.innerHTML = list.map((p) => {
      const variants = (p.product_variants ?? []).sort((a, b) => a.position - b.position);
      const total = variants.reduce((n, v) => n + v.inventory_qty, 0);

      return `
        <article class="row" data-id="${p.id}">
          <div class="row__head">
            <span class="row__title">${esc(p.title)}</span>
            <span class="chip ${p.status === 'active' ? 'chip--ok' : ''}">${esc(p.status)}</span>
            <span class="row__meta">${money(p.price_cents)}</span>
            <span class="row__spacer"></span>
            <span class="chip ${total === 0 ? 'chip--bad' : total < 10 ? 'chip--warn' : 'chip--ok'}">${total} in stock</span>
          </div>
          <div class="row__body">
            <div class="grid2" style="margin:16px 0">
              <label>Title <input class="input" data-f="title" value="${esc(p.title)}"></label>
              <label>Handle <input class="input" data-f="handle" value="${esc(p.handle)}"></label>
              <label>Price (LKR) <input class="input" type="number" step="0.01" min="0"
                     data-f="price" value="${(p.price_cents / 100).toFixed(2)}"></label>
              <label>Status
                <select class="input" data-f="status">
                  ${['active', 'draft', 'archived'].map((s) =>
                    `<option value="${s}" ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select></label>
              <label>Audience
                <select class="input" data-f="audience">
                  ${['unisex', 'mens', 'womens'].map((s) =>
                    `<option value="${s}" ${p.audience === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select></label>
              <label>Mark as new
                <select class="input" data-f="is_new">
                  <option value="false" ${!p.is_new ? 'selected' : ''}>No</option>
                  <option value="true" ${p.is_new ? 'selected' : ''}>Yes</option>
                </select></label>
            </div>

            <button class="btn btn--primary btn--slim" data-act="save">Save details</button>
            <button class="btn btn--slim btn--danger" data-act="archive">Archive</button>

            <h3>Stock by variant</h3>
            ${variants.map((v) => `
              <div class="stockline" data-vid="${v.id}">
                <span class="stockline__name">
                  <i class="swatch" style="background:${esc(v.colour_hex ?? '#ccc')}"></i>
                  ${esc(v.colour_name)} / ${esc(v.size)}
                </span>
                <span class="stockline__qty">${v.inventory_qty}</span>
                <button class="btn btn--slim" data-delta="-1">−1</button>
                <button class="btn btn--slim" data-delta="1">+1</button>
                <button class="btn btn--slim" data-delta="10">+10</button>
                <input class="input input--slim" type="number" placeholder="set qty" style="width:110px">
                <button class="btn btn--slim" data-act="set">Set</button>
              </div>`).join('') || '<p class="hint">No variants yet.</p>'}
          </div>
        </article>`;
    }).join('') || '<p class="hint">No products yet.</p>';
  }

  /* one delegated listener for the whole product list */
  $('#productList').addEventListener('click', async (e) => {
    const head = e.target.closest('.row__head');
    if (head) { head.parentElement.classList.toggle('is-open'); return; }

    const row = e.target.closest('.row');
    if (!row) return;
    const id = row.dataset.id;

    if (e.target.dataset.act === 'save') {
      const get = (f) => $(`[data-f="${f}"]`, row).value;
      const price = Math.round(parseFloat(get('price')) * 100);

      if (!Number.isFinite(price) || price < 0) return toast('Price must be a positive number', true);

      const saved = await api(`/api/admin/products/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: get('title'),
          handle: get('handle'),
          price_cents: price,
          status: get('status'),
          audience: get('audience'),
          is_new: get('is_new') === 'true'
        })
      });
      if (saved) { toast('Product saved'); loadProducts(); }
      return;
    }

    if (e.target.dataset.act === 'archive') {
      if (!confirm('Archive this product? It will disappear from the storefront.')) return;
      const done = await api(`/api/admin/products/${id}`, { method: 'DELETE' });
      if (done) { toast('Product archived'); loadProducts(); }
      return;
    }

    const line = e.target.closest('.stockline');
    if (!line) return;
    const vid = line.dataset.vid;

    if (e.target.dataset.delta) {
      const res = await api(`/api/admin/variants/${vid}/stock`, {
        method: 'POST',
        body: JSON.stringify({ delta: Number(e.target.dataset.delta), reason: 'manual' })
      });
      if (res) { line.querySelector('.stockline__qty').textContent = res.inventory_qty; toast('Stock updated'); }
      return;
    }

    if (e.target.dataset.act === 'set') {
      const field = line.querySelector('input');
      const target = parseInt(field.value, 10);
      if (!Number.isInteger(target) || target < 0) return toast('Enter a whole number', true);

      const current = Number(line.querySelector('.stockline__qty').textContent);
      if (target === current) return;

      const res = await api(`/api/admin/variants/${vid}/stock`, {
        method: 'POST',
        body: JSON.stringify({ delta: target - current, reason: 'recount' })
      });
      if (res) { line.querySelector('.stockline__qty').textContent = res.inventory_qty; field.value = ''; toast('Stock set'); }
    }
  });

  $('#newProduct').addEventListener('click', async () => {
    const title = prompt('Product name?');
    if (!title) return;

    const rupees = parseFloat(prompt('Price in LKR?', '4500') ?? '');
    if (!Number.isFinite(rupees) || rupees < 0) return toast('Invalid price', true);

    const created = await api('/api/admin/products', {
      method: 'POST',
      body: JSON.stringify({
        title,
        handle: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        price_cents: Math.round(rupees * 100),
        status: 'draft'
      })
    });
    if (created) { toast('Product created as draft'); loadProducts(); }
  });

  /* ---------- hero slides ---------- */

  async function loadSlides() {
    const list = await api('/api/admin/slides');
    if (!list) return;

    $('#slideList').innerHTML = list.map((s, i) => `
      <article class="row is-open" data-id="${s.id}">
        <div class="row__head">
          <span class="chip">${esc(s.kind)}</span>
          <span class="row__title">${esc(s.title || s.media_url)}</span>
          <span class="row__spacer"></span>
          <span class="chip ${s.is_active ? 'chip--ok' : 'chip--bad'}">${s.is_active ? 'live' : 'hidden'}</span>
        </div>
        <div class="row__body">
          <div class="grid2" style="margin:16px 0">
            <label>Type
              <select class="input" data-f="kind">
                <option value="image" ${s.kind === 'image' ? 'selected' : ''}>Image</option>
                <option value="video" ${s.kind === 'video' ? 'selected' : ''}>Video</option>
              </select></label>
            <label>Media URL <input class="input" data-f="media_url" value="${esc(s.media_url)}"></label>
            <label>Poster (video only) <input class="input" data-f="poster_url" value="${esc(s.poster_url ?? '')}"></label>
            <label>Focal point <input class="input" data-f="focal_point" value="${esc(s.focal_point ?? 'center center')}"></label>
            <label>Eyebrow <input class="input" data-f="eyebrow" value="${esc(s.eyebrow ?? '')}"></label>
            <label>Title <input class="input" data-f="title" value="${esc(s.title ?? '')}"></label>
            <label>Subtitle <input class="input" data-f="subtitle" value="${esc(s.subtitle ?? '')}"></label>
            <label>Button 1 label <input class="input" data-f="cta_label" value="${esc(s.cta_label ?? '')}"></label>
            <label>Button 1 link <input class="input" data-f="cta_href" value="${esc(s.cta_href ?? '')}"></label>
            <label>Button 2 label <input class="input" data-f="cta2_label" value="${esc(s.cta2_label ?? '')}"></label>
            <label>Button 2 link <input class="input" data-f="cta2_href" value="${esc(s.cta2_href ?? '')}"></label>
            <label>Visible
              <select class="input" data-f="is_active">
                <option value="true" ${s.is_active ? 'selected' : ''}>Live</option>
                <option value="false" ${!s.is_active ? 'selected' : ''}>Hidden</option>
              </select></label>
          </div>
          <button class="btn btn--primary btn--slim" data-act="save">Save slide</button>
          <button class="btn btn--slim" data-act="up" ${i === 0 ? 'disabled' : ''}>Move up</button>
          <button class="btn btn--slim" data-act="down" ${i === list.length - 1 ? 'disabled' : ''}>Move down</button>
          <button class="btn btn--slim btn--danger" data-act="delete">Delete</button>
        </div>
      </article>`).join('') || '<p class="hint">No slides yet — the storefront will use its built-in defaults.</p>';

    $('#slideList').dataset.order = list.map((s) => s.id).join(',');
  }

  $('#slideList').addEventListener('click', async (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const id = row.dataset.id;
    const act = e.target.dataset.act;

    if (act === 'save') {
      const get = (f) => $(`[data-f="${f}"]`, row).value.trim();
      const saved = await api(`/api/admin/slides/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          kind: get('kind'),
          media_url: get('media_url'),
          poster_url: get('poster_url') || null,
          focal_point: get('focal_point') || 'center center',
          eyebrow: get('eyebrow') || null,
          title: get('title') || null,
          subtitle: get('subtitle') || null,
          cta_label: get('cta_label') || null,
          cta_href: get('cta_href') || null,
          cta2_label: get('cta2_label') || null,
          cta2_href: get('cta2_href') || null,
          is_active: get('is_active') === 'true'
        })
      });
      if (saved) { toast('Slide saved'); loadSlides(); }
      return;
    }

    if (act === 'delete') {
      if (!confirm('Delete this slide?')) return;
      const done = await api(`/api/admin/slides/${id}`, { method: 'DELETE' });
      if (done) { toast('Slide deleted'); loadSlides(); }
      return;
    }

    if (act === 'up' || act === 'down') {
      const order = $('#slideList').dataset.order.split(',');
      const i = order.indexOf(id);
      const j = act === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= order.length) return;

      [order[i], order[j]] = [order[j], order[i]];

      const done = await api('/api/admin/slides/reorder', {
        method: 'POST',
        body: JSON.stringify({ order })
      });
      if (done) { toast('Order updated'); loadSlides(); }
    }
  });

  $('#newSlide').addEventListener('click', async () => {
    const kind = confirm('OK for an image slide, Cancel for a video slide') ? 'image' : 'video';
    const media = prompt(kind === 'image'
      ? 'Image path or URL (e.g. assets/hero-veranda.png)'
      : 'Video path or URL (e.g. assets/brand-film.mp4)');
    if (!media) return;

    const created = await api('/api/admin/slides', {
      method: 'POST',
      body: JSON.stringify({
        kind,
        media_url: media.trim(),
        title: 'New slide',
        is_active: false,
        sort_order: 99
      })
    });
    if (created) { toast('Slide added (hidden — edit then set it live)'); loadSlides(); }
  });

  /* ---------- orders ---------- */

  async function loadOrders() {
    const status = $('#orderFilter').value;
    const list = await api('/api/admin/orders' + (status ? `?status=${status}` : ''));
    if (!list) return;

    const STATUSES = ['pending', 'paid', 'fulfilled', 'cancelled', 'refunded'];

    $('#orderTable').innerHTML = list.length
      ? `<thead><tr><th>#</th><th>Placed</th><th>Email</th><th>Items</th><th>Total</th><th>Status</th></tr></thead>
         <tbody>${list.map((o) => `
           <tr data-id="${o.id}">
             <td>${o.order_number}</td>
             <td>${new Date(o.placed_at).toLocaleDateString()}</td>
             <td>${esc(o.email)}</td>
             <td>${(o.order_items ?? []).length}</td>
             <td>${money(o.total_cents)}</td>
             <td>
               <select class="input input--slim" data-act="status">
                 ${STATUSES.map((s) => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}
               </select>
             </td>
           </tr>`).join('')}</tbody>`
      : '<tbody><tr><td class="empty">No orders yet.</td></tr></tbody>';
  }

  $('#orderFilter').addEventListener('change', loadOrders);

  $('#orderTable').addEventListener('change', async (e) => {
    if (e.target.dataset.act !== 'status') return;
    const id = e.target.closest('tr').dataset.id;

    const done = await api(`/api/admin/orders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: e.target.value })
    });
    if (done) toast('Order updated');
  });

  /* ---------- contact & social ---------- */

  async function loadContact() {
    const res = await fetch(API + '/api/settings').catch(() => null);
    const s = res && res.ok ? await res.json() : null;
    if (!s) return toast('Could not load settings', true);

    const form = $('#settingsForm');
    ['brand_name', 'tagline', 'contact_email', 'support_email', 'contact_phone',
     'whatsapp_number', 'hotline', 'google_maps_url', 'address_line1',
     'address_line2', 'city', 'footer_note'].forEach((k) => {
      if (form[k]) form[k].value = s[k] ?? '';
    });

    form.free_shipping_threshold.value = ((s.free_shipping_threshold_cents ?? 0) / 100).toFixed(2);
    form.flat_shipping.value = ((s.flat_shipping_cents ?? 0) / 100).toFixed(2);
    form.announcements.value = (s.announcements ?? []).join('\n');

    const links = await api('/api/admin/socials');
    if (!links) return;

    $('#socialList').innerHTML = links.map((l) => `
      <div class="stockline" data-id="${l.id}">
        <input class="input input--slim" data-f="platform" value="${esc(l.platform)}" style="width:130px">
        <input class="input input--slim" data-f="url" value="${esc(l.url)}" style="flex:1;min-width:220px">
        <select class="input input--slim" data-f="is_active">
          <option value="true" ${l.is_active ? 'selected' : ''}>Live</option>
          <option value="false" ${!l.is_active ? 'selected' : ''}>Hidden</option>
        </select>
        <button class="btn btn--slim btn--primary" data-act="save">Save</button>
        <button class="btn btn--slim btn--danger" data-act="delete">Delete</button>
      </div>`).join('') || '<p class="hint">No links yet.</p>';
  }

  $('#settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;

    const toCents = (v) => {
      const n = parseFloat(v);
      return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
    };

    const saved = await api('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        brand_name: f.brand_name.value.trim(),
        tagline: f.tagline.value.trim(),
        contact_email: f.contact_email.value.trim() || null,
        support_email: f.support_email.value.trim() || null,
        contact_phone: f.contact_phone.value.trim() || null,
        whatsapp_number: f.whatsapp_number.value.trim() || null,
        hotline: f.hotline.value.trim() || null,
        google_maps_url: f.google_maps_url.value.trim() || null,
        address_line1: f.address_line1.value.trim() || null,
        address_line2: f.address_line2.value.trim() || null,
        city: f.city.value.trim() || null,
        footer_note: f.footer_note.value.trim() || null,
        free_shipping_threshold_cents: toCents(f.free_shipping_threshold.value),
        flat_shipping_cents: toCents(f.flat_shipping.value),
        announcements: f.announcements.value.split('\n').map((s) => s.trim()).filter(Boolean)
      })
    });
    if (saved) toast('Settings saved');
  });

  $('#socialList').addEventListener('click', async (e) => {
    const row = e.target.closest('.stockline');
    if (!row) return;
    const id = row.dataset.id;

    if (e.target.dataset.act === 'save') {
      const get = (f) => $(`[data-f="${f}"]`, row).value.trim();
      const saved = await api(`/api/admin/socials/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          platform: get('platform'),
          url: get('url'),
          is_active: get('is_active') === 'true'
        })
      });
      if (saved) toast('Link saved');
      return;
    }

    if (e.target.dataset.act === 'delete') {
      if (!confirm('Delete this link?')) return;
      const done = await api(`/api/admin/socials/${id}`, { method: 'DELETE' });
      if (done) { toast('Link deleted'); loadContact(); }
    }
  });

  $('#newSocial').addEventListener('click', async () => {
    const platform = prompt('Platform name? (e.g. Instagram)');
    if (!platform) return;
    const url = prompt('Full URL, including https://');
    if (!url) return;

    const created = await api('/api/admin/socials', {
      method: 'POST',
      body: JSON.stringify({ platform, url, icon_name: platform.toLowerCase() })
    });
    if (created) { toast('Link added'); loadContact(); }
  });

  /* ---------- subscribers ---------- */

  let subscribers = [];

  async function loadSubscribers() {
    const list = await api('/api/admin/subscribers');
    if (!list) return;
    subscribers = list;

    $('#subTable').innerHTML = list.length
      ? `<thead><tr><th>Email</th><th>Source</th><th>Subscribed</th></tr></thead>
         <tbody>${list.map((s) => `
           <tr>
             <td>${esc(s.email)}</td>
             <td>${esc(s.source ?? '—')}</td>
             <td>${new Date(s.subscribed_at).toLocaleDateString()}</td>
           </tr>`).join('')}</tbody>`
      : '<tbody><tr><td class="empty">No subscribers yet.</td></tr></tbody>';
  }

  $('#exportSubs').addEventListener('click', () => {
    if (!subscribers.length) return toast('Nothing to export', true);

    /* quote every field so commas in the data can't shift columns */
    const csv = ['email,source,subscribed_at']
      .concat(subscribers.map((s) =>
        [s.email, s.source ?? '', s.subscribed_at]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')))
      .join('\n');

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  /* ---------- boot ---------- */

  (async function boot() {
    if (SUPABASE_URL.includes('YOUR-PROJECT-REF')) {
      showGate('Set your Supabase URL and anon key in admin.js first.');
      return;
    }

    const { data: { session } } = await sb.auth.getSession();
    if (!session) return showGate();

    const status = await api('/api/admin/status');
    if (status?.isAdmin) showPanel(status.email);
    else showGate('That account is not an admin.');
  })();

})();
