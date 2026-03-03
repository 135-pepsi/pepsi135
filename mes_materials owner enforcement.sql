-- mes_materials：自动补 owner_id + 防篡改

create or replace function public.set_mes_materials_owner_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if tg_op = 'INSERT' then
    if new.owner_id is null then
      new.owner_id := auth.uid();
    end if;

    if new.owner_id <> auth.uid() then
      raise exception 'owner_id must equal auth.uid()';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.owner_id is distinct from old.owner_id then
      raise exception 'owner_id is immutable';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_set_mes_materials_owner_id on public.mes_materials;

create trigger trg_set_mes_materials_owner_id
before insert or update on public.mes_materials
for each row
execute function public.set_mes_materials_owner_id();

-- 可选：RLS 对齐（若你还没配）
alter table public.mes_materials enable row level security;

drop policy if exists "mes_materials_auth_read" on public.mes_materials;
drop policy if exists "mes_materials_auth_write_insert" on public.mes_materials;
drop policy if exists "mes_materials_auth_write_update" on public.mes_materials;
drop policy if exists "mes_materials_auth_write_delete" on public.mes_materials;

create policy "mes_materials_auth_read" on public.mes_materials
for select to authenticated
using (owner_id = auth.uid());

create policy "mes_materials_auth_write_insert" on public.mes_materials
for insert to authenticated
with check (owner_id = auth.uid());

create policy "mes_materials_auth_write_update" on public.mes_materials
for update to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "mes_materials_auth_write_delete" on public.mes_materials
for delete to authenticated
using (owner_id = auth.uid());
