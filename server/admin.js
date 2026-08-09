import { Router } from 'express';
import { admin, currentUser } from './db.js';

export const adminRouter = Router();

/* ---------------------------------------------------------
   Admin gate
   Mirrors the nexabill convention: match site_admins on user_id
   OR email, so a master admin is recognised whether they signed
   in with a password or an OAuth provider.
   --------------------------------------------------------- */

async function isAdmin(req) {
  const user = await currentUser(req);
  if (!user) return { ok: false, user: null };

  const { data: byId } = await admin
    .from('site_admins').select('id').eq('user_id', user.id).maybeSingle();
  if (byId) return { ok: true, user };

  if (user.email) {
    const { data: byEmail } = await admin
      .from('site_admins').select('id').ilike('email', user.email).maybeSingle();
    if (byEmail) return { ok: true, user };
  }

  return { ok: false, user };
}

/** Blocks everything below unless the caller is an admin. */
async function requireAdmin(req, res, next) {
  try {
    const { ok, user } = await isAdmin(req);
    if (!ok) {
      return res.status(user ? 403 : 401)
        .json({ error: user ? 'Admins only' : 'Sign in required' });
    }
    req.adminUser = user;
    next();
  } catch (err) {
    next(err);
  }
}

const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (res, status, message, detail) =>
  res.status(status).json({ error: message, ...(detail ? { detail } : {}) });

const isUuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

/** Keeps only known columns so a client can't write arbitrary fields. */
const pick = (src, keys) =>
  Object.fromEntries(Object.entries(src ?? {}).filter(([k]) => keys.includes(k)));

/* status endpoint is deliberately outside the gate — the panel calls it
   to decide whether to show the login screen */
adminRouter.get('/status', route(async (req, res) => {
  const { ok, user } = await isAdmin(req);
  res.json({ isAdmin: ok, email: user?.email ?? null });
}));

adminRouter.use(requireAdmin);

/* ---------------------------------------------------------
   Dashboard
   --------------------------------------------------------- */

adminRouter.get('/overview', route(async (_req, res) => {
  const [products, orders, subs, lowStock] = await Promise.all([
    admin.from('products').select('id', { count: 'exact', head: true }),
    admin.from('orders').select('id', { count: 'exact', head: true }),
    admin.from('newsletter_subscribers').select('id', { count: 'exact', head: true }),
    admin.from('product_variants')
      .select('id, sku, colour_name, size, inventory_qty, products(title)')
      .lt('inventory_qty', 5).order('inventory_qty').limit(20)
  ]);

  const { data: revenue } = await admin
    .from('orders').select('total_cents').neq('status', 'cancelled');

  res.json({
    products: products.count ?? 0,
    orders: orders.count ?? 0,
    subscribers: subs.count ?? 0,
    revenue_cents: (revenue ?? []).reduce((n, o) => n + (o.total_cents ?? 0), 0),
    low_stock: lowStock.data ?? []
  });
}));

/* ---------------------------------------------------------
   Products & stock
   --------------------------------------------------------- */

const PRODUCT_FIELDS = ['handle', 'title', 'description', 'status', 'audience',
  'price_cents', 'compare_at_cents', 'is_new', 'position'];

adminRouter.get('/products', route(async (_req, res) => {
  const { data, error } = await admin
    .from('products')
    .select('*, product_variants(*)')
    .order('position');

  if (error) return fail(res, 500, 'Could not load products', error.message);
  res.json(data);
}));

adminRouter.post('/products', route(async (req, res) => {
  const body = pick(req.body, PRODUCT_FIELDS);
  if (!body.handle || !body.title) return fail(res, 400, 'handle and title are required');
  if (!Number.isInteger(body.price_cents) || body.price_cents < 0) {
    return fail(res, 400, 'price_cents must be a non-negative whole number');
  }

  const { data, error } = await admin.from('products').insert(body).select().single();
  if (error) {
    if (error.code === '23505') return fail(res, 409, 'That handle is already taken');
    return fail(res, 500, 'Could not create product', error.message);
  }
  res.status(201).json(data);
}));

adminRouter.patch('/products/:id', route(async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Bad product id');
  const body = pick(req.body, PRODUCT_FIELDS);
  if (!Object.keys(body).length) return fail(res, 400, 'Nothing to update');

  const { data, error } = await admin
    .from('products').update(body).eq('id', req.params.id).select().single();

  if (error) return fail(res, 500, 'Could not update product', error.message);
  res.json(data);
}));

