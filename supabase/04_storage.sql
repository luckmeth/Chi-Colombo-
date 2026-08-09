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
