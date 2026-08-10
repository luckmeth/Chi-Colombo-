import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { admin, currentUser } from './db.js';
import { restock } from './payments.js';

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
    .select('*, product_variants(*), product_images(*)')
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
   Media uploads

   The browser never posts file bytes through this server. It asks for a
   signed upload URL, then PUTs straight to Supabase Storage. A hero video
   can be tens of megabytes, and streaming that through Express would mean
   buffering the whole thing in this process's memory for no benefit.

   The signed URL is single-use, scoped to one exact object path, and the
   path is chosen here — the client cannot pick where its bytes land.
   --------------------------------------------------------- */

const BUCKET = 'media';

/* Mirrors the bucket's allow-list in 04_storage.sql. Checked here too so a
   bad type fails with a useful message instead of an opaque Storage error.
   SVG is excluded on purpose: the bucket is public, and SVG is executable. */
const MEDIA_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime'
]);

/* Free-plan ceiling; the bucket enforces it as well. */
const MAX_UPLOAD_BYTES = 52428800;

const FOLDERS = new Set(['products', 'hero', 'posters']);

const PUBLIC_PREFIX = `${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;

/** Strips anything that could escape the folder or confuse a URL. */
function safeName(name) {
  const cleaned = String(name ?? 'file')
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned.slice(-80) || 'file';
}

/** The storage path behind one of our public URLs, or null if it isn't ours. */
function storagePath(url) {
  if (typeof url !== 'string' || !url.startsWith(PUBLIC_PREFIX)) return null;
  const path = url.slice(PUBLIC_PREFIX.length).split(/[?#]/)[0];
  return path ? decodeURIComponent(path) : null;
}

/** Best-effort cleanup — a failure here must not fail the caller's request. */
async function removeObject(url) {
  const path = storagePath(url);
  if (!path) return;
  await admin.storage.from(BUCKET).remove([path]).catch(() => {});
}

adminRouter.post('/uploads/sign', route(async (req, res) => {
  const { filename, content_type: contentType, folder = 'products', size } = req.body ?? {};

  if (!MEDIA_TYPES.has(contentType)) {
    return fail(res, 415, `Unsupported file type${contentType ? `: ${contentType}` : ''}`,
      'Allowed: PNG, JPEG, WebP, AVIF, GIF, MP4, WebM, MOV');
  }
  if (!FOLDERS.has(folder)) return fail(res, 400, 'Unknown folder');
  if (Number.isFinite(size) && size > MAX_UPLOAD_BYTES) {
    return fail(res, 413, `File is too large — the limit is ${MAX_UPLOAD_BYTES / 1048576} MB`);
  }

  /* randomUUID prefix keeps two uploads of "photo.jpg" apart and makes the
     path unguessable, so the object cannot be overwritten by a second signer */
  const path = `${folder}/${randomUUID()}-${safeName(filename)}`;

  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) return fail(res, 500, 'Could not start the upload', error.message);

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);

  res.json({
    path,
    token: data.token,
    signed_url: data.signedUrl,
    public_url: pub.publicUrl,
    bucket: BUCKET
  });
}));

/** Drops an uploaded object that no record ended up pointing at. */
adminRouter.post('/uploads/discard', route(async (req, res) => {
  const url = req.body?.url;
  if (!storagePath(url)) return fail(res, 400, 'Not a media URL for this project');
  await removeObject(url);
  res.status(204).end();
}));

/* ---------------------------------------------------------
   Product images
   --------------------------------------------------------- */

adminRouter.get('/products/:id/images', route(async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Bad product id');

  const { data, error } = await admin
    .from('product_images').select('*').eq('product_id', req.params.id).order('position');

  if (error) return fail(res, 500, 'Could not load images', error.message);
  res.json(data);
}));

adminRouter.post('/products/:id/images', route(async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Bad product id');

  const url = req.body?.url;
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return fail(res, 400, 'url must be an http(s) URL');
  }

  /* append: take the next free slot rather than trusting a client-sent
     position, which would collide with the unique (product_id, position) index */
  const { data: last } = await admin
    .from('product_images').select('position')
    .eq('product_id', req.params.id)
    .order('position', { ascending: false }).limit(1).maybeSingle();

  const { data, error } = await admin.from('product_images').insert({
    product_id: req.params.id,
    url,
    alt: req.body?.alt ?? null,
    position: (last?.position ?? -1) + 1
  }).select().single();

  if (error) return fail(res, 500, 'Could not attach the image', error.message);
  res.status(201).json(data);
}));

adminRouter.patch('/images/:id', route(async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Bad image id');

  const { data, error } = await admin
    .from('product_images').update(pick(req.body, ['alt']))
    .eq('id', req.params.id).select().single();

  if (error) return fail(res, 500, 'Could not update the image', error.message);
  res.json(data);
}));

adminRouter.delete('/images/:id', route(async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Bad image id');

  const { data: row } = await admin
    .from('product_images').select('url').eq('id', req.params.id).maybeSingle();

  const { error } = await admin.from('product_images').delete().eq('id', req.params.id);
  if (error) return fail(res, 500, 'Could not remove the image', error.message);

  /* the row is gone either way; an orphaned object is better than a broken card */
  if (row?.url) await removeObject(row.url);
  res.status(204).end();
}));

adminRouter.post('/products/:id/images/reorder', route(async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Bad product id');

  const order = req.body?.order;
  if (!Array.isArray(order) || !order.length || !order.every(isUuid)) {
    return fail(res, 400, 'order must be an array of image ids');
  }

  /* Two passes. (product_id, position) is unique, so writing the final
     positions directly would collide the moment two images swap places.
     Negative slots are unused, so the first pass can never conflict. */
  for (const [i, id] of order.entries()) {
    await admin.from('product_images')
      .update({ position: -(i + 1) }).eq('id', id).eq('product_id', req.params.id);
  }
  for (const [i, id] of order.entries()) {
    await admin.from('product_images')
      .update({ position: i }).eq('id', id).eq('product_id', req.params.id);
  }

  const { data, error } = await admin
    .from('product_images').select('*').eq('product_id', req.params.id).order('position');

  if (error) return fail(res, 500, 'Could not reorder images', error.message);
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

  const { data: before } = await admin
    .from('hero_slides').select('media_url, poster_url').eq('id', req.params.id).maybeSingle();

  const { data, error } = await admin
    .from('hero_slides').update(body).eq('id', req.params.id).select().single();

  if (error) return fail(res, 500, 'Could not update slide', error.message);

  /* swapping in new media leaves the old object unreferenced — drop it, but
     only once the row actually points somewhere else */
  for (const field of ['media_url', 'poster_url']) {
    if (before?.[field] && data[field] !== before[field]) await removeObject(before[field]);
  }

  res.json(data);
}));

adminRouter.delete('/slides/:id', route(async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Bad slide id');

  const { data: row } = await admin
    .from('hero_slides').select('media_url, poster_url').eq('id', req.params.id).maybeSingle();

  const { error } = await admin.from('hero_slides').delete().eq('id', req.params.id);
  if (error) return fail(res, 500, 'Could not delete slide', error.message);

  await removeObject(row?.media_url);
  await removeObject(row?.poster_url);
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
   Payment settings

   Secrets go in and never come back out. A GET returns only whether a
   value is set and its last four characters, because the panel runs in
   a browser with the anon key — anything this endpoint returns is one
   devtools tab away from being read.
   --------------------------------------------------------- */

const SECRET_FIELDS = [
  'payhere_merchant_secret', 'payhere_app_secret', 'paypal_secret'
];

const PAYMENT_FIELDS = [
  'active_provider',
  'payhere_enabled', 'payhere_sandbox', 'payhere_merchant_id',
  'payhere_merchant_secret', 'payhere_app_id', 'payhere_app_secret',
  'paypal_enabled', 'paypal_sandbox', 'paypal_client_id', 'paypal_secret'
];

/** { configured: bool, hint: '…1234' } — never the value itself. */
const mask = (value) => ({
  configured: Boolean(value),
  hint: value ? `…${String(value).slice(-4)}` : null
});

/** The only shape of payment settings that may leave the server. */
async function paymentView() {
  const { data, error } = await admin
    .from('payment_settings').select('*').eq('id', 'global').maybeSingle();

  if (error) throw new Error(error.message);

  const s = data ?? {};
  return {
    active_provider: s.active_provider ?? 'payhere',

    payhere_enabled: Boolean(s.payhere_enabled),
    payhere_sandbox: s.payhere_sandbox !== false,
    payhere_merchant_id: s.payhere_merchant_id ?? '',
    payhere_app_id: s.payhere_app_id ?? '',
    payhere_merchant_secret: mask(s.payhere_merchant_secret),
    payhere_app_secret: mask(s.payhere_app_secret),

    paypal_enabled: Boolean(s.paypal_enabled),
    paypal_sandbox: s.paypal_sandbox !== false,
    paypal_client_id: s.paypal_client_id ?? '',
    paypal_secret: mask(s.paypal_secret),

    /* the storefront only offers a provider that is both on and complete */
    payhere_ready: Boolean(s.payhere_enabled && s.payhere_merchant_id && s.payhere_merchant_secret),
    updated_at: s.updated_at ?? null
  };
}

adminRouter.get('/payments', route(async (_req, res) => {
  res.json(await paymentView());
}));

adminRouter.patch('/payments', route(async (req, res) => {
  const body = pick(req.body, PAYMENT_FIELDS);
  if (!Object.keys(body).length) return fail(res, 400, 'Nothing to update');

  /* An empty secret field means "leave it alone", not "erase it" — otherwise
     saving the form after a page load would wipe every stored key, since the
     GET above never sent them back to be re-submitted. */
  for (const field of SECRET_FIELDS) {
    if (field in body && !String(body[field]).trim()) delete body[field];
  }

  if (body.active_provider && !['payhere', 'paypal'].includes(body.active_provider)) {
    return fail(res, 400, 'Unknown payment provider');
  }

  const { error } = await admin
    .from('payment_settings').update(body).eq('id', 'global');

  if (error) return fail(res, 500, 'Could not save payment settings', error.message);

  /* echo the masked view, so the panel repaints from stored truth rather
     than from what it just typed */
  res.json(await paymentView());
}));

/* ---------------------------------------------------------
   Content pages
   --------------------------------------------------------- */

/* Admin-authored HTML is rendered as markup on the public storefront, so it
   is filtered here rather than trusted. An allow-list, not a block-list:
   anything not named is dropped, which fails closed when something new
   turns up. */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'h2', 'h3', 'h4', 'ul', 'ol', 'li',
  'strong', 'b', 'em', 'i', 'u', 'a', 'blockquote'
]);

function sanitizeHtml(input) {
  let html = String(input ?? '');

  /* these carry their payload as content, so the content goes too */
  html = html.replace(/<(script|style|iframe|object|embed|noscript|svg)\b[\s\S]*?<\/\1\s*>/gi, '');
  html = html.replace(/<!--[\s\S]*?-->/g, '');

  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (match, rawTag, attrs) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';
    if (match.startsWith('</')) return `</${tag}>`;

    /* every attribute is dropped except a safe href — that removes onclick,
       style, srcset and everything else in one move */
    if (tag === 'a') {
      const found = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
      const url = (found?.[2] ?? found?.[3] ?? found?.[4] ?? '').trim();
      return /^(https?:\/\/|\/|mailto:|tel:|#)/i.test(url)
        ? `<a href="${url.replace(/"/g, '&quot;')}">`
        : '<a>';
    }

    return `<${tag}>`;
  });
}