adminRouter.delete('/products/:id', route(async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Bad product id');

  /* archive rather than delete — order history references variants */
  const { error } = await admin
    .from('products').update({ status: 'archived' }).eq('id', req.params.id);

  if (error) return fail(res, 500, 'Could not archive product', error.message);
  res.status(204).end();
}));

const VARIANT_FIELDS = ['product_id', 'sku', 'colour_name', 'colour_hex', 'size',
  'price_cents', 'inventory_qty', 'position', 'is_active'];

adminRouter.post('/variants', route(async (req, res) => {
  const body = pick(req.body, VARIANT_FIELDS);
  if (!isUuid(body.product_id)) return fail(res, 400, 'product_id must be a uuid');
  if (!body.colour_name) return fail(res, 400, 'colour_name is required');

  const { data, error } = await admin.from('product_variants').insert(body).select().single();
  if (error) {
    if (error.code === '23505') return fail(res, 409, 'That colour/size already exists');
    return fail(res, 500, 'Could not create variant', error.message);
  }
  res.status(201).json(data);
}));

adminRouter.patch('/variants/:id', route(async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Bad variant id');
  const body = pick(req.body, VARIANT_FIELDS);

  const { data, error } = await admin
    .from('product_variants').update(body).eq('id', req.params.id).select().single();

  if (error) return fail(res, 500, 'Could not update variant', error.message);
  res.json(data);
}));

adminRouter.delete('/variants/:id', route(async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Bad variant id');
  const { error } = await admin
    .from('product_variants').update({ is_active: false }).eq('id', req.params.id);
  if (error) return fail(res, 500, 'Could not deactivate variant', error.message);
  res.status(204).end();
}));

/** Relative stock change, logged to stock_movements. */
adminRouter.post('/variants/:id/stock', route(async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Bad variant id');

  const delta = Number(req.body?.delta);
  if (!Number.isInteger(delta) || delta === 0) {
    return fail(res, 400, 'delta must be a non-zero whole number');
  }

  const { data: variant } = await admin
    .from('product_variants').select('inventory_qty').eq('id', req.params.id).maybeSingle();

  if (!variant) return fail(res, 404, 'Variant not found');
  if (variant.inventory_qty + delta < 0) {
    return fail(res, 409, `Cannot go below zero — only ${variant.inventory_qty} in stock`);
  }

  const { data, error } = await admin
    .from('product_variants')
    .update({ inventory_qty: variant.inventory_qty + delta })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return fail(res, 500, 'Could not adjust stock', error.message);

  await admin.from('stock_movements').insert({
    variant_id: req.params.id,
    delta,
    reason: req.body?.reason ?? 'manual',
    note: req.body?.note ?? null,
    actor: req.adminUser.id
  });

  res.json(data);
}));

/* ---------------------------------------------------------
   Hero slides
   --------------------------------------------------------- */

const SLIDE_FIELDS = ['kind', 'media_url', 'poster_url', 'focal_point', 'eyebrow',
  'title', 'subtitle', 'cta_label', 'cta_href', 'cta2_label', 'cta2_href',
  'sort_order', 'is_active'];

adminRouter.get('/slides', route(async (_req, res) => {
  const { data, error } = await admin.from('hero_slides').select('*').order('sort_order');
  if (error) return fail(res, 500, 'Could not load slides', error.message);
  res.json(data);
}));

adminRouter.post('/slides', route(async (req, res) => {
  const body = pick(req.body, SLIDE_FIELDS);
  if (!body.media_url) return fail(res, 400, 'media_url is required');
  if (body.kind && !['image', 'video'].includes(body.kind)) {
    return fail(res, 400, "kind must be 'image' or 'video'");
  }

  const { data, error } = await admin.from('hero_slides').insert(body).select().single();
  if (error) return fail(res, 500, 'Could not create slide', error.message);
  res.status(201).json(data);
}));

adminRouter.patch('/slides/:id', route(async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Bad slide id');
  const body = pick(req.body, SLIDE_FIELDS);

  const { data, error } = await admin
    .from('hero_slides').update(body).eq('id', req.params.id).select().single();

  if (error) return fail(res, 500, 'Could not update slide', error.message);
  res.json(data);
}));

adminRouter.delete('/slides/:id', route(async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Bad slide id');
  const { error } = await admin.from('hero_slides').delete().eq('id', req.params.id);
  if (error) return fail(res, 500, 'Could not delete slide', error.message);
  res.status(204).end();
}));

