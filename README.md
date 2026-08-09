# Chic Colombo — storefront

Static storefront + Supabase-backed API.

```
chic-colombo/
├── index.html            storefront markup
├── admin.html            admin panel
├── styles.css            theme (brown palette, Sri Lankan motifs, animations)
├── script.js             UI behaviour, renders catalogue
├── config.js             where the browser finds the API and Supabase
├── api.js                API client (degrades gracefully when offline)
├── vercel.json           clean URLs, so /admin serves admin.html
├── package.json          deps + scripts for the whole project
├── api/
│   └── [[...path]].js    Vercel entry point — hands /api/* to the Express app
├── assets/
│   ├── hero-veranda.png  hero photograph
│   └── logo.png          ← YOU NEED TO ADD THIS (see below)
├── supabase/
│   ├── 01_schema.sql     tables, RLS, checkout function
│   ├── 02_seed.sql       catalogue seed
│   ├── 03_admin.sql      admins, hero slides, settings
│   ├── 04_storage.sql    media bucket + storage policies
│   └── setup_all.sql     all four concatenated, for one-shot setup
└── server/
    ├── app.js            the Express app — every route lives here
    ├── index.js          local dev listener (production uses api/ instead)
    ├── admin.js          /api/admin routes
    ├── db.js             Supabase clients
    ├── env.js            loads server/.env whatever the working directory
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

**Already applied** to the `Chi colombo` project (`dvvpwmmhybttrijbnakf`). This
section is for rebuilding it, or setting up a second environment.

Either paste `supabase/setup_all.sql` into the dashboard **SQL Editor**, or
apply it over the Management API:

```powershell
$env:SUPABASE_ACCESS_TOKEN = "sbp_..."   # supabase.com/dashboard/account/tokens
$env:SUPABASE_PROJECT_REF  = "dvvpwmmhybttrijbnakf"
node supabase/apply.mjs
```

`setup_all.sql` is generated from `01_schema.sql` + `02_seed.sql` +
`03_admin.sql`; edit those and regenerate rather than editing it directly. Every
insert is guarded, so re-running is safe.

**Before a fresh run, change the seeded admin email** in `03_admin.sql` — it
inserts `methullakvindu5@gmail.com` into `site_admins`.

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
npm install      # from the repo root — there is one package.json now
npm start        # API on :8787
npm run serve    # storefront on :4321, in another terminal
```

`server/.env` is already populated with this project's URL and keys. On a fresh
clone, `cp server/.env.example server/.env` and fill it from Supabase → Project
Settings → API. `server/env.js` loads it by absolute path, so the scripts work
from any directory.

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

Admin-only, all under `/api/admin` and gated by `site_admins`:

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/admin/uploads/sign` | `{ filename, content_type, folder, size }` → signed upload URL |
| `POST` | `/api/admin/uploads/discard` | `{ url }`, drops an unreferenced object |
| `GET` | `/api/admin/products/:id/images` | ordered by position |
| `POST` | `/api/admin/products/:id/images` | `{ url, alt }`, appended last |
| `POST` | `/api/admin/products/:id/images/reorder` | `{ order: [id, …] }` |
| `DELETE` | `/api/admin/images/:id` | removes the row *and* the stored file |

Writes are rate limited to 30/min per IP. Stock is re-checked on every cart
mutation *and* again inside the checkout transaction.

`/api/newsletter` returns the same response whether or not the address was
already subscribed, so it can't be used to probe for known emails.

---

## 4. Admin panel

Open `admin.html`. The project URL and **anon** key are already filled in near
the top of `admin.js` — the anon key is meant to be public and RLS still
applies. Override them per-environment by setting `window.CHIC_SUPABASE_URL` /
`window.CHIC_SUPABASE_ANON_KEY` before the script runs.

The master admin account already exists and is linked in `site_admins`. To add
another, or to reset the password on this one:

```bash
npm run create-admin
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
| Products & stock | edit title, handle, price, status, audience; ±1/±10 or set-exact stock per variant, logged to `stock_movements`; drag photos in to upload, drag them around to reorder |
| Hero slider | add/edit/reorder/delete image **and video** slides, set copy and buttons, toggle live; drop a file to upload the media or the video poster |
| Orders | filter by status, change status |
| Contact & social | phone, WhatsApp, hotline, emails, address, maps link, shipping rates, announcement bar copy, social links |
| Subscribers | list + CSV export |

