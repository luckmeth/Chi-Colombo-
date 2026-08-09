# Chic Colombo — storefront

Static storefront + Supabase-backed API.

```
carnage-replica/
├── index.html            storefront markup
├── styles.css            theme (brown palette, Sri Lankan motifs, animations)
├── script.js             UI behaviour, renders catalogue
├── api.js                API client (degrades gracefully when offline)
├── assets/
│   ├── hero-veranda.png  hero photograph
│   └── logo.png          ← YOU NEED TO ADD THIS (see below)
├── supabase/
│   ├── 01_schema.sql     tables, RLS, checkout function
│   └── 02_seed.sql       catalogue seed
└── server/
    ├── index.js          Express API
    ├── db.js             Supabase clients
    └── .env.example      copy to .env
```

---

## 1. The logo

`assets/logo.png` **does not exist yet.** The header and footer currently show a
hand-drawn SVG approximation, which is *not* your real logo.

Save your logo — ideally with the background removed — to:

```
carnage-replica/assets/logo.png
```

`script.js` probes for that file on load. When it's there, it swaps in
automatically and deletes the SVG stand-ins. No code changes needed.

---

## 2. Database

In the Supabase dashboard → **SQL Editor**, run in order:

1. `supabase/01_schema.sql`
2. `supabase/02_seed.sql`
3. `supabase/03_admin.sql`

**Before running `03_admin.sql`, change the seeded admin email** near the top —
it currently inserts `methullakvindu5@gmail.com` into `site_admins`.

`03_admin.sql` adds `site_admins`, `hero_slides`, `app_settings`,
`social_links` and `stock_movements`, plus the `is_admin()` predicate and the
admin-write RLS policies for the catalogue.

`01_schema.sql` creates:

| Table | Purpose |
|---|---|
| `collections` | categories, destinations, featured edits |
| `products` / `product_variants` / `product_images` | catalogue, per-variant stock |
| `collection_products` | membership join |
| `customers` / `addresses` | auto-created on signup via trigger |
| `carts` / `cart_items` | guest (session token) and member carts |
| `orders` / `order_items` | line items snapshot title + price |
| `newsletter_subscribers` | insert-only |

Plus the `product_cards` view and the `checkout_cart()` function.

**Money is integer cents.** `price_cents = 455000` is LKR 4,550.00. No floats.

### Row Level Security

RLS is on for every table.

- Catalogue is world-readable, but only where `status = 'active'`.
- Customers, addresses, orders: owner-only via `auth.uid()`.
- Newsletter: anyone may insert, **nobody** may select.
- Carts: policies cover signed-in users only. **Guest carts are deliberately
  invisible to RLS** — a policy matching on a guest `session_token` would let
  anyone read any cart by guessing tokens, so guest carts are only reachable
  through the API using the service-role key, which validates ownership per
  request in `ownsCart()`.

### Why checkout is a database function

`checkout_cart()` does the stock check, order write and inventory decrement in
one transaction, and takes `FOR UPDATE` locks on the variant rows first. Doing
this in application code lets two simultaneous checkouts both pass the stock
check and oversell the last unit.

It raises distinct error codes the API maps to HTTP:

| Code | Meaning | HTTP |
|---|---|---|
| `P0001` | cart empty | 400 |
| `P0002` | cart missing / already converted | 404 |
| `P0003` | insufficient stock | 409 |

---

## 3. API server

```bash
cd carnage-replica/server
npm install
cp .env.example .env      # then fill in your keys
npm start
```

Keys are in Supabase → Project Settings → API.