/** Persist a whole reordering in one request. */
adminRouter.post('/slides/reorder', route(async (req, res) => {
  const order = req.body?.order;
  if (!Array.isArray(order) || !order.every(isUuid)) {
    return fail(res, 400, 'order must be an array of slide ids');
  }

  await Promise.all(order.map((id, i) =>
    admin.from('hero_slides').update({ sort_order: i }).eq('id', id)));

  res.json({ ok: true });
}));

/* ---------------------------------------------------------
   Settings & social links
   --------------------------------------------------------- */

const SETTING_FIELDS = ['brand_name', 'tagline', 'contact_email', 'support_email',
  'contact_phone', 'whatsapp_number', 'hotline', 'address_line1', 'address_line2',
  'city', 'country', 'google_maps_url', 'free_shipping_threshold_cents',
  'flat_shipping_cents', 'currency', 'announcements', 'footer_note'];

adminRouter.patch('/settings', route(async (req, res) => {
  const body = pick(req.body, SETTING_FIELDS);
  if (!Object.keys(body).length) return fail(res, 400, 'Nothing to update');

  if (body.announcements && !Array.isArray(body.announcements)) {
    return fail(res, 400, 'announcements must be an array of strings');
  }

  const { data, error } = await admin
    .from('app_settings').update(body).eq('id', 'global').select().single();

  if (error) return fail(res, 500, 'Could not save settings', error.message);
  res.json(data);
}));

const SOCIAL_FIELDS = ['platform', 'url', 'icon_name', 'sort_order', 'is_active'];

adminRouter.get('/socials', route(async (_req, res) => {
  const { data, error } = await admin.from('social_links').select('*').order('sort_order');
  if (error) return fail(res, 500, 'Could not load links', error.message);
  res.json(data);
}));

adminRouter.post('/socials', route(async (req, res) => {
  const body = pick(req.body, SOCIAL_FIELDS);
  if (!body.platform || !body.url) return fail(res, 400, 'platform and url are required');

  /* an unvalidated href here ends up rendered on the public storefront */
  if (!/^https?:\/\//i.test(body.url)) {
    return fail(res, 400, 'url must start with http:// or https://');
  }

  body.icon_name ||= body.platform.toLowerCase();

  const { data, error } = await admin.from('social_links').insert(body).select().single();
  if (error) return fail(res, 500, 'Could not add link', error.message);
  res.status(201).json(data);
}));

adminRouter.patch('/socials/:id', route(async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Bad link id');
  const body = pick(req.body, SOCIAL_FIELDS);

  if (body.url && !/^https?:\/\//i.test(body.url)) {
    return fail(res, 400, 'url must start with http:// or https://');
  }

  const { data, error } = await admin
    .from('social_links').update(body).eq('id', req.params.id).select().single();

  if (error) return fail(res, 500, 'Could not update link', error.message);
  res.json(data);
}));

adminRouter.delete('/socials/:id', route(async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Bad link id');
  const { error } = await admin.from('social_links').delete().eq('id', req.params.id);
  if (error) return fail(res, 500, 'Could not delete link', error.message);
  res.status(204).end();
}));

/* ---------------------------------------------------------
   Orders & subscribers
   --------------------------------------------------------- */

adminRouter.get('/orders', route(async (req, res) => {
  let q = admin.from('orders').select('*, order_items(*)').order('placed_at', { ascending: false });
  if (req.query.status) q = q.eq('status', req.query.status);

  const { data, error } = await q.limit(200);
  if (error) return fail(res, 500, 'Could not load orders', error.message);
  res.json(data);
}));

adminRouter.patch('/orders/:id', route(async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Bad order id');

  const allowed = ['pending', 'paid', 'fulfilled', 'cancelled', 'refunded'];
  const { status } = req.body ?? {};
  if (!allowed.includes(status)) {
    return fail(res, 400, `status must be one of: ${allowed.join(', ')}`);
  }

  const { data, error } = await admin
    .from('orders').update({ status }).eq('id', req.params.id).select().single();

  if (error) return fail(res, 500, 'Could not update order', error.message);
  res.json(data);
}));

adminRouter.get('/subscribers', route(async (_req, res) => {
  const { data, error } = await admin
    .from('newsletter_subscribers').select('*')
    .order('subscribed_at', { ascending: false }).limit(500);

  if (error) return fail(res, 500, 'Could not load subscribers', error.message);
  res.json(data);
}));
