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
