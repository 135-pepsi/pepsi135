-- Migration date: 2026-03-01
-- Purpose: switch to shared data model:
--   - anonymous users: read-only
--   - authenticated users: read + write
-- Notes:
--   - owner_id column is retained for compatibility/audit but is no longer used by RLS matching.

begin;

alter table public.mes_orders enable row level security;
alter table public.mes_materials enable row level security;

-- mes_orders policies
drop policy if exists "mes_orders_public_read" on public.mes_orders;
drop policy if exists "mes_orders_auth_read" on public.mes_orders;
drop policy if exists "mes_orders_public_insert" on public.mes_orders;
drop policy if exists "mes_orders_auth_write_insert" on public.mes_orders;
drop policy if exists "mes_orders_public_update" on public.mes_orders;
drop policy if exists "mes_orders_auth_write_update" on public.mes_orders;
drop policy if exists "mes_orders_public_delete" on public.mes_orders;
drop policy if exists "mes_orders_auth_write_delete" on public.mes_orders;
drop policy if exists "mes_orders_read_all" on public.mes_orders;
drop policy if exists "mes_orders_insert_auth" on public.mes_orders;
drop policy if exists "mes_orders_update_auth" on public.mes_orders;
drop policy if exists "mes_orders_delete_auth" on public.mes_orders;

create policy "mes_orders_read_all" on public.mes_orders
for select to anon, authenticated
using (true);

create policy "mes_orders_insert_auth" on public.mes_orders
for insert to authenticated
with check (auth.uid() is not null);

create policy "mes_orders_update_auth" on public.mes_orders
for update to authenticated
using (auth.uid() is not null)
with check (auth.uid() is not null);

create policy "mes_orders_delete_auth" on public.mes_orders
for delete to authenticated
using (auth.uid() is not null);

-- mes_materials policies
drop policy if exists "mes_materials_public_read" on public.mes_materials;
drop policy if exists "mes_materials_auth_read" on public.mes_materials;
drop policy if exists "mes_materials_public_insert" on public.mes_materials;
drop policy if exists "mes_materials_auth_write_insert" on public.mes_materials;
drop policy if exists "mes_materials_public_update" on public.mes_materials;
drop policy if exists "mes_materials_auth_write_update" on public.mes_materials;
drop policy if exists "mes_materials_public_delete" on public.mes_materials;
drop policy if exists "mes_materials_auth_write_delete" on public.mes_materials;
drop policy if exists "mes_materials_read_all" on public.mes_materials;
drop policy if exists "mes_materials_insert_auth" on public.mes_materials;
drop policy if exists "mes_materials_update_auth" on public.mes_materials;
drop policy if exists "mes_materials_delete_auth" on public.mes_materials;

create policy "mes_materials_read_all" on public.mes_materials
for select to anon, authenticated
using (true);

create policy "mes_materials_insert_auth" on public.mes_materials
for insert to authenticated
with check (auth.uid() is not null);

create policy "mes_materials_update_auth" on public.mes_materials
for update to authenticated
using (auth.uid() is not null)
with check (auth.uid() is not null);

create policy "mes_materials_delete_auth" on public.mes_materials
for delete to authenticated
using (auth.uid() is not null);

commit;
