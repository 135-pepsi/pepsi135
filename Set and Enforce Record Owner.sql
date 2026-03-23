-- 1) 自动补 owner_id（insert/update 前）
create or replace function public.set_mes_orders_owner_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 必须是登录用户
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if tg_op = 'INSERT' then
    -- 前端没传就自动补
    if new.owner_id is null then
      new.owner_id := auth.uid();
    end if;

    -- 传了也必须等于自己
    if new.owner_id <> auth.uid() then
      raise exception 'owner_id must equal auth.uid()';
    end if;
  elsif tg_op = 'UPDATE' then
    -- 不允许把 owner_id 改成别人的
    if new.owner_id is distinct from old.owner_id then
      raise exception 'owner_id is immutable';
    end if;
  end if;

  return new;
end;
$$;

-- 2) 绑定触发器
drop trigger if exists trg_set_mes_orders_owner_id on public.mes_orders;

create trigger trg_set_mes_orders_owner_id
before insert or update on public.mes_orders
for each row
execute function public.set_mes_orders_owner_id();
-- LEGACY SCRIPT
-- This script enforces owner_id = auth.uid() for mes_orders.
-- Do not run it on the current shared-data setup. Use only for historical troubleshooting.
-- Running this after the shared-mode SQL will reintroduce per-user ownership behavior.
