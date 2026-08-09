import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';

import { admin, currentUser } from './db.js';
import { adminRouter } from './admin.js';

const app = express();
const PORT = process.env.PORT ?? 8787;

app.use(express.json({ limit: '64kb' }));
app.use(cors({
  origin: (process.env.CORS_ORIGIN ?? 'http://localhost:4321').split(','),
  credentials: true
}));

/* write endpoints get a tighter budget than reads */
const writeLimiter = rateLimit({ windowMs: 60_000, max: 30 });

/* ---------------------------------------------------------
   helpers
   --------------------------------------------------------- */

/** Wraps an async route so a rejection becomes a 500 instead of a hang. */
const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const fail = (res, status, message, detail) =>
  res.status(status).json({ error: message, ...(detail ? { detail } : {}) });

const isUuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

const isEmail = (v) =>
  typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

/* ---------------------------------------------------------
   Catalogue (public reads)
   --------------------------------------------------------- */

app.get('/api/products', route(async (req, res) => {
  const { collection, audience } = req.query;
  const limit = Math.min(Number(req.query.limit) || 24, 100);

  if (collection) {
    /* membership lives on the join table, so resolve the handle first */
    const { data: col, error: colErr } = await admin
      .from('collections')
      .select('id')
      .eq('handle', collection)
      .maybeSingle();

    if (colErr) return fail(res, 500, 'Could not load collection', colErr.message);
    if (!col) return fail(res, 404, 'Collection not found');

    const { data: members, error } = await admin
      .from('collection_products')
      .select('product_id, position')
      .eq('collection_id', col.id)
      .order('position')
      .limit(limit);

    if (error) return fail(res, 500, 'Could not load products', error.message);
    if (!members.length) return res.json([]);

    /* Read through product_cards, not products. It is the storefront shape —
       it carries primary_image / hover_image and already filters to active
       rows. Returning raw product rows here meant every card rendered by
       collection was missing its photography. */
    const rank = new Map(members.map((m, i) => [m.product_id, i]));

    const { data: cards, error: cardErr } = await admin
      .from('product_cards').select('*').in('id', [...rank.keys()]);

    if (cardErr) return fail(res, 500, 'Could not load products', cardErr.message);

    /* the collection's own ordering, not the catalogue-wide one */
    return res.json(cards.sort((a, b) => rank.get(a.id) - rank.get(b.id)));
  }

  let query = admin.from('product_cards').select('*').order('position').limit(limit);
  if (audience) query = query.in('audience', [audience, 'unisex']);

  const { data, error } = await query;
  if (error) return fail(res, 500, 'Could not load products', error.message);
  res.json(data);
}));

app.get('/api/products/:handle', route(async (req, res) => {
  const { data, error } = await admin
    .from('products')
    .select('*, product_variants(*), product_images(*)')
    .eq('handle', req.params.handle)
    .eq('status', 'active')
    .maybeSingle();

  if (error) return fail(res, 500, 'Could not load product', error.message);
  if (!data) return fail(res, 404, 'Product not found');
  res.json(data);
}));

app.get('/api/collections', route(async (req, res) => {
  let query = admin.from('collections').select('*').eq('is_active', true).order('position');
  if (req.query.kind) query = query.eq('kind', req.query.kind);

  const { data, error } = await query;
  if (error) return fail(res, 500, 'Could not load collections', error.message);
  res.json(data);
}));

/* ---------------------------------------------------------
   Site content — hero slides, settings, socials.
   Public reads; every write lives behind /api/admin.
   --------------------------------------------------------- */

app.get('/api/slides', route(async (_req, res) => {
  const { data, error } = await admin
    .from('hero_slides').select('*').eq('is_active', true).order('sort_order');

  if (error) return fail(res, 500, 'Could not load slides', error.message);
  res.json(data);
}));

app.get('/api/settings', route(async (_req, res) => {
  const [settings, socials] = await Promise.all([
    admin.from('app_settings').select('*').eq('id', 'global').maybeSingle(),
    admin.from('social_links').select('platform, url, icon_name')
      .eq('is_active', true).order('sort_order')
  ]);

  if (settings.error) return fail(res, 500, 'Could not load settings', settings.error.message);
  res.json({ ...(settings.data ?? {}), socials: socials.data ?? [] });
}));

/* ---------------------------------------------------------
   Admin (gated inside the router)
   --------------------------------------------------------- */

app.use('/api/admin', adminRouter);

/* ---------------------------------------------------------
   Cart
   Guests are identified by an opaque session token we mint here.
   --------------------------------------------------------- */

