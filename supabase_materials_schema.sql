-- Supabase: MES 物料表
create table if not exists public.mes_materials (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  order_no text not null default '',
  customer text not null default '',
  material text not null default '',
  spec text not null default '',
  quantity numeric,
  amount numeric,
  is_ready text not null default '',
  updated_at timestamptz not null default now(),
  constraint mes_materials_quantity_non_negative check (quantity is null or quantity >= 0),
  constraint mes_materials_amount_non_negative check (amount is null or amount >= 0),
  constraint mes_materials_order_no_len check (char_length(order_no) <= 64),
  constraint mes_materials_customer_len check (char_length(customer) <= 128),
  constraint mes_materials_material_len check (char_length(material) <= 128),
  constraint mes_materials_spec_len check (char_length(spec) <= 256),
  constraint mes_materials_is_ready_len check (char_length(is_ready) <= 16)
);

alter table public.mes_materials add column if not exists quantity numeric;
alter table public.mes_materials add column if not exists owner_id uuid;
alter table public.mes_materials alter column owner_id set default auth.uid();

create index if not exists idx_mes_materials_updated_at on public.mes_materials(updated_at desc);
create index if not exists idx_mes_materials_order_no on public.mes_materials(order_no);
create index if not exists idx_mes_materials_customer on public.mes_materials(customer);
create index if not exists idx_mes_materials_material on public.mes_materials(material);
create index if not exists idx_mes_materials_owner_id on public.mes_materials(owner_id);
create index if not exists idx_mes_materials_owner_updated on public.mes_materials(owner_id, updated_at desc);

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

alter table public.mes_materials enable row level security;

drop policy if exists "mes_materials_public_read" on public.mes_materials;
drop policy if exists "mes_materials_auth_read" on public.mes_materials;
drop policy if exists "mes_materials_auth_write_insert" on public.mes_materials;
drop policy if exists "mes_materials_auth_write_update" on public.mes_materials;
drop policy if exists "mes_materials_auth_write_delete" on public.mes_materials;
drop policy if exists "mes_materials_public_insert" on public.mes_materials;
drop policy if exists "mes_materials_public_update" on public.mes_materials;
drop policy if exists "mes_materials_public_delete" on public.mes_materials;
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
