-- Migration date: 2026-02-17
-- Purpose: apply owner-based RLS isolation + baseline data constraints/indexes.
-- Notes:
-- 1) Existing rows with owner_id IS NULL will become invisible under owner-based RLS.
-- 2) For single-tenant historical data, backfill owner_id manually before enabling strict non-null:
--    update public.mes_orders set owner_id = 'YOUR_AUTH_USER_UUID' where owner_id is null;
--    update public.mes_materials set owner_id = 'YOUR_AUTH_USER_UUID' where owner_id is null;

begin;

alter table public.mes_orders add column if not exists owner_id uuid;
alter table public.mes_orders alter column owner_id set default auth.uid();

alter table public.mes_materials add column if not exists owner_id uuid;
alter table public.mes_materials alter column owner_id set default auth.uid();

create index if not exists idx_mes_orders_owner_id on public.mes_orders(owner_id);
create index if not exists idx_mes_orders_owner_updated on public.mes_orders(owner_id, updated_at desc);
create index if not exists idx_mes_materials_owner_id on public.mes_materials(owner_id);
create index if not exists idx_mes_materials_owner_updated on public.mes_materials(owner_id, updated_at desc);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mes_orders_qty_non_negative') then
    alter table public.mes_orders add constraint mes_orders_qty_non_negative check (qty is null or qty >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mes_orders_planned_hours_non_negative') then
    alter table public.mes_orders add constraint mes_orders_planned_hours_non_negative check (planned_hours is null or planned_hours >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mes_orders_order_no_len') then
    alter table public.mes_orders add constraint mes_orders_order_no_len check (char_length(order_no) <= 64);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mes_orders_drawing_no_len') then
    alter table public.mes_orders add constraint mes_orders_drawing_no_len check (char_length(drawing_no) <= 128);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mes_orders_customer_len') then
    alter table public.mes_orders add constraint mes_orders_customer_len check (char_length(customer) <= 128);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mes_orders_item_name_len') then
    alter table public.mes_orders add constraint mes_orders_item_name_len check (char_length(item_name) <= 256);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mes_orders_program_no_len') then
    alter table public.mes_orders add constraint mes_orders_program_no_len check (char_length(program_no) <= 64);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mes_orders_machine_len') then
    alter table public.mes_orders add constraint mes_orders_machine_len check (char_length(machine) <= 64);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mes_orders_lathe_len') then
    alter table public.mes_orders add constraint mes_orders_lathe_len check (char_length(lathe) <= 16);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mes_orders_surface_len') then
    alter table public.mes_orders add constraint mes_orders_surface_len check (char_length(surface) <= 128);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mes_orders_status_len') then
    alter table public.mes_orders add constraint mes_orders_status_len check (char_length(status) <= 32);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mes_orders_is_delayed_len') then
    alter table public.mes_orders add constraint mes_orders_is_delayed_len check (char_length(is_delayed) <= 16);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mes_orders_note_len') then
    alter table public.mes_orders add constraint mes_orders_note_len check (char_length(note) <= 1000);
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mes_materials_quantity_non_negative') then
    alter table public.mes_materials add constraint mes_materials_quantity_non_negative check (quantity is null or quantity >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mes_materials_amount_non_negative') then
    alter table public.mes_materials add constraint mes_materials_amount_non_negative check (amount is null or amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mes_materials_order_no_len') then
    alter table public.mes_materials add constraint mes_materials_order_no_len check (char_length(order_no) <= 64);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mes_materials_customer_len') then
    alter table public.mes_materials add constraint mes_materials_customer_len check (char_length(customer) <= 128);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mes_materials_material_len') then
    alter table public.mes_materials add constraint mes_materials_material_len check (char_length(material) <= 128);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mes_materials_spec_len') then
    alter table public.mes_materials add constraint mes_materials_spec_len check (char_length(spec) <= 256);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mes_materials_is_ready_len') then
    alter table public.mes_materials add constraint mes_materials_is_ready_len check (char_length(is_ready) <= 16);
  end if;
end
$$;

alter table public.mes_orders enable row level security;
drop policy if exists "mes_orders_public_read" on public.mes_orders;
drop policy if exists "mes_orders_auth_read" on public.mes_orders;
create policy "mes_orders_auth_read" on public.mes_orders
for select to authenticated
using (owner_id = auth.uid());

drop policy if exists "mes_orders_public_insert" on public.mes_orders;
drop policy if exists "mes_orders_auth_write_insert" on public.mes_orders;
create policy "mes_orders_auth_write_insert" on public.mes_orders
for insert to authenticated
with check (owner_id = auth.uid());

drop policy if exists "mes_orders_public_update" on public.mes_orders;
drop policy if exists "mes_orders_auth_write_update" on public.mes_orders;
create policy "mes_orders_auth_write_update" on public.mes_orders
for update to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "mes_orders_public_delete" on public.mes_orders;
drop policy if exists "mes_orders_auth_write_delete" on public.mes_orders;
create policy "mes_orders_auth_write_delete" on public.mes_orders
for delete to authenticated
using (owner_id = auth.uid());

alter table public.mes_materials enable row level security;
drop policy if exists "mes_materials_public_read" on public.mes_materials;
drop policy if exists "mes_materials_auth_read" on public.mes_materials;
create policy "mes_materials_auth_read" on public.mes_materials
for select to authenticated
using (owner_id = auth.uid());

drop policy if exists "mes_materials_public_insert" on public.mes_materials;
drop policy if exists "mes_materials_auth_write_insert" on public.mes_materials;
create policy "mes_materials_auth_write_insert" on public.mes_materials
for insert to authenticated
with check (owner_id = auth.uid());

drop policy if exists "mes_materials_public_update" on public.mes_materials;
drop policy if exists "mes_materials_auth_write_update" on public.mes_materials;
create policy "mes_materials_auth_write_update" on public.mes_materials
for update to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "mes_materials_public_delete" on public.mes_materials;
drop policy if exists "mes_materials_auth_write_delete" on public.mes_materials;
create policy "mes_materials_auth_write_delete" on public.mes_materials
for delete to authenticated
using (owner_id = auth.uid());

commit;
