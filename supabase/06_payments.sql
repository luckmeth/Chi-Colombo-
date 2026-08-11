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