Products are **archived, not deleted** (order history references their
variants), and variants are deactivated rather than removed.

### Media

Every image and video field is a dropzone — drag a file onto it, or click to
open a picker. Files go to the public `media` bucket created by
`04_storage.sql`, under `products/`, `hero/` or `posters/`.

The bytes never pass through the API server. It issues a **signed, single-use
upload URL** scoped to one path it chooses itself, and the browser PUTs straight
to Supabase Storage — otherwise a 40 MB hero video would be buffered in the
server's memory on the way through. The client cannot pick the destination path.

Limits are 50 MB per file (the project ceiling on the free plan) and a MIME
allow-list enforced in `server/admin.js` *and* by the bucket itself. **SVG is
refused**: the bucket is world-readable, so an uploaded SVG would be a stored
XSS payload served from the project's own domain.

For products, image order is what the storefront reads — position 0 is the card
front and position 1 is the hover image. Drag the thumbnails to change it.
Deleting a photo removes the stored file as well.

---

## 5. Frontend

```bash
npx --yes serve "carnage-replica" -l 4321
```

The page renders its built-in catalogue immediately, then calls
`/api/health`. If the API answers, the live catalogue replaces the static
rails and `<html>` gets `.api-live`. If not, the built-in data stays and the
site keeps working. **The backend is optional for the page to run.**

Point the client elsewhere by setting `window.CHIC_API_BASE` before `config.js`
— an explicit value always wins over the automatic one.

---

## 6. Deployment (Vercel)

The storefront and the API deploy together, from the same repo, to the same
origin. No build step: Vercel serves the repo root as static files and turns
`api/[[...path]].js` into one serverless function that handles every `/api/*`
request.

Three pieces make that work, and each is load-bearing:

| | |
|---|---|
| `api/[[...path]].js` | The optional-catch-all filename is deliberate. It leaves the full path on `req.url`, so the routes in `server/app.js` (`/api/products`, `/api/cart/:id`) keep matching. A plain `api/index.js` would deliver `/api` instead and every route would 404. |
| `vercel.json` | `cleanUrls: true` is why `/admin` serves `admin.html`. Without it that URL 404s. |
| `config.js` | Resolves the API base to `''` (same origin) anywhere but localhost. Same origin also means CORS never comes into it. |

Set these in **Project Settings → Environment Variables**:

```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
CORS_ORIGIN                  # your deployed origin; same-origin needs no entry
```

> `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. It belongs in the environment only —
> never in `config.js` or any file the browser downloads.

`server/app.js` sets `trust proxy` to 1. Behind Vercel's edge every request
otherwise appears to come from the same address, and the rate limiter would
treat all visitors as one client and throttle the whole site.

After deploying, check `/api/health` returns `{"ok":true,"db":"ok"}` and that
`/admin` loads the panel.

### The rate limiter is best-effort in production

`express-rate-limit` keeps its counters in memory. Serverless instances come and
go and don't share state, so the 30/min budget is per-instance rather than
global. It still blunts a naive flood; it is not a real defence. Moving the
counters into Postgres or Upstash is the fix if that day comes.

---

## Not done yet

- **No payment provider.** `checkout_cart()` writes orders as `pending`. Wire
  Stripe/PayHere and flip to `paid` on webhook confirmation.
- **No auth UI.** The schema and `/api/orders` support signed-in customers, but
  the page has no login screen.
- **Product cards fall back to gradients.** Real photography renders as soon as
  a product has images; products without any keep the woven gradient placeholder.
- **Admin writes have not been exercised.** Sign-in, sign-out and all six
  sections were driven in a real browser against live data, and the read side
  of every `/api/admin` route is verified. Creating a product, editing a hero
  slide and saving contact settings have not been run end to end.
- **Uploads abandoned mid-edit leak an object.** Dropping a file on a hero
  slide uploads it immediately, but the slide only points at it once you press
  Save. Navigate away in between and the object stays in the bucket with
  nothing referencing it. `POST /api/admin/uploads/discard` exists for this;
  the panel does not call it yet.
- **No image transformation.** Uploads are stored and served at their original
  size, so a 12 MP camera file is what the storefront downloads. Supabase
  image transformations are enabled on the project but unused.
