-- Migration date: 2026-02-15
-- Purpose: migrate mes_orders.start_time/due_date from text to timestamptz/date,
-- and keep legacy text columns in sync for compatibility.

begin;

alter table public.mes_orders
  add column if not exists start_time_new timestamptz,
  add column if not exists due_date_new date;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mes_orders'
      AND column_name = 'start_time'
      AND data_type = 'text'
  ) THEN
    EXECUTE $sql$
      update public.mes_orders
      set start_time_new =
        case
          when start_time is null or btrim(start_time) = '' then null
          when replace(start_time, '/', '-') ~ '^\\d{4}-\\d{2}-\\d{2}$'
            then (replace(start_time, '/', '-') || 'T00:00:00Z')::timestamptz
          when replace(start_time, '/', '-') ~ '^\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}$'
            then (regexp_replace(replace(start_time, '/', '-'), ' ', 'T') || ':00Z')::timestamptz
          when replace(start_time, '/', '-') ~ '^\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}:\\d{2}$'
            then (regexp_replace(replace(start_time, '/', '-'), ' ', 'T') || 'Z')::timestamptz
          when replace(start_time, '/', '-') ~ '^\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}:\\d{2}(Z|[+-]\\d{2}:\\d{2})$'
            then regexp_replace(replace(start_time, '/', '-'), ' ', 'T')::timestamptz
          else null
        end
      where start_time_new is null
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mes_orders'
      AND column_name = 'due_date'
      AND data_type = 'text'
  ) THEN
    EXECUTE $sql$
      update public.mes_orders
      set due_date_new =
        case
          when due_date is null or btrim(due_date) = '' then null
          when replace(due_date, '/', '-') ~ '^\\d{4}-\\d{2}-\\d{2}$'
            then replace(due_date, '/', '-')::date
          else null
        end
      where due_date_new is null
    $sql$;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mes_orders'
      AND column_name = 'start_time'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE public.mes_orders RENAME COLUMN start_time TO start_time_text;
    ALTER TABLE public.mes_orders RENAME COLUMN start_time_new TO start_time;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mes_orders'
      AND column_name = 'due_date'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE public.mes_orders RENAME COLUMN due_date TO due_date_text;
    ALTER TABLE public.mes_orders RENAME COLUMN due_date_new TO due_date;
  END IF;
END
$$;

alter table public.mes_orders
  add column if not exists start_time_text text not null default '',
  add column if not exists due_date_text text not null default '';

update public.mes_orders
set
  start_time_text = coalesce(to_char(start_time at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS'), ''),
  due_date_text = coalesce(due_date::text, '')
where
  coalesce(start_time_text, '') = ''
  or coalesce(due_date_text, '') = '';

create or replace function public.sync_mes_orders_legacy_text_cols()
returns trigger
language plpgsql
as $$
begin
  NEW.start_time_text := coalesce(to_char(NEW.start_time at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS'), '');
  NEW.due_date_text := coalesce(NEW.due_date::text, '');
  return NEW;
end;
$$;

drop trigger if exists trg_sync_mes_orders_legacy_text_cols on public.mes_orders;
create trigger trg_sync_mes_orders_legacy_text_cols
before insert or update of start_time, due_date
on public.mes_orders
for each row
execute function public.sync_mes_orders_legacy_text_cols();

create index if not exists idx_mes_orders_start_time on public.mes_orders(start_time desc);
create index if not exists idx_mes_orders_due_date on public.mes_orders(due_date);

commit;
