-- Migration date: 2026-03-22
-- Purpose: create storage buckets and shared read / authenticated write policies
-- Buckets can be renamed in front-end config, but these defaults match the shipped config files.

begin;

insert into storage.buckets (id, name, public, file_size_limit)
values
  (
    'material-screenshots',
    'material-screenshots',
    false,
    52428800
  ),
  (
    'order-attachments',
    'order-attachments',
    false,
    52428800
  ),
  (
    'tuzhi',
    'tuzhi',
    false,
    52428800
  )
on conflict (id) do nothing;

drop policy if exists "mes_storage_read_shared" on storage.objects;
create policy "mes_storage_read_shared" on storage.objects
for select to anon, authenticated
using (bucket_id in ('material-screenshots', 'order-attachments', 'tuzhi'));

drop policy if exists "mes_storage_insert_auth" on storage.objects;
create policy "mes_storage_insert_auth" on storage.objects
for insert to authenticated
with check (
  bucket_id in ('material-screenshots', 'order-attachments', 'tuzhi')
  and auth.uid() is not null
);

drop policy if exists "mes_storage_update_auth" on storage.objects;
create policy "mes_storage_update_auth" on storage.objects
for update to authenticated
using (
  bucket_id in ('material-screenshots', 'order-attachments', 'tuzhi')
  and auth.uid() is not null
)
with check (
  bucket_id in ('material-screenshots', 'order-attachments', 'tuzhi')
  and auth.uid() is not null
);

drop policy if exists "mes_storage_delete_auth" on storage.objects;
create policy "mes_storage_delete_auth" on storage.objects
for delete to authenticated
using (
  bucket_id in ('material-screenshots', 'order-attachments', 'tuzhi')
  and auth.uid() is not null
);

commit;
