-- 258_backup_exclude_self.sql
--
-- The nightly backup had not run for 14 days. It was backing up itself.
--
-- fn_backup_export() loops over every BASE TABLE in `public` and dumps
-- each to JSON. That included `auto_backup`, the table holding previous
-- backups — so every run swallowed all earlier backups whole and the
-- payload doubled each night:
--
--   id 1  05-Aug   6.4 MB   0 nested backups
--   id 2  05-Aug    13 MB   1
--   id 3  06-Aug    25 MB   2
--   id 4  07-Aug     -      would be ~50 MB -> statement timeout
--
-- cron.job_run_details shows exactly that: 2 successes (05/06-Aug) then
-- 14 consecutive failures from 07-Aug to 20-Aug, every one
--   "canceling statement due to statement timeout
--    CONTEXT: PL/pgSQL function fn_backup_export() line 14 at EXECUTE"
--
-- The whole database is 36 MB and a single backup row was 25 MB of it.
--
-- Retention was never broken: fn_auto_backup_run() prunes rows older
-- than 7 days, but that line sits AFTER the export, which threw first.
-- Fixing the export fixes retention too.
--
-- audit_log (4 MB) is deliberately still included — it is real history,
-- not derived from the backup mechanism. Revisit if backups get slow.

create or replace function public.fn_backup_export()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  tables_json jsonb := '{}'::jsonb;
  tbl record;
  tbl_data jsonb;
begin
  for tbl in
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
      -- NEVER back up the backup table. Including it made each run
      -- contain every previous run, doubling the payload nightly until
      -- it blew the statement timeout. See migration 258.
      and table_name <> 'auto_backup'
    order by table_name
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t', tbl.table_name)
      into tbl_data;
    tables_json := jsonb_set(tables_json, array[tbl.table_name], tbl_data);
  end loop;

  execute 'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from auth.users t' into tbl_data;
  tables_json := jsonb_set(tables_json, array['auth.users'], tbl_data);

  execute 'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from auth.identities t' into tbl_data;
  tables_json := jsonb_set(tables_json, array['auth.identities'], tbl_data);

  return jsonb_build_object(
    'meta', jsonb_build_object(
      'version', 1,
      'app', 'PPK TEX ERP',
      'created_at', now()
    ),
    'tables', tables_json
  );
end;
$function$;

-- Clear the three bloated rows. All are contaminated (each contains the
-- earlier ones) and all pre-date the 7-day retention window anyway, so
-- the prune step would have removed them on the next successful run.
delete from public.auto_backup;
