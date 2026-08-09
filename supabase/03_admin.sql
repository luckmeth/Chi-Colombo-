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
   'SHOP MENS', '#', 'SHOP WOMENS', '#', 0),
  ('video'::slide_kind, 'assets/brand-film.mp4', 'assets/video-poster.jpg',
   'THE FILM', 'An Evening in the Dry Zone',
   'Shot on a veranda above the paddy fields.',
   'SHOP THE LOOK', '#', null, null, 1)
) as v(kind, media_url, poster_url, eyebrow, title, subtitle,
       cta_label, cta_href, cta2_label, cta2_href, sort_order)
where not exists (select 1 from hero_slides);