app.post('/api/cart', writeLimiter, route(async (req, res) => {
  const user = await currentUser(req);
  const token = req.get('x-cart-token');

  /* reuse an existing open cart when we can */
  if (token) {
    const { data: existing } = await admin
      .from('carts')
      .select('id, session_token')
      .eq('session_token', token)
      .eq('status', 'open')
      .maybeSingle();

    if (existing) return res.json({ cart_id: existing.id, cart_token: existing.session_token });
  }

  if (user) {
    const { data: mine } = await admin
      .from('carts')
      .select('id, session_token')
      .eq('customer_id', user.id)
      .eq('status', 'open')
      .maybeSingle();

    if (mine) return res.json({ cart_id: mine.id, cart_token: mine.session_token });
  }

  const sessionToken = randomUUID();
  const { data, error } = await admin
    .from('carts')
    .insert({ customer_id: user?.id ?? null, session_token: sessionToken })
    .select('id, session_token')
    .single();

  if (error) return fail(res, 500, 'Could not create cart', error.message);
  res.status(201).json({ cart_id: data.id, cart_token: data.session_token });
}));

/** Confirms the caller actually owns this cart before any mutation. */
async function ownsCart(req, cartId) {
  if (!isUuid(cartId)) return false;

  const { data: cart } = await admin
    .from('carts')
    .select('id, customer_id, session_token, status')
    .eq('id', cartId)
    .maybeSingle();

  if (!cart || cart.status !== 'open') return false;

  const token = req.get('x-cart-token');
  if (token && cart.session_token === token) return true;

  const user = await currentUser(req);
  return Boolean(user && cart.customer_id === user.id);
}

app.get('/api/cart/:cartId', route(async (req, res) => {
  const { cartId } = req.params;
  if (!(await ownsCart(req, cartId))) return fail(res, 403, 'Not your cart');

  const { data, error } = await admin
    .from('cart_items')
    .select(`
      id, qty,
      product_variants (
        id, colour_name, size, price_cents, inventory_qty,
        products ( id, handle, title, price_cents, currency )
      )
    `)
    .eq('cart_id', cartId);

  if (error) return fail(res, 500, 'Could not load cart', error.message);

  const items = data.map((row) => {
    const variant = row.product_variants;
    const product = variant.products;
    const unit = variant.price_cents ?? product.price_cents;
    return {
      item_id: row.id,
      variant_id: variant.id,
      handle: product.handle,
      title: product.title,
      colour: variant.colour_name,
      size: variant.size,
      qty: row.qty,
      unit_price_cents: unit,
      line_total_cents: unit * row.qty
    };
  });

  res.json({
    cart_id: cartId,
    items,
    subtotal_cents: items.reduce((sum, i) => sum + i.line_total_cents, 0),
    currency: 'LKR'
  });
}));

app.post('/api/cart/:cartId/items', writeLimiter, route(async (req, res) => {
  const { cartId } = req.params;
  const { variant_id: variantId, qty = 1 } = req.body ?? {};

  if (!(await ownsCart(req, cartId))) return fail(res, 403, 'Not your cart');
  if (!isUuid(variantId)) return fail(res, 400, 'variant_id must be a uuid');

  const quantity = Number(qty);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    return fail(res, 400, 'qty must be a whole number between 1 and 99');
  }

  const { data: variant } = await admin
    .from('product_variants')
    .select('id, inventory_qty, is_active')
    .eq('id', variantId)
    .maybeSingle();

  if (!variant || !variant.is_active) return fail(res, 404, 'Variant not available');

  /* adding to an existing line must not exceed stock either */
  const { data: existing } = await admin
    .from('cart_items')
    .select('id, qty')
    .eq('cart_id', cartId)
    .eq('variant_id', variantId)
    .maybeSingle();

  const desired = (existing?.qty ?? 0) + quantity;
  if (desired > variant.inventory_qty) {
    return fail(res, 409, `Only ${variant.inventory_qty} left in stock`);
  }

  const { data, error } = await admin
    .from('cart_items')
    .upsert({ cart_id: cartId, variant_id: variantId, qty: desired },
            { onConflict: 'cart_id,variant_id' })
    .select('id, qty')
    .single();

  if (error) return fail(res, 500, 'Could not add to cart', error.message);
  res.status(201).json(data);
}));

