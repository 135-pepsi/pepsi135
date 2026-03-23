-- 1) 确保开启 RLS
alter table public.mes_orders enable row level security;

-- 2) 清理旧策略
drop policy if exists "mes_orders_public_read" on public.mes_orders;
drop policy if exists "mes_orders_auth_read" on public.mes_orders;
drop policy if exists "mes_orders_public_insert" on public.mes_orders;
drop policy if exists "mes_orders_auth_write_insert" on public.mes_orders;
drop policy if exists "mes_orders_public_update" on public.mes_orders;
drop policy if exists "mes_orders_auth_write_update" on public.mes_orders;
drop policy if exists "mes_orders_public_delete" on public.mes_orders;
drop policy if exists "mes_orders_auth_write_delete" on public.mes_orders;

-- 3) 仅登录用户可读，且只能读自己的数据
create policy "mes_orders_auth_read" on public.mes_orders
for select to authenticated
using (owner_id = auth.uid());

-- 4) 仅登录用户可新增，且 owner_id 必须是自己
create policy "mes_orders_auth_write_insert" on public.mes_orders
for insert to authenticated
with check (owner_id = auth.uid());

-- 5) 仅登录用户可更新自己的数据
create policy "mes_orders_auth_write_update" on public.mes_orders
for update to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

-- 6) 仅登录用户可删除自己的数据
create policy "mes_orders_auth_write_delete" on public.mes_orders
for delete to authenticated
using (owner_id = auth.uid());
-- LEGACY SCRIPT
-- This script switches mes_orders to per-user owner_id RLS.
-- Do not run it on the current shared-data setup. Use only for historical troubleshooting.
-- Running this after the shared-mode SQL will make different accounts unable to see the same orders.