const PAGE_FIELDS = ['slug', 'title', 'body_html', 'is_published', 'sort_order'];

adminRouter.get('/pages', route(async (_req, res) => {
  const { data, error } = await admin
    .from('content_pages').select('*').order('sort_order');
  if (error) return fail(res, 500, 'Could not load pages', error.message);
  res.json(data);
}));

adminRouter.post('/pages', route(async (req, res) => {
  const body = pick(req.body, PAGE_FIELDS);
  if (!body.slug || !body.title) return fail(res, 400, 'slug and title are required');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(body.slug)) {
    return fail(res, 400, 'The slug may only contain lowercase letters, numbers and hyphens');
  }

  body.body_html = sanitizeHtml(body.body_html ?? '');

  const { data, error } = await admin.from('content_pages').insert(body).select().single();
  if (error) {
    if (error.code === '23505') return fail(res, 409, 'That slug is already taken');
    return fail(res, 500, 'Could not create the page', error.message);
  }
  res.status(201).json(data);
}));

adminRouter.patch('/pages/:id', route(async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Bad page id');

  const body = pick(req.body, PAGE_FIELDS);
  if (!Object.keys(body).length) return fail(res, 400, 'Nothing to update');
  if (body.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(body.slug)) {
    return fail(res, 400, 'The slug may only contain lowercase letters, numbers and hyphens');
  }
  if ('body_html' in body) body.body_html = sanitizeHtml(body.body_html);

  const { data, error } = await admin
    .from('content_pages').update(body).eq('id', req.params.id).select().single();

  if (error) {
    if (error.code === '23505') return fail(res, 409, 'That slug is already taken');
    return fail(res, 500, 'Could not save the page', error.message);
  }
  res.json(data);
}));

