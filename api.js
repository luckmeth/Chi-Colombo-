/* =========================================================
   Chic Colombo — storefront API client
   Talks to server/index.js. Every call degrades to null on
   failure so the page can fall back to its built-in catalogue
   and keep working with the backend switched off.
   ========================================================= */

window.ChicAPI = (function () {
  'use strict';

  const BASE = window.CHIC_API_BASE;   /* resolved in config.js */
  const TOKEN_KEY = 'chic_cart_token';
  const CART_KEY = 'chic_cart_id';

  const cartToken = () => localStorage.getItem(TOKEN_KEY);
  const cartId = () => localStorage.getItem(CART_KEY);

  async function call(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers ?? {}) };
    const token = cartToken();
    if (token) headers['x-cart-token'] = token;

    /* don't let a downed API hang the UI */
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 6000);

    try {
      const res = await fetch(BASE + path, { ...options, headers, signal: abort.signal });
      if (res.status === 204) return { ok: true };

      const body = await res.json().catch(() => null);
      if (!res.ok) {
        return { ok: false, status: res.status, error: body?.error ?? 'Request failed' };
      }
      return { ok: true, data: body };
    } catch {
      return { ok: false, status: 0, error: 'offline' };
    } finally {
      clearTimeout(timer);
    }
  }

  /** True when the API answers — callers use this to decide on fallbacks. */
  async function health() {
    const res = await call('/api/health');
    return res.ok && res.data?.ok === true;
  }

  async function products({ collection, audience, limit, q } = {}) {
    const qs = new URLSearchParams();
    if (collection) qs.set('collection', collection);
    if (audience) qs.set('audience', audience);
    if (limit) qs.set('limit', limit);
    if (q) qs.set('q', q);

    const res = await call('/api/products' + (qs.toString() ? `?${qs}` : ''));
    return res.ok ? res.data : null;
  }

  async function product(handle) {
    const res = await call('/api/products/' + encodeURIComponent(handle));
    return res.ok ? res.data : null;
  }

  async function collections(kind) {
    const res = await call('/api/collections' + (kind ? `?kind=${kind}` : ''));
    return res.ok ? res.data : null;
  }

  /** Hero slides, ordered, active only. */
  async function slides() {
    const res = await call('/api/slides');
    return res.ok ? res.data : null;
  }

  /** Contact details, socials, marquee copy — all admin-editable. */
  async function settings() {
    const res = await call('/api/settings');
    return res.ok ? res.data : null;
  }

  /** A content page (terms, privacy, FAQ …) by slug. */
  async function page(slug) {
    const res = await call('/api/pages/' + encodeURIComponent(slug));
    return res.ok ? res.data : null;
  }

  /** Creates the cart on first use and remembers it locally. */
  async function ensureCart() {
    const existing = cartId();
    if (existing) return existing;

    const res = await call('/api/cart', { method: 'POST' });
    if (!res.ok) return null;

    localStorage.setItem(CART_KEY, res.data.cart_id);
    if (res.data.cart_token) localStorage.setItem(TOKEN_KEY, res.data.cart_token);
    return res.data.cart_id;
  }

  async function addItem(variantId, qty = 1) {
    const id = await ensureCart();
    if (!id) return { ok: false, error: 'offline' };

    return call(`/api/cart/${id}/items`, {
      method: 'POST',
      body: JSON.stringify({ variant_id: variantId, qty })
    });
  }

  async function setQty(itemId, qty) {
    const id = cartId();
    if (!id) return { ok: false, error: 'no cart' };

    return call(`/api/cart/${id}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ qty })
    });
  }

  async function removeItem(itemId) {
    const id = cartId();
    if (!id) return { ok: false, error: 'no cart' };
    return call(`/api/cart/${id}/items/${itemId}`, { method: 'DELETE' });
  }

  async function getCart() {
    const id = cartId();
    if (!id) return null;

    const res = await call(`/api/cart/${id}`);
    if (!res.ok) {
      /* a stale or checked-out cart should not wedge the session */
      if (res.status === 403 || res.status === 404) {
        localStorage.removeItem(CART_KEY);
        localStorage.removeItem(TOKEN_KEY);
      }
      return null;
    }
    return res.data;
  }

  async function checkout({ email, address, shippingCents = 0 }) {
    const id = cartId();
    if (!id) return { ok: false, error: 'no cart' };

    const res = await call('/api/checkout', {
      method: 'POST',
      body: JSON.stringify({
        cart_id: id,
        email,
        address,
        shipping_cents: shippingCents
      })
    });

    /* the cart is consumed on success — start a fresh one next time */
    if (res.ok) {
      localStorage.removeItem(CART_KEY);
      localStorage.removeItem(TOKEN_KEY);
    }
    return res;
  }

  async function subscribe(email) {
    return call('/api/newsletter', {
      method: 'POST',
      body: JSON.stringify({ email, source: 'footer' })
    });
  }

  return {
    health, products, product, collections, slides, settings, page,
    ensureCart, addItem, setQty, removeItem, getCart, checkout, subscribe
  };
})();
