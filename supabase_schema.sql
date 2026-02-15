-- Supabase: MES 订单表
create extension if not exists pg_trgm;

create table if not exists public.mes_orders (
  id uuid primary key,
  created_at timestamptz not null default now(),
  order_no text not null default '',
  drawing_no text not null default '',
  customer text not null default '',
  item_name text not null default '',
  qty numeric,
  program_no text not null default '未出',
  planned_hours numeric,
  machine text not null default '',
  lathe text not null default '',
  surface text not null default '',
  status text not null default '待排产',
  start_time text not null default '',
  due_date text not null default '',
  is_delayed text not null default '',
  note text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.mes_orders
add column if not exists created_at timestamptz not null default now();

alter table public.mes_orders
add column if not exists item_name text not null default '';

create index if not exists idx_mes_orders_updated_at on public.mes_orders(updated_at desc);
create index if not exists idx_mes_orders_order_no on public.mes_orders(order_no);
create index if not exists idx_mes_orders_drawing_no on public.mes_orders(drawing_no);
create index if not exists idx_mes_orders_status on public.mes_orders(status);
create index if not exists idx_mes_orders_customer on public.mes_orders(customer);
create index if not exists idx_mes_orders_machine on public.mes_orders(machine);
create index if not exists idx_mes_orders_status_updated_at on public.mes_orders(status, updated_at desc);
create index if not exists idx_mes_orders_item_name_trgm on public.mes_orders using gin (item_name gin_trgm_ops);
create index if not exists idx_mes_orders_note_trgm on public.mes_orders using gin (note gin_trgm_ops);

alter table public.mes_orders enable row level security;

drop policy if exists "mes_orders_public_read" on public.mes_orders;
create policy "mes_orders_public_read" on public.mes_orders
for select using (true);

drop policy if exists "mes_orders_public_insert" on public.mes_orders;
create policy "mes_orders_public_insert" on public.mes_orders
for insert with check (true);

drop policy if exists "mes_orders_public_update" on public.mes_orders;
create policy "mes_orders_public_update" on public.mes_orders
for update using (true) with check (true);

drop policy if exists "mes_orders_public_delete" on public.mes_orders;
create policy "mes_orders_public_delete" on public.mes_orders
for delete using (true);
