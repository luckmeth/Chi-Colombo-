/* =========================================================
   Chic Colombo — payments and order tracking.

   PayHere is the live provider. PayPal is deliberately not wired: it
   does not settle in LKR, so enabling it needs a currency decision
   first. Its credentials and the plumbing around it are in place so
   that decision is the only work left.

   Nothing here ever sends a secret to the browser. The merchant secret
   signs the checkout hash server-side; the page only ever receives the
   resulting form fields.
   ========================================================= */

import { Router } from 'express';
import { createHash } from 'node:crypto';
import rateLimit from 'express-rate-limit';

import { admin } from './db.js';

export const paymentsRouter = Router();

const md5 = (value) => createHash('md5').update(String(value), 'utf8').digest('hex').toUpperCase();

const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (res, status, message, detail) =>
  res.status(status).json({ error: message, ...(detail ? { detail } : {}) });

const isUuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

/** Two decimals, no separators — the exact form PayHere signs. */
const amount = (cents) => (cents / 100).toFixed(2);

/** Credentials, read with the service role. Never leaves this module. */
async function settings() {
  const { data } = await admin.from('payment_settings').select('*').eq('id', 'global').maybeSingle();
  return data ?? null;
}

/** The public origin, for the URLs PayHere calls back on. */
function publicBase(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  /* trust proxy is set, so this is the external scheme and host on Vercel */
  return `${req.protocol}://${req.get('host')}`;
}

/* ---------------------------------------------------------
   What the checkout page may offer
   --------------------------------------------------------- */

paymentsRouter.get('/payments/methods', route(async (_req, res) => {
  const s = await settings();

  /* `enabled` means "switched on AND actually configured" — a provider with
     the toggle on but no keys would fail at the redirect, which is a worse
     experience than not offering it. */
  const payhereReady = Boolean(s?.payhere_enabled && s.payhere_merchant_id && s.payhere_merchant_secret);
  const paypalReady = Boolean(s?.paypal_enabled && s.paypal_client_id && s.paypal_secret);

  res.json([
    {
      id: 'payhere',
      label: 'Card, bank or eZ Cash',
      note: payhereReady
        ? (s.payhere_sandbox ? 'PayHere — sandbox mode' : 'Secured by PayHere')
        : 'Not configured yet',
      enabled: payhereReady
    },
    {
      id: 'paypal',
      label: 'PayPal',
      note: paypalReady ? 'PayPal' : 'Unavailable — PayPal does not support LKR',
      enabled: false && paypalReady
    }
  ]);
}));

/* ---------------------------------------------------------
   PayHere — start
   --------------------------------------------------------- */

paymentsRouter.post('/payments/payhere/start', route(async (req, res) => {
  const orderId = req.body?.order_id;
  if (!isUuid(orderId)) return fail(res, 400, 'Bad order id');

  const s = await settings();
  if (!s?.payhere_enabled || !s.payhere_merchant_id || !s.payhere_merchant_secret) {
    return fail(res, 503, 'PayHere is not configured');
  }

  const { data: order } = await admin
    .from('orders')
    .select('id, order_number, email, total_cents, currency, status, shipping_address')
    .eq('id', orderId)
    .maybeSingle();

  if (!order) return fail(res, 404, 'Order not found');
  if (order.status !== 'pending') return fail(res, 409, 'That order is not awaiting payment');

  const base = publicBase(req);
  const addr = order.shipping_address ?? {};
  const [first, ...rest] = String(addr.full_name ?? '').trim().split(/\s+/);

  /* PayHere signs: merchant_id + order_id + amount + currency + md5(secret).
     order_number is used as the reference because it is short, stable and
     already unique; the notification is signature-verified, so a guessable
     reference gives an attacker nothing. */
  const total = amount(order.total_cents);
  const hash = md5(
    s.payhere_merchant_id + order.order_number + total + order.currency + md5(s.payhere_merchant_secret)
  );

  await admin.from('orders')
    .update({ payment_provider: 'payhere', payment_status: 'pending' })
    .eq('id', order.id);

  res.json({
    action: s.payhere_sandbox
      ? 'https://sandbox.payhere.lk/pay/checkout'
      : 'https://www.payhere.lk/pay/checkout',
    fields: {
      merchant_id: s.payhere_merchant_id,
      return_url: `${base}/order/${order.order_number}`,
      cancel_url: `${base}/checkout?cancelled=1`,
      notify_url: `${base}/api/payments/payhere/notify`,
      order_id: String(order.order_number),
      items: `Chic Colombo order #${order.order_number}`,
      currency: order.currency,
      amount: total,
      first_name: first ?? '',
      last_name: rest.join(' '),
      email: order.email,
      phone: addr.phone ?? '',
      address: [addr.line1, addr.line2].filter(Boolean).join(', '),
      city: addr.city ?? '',
      country: 'Sri Lanka',
      hash
    }
  });
}));

/* ---------------------------------------------------------
   PayHere — notification

   Public and unauthenticated by necessity: PayHere's servers call it,
   not the shopper. md5sig is what makes it trustworthy — it can only be
   produced by someone holding the merchant secret.
   --------------------------------------------------------- */

const STATUS = {
  '2': { payment: 'paid', order: 'paid', note: 'Payment received' },
  '0': { payment: 'pending', order: 'pending', note: 'Payment pending' },
  '-1': { payment: 'cancelled', order: 'cancelled', note: 'Payment cancelled' },
  '-2': { payment: 'failed', order: 'cancelled', note: 'Payment failed' },
  '-3': { payment: 'chargeback', order: 'refunded', note: 'Chargeback' }
};

