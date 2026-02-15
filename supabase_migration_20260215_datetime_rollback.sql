-- Rollback date: 2026-02-15
-- Purpose: rollback mes_orders.start_time/due_date to text columns.

begin;

alter table public.mes_orders
  add column if not exists start_time_old_text text not null default '',
  add column if not exists due_date_old_text text not null default '';

update public.mes_orders
set
  start_time_old_text = coalesce(to_char(start_time at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS'), ''),
  due_date_old_text = coalesce(due_date::text, '');

alter table public.mes_orders drop trigger if exists trg_sync_mes_orders_legacy_text_cols;
drop function if exists public.sync_mes_orders_legacy_text_cols();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mes_orders'
      AND column_name = 'start_time'
      AND data_type = 'timestamp with time zone'
  ) THEN
    ALTER TABLE public.mes_orders RENAME COLUMN start_time TO start_time_timestamptz;
    ALTER TABLE public.mes_orders RENAME COLUMN start_time_old_text TO start_time;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mes_orders'
      AND column_name = 'due_date'
      AND data_type = 'date'
  ) THEN
    ALTER TABLE public.mes_orders RENAME COLUMN due_date TO due_date_date;
    ALTER TABLE public.mes_orders RENAME COLUMN due_date_old_text TO due_date;
  END IF;
END
$$;

drop index if exists idx_mes_orders_start_time;
drop index if exists idx_mes_orders_due_date;

commit;