adminRouter.delete('/pages/:id', route(async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Bad page id');
  const { error } = await admin.from('content_pages').delete().eq('id', req.params.id);
  if (error) return fail(res, 500, 'Could not delete the page', error.message);
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

adminRouter.get('/orders/:id', route(async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Bad order id');

  const { data, error } = await admin
    .from('orders').select('*, order_items(*)').eq('id', req.params.id).maybeSingle();

  if (error) return fail(res, 500, 'Could not load the order', error.message);
  if (!data) return fail(res, 404, 'Order not found');

  const { data: events } = await admin
    .from('order_events').select('*').eq('order_id', data.id).order('created_at');

  res.json({ ...data, events: events ?? [] });
}));

const ORDER_STATUSES = ['pending', 'paid', 'fulfilled', 'cancelled', 'refunded'];

adminRouter.patch('/orders/:id', route(async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Bad order id');

  const body = pick(req.body, ['status', 'courier', 'tracking_number', 'tracking_url']);
  if (!Object.keys(body).length) return fail(res, 400, 'Nothing to update');

  if (body.status && !ORDER_STATUSES.includes(body.status)) {
    return fail(res, 400, `status must be one of: ${ORDER_STATUSES.join(', ')}`);
  }
  if (body.tracking_url && !/^https?:\/\//i.test(body.tracking_url)) {
    return fail(res, 400, 'tracking_url must start with http:// or https://');
  }

  const { data: before } = await admin
    .from('orders').select('status').eq('id', req.params.id).maybeSingle();

  if (!before) return fail(res, 404, 'Order not found');

  /* Cancelling from here has to give the stock back, exactly as a failed
     payment notification does — checkout_cart took the units when the order
     was created, before any money moved. */
  const cancelling = body.status === 'cancelled' && before.status !== 'cancelled';

  const { data, error } = await admin
    .from('orders').update(body).eq('id', req.params.id).select().single();

  if (error) return fail(res, 500, 'Could not update order', error.message);

  if (body.status && body.status !== before.status) {
    await admin.from('order_events').insert({
      order_id: data.id,
      status: body.status,
      note: `Marked ${body.status} in the admin panel`,
      actor: req.adminUser.id
    });
  }

  if (body.tracking_number) {
    await admin.from('order_events').insert({
      order_id: data.id,
      status: data.status,
      note: `Tracking number added${body.courier ? ` (${body.courier})` : ''}: ${body.tracking_number}`,
      actor: req.adminUser.id
    });
  }

  if (cancelling) await restock(data.id);

  res.json(data);
}));

adminRouter.get('/subscribers', route(async (_req, res) => {
  const { data, error } = await admin
    .from('newsletter_subscribers').select('*')
    .order('subscribed_at', { ascending: false }).limit(500);

  if (error) return fail(res, 500, 'Could not load subscribers', error.message);
  res.json(data);
}));