paymentsRouter.post('/payments/payhere/notify', route(async (req, res) => {
  const b = req.body ?? {};
  const s = await settings();

  if (!s?.payhere_merchant_secret) return res.status(503).end();

  const expected = md5(
    String(b.merchant_id) + String(b.order_id) + String(b.payhere_amount) +
    String(b.payhere_currency) + String(b.status_code) + md5(s.payhere_merchant_secret)
  );

  if (String(b.md5sig ?? '').toUpperCase() !== expected) {
    console.warn('[payhere] rejected notification with a bad signature', b.order_id);
    /* 403, not 400: this is an authentication failure, and PayHere retries
       on 5xx — there is no point retrying a forged payload */
    return res.status(403).end();
  }

  if (String(b.merchant_id) !== String(s.payhere_merchant_id)) {
    return res.status(403).end();
  }

  const mapped = STATUS[String(b.status_code)];
  if (!mapped) return res.status(200).end();   /* unknown code: acknowledge, ignore */

  const { data: order } = await admin
    .from('orders')
    .select('id, status, total_cents, payment_status')
    .eq('order_number', Number(b.order_id))
    .maybeSingle();

  if (!order) {
    console.warn('[payhere] notification for an unknown order', b.order_id);
    return res.status(200).end();
  }

  /* Paying twice for one order should not overwrite anything, and a late
     "pending" must not undo a "paid". */
  if (order.payment_status === 'paid' && mapped.payment !== 'chargeback') {
    return res.status(200).end();
  }

  /* The amount is signed, so this compares what the gateway captured against
     what we asked for — a mismatch means the order was tampered with. */
  const paidCents = Math.round(Number(b.payhere_amount) * 100);
  if (mapped.payment === 'paid' && paidCents !== order.total_cents) {
    console.warn('[payhere] amount mismatch', { expected: order.total_cents, got: paidCents });
    await admin.from('order_events').insert({
      order_id: order.id,
      status: 'flagged',
      note: `Amount mismatch: paid ${paidCents}, expected ${order.total_cents}`
    });
    return res.status(200).end();
  }

  await admin.from('orders').update({
    status: mapped.order,
    payment_status: mapped.payment,
    payment_provider: 'payhere',
    payment_ref: b.payment_id ? String(b.payment_id) : null,
    paid_at: mapped.payment === 'paid' ? new Date().toISOString() : null
  }).eq('id', order.id);

  await admin.from('order_events').insert({
    order_id: order.id,
    status: mapped.order,
    note: `${mapped.note}${b.payment_id ? ` (ref ${b.payment_id})` : ''}`
  });

  /* A cancelled or failed payment must give the stock back — checkout_cart
     decremented it when the order was created, before any money moved. */
  if (mapped.order === 'cancelled') await restock(order.id);

  res.status(200).end();
}));

/** Returns an order's units to inventory. Safe to call once per order. */
export async function restock(orderId) {
  const { data: items } = await admin
    .from('order_items').select('variant_id, qty').eq('order_id', orderId);

  for (const item of items ?? []) {
    if (!item.variant_id) continue;
    const { data: v } = await admin
      .from('product_variants').select('inventory_qty').eq('id', item.variant_id).maybeSingle();
    if (!v) continue;

    await admin.from('product_variants')
      .update({ inventory_qty: v.inventory_qty + item.qty })
      .eq('id', item.variant_id);

    await admin.from('stock_movements').insert({
      variant_id: item.variant_id,
      delta: item.qty,
      reason: 'order cancelled',
      note: `Restocked from order ${orderId}`
    });
  }
}

/* ---------------------------------------------------------
   Order tracking
   --------------------------------------------------------- */

/* Tighter than the general write budget: order numbers run in sequence from
   1001, so this endpoint is the obvious thing to enumerate. */
const trackLimiter = rateLimit({ windowMs: 60_000, max: 10 });

paymentsRouter.post('/track', trackLimiter, route(async (req, res) => {
  const number = Number(req.body?.order_number);
  const email = String(req.body?.email ?? '').trim();

  /* One message for "no such order" and for "wrong email", so the endpoint
     cannot be used to discover which order numbers exist. */
  const nope = () => fail(res, 404, 'No order matches that number and email address');

  if (!Number.isInteger(number) || number <= 0 || !email) return nope();

  const { data: order } = await admin
    .from('orders')
    .select(`
      id, order_number, email, status, payment_status, currency,
      subtotal_cents, shipping_cents, total_cents, shipping_address,
      placed_at, paid_at, courier, tracking_number, tracking_url,
      order_items ( title_snapshot, variant_snapshot, qty, unit_price_cents, line_total_cents )
    `)
    .eq('order_number', number)
    .maybeSingle();

  if (!order || order.email.toLowerCase() !== email.toLowerCase()) return nope();

  const { data: events } = await admin
    .from('order_events')
    .select('status, note, created_at')
    .eq('order_id', order.id)
    .order('created_at');

  /* the address holds a name and phone the shopper does not need read back */
  const { shipping_address: address, email: _hidden, id: _id, ...rest } = order;

  res.json({
    ...rest,
    city: address?.city ?? null,
    events: events ?? []
  });
}));
