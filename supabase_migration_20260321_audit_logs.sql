-- Migration date: 2026-03-21
-- Purpose: add audit logs and admin-gated access page support

begin;

create extension if not exists pgcrypto;

create table if not exists public.mes_audit_admins (
  email text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.mes_audit_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid,
  user_email text not null default '',
  table_name text not null default '',
  page_type text not null default '',
  action_type text not null default '',
  record_id uuid,
  record_label text not null default '',
  changed_fields jsonb not null default '[]'::jsonb,
  before_data jsonb,
  after_data jsonb
);

create index if not exists idx_mes_audit_logs_created_at on public.mes_audit_logs(created_at desc);
create index if not exists idx_mes_audit_logs_user_email on public.mes_audit_logs(user_email);
create index if not exists idx_mes_audit_logs_page_type on public.mes_audit_logs(page_type);
create index if not exists idx_mes_audit_logs_action_type on public.mes_audit_logs(action_type);
create index if not exists idx_mes_audit_logs_record_id on public.mes_audit_logs(record_id);

alter table public.mes_audit_admins enable row level security;
alter table public.mes_audit_logs enable row level security;

drop policy if exists "mes_audit_admins_select_self" on public.mes_audit_admins;
create policy "mes_audit_admins_select_self" on public.mes_audit_admins
for select to authenticated
using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists "mes_audit_logs_select_admins" on public.mes_audit_logs;
create policy "mes_audit_logs_select_admins" on public.mes_audit_logs
for select to authenticated
using (
  exists (
    select 1
    from public.mes_audit_admins admins
    where lower(admins.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
);

create or replace function public.mes_jsonb_changed_fields(old_row jsonb, new_row jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(
    (
      select jsonb_agg(key order by key)
      from (
        select key
        from jsonb_object_keys(coalesce(old_row, '{}'::jsonb) || coalesce(new_row, '{}'::jsonb)) as key
        where coalesce(old_row -> key, 'null'::jsonb) is distinct from coalesce(new_row -> key, 'null'::jsonb)
      ) changed
    ),
    '[]'::jsonb
  );
$$;

create or replace function public.log_mes_table_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_old jsonb;
  v_new jsonb;
  v_changed jsonb;
  v_page_type text;
  v_record_label text := '';
  v_record_id uuid;
begin
  if TG_TABLE_NAME = 'mes_orders' then
    v_page_type := 'orders';
  elsif TG_TABLE_NAME = 'mes_materials' then
    v_page_type := 'materials';
  else
    v_page_type := TG_TABLE_NAME;
  end if;

  if TG_OP = 'DELETE' then
    v_old := to_jsonb(OLD);
    v_new := null;
    v_changed := public.mes_jsonb_changed_fields(v_old, null);
    v_record_id := OLD.id;
    v_record_label := coalesce(OLD.order_no, OLD.customer, OLD.id::text, '');
  elsif TG_OP = 'INSERT' then
    v_old := null;
    v_new := to_jsonb(NEW);
    v_changed := public.mes_jsonb_changed_fields(null, v_new);
    v_record_id := NEW.id;
    v_record_label := coalesce(NEW.order_no, NEW.customer, NEW.id::text, '');
  else
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_changed := public.mes_jsonb_changed_fields(v_old, v_new);
    v_record_id := NEW.id;
    v_record_label := coalesce(NEW.order_no, NEW.customer, NEW.id::text, '');
    if v_old = v_new then
      return NEW;
    end if;
  end if;

  insert into public.mes_audit_logs (
    user_id,
    user_email,
    table_name,
    page_type,
    action_type,
    record_id,
    record_label,
    changed_fields,
    before_data,
    after_data
  ) values (
    v_user_id,
    v_user_email,
    TG_TABLE_NAME,
    v_page_type,
    lower(TG_OP),
    v_record_id,
    v_record_label,
    v_changed,
    v_old,
    v_new
  );

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_mes_orders_audit on public.mes_orders;
create trigger trg_mes_orders_audit
after insert or update or delete on public.mes_orders
for each row execute function public.log_mes_table_change();

do $$
begin
  if to_regclass('public.mes_materials') is not null then
    execute 'drop trigger if exists trg_mes_materials_audit on public.mes_materials';
    execute 'create trigger trg_mes_materials_audit after insert or update or delete on public.mes_materials for each row execute function public.log_mes_table_change()';
  end if;
end
$$;

comment on table public.mes_audit_admins is 'Accounts allowed to read audit logs. Insert approved emails here.';
comment on table public.mes_audit_logs is 'Audit trail for MES orders and materials.';

commit;
