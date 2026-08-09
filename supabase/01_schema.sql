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
