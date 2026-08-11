-- =========================================================
-- Chic Colombo — complete setup, generated from:
--   01_schema.sql  02_seed.sql  03_admin.sql  04_storage.sql  05_content.sql  06_payments.sql
--
-- Paste this whole file into Supabase -> SQL Editor and Run.
-- Safe to re-run: every insert is guarded.
--
-- BEFORE RUNNING: change the admin email in the site_admins
-- insert further down to the address you will sign in with.
-- =========================================================

-- ============================================================
-- SOURCE: 01_schema.sql
-- ============================================================

-- =========================================================
-- Chic Colombo — storefront schema (Supabase / Postgres)
-- Run this first, then 02_seed.sql
--
-- Money is stored as integer cents (LKR) to avoid float drift.
-- =========================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------------------------------------------------------
-- Enums
-- ---------------------------------------------------------
do $$ begin
  create type product_status as enum ('draft', 'active', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type audience as enum ('mens', 'womens', 'unisex');
exception when duplicate_object then null; end $$;

do $$ begin
  create type collection_kind as enum ('category', 'destination', 'featured');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum ('pending', 'paid', 'fulfilled', 'cancelled', 'refunded');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------
-- Collections
-- ---------------------------------------------------------
create table if not exists collections (
  id          uuid primary key default gen_random_uuid(),
  handle      text unique not null,
  title       text not null,
  description text,
  kind        collection_kind not null default 'category',
  audience    audience not null default 'unisex',
  image_url   text,
  position    int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists collections_kind_idx on collections (kind, audience, position);

drop trigger if exists collections_updated_at on collections;
create trigger collections_updated_at
  before update on collections
  for each row execute function set_updated_at();

-- ---------------------------------------------------------
-- Products
-- ---------------------------------------------------------
create table if not exists products (
  id               uuid primary key default gen_random_uuid(),
  handle           text unique not null,
  title            text not null,
  description      text,
  status           product_status not null default 'active',
  audience         audience not null default 'unisex',
  currency         char(3) not null default 'LKR',
  price_cents      int not null check (price_cents >= 0),
  compare_at_cents int check (compare_at_cents >= 0),
  is_new           boolean not null default false,
  position         int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- a sale price must actually be lower than the struck-through price
  constraint compare_at_gt_price
    check (compare_at_cents is null or compare_at_cents > price_cents)
);

create index if not exists products_status_idx on products (status, audience, position);

drop trigger if exists products_updated_at on products;
create trigger products_updated_at
  before update on products
  for each row execute function set_updated_at();

-- ---------------------------------------------------------
-- Variants — colour / size, each with its own stock
-- ---------------------------------------------------------
create table if not exists product_variants (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products (id) on delete cascade,
  sku           text unique,
  colour_name   text not null,
  colour_hex    char(7),
  size          text not null default 'OS',
  price_cents   int check (price_cents >= 0),   -- null inherits the product price
  inventory_qty int not null default 0 check (inventory_qty >= 0),
  position      int not null default 0,
  is_active     boolean not null default true,

  unique (product_id, colour_name, size)
);

create index if not exists variants_product_idx on product_variants (product_id, position);

-- ---------------------------------------------------------
-- Images
-- ---------------------------------------------------------
create table if not exists product_images (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  url        text not null,
  alt        text,
  position   int not null default 0
);

create index if not exists images_product_idx on product_images (product_id, position);

-- ---------------------------------------------------------
-- Product <-> Collection
-- ---------------------------------------------------------
create table if not exists collection_products (
  collection_id uuid not null references collections (id) on delete cascade,
  product_id    uuid not null references products (id) on delete cascade,
  position      int not null default 0,
  primary key (collection_id, product_id)
);

create index if not exists collection_products_product_idx on collection_products (product_id);

-- ---------------------------------------------------------
-- Customers — mirrors auth.users
-- ---------------------------------------------------------
create table if not exists customers (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      citext unique not null,
  full_name  text,
  phone      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists customers_updated_at on customers;
create trigger customers_updated_at
  before update on customers
  for each row execute function set_updated_at();

-- auto-create a customer row on signup
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.customers (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------
-- Addresses
-- ---------------------------------------------------------
create table if not exists addresses (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references customers (id) on delete cascade,
  full_name    text not null,
  line1        text not null,
  line2        text,
  city         text not null,
  district     text,
  postal_code  text,
  country      char(2) not null default 'LK',
  phone        text,
  is_default   boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists addresses_customer_idx on addresses (customer_id);

-- ---------------------------------------------------------
-- Carts — guests use session_token, members use customer_id
-- ---------------------------------------------------------
create table if not exists carts (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid references customers (id) on delete cascade,
  session_token text unique,
  status        text not null default 'open' check (status in ('open', 'converted', 'abandoned')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- a cart belongs to someone: a customer, a guest session, or both
  constraint cart_has_owner check (customer_id is not null or session_token is not null)
);

create index if not exists carts_customer_idx on carts (customer_id) where customer_id is not null;

drop trigger if exists carts_updated_at on carts;
create trigger carts_updated_at
  before update on carts
  for each row execute function set_updated_at();

create table if not exists cart_items (
  id         uuid primary key default gen_random_uuid(),
  cart_id    uuid not null references carts (id) on delete cascade,
  variant_id uuid not null references product_variants (id) on delete restrict,
  qty        int not null default 1 check (qty > 0),
  added_at   timestamptz not null default now(),

  unique (cart_id, variant_id)
);

create index if not exists cart_items_cart_idx on cart_items (cart_id);

-- ---------------------------------------------------------
-- Orders
-- ---------------------------------------------------------
create table if not exists orders (
  id               uuid primary key default gen_random_uuid(),
  order_number     bigint generated by default as identity (start with 1001),
  customer_id      uuid references customers (id) on delete set null,
  email            citext not null,
  status           order_status not null default 'pending',
  currency         char(3) not null default 'LKR',
  subtotal_cents   int not null check (subtotal_cents >= 0),
  shipping_cents   int not null default 0 check (shipping_cents >= 0),
  discount_cents   int not null default 0 check (discount_cents >= 0),
  total_cents      int not null check (total_cents >= 0),
  shipping_address jsonb,
  note             text,
  placed_at        timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists orders_number_idx on orders (order_number);
create index if not exists orders_customer_idx on orders (customer_id, placed_at desc);

drop trigger if exists orders_updated_at on orders;
create trigger orders_updated_at
  before update on orders
  for each row execute function set_updated_at();

-- line items snapshot title/price so history survives catalogue edits
create table if not exists order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references orders (id) on delete cascade,
  variant_id       uuid references product_variants (id) on delete set null,
  title_snapshot   text not null,
  variant_snapshot text,
  sku_snapshot     text,
  unit_price_cents int not null check (unit_price_cents >= 0),
  qty              int not null check (qty > 0),
  line_total_cents int not null check (line_total_cents >= 0)
);

create index if not exists order_items_order_idx on order_items (order_id);

-- ---------------------------------------------------------
-- Newsletter
-- ---------------------------------------------------------
create table if not exists newsletter_subscribers (
  id              uuid primary key default gen_random_uuid(),
  email           citext unique not null,
  source          text default 'footer',
  subscribed_at   timestamptz not null default now(),
  unsubscribed_at timestamptz
);

-- ---------------------------------------------------------
-- Storefront read view — one row per product card
-- ---------------------------------------------------------
create or replace view product_cards
with (security_invoker = true)
as
select
  p.id,
  p.handle,
  p.title,
  p.audience,
  p.currency,
  p.price_cents,
  p.compare_at_cents,
  p.is_new,
  p.position,
  coalesce(
    (select pi.url from product_images pi
      where pi.product_id = p.id order by pi.position limit 1),
    null
  ) as primary_image,
  coalesce(
    (select pi.url from product_images pi
      where pi.product_id = p.id order by pi.position offset 1 limit 1),
    null
  ) as hover_image,
  (select v.colour_name from product_variants v
    where v.product_id = p.id and v.is_active order by v.position limit 1) as default_colour,
  coalesce((select sum(v.inventory_qty) from product_variants v
    where v.product_id = p.id), 0) as total_inventory
from products p
where p.status = 'active';

-- ---------------------------------------------------------
-- Checkout — one atomic call: validate stock, decrement, write order
-- ---------------------------------------------------------
create or replace function checkout_cart(
  p_cart_id  uuid,
  p_email    citext,
  p_address  jsonb default null,
  p_shipping int default 0
)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    orders;
  v_subtotal int;
  v_item     record;
begin
  if not exists (select 1 from carts where id = p_cart_id and status = 'open') then
    raise exception 'Cart % is not open', p_cart_id using errcode = 'P0002';
  end if;

  if not exists (select 1 from cart_items where cart_id = p_cart_id) then
    raise exception 'Cart % is empty', p_cart_id using errcode = 'P0001';
  end if;

  -- lock the variants so two concurrent checkouts cannot oversell
  perform 1
  from cart_items ci
  join product_variants v on v.id = ci.variant_id
  where ci.cart_id = p_cart_id
  for update of v;

  -- stock check before any mutation
  for v_item in
    select ci.variant_id, ci.qty, v.inventory_qty, p.title, v.colour_name
    from cart_items ci
    join product_variants v on v.id = ci.variant_id
    join products p on p.id = v.product_id
    where ci.cart_id = p_cart_id
  loop
    if v_item.inventory_qty < v_item.qty then
      raise exception 'Insufficient stock for % (%): % left, % requested',
        v_item.title, v_item.colour_name, v_item.inventory_qty, v_item.qty
        using errcode = 'P0003';
    end if;
  end loop;

  select sum(coalesce(v.price_cents, p.price_cents) * ci.qty)
    into v_subtotal
  from cart_items ci
  join product_variants v on v.id = ci.variant_id
  join products p on p.id = v.product_id
  where ci.cart_id = p_cart_id;

  insert into orders (customer_id, email, subtotal_cents, shipping_cents,
                      total_cents, shipping_address, status)
  select c.customer_id, p_email, v_subtotal, p_shipping,
         v_subtotal + p_shipping, p_address, 'pending'
  from carts c where c.id = p_cart_id
  returning * into v_order;

  insert into order_items (order_id, variant_id, title_snapshot, variant_snapshot,
                           sku_snapshot, unit_price_cents, qty, line_total_cents)
  select
    v_order.id,
    v.id,
    p.title,
    v.colour_name || ' / ' || v.size,
    v.sku,
    coalesce(v.price_cents, p.price_cents),
    ci.qty,
    coalesce(v.price_cents, p.price_cents) * ci.qty
  from cart_items ci
  join product_variants v on v.id = ci.variant_id
  join products p on p.id = v.product_id
  where ci.cart_id = p_cart_id;

  update product_variants v
     set inventory_qty = v.inventory_qty - ci.qty
    from cart_items ci
   where ci.variant_id = v.id and ci.cart_id = p_cart_id;

  update carts set status = 'converted' where id = p_cart_id;

  return v_order;
end;
$$;

-- checkout_cart is SECURITY DEFINER, so it bypasses RLS by design. PostgREST
-- exposes every public function as an RPC endpoint, which would let anyone
-- POST /rpc/checkout_cart with a cart id and convert a cart that isn't theirs.
-- Lock it to the service role; the API validates ownership before calling it.
revoke all on function checkout_cart(uuid, citext, jsonb, int) from public;
revoke all on function checkout_cart(uuid, citext, jsonb, int) from anon, authenticated;
grant execute on function checkout_cart(uuid, citext, jsonb, int) to service_role;

-- =========================================================
-- Row Level Security
-- =========================================================

alter table collections            enable row level security;
alter table products               enable row level security;
alter table product_variants       enable row level security;
alter table product_images         enable row level security;
alter table collection_products    enable row level security;
alter table customers              enable row level security;
alter table addresses              enable row level security;
alter table carts                  enable row level security;
alter table cart_items             enable row level security;
alter table orders                 enable row level security;
alter table order_items            enable row level security;
alter table newsletter_subscribers enable row level security;

-- ---- catalogue: world-readable, writes are service-role only ----
drop policy if exists "catalogue readable" on products;
create policy "catalogue readable" on products
  for select using (status = 'active');

drop policy if exists "collections readable" on collections;
create policy "collections readable" on collections
  for select using (is_active);

drop policy if exists "variants readable" on product_variants;
create policy "variants readable" on product_variants
  for select using (
    is_active and exists (
      select 1 from products p where p.id = product_id and p.status = 'active'
    )
  );

drop policy if exists "images readable" on product_images;
create policy "images readable" on product_images
  for select using (
    exists (select 1 from products p where p.id = product_id and p.status = 'active')
  );

drop policy if exists "collection_products readable" on collection_products;
create policy "collection_products readable" on collection_products
  for select using (true);

-- ---- customers: only your own row ----
drop policy if exists "own customer row" on customers;
create policy "own customer row" on customers
  for select using (auth.uid() = id);

drop policy if exists "update own customer row" on customers;
create policy "update own customer row" on customers
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own addresses" on addresses;
create policy "own addresses" on addresses
  for all using (auth.uid() = customer_id) with check (auth.uid() = customer_id);

-- ---- carts: signed-in users only.
-- Guest carts carry no customer_id, so they are invisible under RLS and must be
-- driven by the API using the service-role key. That is deliberate: a guest
-- session_token in a public policy would let anyone read any cart by guessing.
drop policy if exists "own cart" on carts;
create policy "own cart" on carts
  for all using (auth.uid() = customer_id) with check (auth.uid() = customer_id);

drop policy if exists "own cart items" on cart_items;
create policy "own cart items" on cart_items
  for all using (
    exists (select 1 from carts c where c.id = cart_id and c.customer_id = auth.uid())
  ) with check (
    exists (select 1 from carts c where c.id = cart_id and c.customer_id = auth.uid())
  );

-- ---- orders: read your own history; creation goes through checkout_cart ----
drop policy if exists "own orders" on orders;
create policy "own orders" on orders
  for select using (auth.uid() = customer_id);

drop policy if exists "own order items" on order_items;
create policy "own order items" on order_items
  for select using (
    exists (select 1 from orders o where o.id = order_id and o.customer_id = auth.uid())
  );

-- ---- newsletter: anyone may subscribe, nobody may read the list ----
drop policy if exists "anyone can subscribe" on newsletter_subscribers;
create policy "anyone can subscribe" on newsletter_subscribers
  for insert with check (true);


-- ============================================================
-- SOURCE: 02_seed.sql
-- ============================================================

-- =========================================================
-- Chic Colombo — seed data
-- Mirrors the catalogue currently hardcoded in script.js.
-- Safe to re-run: every insert is idempotent on its natural key.
-- =========================================================

-- ---------------------------------------------------------
-- Collections
-- ---------------------------------------------------------
insert into collections (handle, title, kind, audience, position) values
  ('latest',            'Shop the Latest Styles', 'featured',    'unisex',  0),
  ('accessories',       'Accessories',            'featured',    'unisex',  1),
  ('leopard-capsule',   'The Leopard Capsule',    'featured',    'unisex',  2),
  ('batik-edit',        'Batik Edit',             'featured',    'unisex',  3),

  ('w-linen-sets',      'Linen Sets',             'category',    'womens',  0),
  ('w-trousers',        'Trousers',               'category',    'womens',  1),
  ('w-crop-tops',       'Crop Tops',              'category',    'womens',  2),
  ('w-tshirts',         'Tshirts',                'category',    'womens',  3),
  ('w-sarongs',         'Sarongs',                'category',    'womens',  4),

  ('m-tshirts',         'Tshirts',                'category',    'mens',    0),
  ('m-trousers',        'Trousers',               'category',    'mens',    1),
  ('m-linen-shirts',    'Linen Shirts',           'category',    'mens',    2),
  ('m-shorts',          'Shorts',                 'category',    'mens',    3),
  ('m-polos',           'Polos',                  'category',    'mens',    4),

  ('d-galle-face',      'Galle Face',             'destination', 'unisex',  0),
  ('d-cinnamon-gardens','Cinnamon Gardens',       'destination', 'unisex',  1),
  ('d-pettah',          'Pettah',                 'destination', 'unisex',  2),
  ('d-arugam-bay',      'Arugam Bay',             'destination', 'unisex',  3),
  ('d-mirissa',         'Mirissa',                'destination', 'unisex',  4),
  ('d-ella',            'Ella',                   'destination', 'unisex',  5)
on conflict (handle) do nothing;

-- ---------------------------------------------------------
-- Products  (price_cents = LKR x 100)
-- ---------------------------------------------------------
insert into products (handle, title, audience, price_cents, is_new, position, description) values
  ('ceylon-ringer-tee',    'Ceylon Ringer Tee',    'unisex', 455000, false, 0,
   'Heavyweight combed cotton with a contrast ringer collar and cuff.'),
  ('monsoon-track-jacket', 'Monsoon Track Jacket', 'unisex', 945000, true,  1,
   'Water-repellent shell cut for humid evenings.'),
  ('sarong-short',         'Sarong Short',         'unisex', 375000, false, 2,
   'Relaxed drawstring short in washed cotton poplin.'),
  ('galle-face-linen-set', 'Galle Face Linen Set', 'womens', 645000, true,  3,
   'Matching linen shirt and trouser, breathable and unlined.'),
  ('leopard-crest-tee',    'Leopard Crest Tee',    'unisex', 545000, true,  4,
   'Our house leopard, hand-drawn and screen printed in small runs.'),
  ('mirissa-crew-tank',    'Mirissa Crew Tank',    'unisex', 465000, true,  5,
   'Ribbed cotton tank with a dropped armhole.'),
  ('colombo-longline-tee', 'Colombo Longline Tee', 'unisex', 445000, true,  6,
   'Longline body in airy single jersey.'),
  ('pettah-panel-tank',    'Pettah Panel Tank',    'unisex', 585000, false, 7,
   'Panelled tank with batik-inspired piping.'),

  ('batik-tote',           'Batik Tote',           'unisex', 550000, false, 8,
   'Hand-dyed batik canvas tote, cotton webbing handles.'),
  ('palm-cap',             'Palm Cap',             'unisex', 365000, false, 9,
   'Six-panel cotton cap with an embroidered palm.'),
  ('woven-belt',           'Woven Belt',           'unisex', 420000, false, 10,
   'Elastic woven belt with a brass roller buckle.'),
  ('island-sandals',       'Island Sandals',       'unisex', 750000, true,  11,
   'Moulded footbed sandal with a leather-look strap.')
on conflict (handle) do nothing;

-- ---------------------------------------------------------
-- Variants — colourway per product, S/M/L/XL for apparel
-- ---------------------------------------------------------
with sized as (
  select p.id, p.handle, c.colour_name, c.colour_hex, s.size, s.pos
  from products p
  join lateral (values
      ('ceylon-ringer-tee',    'Palm Green',   '#5C6B4A'),
      ('monsoon-track-jacket', 'Ceylon Brown', '#8A5626'),
      ('sarong-short',         'Coconut',      '#F0E4D0'),
      ('galle-face-linen-set', 'Coconut',      '#F0E4D0'),
      ('leopard-crest-tee',    'Ceylon Brown', '#8A5626'),
      ('mirissa-crew-tank',    'Monsoon Grey', '#7A6350'),
      ('colombo-longline-tee', 'Coconut',      '#F0E4D0'),
      ('pettah-panel-tank',    'Indigo Batik', '#2E3A4A')
    ) as c(handle, colour_name, colour_hex) on c.handle = p.handle
  join lateral (values ('S',0), ('M',1), ('L',2), ('XL',3)) as s(size, pos) on true
)
insert into product_variants (product_id, sku, colour_name, colour_hex, size, inventory_qty, position)
select
  id,
  upper(replace(handle, '-', '')) || '-' || size,
  colour_name,
  colour_hex,
  size,
  25,
  pos
from sized
on conflict (product_id, colour_name, size) do nothing;

-- accessories are one-size
insert into product_variants (product_id, sku, colour_name, colour_hex, size, inventory_qty, position)
select
  p.id,
  upper(replace(p.handle, '-', '')) || '-OS',
  c.colour_name,
  c.colour_hex,
  'OS',
  40,
  0
from products p
join lateral (values
    ('batik-tote',     'Indigo Batik', '#2E3A4A'),
    ('palm-cap',       'Ceylon Brown', '#8A5626'),
    ('woven-belt',     'Leopard Tan',  '#B4703A'),
    ('island-sandals', 'Coconut',      '#F0E4D0')
  ) as c(handle, colour_name, colour_hex) on c.handle = p.handle
on conflict (product_id, colour_name, size) do nothing;

-- ---------------------------------------------------------
-- Collection membership
-- ---------------------------------------------------------
insert into collection_products (collection_id, product_id, position)
select c.id, p.id, p.position
from collections c
join products p on true
where c.handle = 'latest' and p.position between 0 and 7
on conflict do nothing;

insert into collection_products (collection_id, product_id, position)
select c.id, p.id, p.position - 8
from collections c
join products p on true
where c.handle = 'accessories' and p.position between 8 and 11
on conflict do nothing;

insert into collection_products (collection_id, product_id, position)
select c.id, p.id, 0
from collections c
join products p on p.handle = 'leopard-crest-tee'
where c.handle = 'leopard-capsule'
on conflict do nothing;

insert into collection_products (collection_id, product_id, position)
select c.id, p.id, 0
from collections c
join products p on p.handle in ('pettah-panel-tank', 'batik-tote')
where c.handle = 'batik-edit'
on conflict do nothing;

-- ---------------------------------------------------------
-- Sanity check
-- ---------------------------------------------------------
do $$
declare
  n_products int;
  n_variants int;
begin
  select count(*) into n_products from products;
  select count(*) into n_variants from product_variants;
  raise notice 'Seeded % products and % variants', n_products, n_variants;
end $$;


-- ============================================================
-- SOURCE: 03_admin.sql
-- ============================================================

-- =========================================================
-- Chic Colombo — admin, hero slider, site settings
-- Run after 01_schema.sql and 02_seed.sql
--
-- Admin gating mirrors the nexabill convention: a site_admins table
-- matched by user_id OR email, so a master admin is recognised whether
-- they signed in with email/password or an OAuth provider.
-- =========================================================

-- ---------------------------------------------------------
-- Admins
-- ---------------------------------------------------------
create table if not exists site_admins (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users (id) on delete cascade,
  email      citext,
  label      text,
  created_at timestamptz not null default now(),

  constraint admin_identified check (user_id is not null or email is not null)
);

create unique index if not exists site_admins_user_idx  on site_admins (user_id) where user_id is not null;
create unique index if not exists site_admins_email_idx on site_admins (lower(email)) where email is not null;

-- Seed your master admin. Change this address before running.
insert into site_admins (email, label)
values ('methullakvindu5@gmail.com', 'Master admin')
on conflict do nothing;

-- Reusable predicate for RLS. security definer so it can read site_admins
-- regardless of the caller's own policies.
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from site_admins a
    where a.user_id = auth.uid()
       or (a.email is not null and a.email = (auth.jwt() ->> 'email')::citext)
  );
$$;

-- ---------------------------------------------------------
-- Hero slides — images and videos in one ordered list
-- ---------------------------------------------------------
do $$ begin
  create type slide_kind as enum ('image', 'video');
exception when duplicate_object then null; end $$;

create table if not exists hero_slides (
  id          uuid primary key default gen_random_uuid(),
  kind        slide_kind not null default 'image',

  media_url   text not null,          -- image src, or mp4 src when kind = 'video'
  poster_url  text,                   -- video first frame; ignored for images
  focal_point text not null default 'center center',  -- CSS object-position

  eyebrow     text,
  title       text,
  subtitle    text,

  cta_label   text,
  cta_href    text,
  cta2_label  text,
  cta2_href   text,

  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- a video slide is useless without something to play
  constraint video_needs_media check (kind <> 'video' or media_url <> '')
);

create index if not exists hero_slides_order_idx on hero_slides (is_active, sort_order);

drop trigger if exists hero_slides_updated_at on hero_slides;
create trigger hero_slides_updated_at
  before update on hero_slides
  for each row execute function set_updated_at();

-- ---------------------------------------------------------
-- Site settings — single row, edited from the admin panel
-- ---------------------------------------------------------
create table if not exists app_settings (
  id                text primary key default 'global',

  brand_name        text default 'Chic Colombo',
  tagline           text default 'Premium Apparel',

  contact_email     citext,
  support_email     citext,
  contact_phone     text,
  whatsapp_number   text,
  hotline           text,

  address_line1     text,
  address_line2     text,
  city              text default 'Colombo',
  country           char(2) default 'LK',
  google_maps_url   text,

  free_shipping_threshold_cents int default 1000000,
  flat_shipping_cents           int default 45000,
  currency          char(3) default 'LKR',

  announcements     jsonb default '[]'::jsonb,   -- marquee strings
  footer_note       text,

  updated_at        timestamptz not null default now(),

  constraint settings_singleton check (id = 'global')
);

insert into app_settings (id, contact_email, contact_phone, whatsapp_number,
                          address_line1, city, footer_note)
values ('global', 'hello@chiccolombo.lk', '+94 11 234 5678', '+94 77 123 4567',
        'Galle Face Terrace', 'Colombo', 'Cut & sewn in Colombo')
on conflict (id) do nothing;

drop trigger if exists app_settings_updated_at on app_settings;
create trigger app_settings_updated_at
  before update on app_settings
  for each row execute function set_updated_at();

-- ---------------------------------------------------------
-- Social links
-- ---------------------------------------------------------
create table if not exists social_links (
  id         uuid primary key default gen_random_uuid(),
  platform   text not null,
  url        text not null,
  icon_name  text not null,
  sort_order int not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- Seed only when empty. The PK is a generated uuid, so ON CONFLICT DO NOTHING
-- would never fire and re-running this file would duplicate every link.
insert into social_links (platform, url, icon_name, sort_order)
select * from (values
  ('Instagram', 'https://instagram.com/chiccolombo', 'instagram', 0),
  ('TikTok',    'https://tiktok.com/@chiccolombo',   'tiktok',    1),
  ('Facebook',  'https://facebook.com/chiccolombo',  'facebook',  2),
  ('YouTube',   'https://youtube.com/@chiccolombo',  'youtube',   3)
) as v(platform, url, icon_name, sort_order)
where not exists (select 1 from social_links);

-- ---------------------------------------------------------
-- Stock movements — an audit trail for every inventory change
-- ---------------------------------------------------------
create table if not exists stock_movements (
  id         uuid primary key default gen_random_uuid(),
  variant_id uuid not null references product_variants (id) on delete cascade,
  delta      int not null,
  reason     text not null default 'manual',
  note       text,
  actor      uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists stock_movements_variant_idx on stock_movements (variant_id, created_at desc);

-- Adjust stock and record why, in one call.
--
-- For use by a signed-in admin from the SQL editor or a client session: the
-- is_admin() guard reads auth.uid()/auth.jwt(), which are null under the
-- service role, so calling this from the API would always fail. The API's
-- POST /api/admin/variants/:id/stock writes the update and the movement row
-- directly instead, after its own admin check.
create or replace function adjust_stock(
  p_variant_id uuid,
  p_delta      int,
  p_reason     text default 'manual',
  p_note       text default null
)
returns product_variants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row product_variants;
begin
  if not is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;

  update product_variants
     set inventory_qty = inventory_qty + p_delta
   where id = p_variant_id
  returning * into v_row;

  if not found then
    raise exception 'Variant % not found', p_variant_id using errcode = 'P0002';
  end if;

  insert into stock_movements (variant_id, delta, reason, note, actor)
  values (p_variant_id, p_delta, p_reason, p_note, auth.uid());

  return v_row;
end;
$$;

-- =========================================================
-- RLS
-- =========================================================

alter table site_admins     enable row level security;
alter table hero_slides     enable row level security;
alter table app_settings    enable row level security;
alter table social_links    enable row level security;
alter table stock_movements enable row level security;

-- admins list: readable only by admins, never writable from the client
drop policy if exists "admins read admin list" on site_admins;
create policy "admins read admin list" on site_admins
  for select using (is_admin());

-- hero + settings + socials: world-readable where active, admin-writable
drop policy if exists "slides readable" on hero_slides;
create policy "slides readable" on hero_slides
  for select using (is_active or is_admin());

drop policy if exists "slides admin write" on hero_slides;
create policy "slides admin write" on hero_slides
  for all using (is_admin()) with check (is_admin());

drop policy if exists "settings readable" on app_settings;
create policy "settings readable" on app_settings
  for select using (true);

drop policy if exists "settings admin write" on app_settings;
create policy "settings admin write" on app_settings
  for update using (is_admin()) with check (is_admin());

drop policy if exists "socials readable" on social_links;
create policy "socials readable" on social_links
  for select using (is_active or is_admin());

drop policy if exists "socials admin write" on social_links;
create policy "socials admin write" on social_links
  for all using (is_admin()) with check (is_admin());

drop policy if exists "stock log admin only" on stock_movements;
create policy "stock log admin only" on stock_movements
  for select using (is_admin());

-- ---------------------------------------------------------
-- Admins get write access to the catalogue and read on orders.
-- 01_schema.sql only granted public read, so add the admin side here.
-- ---------------------------------------------------------
drop policy if exists "products admin write" on products;
create policy "products admin write" on products
  for all using (is_admin()) with check (is_admin());

drop policy if exists "variants admin write" on product_variants;
create policy "variants admin write" on product_variants
  for all using (is_admin()) with check (is_admin());

drop policy if exists "images admin write" on product_images;
create policy "images admin write" on product_images
  for all using (is_admin()) with check (is_admin());

drop policy if exists "collections admin write" on collections;
create policy "collections admin write" on collections
  for all using (is_admin()) with check (is_admin());

drop policy if exists "collection_products admin write" on collection_products;
create policy "collection_products admin write" on collection_products
  for all using (is_admin()) with check (is_admin());

drop policy if exists "orders admin read" on orders;
create policy "orders admin read" on orders
  for select using (is_admin());

drop policy if exists "orders admin update" on orders;
create policy "orders admin update" on orders
  for update using (is_admin()) with check (is_admin());

drop policy if exists "order items admin read" on order_items;
create policy "order items admin read" on order_items
  for select using (is_admin());

drop policy if exists "subscribers admin read" on newsletter_subscribers;
create policy "subscribers admin read" on newsletter_subscribers
  for select using (is_admin());

-- ---------------------------------------------------------
-- Default hero slides, mirroring what the page ships with
-- ---------------------------------------------------------
-- Same reasoning as social_links: guard on emptiness, not ON CONFLICT.
insert into hero_slides (kind, media_url, poster_url, eyebrow, title, subtitle,
                         cta_label, cta_href, cta2_label, cta2_href, sort_order)
select * from (values
  ('image'::slide_kind, 'assets/hero-veranda.png', null::text,
   'PREMIUM APPAREL · MADE IN SRI LANKA', 'Island State of Mind',
   'Made on the island, worn everywhere. Breathable cotton and linen built for the heat.',
   'SHOP MENS', '/shop?audience=mens', 'SHOP WOMENS', '/shop?audience=womens', 0),
  ('video'::slide_kind, 'assets/brand-film.mp4', 'assets/video-poster.jpg',
   'THE FILM', 'An Evening in the Dry Zone',
   'Shot on a veranda above the paddy fields.',
   'SHOP THE LOOK', '/collections/latest', null, null, 1)
) as v(kind, media_url, poster_url, eyebrow, title, subtitle,
       cta_label, cta_href, cta2_label, cta2_href, sort_order)
where not exists (select 1 from hero_slides);


-- ============================================================
-- SOURCE: 04_storage.sql
-- ============================================================

-- =========================================================
-- Chic Colombo — media storage
-- Run after 03_admin.sql
--
-- One public bucket holds every uploaded asset: product photography,
-- hero stills, hero video and video posters. Public because the
-- storefront reads these anonymously; writes are admin-only.
-- =========================================================

-- ---------------------------------------------------------
-- Bucket
-- ---------------------------------------------------------
-- 50 MB is the project-wide ceiling on the free plan, so the bucket
-- cannot usefully be set higher. The MIME allow-list is the real guard:
-- it is enforced by Storage itself, before the object is written.
--
-- image/svg+xml is deliberately excluded. SVG is executable markup, and
-- the bucket is world-readable, so an uploaded SVG would be a stored
-- XSS payload served from the project's own domain.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  true,
  52428800,
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------
-- Policies
-- ---------------------------------------------------------
-- The API uploads with the service-role key and the browser uploads with a
-- short-lived signed URL, and both bypass RLS — so these policies are not the
-- primary path. They exist so that a signed-in admin hitting Storage directly
-- gets the same permissions, and so anonymous writes are refused if a future
-- client ever talks to Storage without a signed URL.

drop policy if exists "media public read" on storage.objects;
create policy "media public read" on storage.objects
  for select using (bucket_id = 'media');

drop policy if exists "media admin insert" on storage.objects;
create policy "media admin insert" on storage.objects
  for insert with check (bucket_id = 'media' and public.is_admin());

drop policy if exists "media admin update" on storage.objects;
create policy "media admin update" on storage.objects
  for update using (bucket_id = 'media' and public.is_admin())
  with check (bucket_id = 'media' and public.is_admin());

drop policy if exists "media admin delete" on storage.objects;
create policy "media admin delete" on storage.objects
  for delete using (bucket_id = 'media' and public.is_admin());

-- ---------------------------------------------------------
-- product_images: keep positions tidy
-- ---------------------------------------------------------
-- 01_schema.sql created the table but left position unconstrained. The
-- storefront reads image 0 as the card front and image 1 as the hover
-- state, so two images sharing a position makes the card non-deterministic.
create unique index if not exists product_images_position_idx
  on product_images (product_id, position);


-- ============================================================
-- SOURCE: 05_content.sql
-- ============================================================

-- =========================================================
-- Chic Colombo — editable content pages
-- Run after 04_storage.sql
--
-- Terms, privacy, refunds, shipping, FAQ and the rest live here rather
-- than in HTML files, so they can be edited from the admin panel without
-- a deploy. The storefront renders them at /pages/<slug>.
--
-- The seeded copy is a WORKING DRAFT. It is written to be sensible for a
-- Sri Lankan apparel shop, not to be legal advice — read it and make it
-- true for your business before you take real orders.
-- =========================================================

create table if not exists content_pages (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  title        text not null,
  body_html    text not null default '',
  is_published boolean not null default true,
  sort_order   int not null default 0,
  updated_at   timestamptz not null default now(),

  -- the slug is part of a public URL; keep it to characters that survive one
  constraint slug_shape check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create index if not exists content_pages_published_idx on content_pages (is_published, sort_order);

drop trigger if exists content_pages_updated_at on content_pages;
create trigger content_pages_updated_at
  before update on content_pages
  for each row execute function set_updated_at();

-- ---------------------------------------------------------
-- RLS
-- ---------------------------------------------------------
alter table content_pages enable row level security;

drop policy if exists "pages readable" on content_pages;
create policy "pages readable" on content_pages
  for select using (is_published or is_admin());

drop policy if exists "pages admin write" on content_pages;
create policy "pages admin write" on content_pages
  for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------
-- Seed
-- ---------------------------------------------------------
-- Guarded per slug, so re-running never overwrites copy you have edited.
insert into content_pages (slug, title, body_html, sort_order)
select * from (values

  ('terms', 'Terms & Conditions', $html$
<p>These terms govern your use of this website and any order you place with
Chic Colombo. By placing an order you accept them.</p>

<h2>Orders</h2>
<p>An order is an offer to buy. It is accepted only when we confirm it by
email. We may decline an order if an item is out of stock, if it was listed at
an incorrect price, or if we cannot verify payment.</p>

<h2>Prices and payment</h2>
<p>Prices are shown in Sri Lankan Rupees (LKR) and include applicable taxes
unless stated otherwise. Payment is taken at checkout through our payment
provider. We do not store your card details.</p>

<h2>Delivery</h2>
<p>Delivery times are estimates, not guarantees. Risk passes to you on
delivery. See our <a href="/pages/shipping-policy">Shipping Policy</a>.</p>

<h2>Returns</h2>
<p>Your rights to return an item are set out in our
<a href="/pages/refund-policy">Returns &amp; Refunds</a> policy.</p>

<h2>Product descriptions</h2>
<p>We photograph our pieces as accurately as we can. Colours vary between
screens, and garments made in small runs vary slightly between batches. That
variation is a property of the product, not a defect.</p>

<h2>Liability</h2>
<p>Nothing in these terms limits liability that cannot be limited by law.
Otherwise our liability for any order is limited to the amount you paid for it.</p>

<h2>Governing law</h2>
<p>These terms are governed by the laws of Sri Lanka.</p>

<h2>Contact</h2>
<p>Questions about these terms: <a href="/pages/contact">get in touch</a>.</p>
$html$, 10),

  ('privacy', 'Privacy Policy', $html$
<p>This policy explains what we collect when you shop with us, why, and what
you can ask us to do about it.</p>

<h2>What we collect</h2>
<ul>
  <li><strong>Order details</strong> — your name, email, phone number and
      delivery address. We need these to fulfil and deliver your order.</li>
  <li><strong>Payment</strong> — handled entirely by our payment provider.
      Card numbers never reach our servers and we cannot see them.</li>
  <li><strong>Cart</strong> — a random identifier stored in your browser so
      your cart survives a refresh. It is not linked to you personally.</li>
  <li><strong>Newsletter</strong> — your email address, only if you enter it.</li>
</ul>

<h2>What we do not do</h2>
<p>We do not sell your data, and we do not share it with anyone except the
providers we need to deliver your order: our payment provider and our courier.</p>

<h2>How long we keep it</h2>
<p>Order records are kept as long as we are required to for tax and accounting
purposes. Newsletter subscriptions are kept until you unsubscribe.</p>

<h2>Your choices</h2>
<p>You can ask us for a copy of the data we hold about you, ask us to correct
it, or ask us to delete it where we are not required to keep it. Every
newsletter has an unsubscribe link.</p>

<h2>Contact</h2>
<p>Privacy questions: <a href="/pages/contact">contact us</a>.</p>
$html$, 20),

  ('refund-policy', 'Returns & Refunds', $html$
<h2>The short version</h2>
<p>If something is not right, tell us within <strong>14 days</strong> of
delivery and we will exchange it or refund it.</p>

<h2>What we can accept</h2>
<p>Items must be unworn and unwashed, with tags attached, in a condition we
can reasonably resell. Please try things on carefully.</p>

<h2>What we cannot accept</h2>
<ul>
  <li>Items returned after 14 days from delivery</li>
  <li>Items that have been worn, washed, altered or damaged after delivery</li>
  <li>Underwear and swimwear, for hygiene reasons, unless faulty</li>
  <li>Sale items marked final sale</li>
</ul>

<h2>Faulty items</h2>
<p>A manufacturing fault is different from ordinary wear. If a piece arrives
faulty, or a fault appears in normal use, contact us with photographs and we
will repair, replace or refund it. This is in addition to your statutory
rights, not instead of them.</p>

<h2>How to return something</h2>
<ol>
  <li><a href="/pages/contact">Contact us</a> with your order number and what
      you would like to do.</li>
  <li>We will confirm the return address and reference.</li>
  <li>Send the item back. Keep proof of postage — until it reaches us it is
      still your parcel.</li>
</ol>

<h2>Refunds</h2>
<p>Refunds go back to the original payment method within 7 working days of us
receiving the item. Your bank may take a few days more to show it. Original
delivery charges are refunded only where the item was faulty or wrongly sent.</p>

<h2>Return postage</h2>
<p>Return postage is yours to pay unless the item was faulty or we sent the
wrong thing, in which case we cover it.</p>
$html$, 30),

  ('shipping-policy', 'Shipping Policy', $html$
<h2>Where we deliver</h2>
<p>We deliver islandwide across Sri Lanka, and internationally on request.</p>

<h2>Cost</h2>
<p>A flat delivery charge applies to islandwide orders, and delivery is free
above the threshold shown at checkout. The exact charge for your order is
always shown before you pay — there are no charges added afterwards.</p>

<h2>How long it takes</h2>
<ul>
  <li><strong>Colombo and suburbs</strong> — usually 1–2 working days</li>
  <li><strong>Rest of the island</strong> — usually 2–5 working days</li>
  <li><strong>International</strong> — quoted per order</li>
</ul>
<p>Orders are dispatched on working days. Orders placed on a weekend or a
public holiday are picked up the next working day. These are estimates from
our courier, not guarantees.</p>

<h2>Tracking</h2>
<p>You will get an email when your order is dispatched. You can check its
status any time on our <a href="/track">order tracking</a> page using your
order number and the email address you ordered with.</p>

<h2>Wrong or incomplete addresses</h2>
<p>Please check your address at checkout. A parcel returned to us because the
address was wrong or nobody was available can be resent, but the second
delivery charge is yours.</p>

<h2>Customs and duties</h2>
<p>International orders may attract import duties or taxes in the destination
country. Those are the recipient's responsibility and are not included in our
prices.</p>
$html$, 40),

  ('faq', 'FAQ', $html$
<h2>How do I know what size to order?</h2>
<p>Every product page lists the sizes we have in stock. Our
<a href="/pages/size-guide">size guide</a> has the measurements.</p>

<h2>Can I change or cancel my order?</h2>
<p>If it has not been dispatched, yes — <a href="/pages/contact">contact us</a>
as soon as you can with your order number. Once it is with the courier it has
to be handled as a return.</p>

<h2>Where is my order?</h2>
<p>Check it on the <a href="/track">tracking page</a> with your order number
and email address.</p>

<h2>What payment methods do you accept?</h2>
<p>Card and local payment methods through our payment provider. All prices are
in Sri Lankan Rupees.</p>

<h2>Do you ship internationally?</h2>
<p>Yes, on request — <a href="/pages/contact">ask us</a> for a quote before
ordering.</p>

<h2>How should I care for my clothes?</h2>
<p>Cold wash, inside out, with like colours. Line dry in shade. Our linen and
cotton are unshrunk natural fibres and a hot wash will shrink them.</p>
$html$, 50),

  ('size-guide', 'Size Guide', $html$
<p>Measurements are of the garment laid flat, in centimetres. Allow 1–2 cm
either way — these are cut and sewn in small runs, not machine-stamped.</p>

<h2>Tops (chest, flat)</h2>
<ul>
  <li>S — 51 cm</li>
  <li>M — 54 cm</li>
  <li>L — 57 cm</li>
  <li>XL — 60 cm</li>
</ul>

<h2>Trousers and shorts (waist, flat)</h2>
<ul>
  <li>S — 38 cm</li>
  <li>M — 41 cm</li>
  <li>L — 44 cm</li>
  <li>XL — 47 cm</li>
</ul>

<h2>Between sizes?</h2>
<p>Our linen is cut relaxed, so size down if you want it closer to the body.
Our jersey is cut true to size.</p>

<p>Still unsure? <a href="/pages/contact">Ask us</a> — tell us your usual size
in a brand you own and we will point you to the right one.</p>
$html$, 60),

  ('contact', 'Contact Us', $html$
<p>We answer messages on working days, usually within one business day.</p>

<h2>Get in touch</h2>
<p>The contact details below are kept up to date in our admin panel and shown
in the footer of every page — phone, WhatsApp and email.</p>

<h2>About an order</h2>
<p>Please include your order number. It is in your confirmation email and on
the <a href="/track">tracking page</a>. It saves us both a round trip.</p>

<h2>Wholesale and press</h2>
<p>Use the same address and tell us what you have in mind.</p>
$html$, 70),

  ('our-makers', 'Our Makers', $html$
<p>Every Chic Colombo piece is cut and sewn in Colombo, a short drive from the
Indian Ocean, by people we know by name.</p>

<h2>Small runs</h2>
<p>We make in small batches. It costs more per piece and it means things sell
out, but it also means we are not sitting on warehouses of unsold stock, and
the people making our clothes are not working to an impossible quota.</p>

<h2>Fabric</h2>
<p>Cotton and linen, chosen for a climate that is hot and humid most of the
year. Breathable, unlined where it can be, and cut to move.</p>

<h2>Why it matters</h2>
<p>Apparel is one of Sri Lanka's largest industries. Making here, properly, is
the point of the brand rather than a detail of it.</p>
$html$, 80),

  ('gift-cards', 'Gift Cards', $html$
<p>Gift cards are coming soon.</p>

<p>In the meantime, if you would like to buy something as a gift and are not
sure of the size, <a href="/pages/contact">talk to us</a> — we will help you
choose, and we are happy to arrange an exchange if it is not right.</p>

<p>Our <a href="/pages/refund-policy">returns policy</a> applies to gifts in
the same way, counted from the delivery date.</p>
$html$, 90)

) as v(slug, title, body_html, sort_order)
where not exists (select 1 from content_pages p where p.slug = v.slug);


-- ============================================================
-- SOURCE: 06_payments.sql
-- ============================================================

-- =========================================================
-- Chic Colombo — payments and order tracking
-- Run after 05_content.sql
--
-- Adds the payment provider credentials (entered in the admin panel),
-- the payment columns on orders, and the event timeline the customer
-- sees on the tracking page.
-- =========================================================

-- ---------------------------------------------------------
-- Provider credentials
-- ---------------------------------------------------------
-- One row. Secrets are written from the admin panel and read only by the
-- API using the service-role key.
create table if not exists payment_settings (
  id text primary key default 'global',

  active_provider text not null default 'payhere'
    check (active_provider in ('payhere', 'paypal')),

  -- PayHere (Sri Lanka). merchant_secret signs the checkout hash and
  -- verifies the notification; app id/secret are only needed for refunds
  -- and the retrieval API.
  payhere_enabled      boolean not null default false,
  payhere_sandbox      boolean not null default true,
  payhere_merchant_id  text,
  payhere_merchant_secret text,
  payhere_app_id       text,
  payhere_app_secret   text,

  -- PayPal. Disabled: PayPal does not settle in LKR, so enabling it needs
  -- a currency decision first (charge USD at a stored rate, most likely).
  paypal_enabled   boolean not null default false,
  paypal_sandbox   boolean not null default true,
  paypal_client_id text,
  paypal_secret    text,

  updated_at timestamptz not null default now(),

  constraint payment_settings_singleton check (id = 'global')
);

insert into payment_settings (id) values ('global') on conflict (id) do nothing;

drop trigger if exists payment_settings_updated_at on payment_settings;
create trigger payment_settings_updated_at
  before update on payment_settings
  for each row execute function set_updated_at();

-- RLS on, and DELIBERATELY NO POLICIES.
--
-- No policy means no row is visible to anon or authenticated, ever. That is
-- the point: the admin panel talks to Supabase with the anon key plus the
-- signed-in admin's JWT, so an is_admin() read policy here would put live
-- payment secrets into a browser. The service role bypasses RLS, so the API
-- can still read them, and the admin panel reaches them only through
-- /api/admin/payments — which never returns a secret, only whether one is set.
alter table payment_settings enable row level security;

-- ---------------------------------------------------------
-- Payment + fulfilment columns on orders
-- ---------------------------------------------------------
alter table orders add column if not exists payment_provider text;
alter table orders add column if not exists payment_status   text not null default 'unpaid';
alter table orders add column if not exists payment_ref      text;
alter table orders add column if not exists paid_at          timestamptz;
alter table orders add column if not exists courier          text;
alter table orders add column if not exists tracking_number  text;
alter table orders add column if not exists tracking_url     text;

do $$ begin
  alter table orders add constraint orders_payment_status_check
    check (payment_status in ('unpaid', 'pending', 'paid', 'failed', 'cancelled', 'chargeback', 'refunded'));
exception when duplicate_object then null; end $$;

-- the payment gateway's own reference must map to exactly one order
create unique index if not exists orders_payment_ref_idx
  on orders (payment_ref) where payment_ref is not null;

-- ---------------------------------------------------------
-- Order timeline
-- ---------------------------------------------------------
-- Every status change appends a row. This is what the tracking page renders,
-- and it doubles as an audit trail for payment notifications.
create table if not exists order_events (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders (id) on delete cascade,
  status     text not null,
  note       text,
  actor      uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists order_events_order_idx on order_events (order_id, created_at);

alter table order_events enable row level security;

-- Customers reach their timeline through POST /api/track, which checks the
-- email server-side with the service-role key. Admins read it in the panel.
drop policy if exists "order events admin read" on order_events;
create policy "order events admin read" on order_events
  for select using (is_admin());

