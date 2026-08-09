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
