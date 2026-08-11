import './env.js';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { admin, currentUser, configError, envReport } from './db.js';
import { adminRouter } from './admin.js';
import { paymentsRouter } from './payments.js';

const app = express();

/* Behind Vercel's proxy every request arrives from the same socket, so without
   this the rate limiters below see one client and throttle the entire site into
   a single 30/min bucket. `1` = trust exactly one proxy hop, which is what a
   platform edge gives us; `true` would let a caller spoof X-Forwarded-For and
   dodge the limiter entirely. */
app.set('trust proxy', 1);

app.use(express.json({ limit: '64kb' }));

/* PayHere posts its payment notification as form-encoded, not JSON. Without
   this the webhook body arrives empty and every notification is discarded. */
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

app.use(cors({
  origin: (process.env.CORS_ORIGIN ?? 'http://localhost:4321').split(','),
  credentials: true
}));

/* Without credentials every route would fail obscurely deep inside a Supabase
   call. Refuse them all at the door with the reason instead — except
   /api/health, which exists precisely to report this. */
app.use('/api', (req, res, next) => {
  if (!configError || req.path === '/health') return next();
  res.status(503).json({ error: 'The server is not configured', detail: configError });
});

/* write endpoints get a tighter budget than reads */
const writeLimiter = rateLimit({ windowMs: 60_000, max: 30 });

/* The admin surface had no limit at all, which left the sign-in-backed routes
   open to being hammered. Higher than the storefront budget because the panel
   fires several requests per screen. */
const adminLimiter = rateLimit({ windowMs: 60_000, max: 120 });

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

  if (typeof req.query.q === 'string' && req.query.q.trim()) {
    /* % and _ are LIKE wildcards. Left in, a search for "50%" would match
       everything, so strip them rather than let a shopper write patterns. */
    const term = req.query.q.trim().replace(/[%_\\]/g, '').slice(0, 60);
    if (!term) return res.json([]);
    query = query.ilike('title', `%${term}%`);
  }

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

/* Terms, privacy, refunds and the rest — edited in the admin panel,
   rendered by the storefront at /pages/<slug>. */
app.get('/api/pages/:slug', route(async (req, res) => {
  const { data, error } = await admin
    .from('content_pages')
    .select('slug, title, body_html, updated_at')
    .eq('slug', req.params.slug)
    .eq('is_published', true)
    .maybeSingle();

  if (error) return fail(res, 500, 'Could not load the page', error.message);
  if (!data) return fail(res, 404, 'Page not found');
  res.json(data);
}));

/* Payment start/notify and order tracking. Mounted at /api rather than
   /api/payments because tracking an order is not a payment operation. */
app.use('/api', paymentsRouter);

