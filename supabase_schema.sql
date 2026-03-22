-- Supabase: MES 订单表
create extension if not exists pg_trgm;

create table if not exists public.mes_orders (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
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
  updated_at timestamptz not null default now(),
  constraint mes_orders_qty_non_negative check (qty is null or qty >= 0),
  constraint mes_orders_planned_hours_non_negative check (planned_hours is null or planned_hours >= 0),
  constraint mes_orders_order_no_len check (char_length(order_no) <= 64),
  constraint mes_orders_drawing_no_len check (char_length(drawing_no) <= 128),
  constraint mes_orders_customer_len check (char_length(customer) <= 128),
  constraint mes_orders_item_name_len check (char_length(item_name) <= 256),
  constraint mes_orders_program_no_len check (char_length(program_no) <= 64),
  constraint mes_orders_machine_len check (char_length(machine) <= 64),
  constraint mes_orders_lathe_len check (char_length(lathe) <= 16),
  constraint mes_orders_surface_len check (char_length(surface) <= 128),
  constraint mes_orders_status_len check (char_length(status) <= 32),
  constraint mes_orders_is_delayed_len check (char_length(is_delayed) <= 16),
  constraint mes_orders_note_len check (char_length(note) <= 1000)
);

alter table public.mes_orders
add column if not exists created_at timestamptz not null default now();

alter table public.mes_orders
add column if not exists item_name text not null default '';

alter table public.mes_orders
add column if not exists owner_id uuid;

alter table public.mes_orders
alter column owner_id set default auth.uid();

create index if not exists idx_mes_orders_updated_at on public.mes_orders(updated_at desc);
create index if not exists idx_mes_orders_order_no on public.mes_orders(order_no);
create index if not exists idx_mes_orders_drawing_no on public.mes_orders(drawing_no);
create index if not exists idx_mes_orders_status on public.mes_orders(status);
create index if not exists idx_mes_orders_customer on public.mes_orders(customer);
create index if not exists idx_mes_orders_machine on public.mes_orders(machine);
create index if not exists idx_mes_orders_owner_id on public.mes_orders(owner_id);
create index if not exists idx_mes_orders_owner_updated on public.mes_orders(owner_id, updated_at desc);
create index if not exists idx_mes_orders_status_updated_at on public.mes_orders(status, updated_at desc);
create index if not exists idx_mes_orders_item_name_trgm on public.mes_orders using gin (item_name gin_trgm_ops);
create index if not exists idx_mes_orders_note_trgm on public.mes_orders using gin (note gin_trgm_ops);

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

alter table public.mes_orders enable row level security;

drop policy if exists "mes_orders_public_read" on public.mes_orders;
drop policy if exists "mes_orders_auth_read" on public.mes_orders;
drop policy if exists "mes_orders_auth_write_insert" on public.mes_orders;
drop policy if exists "mes_orders_auth_write_update" on public.mes_orders;
drop policy if exists "mes_orders_auth_write_delete" on public.mes_orders;
drop policy if exists "mes_orders_public_insert" on public.mes_orders;
drop policy if exists "mes_orders_public_update" on public.mes_orders;
drop policy if exists "mes_orders_public_delete" on public.mes_orders;
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