> `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. Server-side only — never ship it to
> the browser. `.gitignore` already excludes `.env`.

### Endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/health` | checks DB reachability |
| `GET` | `/api/products` | `?collection=` `?audience=` `?limit=` |
| `GET` | `/api/products/:handle` | includes variants + images |
| `GET` | `/api/collections` | `?kind=category\|destination\|featured` |
| `POST` | `/api/cart` | creates/returns cart, issues `x-cart-token` |
| `GET` | `/api/cart/:cartId` | line items + subtotal |
| `POST` | `/api/cart/:cartId/items` | `{ variant_id, qty }` |
| `PATCH` | `/api/cart/:cartId/items/:itemId` | `{ qty }`, `0` removes |
| `DELETE` | `/api/cart/:cartId/items/:itemId` | |
| `POST` | `/api/checkout` | `{ cart_id, email, address, shipping_cents }` |
| `GET` | `/api/orders` | requires `Authorization: Bearer <token>` |
| `POST` | `/api/newsletter` | `{ email }` |

Writes are rate limited to 30/min per IP. Stock is re-checked on every cart
mutation *and* again inside the checkout transaction.

`/api/newsletter` returns the same response whether or not the address was
already subscribed, so it can't be used to probe for known emails.

---

## 4. Admin panel

Open `admin.html`. Before first use, set your project values near the top of
`admin.js`:

```js
const SUPABASE_URL      = 'https://YOUR-PROJECT-REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';
```

Only the **anon** key goes here — it's meant to be public and RLS still applies.

Then create the admin login:

```bash
cd carnage-replica/server && npm run create-admin
```

It prompts for the email and password (hidden as you type), creates the
pre-confirmed auth account, and links it into `site_admins` in one step. The
password goes straight to Supabase — never to disk, an env var, or your shell
history. Safe to re-run: an existing account is linked rather than duplicated.

Doing it by hand instead: Supabase → Authentication → Users → Add user, tick
**Auto Confirm User**, then make sure that address is in `site_admins`.

### How admin access is gated

Same convention as nexabill: `site_admins` is matched on `user_id` **or**
`email`, so a master admin is recognised whether they signed in with a password
or an OAuth provider. The check runs server-side in `server/admin.js` using the
service-role key — the browser never holds it, and hiding the UI is not the
security boundary. `is_admin()` enforces the same rule again at the RLS layer.

| Section | What you can do |
|---|---|
| Overview | product/order/subscriber counts, revenue, low-stock list |
| Products & stock | edit title, handle, price, status, audience; ±1/±10 or set-exact stock per variant, logged to `stock_movements` |
| Hero slider | add/edit/reorder/delete image **and video** slides, set copy and buttons, toggle live |
| Orders | filter by status, change status |
| Contact & social | phone, WhatsApp, hotline, emails, address, maps link, shipping rates, announcement bar copy, social links |
| Subscribers | list + CSV export |

Products are **archived, not deleted** (order history references their
variants), and variants are deactivated rather than removed.

---

## 5. Frontend

```bash
npx --yes serve "carnage-replica" -l 4321
```

The page renders its built-in catalogue immediately, then calls
`/api/health`. If the API answers, the live catalogue replaces the static
rails and `<html>` gets `.api-live`. If not, the built-in data stays and the
site keeps working. **The backend is optional for the page to run.**

Point the client elsewhere by setting `window.CHIC_API_BASE` before `api.js`.

---

## Not done yet

- **No payment provider.** `checkout_cart()` writes orders as `pending`. Wire
  Stripe/PayHere and flip to `paid` on webhook confirmation.
- **No auth UI.** The schema and `/api/orders` support signed-in customers, but
  the page has no login screen.
- **Product images are CSS gradients.** `product_images` exists and
  `product_cards` exposes `primary_image` / `hover_image`; the card renderer
  still draws placeholder gradients. Swap when you have photography.
- **SQL is unexecuted.** It was written against the Postgres/Supabase docs but
  not run — I had no database to run it against. Expect to fix small things on
  first execution. This covers all three files, including `03_admin.sql`.
- **The admin panel has never talked to a live backend.** Its markup, routing,
  rendering and gate logic were verified in the browser, and every JS file
  parses clean, but no request has actually reached Supabase.
- **No media upload.** Hero slides take a path or URL you type in; put files in
  `assets/` yourself, or point at Supabase Storage. There is no file picker.