app.use('/api/admin', adminLimiter, adminRouter);

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
        id, colour_name, size, colour_hex, price_cents, inventory_qty,
        products ( id, handle, title, price_cents, currency, product_images ( url, position ) )
      )
    `)
    .eq('cart_id', cartId);

  if (error) return fail(res, 500, 'Could not load cart', error.message);

  const items = data.map((row) => {
    const variant = row.product_variants;
    const product = variant.products;
    const unit = variant.price_cents ?? product.price_cents;

    /* position 0 is the card front — the same image the shopper clicked */
    const image = (product.product_images ?? [])
      .sort((a, b) => a.position - b.position)[0]?.url ?? null;

    return {
      item_id: row.id,
      variant_id: variant.id,
      handle: product.handle,
      title: product.title,
      colour: variant.colour_name,
      colour_hex: variant.colour_hex,
      size: variant.size,
      image,
      qty: row.qty,
      /* the cart page caps the quantity stepper at what is actually in stock */
      inventory_qty: variant.inventory_qty,
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

/** What delivery costs for a given subtotal, from the admin's own settings. */
export async function shippingFor(subtotalCents) {
  const { data } = await admin
    .from('app_settings')
    .select('free_shipping_threshold_cents, flat_shipping_cents')
    .eq('id', 'global')
    .maybeSingle();

  const threshold = data?.free_shipping_threshold_cents ?? 0;
  const flat = data?.flat_shipping_cents ?? 0;

  return threshold > 0 && subtotalCents >= threshold ? 0 : flat;
}

app.post('/api/checkout', writeLimiter, route(async (req, res) => {
  const { cart_id: cartId, email, address } = req.body ?? {};

  if (!(await ownsCart(req, cartId))) return fail(res, 403, 'Not your cart');
  if (!isEmail(email)) return fail(res, 400, 'A valid email is required');

  /* Shipping is computed here, never taken from the request. The page shows a
     quote, but a quote the client could edit is a discount anyone can grant
     themselves — post shipping_cents: 0 and delivery is free. */
  const { data: lines, error: lineErr } = await admin
    .from('cart_items')
    .select('qty, product_variants ( price_cents, products ( price_cents ) )')
    .eq('cart_id', cartId);

  if (lineErr) return fail(res, 500, 'Could not price the cart', lineErr.message);

  const subtotal = (lines ?? []).reduce((sum, row) => {
    const unit = row.product_variants.price_cents ?? row.product_variants.products.price_cents;
    return sum + unit * row.qty;
  }, 0);

  const shipping = await shippingFor(subtotal);

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

  /* the first entry in the timeline the tracking page shows */
  await admin.from('order_events').insert({
    order_id: order.id,
    status: 'pending',
    note: 'Order placed'
  });

  res.status(201).json({
    order_id: order.id,
    order_number: order.order_number,
    subtotal_cents: order.subtotal_cents,
    shipping_cents: order.shipping_cents,
    total_cents: order.total_cents,
    currency: order.currency,
    status: order.status
  });
}));

/** What delivery would cost right now — so the cart can quote it honestly. */
app.get('/api/shipping-quote', route(async (req, res) => {
  const subtotal = Number(req.query.subtotal_cents) || 0;
  res.json({ shipping_cents: await shippingFor(subtotal) });
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

/* Answers even when nothing else can, because when the API is broken this is
   the endpoint you check first. `env` reports which variables the process can
   see — names only, never values. */
app.get('/api/health', route(async (_req, res) => {
  if (configError) {
    return res.status(503).json({ ok: false, db: 'not configured', error: configError, env: envReport });
  }

  const { error } = await admin.from('products').select('id', { head: true, count: 'exact' });
  res.json({
    ok: !error,
    db: error ? 'unreachable' : 'ok',
    ...(error ? { error: error.message, env: envReport } : {})
  });
}));

/* ---------------------------------------------------------
   Static site — development only.

   On Vercel the edge serves these files and the function only ever sees
   /api/*, so none of this runs in production. Locally it means one
   server on one origin with exactly the production URLs: clean URLs,
   and the same rewrites declared in vercel.json. Keep the two in step.
   --------------------------------------------------------- */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const REWRITES = [
  [/^\/collections\/[^/]+\/?$/, 'collection.html'],
  [/^\/products\/[^/]+\/?$/,    'product.html'],
  [/^\/pages\/[^/]+\/?$/,       'page.html'],
  [/^\/order\/[^/]+\/?$/,       'confirmation.html'],
  [/^\/shop\/?$/,               'collection.html'],
  [/^\/search\/?$/,             'collection.html']
];

/* extensions:['html'] is the local equivalent of vercel.json's cleanUrls,
   so /admin resolves to admin.html here too */
app.use(express.static(ROOT, { extensions: ['html'] }));

app.use((req, res, next) => {
  /* an unmatched /api path is an API error, not a missing page */
  if (req.path.startsWith('/api/')) return next();

  const match = REWRITES.find(([pattern]) => pattern.test(req.path));
  if (match) return res.sendFile(join(ROOT, match[1]));

  res.status(404).sendFile(join(ROOT, '404.html'));
});

app.use((_req, res) => fail(res, 404, 'No such endpoint'));

app.use((err, _req, res, _next) => {
  console.error('[api]', err);
  fail(res, 500, 'Something went wrong');
});

/* No listen() here. `server/index.js` starts a local server for development;
   `api/[[...path]].js` hands this same app to Vercel as a serverless function.
   One app definition, two ways in. */
export default app;
