-- Supabase: MES 物料表
create table if not exists public.mes_materials (
  id uuid primary key,
  created_at timestamptz not null default now(),
  order_no text not null default '',
  customer text not null default '',
  material text not null default '',
  spec text not null default '',
  quantity numeric,
  amount numeric,
  is_ready text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.mes_materials add column if not exists quantity numeric;

create index if not exists idx_mes_materials_updated_at on public.mes_materials(updated_at desc);
create index if not exists idx_mes_materials_order_no on public.mes_materials(order_no);
create index if not exists idx_mes_materials_customer on public.mes_materials(customer);
create index if not exists idx_mes_materials_material on public.mes_materials(material);

alter table public.mes_materials enable row level security;

drop policy if exists "mes_materials_public_read" on public.mes_materials;
create policy "mes_materials_public_read" on public.mes_materials
for select using (true);

drop policy if exists "mes_materials_public_insert" on public.mes_materials;
create policy "mes_materials_public_insert" on public.mes_materials
for insert with check (true);

drop policy if exists "mes_materials_public_update" on public.mes_materials;
create policy "mes_materials_public_update" on public.mes_materials
for update using (true) with check (true);

drop policy if exists "mes_materials_public_delete" on public.mes_materials;
create policy "mes_materials_public_delete" on public.mes_materials
for delete using (true);