app.patch('/api/cart/:cartId/items/:itemId', writeLimiter, route(async (req, res) => {
  const { cartId, itemId } = req.params;
  if (!(await ownsCart(req, cartId))) return fail(res, 403, 'Not your cart');

  const quantity = Number(req.body?.qty);
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99) {
    return fail(res, 400, 'qty must be a whole number between 0 and 99');
  }

  if (quantity === 0) {
    const { error } = await admin.from('cart_items')
      .delete().eq('id', itemId).eq('cart_id', cartId);
    if (error) return fail(res, 500, 'Could not remove item', error.message);
    return res.status(204).end();
  }

  const { data: item } = await admin
    .from('cart_items')
    .select('variant_id, product_variants ( inventory_qty )')
    .eq('id', itemId)
    .eq('cart_id', cartId)
    .maybeSingle();

  if (!item) return fail(res, 404, 'Item not in cart');
  if (quantity > item.product_variants.inventory_qty) {
    return fail(res, 409, `Only ${item.product_variants.inventory_qty} left in stock`);
  }

  const { data, error } = await admin
    .from('cart_items')
    .update({ qty: quantity })
    .eq('id', itemId).eq('cart_id', cartId)
    .select('id, qty')
    .single();

  if (error) return fail(res, 500, 'Could not update item', error.message);
  res.json(data);
}));

app.delete('/api/cart/:cartId/items/:itemId', writeLimiter, route(async (req, res) => {
  const { cartId, itemId } = req.params;
  if (!(await ownsCart(req, cartId))) return fail(res, 403, 'Not your cart');

  const { error } = await admin.from('cart_items')
    .delete().eq('id', itemId).eq('cart_id', cartId);

  if (error) return fail(res, 500, 'Could not remove item', error.message);
  res.status(204).end();
}));

/* ---------------------------------------------------------
   Checkout
   Stock check, order write and inventory decrement all happen
   inside checkout_cart() so they cannot half-apply.
   --------------------------------------------------------- */

app.post('/api/checkout', writeLimiter, route(async (req, res) => {
  const { cart_id: cartId, email, address, shipping_cents: shipping = 0 } = req.body ?? {};

  if (!(await ownsCart(req, cartId))) return fail(res, 403, 'Not your cart');
  if (!isEmail(email)) return fail(res, 400, 'A valid email is required');
  if (!Number.isInteger(shipping) || shipping < 0) {
    return fail(res, 400, 'shipping_cents must be a non-negative whole number');
  }

  const { data, error } = await admin.rpc('checkout_cart', {
    p_cart_id: cartId,
    p_email: email,
    p_address: address ?? null,
    p_shipping: shipping
  });

  if (error) {
    /* surface the schema's own guard rails as usable statuses */
    if (error.code === 'P0003') return fail(res, 409, error.message);   // out of stock
    if (error.code === 'P0001') return fail(res, 400, 'Your cart is empty');
    if (error.code === 'P0002') return fail(res, 404, 'Cart not found or already checked out');
    return fail(res, 500, 'Checkout failed', error.message);
  }

  const order = Array.isArray(data) ? data[0] : data;
  res.status(201).json({
    order_id: order.id,
    order_number: order.order_number,
    total_cents: order.total_cents,
    currency: order.currency,
    status: order.status
  });
}));

/* ---------------------------------------------------------
   Orders (signed-in customers)
   --------------------------------------------------------- */

app.get('/api/orders', route(async (req, res) => {
  const user = await currentUser(req);
  if (!user) return fail(res, 401, 'Sign in to view orders');

  const { data, error } = await admin
    .from('orders')
    .select('*, order_items(*)')
    .eq('customer_id', user.id)
    .order('placed_at', { ascending: false });

  if (error) return fail(res, 500, 'Could not load orders', error.message);
  res.json(data);
}));

/* ---------------------------------------------------------
   Newsletter
   --------------------------------------------------------- */

app.post('/api/newsletter', writeLimiter, route(async (req, res) => {
  const { email, source = 'footer' } = req.body ?? {};
  if (!isEmail(email)) return fail(res, 400, 'Enter a valid email address');

  const { error } = await admin
    .from('newsletter_subscribers')
    .upsert({ email, source }, { onConflict: 'email', ignoreDuplicates: true });

  if (error) return fail(res, 500, 'Could not subscribe', error.message);

  /* same response whether or not they were already on the list —
     don't let this endpoint be used to probe for known addresses */
  res.status(201).json({ ok: true });
}));

/* ---------------------------------------------------------
   Health + error handling
   --------------------------------------------------------- */

app.get('/api/health', route(async (_req, res) => {
  const { error } = await admin.from('products').select('id', { head: true, count: 'exact' });
  res.json({ ok: !error, db: error ? 'unreachable' : 'ok' });
}));

app.use((_req, res) => fail(res, 404, 'No such endpoint'));

app.use((err, _req, res, _next) => {
  console.error('[api]', err);
  fail(res, 500, 'Something went wrong');
});

app.listen(PORT, () => {
  console.log(`Chic Colombo API listening on http://localhost:${PORT}`);
});
