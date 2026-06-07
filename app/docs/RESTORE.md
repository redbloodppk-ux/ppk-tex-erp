# Backup & Restore Runbook — PPK TEX ERP

**Card:** CORR-H7 (Production Hardening)
**Owner:** Praveen Kumar
**Last reviewed:** 7 Jun 2026

This runbook covers how PPK TEX ERP's data is backed up, how to restore from a backup if production is corrupted or lost, and the quarterly drill that proves the restore actually works. Read this end-to-end before the first production user logs in.

---

## 1. What gets backed up

| Layer | Mechanism | Frequency | Retention | Owner |
|---|---|---|---|---|
| Supabase Postgres (live DB) | Daily automatic backup | Daily, 02:00 UTC | 7 days (Free) / 30 days (Pro) | Supabase |
| Supabase Postgres (PITR) | Continuous WAL streaming | Every transaction | 7 days back (Pro tier only) | Supabase |
| Application code | Git push to GitHub | Per commit | Forever | GitHub |
| Vercel build artifacts | Vercel deployment history | Per push | 30 days of deployments | Vercel |
| Supabase Auth users | Same daily backup as DB | Daily | Same as above | Supabase |
| Secrets (.env on Vercel) | Vercel project settings | Per change | Forever, encrypted | Vercel |
| Weekly off-site export (this runbook) | Edge Function `weekly-export` | Sunday 22:00 IST | 90 days | We host on Supabase Storage |

**What is NOT backed up automatically:**

- Local `.env` files on the owner's laptop (keep them in a password manager).
- Anything in `node_modules/` (regenerable; never back this up).
- Files uploaded to Supabase Storage that aren't in the weekly export's allowlist.

---

## 2. Enabling the right backup tier

Supabase Free tier only keeps 7 days of daily backups and **no Point-in-Time Recovery (PITR)**. For a production ERP that's not enough — a payroll mistake on a Monday isn't worth losing six days of subsequent data to recover.

**Before the first non-owner user logs in:**

1. Sign in to Supabase Dashboard → Project `ppk-tex-erp` → Settings → Subscription.
2. Upgrade to **Pro** (currently US$25/month).
3. Go to Database → Backups. Confirm "Daily backups" is on (it is by default on Pro).
4. Toggle "Point-in-Time Recovery" **on**. Pick the 7-day retention window for cost; 14-day or 28-day are available if needed.
5. Tick the checkbox confirming the cost increase.

Verify:

- Run `SELECT pg_is_in_recovery();` in the SQL editor — should return `f` (false). PITR streams from the live primary; you should not be on a replica when running queries from the dashboard.
- Wait 24 hours, then check Database → Backups → "Restore". You should see at least one timestamped restore point.

---

## 3. Weekly off-site export (belt-and-braces)

In addition to Supabase's own backups, we keep a weekly export of the critical tables in Supabase Storage under a separate project so a Supabase-side incident doesn't take both copies out.

### 3.1 What's in the export

- `party`, `jobwork_party`, `ledger` — master party data
- `fabric_quality`, `yarn_count`, `bobbin`, `ends_master` — master specs
- `sales_invoice`, `sales_invoice_item`, `delivery_challan`, `dc_line` — sales side
- `purchase_invoice`, `purchase_invoice_item` — purchase side
- `production_batch`, `pavu`, `sizing_job` — production
- `jobwork_warp_beam`, `jobwork_weft_bag`, `bobbin_stock` — jobwork ledger
- `attendance_day`, `attendance_record`, `wage_entry` — attendance + wages
- `audit_log` — change history
- `opening_stock`, `doc_sequence`, `user_profile` — admin tables

Not exported: `node_modules`, anything `*_archive`, anything `*_tmp`.

### 3.2 Export script

Lives in `supabase/functions/weekly-export/` as a Supabase Edge Function. Schedule:

```sql
-- run on cron: 22:00 IST every Sunday = 16:30 UTC
SELECT cron.schedule(
  'weekly-export',
  '30 16 * * 0',
  $$ SELECT net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/weekly-export',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role'))
  ) $$
);
```

The function writes one gzipped JSON file per table to a private storage bucket `backups/` under a folder `YYYY-WW/` (year-week). Files older than 90 days are pruned by a second nightly cron job.

**Sanity check after first run:**

- Supabase Dashboard → Storage → `backups` → `YYYY-WW/` should list ~25 `.json.gz` files.
- Pick `sales_invoice.json.gz`, download, `gunzip`, verify row count roughly matches the live table.

---

## 4. Restore procedures

### 4.1 Quick PITR restore (last 7 days, point-in-time)

**When to use:** A bad migration ran 2 hours ago and you want the DB exactly as it was 3 hours ago.

1. Supabase Dashboard → Database → Backups → "Restore".
2. Pick "Point-in-time" tab.
3. Choose the timestamp (UTC). The dashboard converts from your browser timezone — double-check the UTC offset.
4. Click "Restore to new project". **Never restore in place on production** — always restore to a fresh project, verify, then swap.
5. Supabase creates a new project (5–10 min). You'll get a new project URL + service role key.
6. Compare the restored project to live (see §5 — Verifying a restore).
7. If the restored copy looks correct, point Vercel's `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the new project, redeploy.
8. Once stable, decommission the broken project (Settings → General → Pause project, then later Delete).

### 4.2 Daily backup restore (last 7 / 30 days, midnight UTC snapshots)

**When to use:** The corruption is more than 7 days old (beyond PITR window), but within the daily backup retention.

1. Supabase Dashboard → Database → Backups → "Restore" → "Daily" tab.
2. Pick the date.
3. Same flow as §4.1 from step 4 onwards.

### 4.3 Weekly off-site restore (90 days, weekly Sunday snapshots)

**When to use:** Both Supabase's daily and PITR backups are gone (very rare — Supabase outage + retention window expired) or you specifically need a value that was correct as of last Sunday.

1. Spin up a fresh empty Supabase project.
2. Apply the schema: run every file in `app/db/migrations/` in order (the repo is the source of truth).
3. From the off-site bucket (`backups/YYYY-WW/`), download every `.json.gz` for the target week.
4. For each file, `gunzip`, then load via `psql \copy` or a small Node script that does `INSERT ... ON CONFLICT DO NOTHING`. Loading order matters because of foreign keys — start with `ledger`, `party`, `jobwork_party`, `fabric_quality`, then transactional tables.
5. Re-run sequences: `SELECT setval('<table>_id_seq', (SELECT MAX(id) FROM <table>))` for every table that has an integer id.
6. Verify (§5), then swap as in §4.1 step 7.

### 4.4 Vercel rollback (code, not data)

**When to use:** A deployment broke something but the DB is fine.

1. Vercel Dashboard → Project `ppk-tex-erp` → Deployments.
2. Find the last known-good deployment (green check, last good timestamp).
3. Click "..." → "Promote to Production". This is instant — the previous deployment becomes live again.
4. Investigate the broken build before re-deploying.

---

## 5. Verifying a restore

Always run these checks before swapping production over to the restored copy.

```sql
-- Row counts in critical tables (vs your reference from before the incident)
SELECT 'sales_invoice'      AS table, count(*) FROM sales_invoice
UNION ALL SELECT 'sales_invoice_item',  count(*) FROM sales_invoice_item
UNION ALL SELECT 'delivery_challan',    count(*) FROM delivery_challan
UNION ALL SELECT 'production_batch',    count(*) FROM production_batch
UNION ALL SELECT 'pavu',                count(*) FROM pavu
UNION ALL SELECT 'attendance_record',   count(*) FROM attendance_record
UNION ALL SELECT 'wage_entry',          count(*) FROM wage_entry
UNION ALL SELECT 'ledger',              count(*) FROM ledger
UNION ALL SELECT 'audit_log',           count(*) FROM audit_log;

-- Latest timestamp per critical table (should be at or before the restore point)
SELECT 'sales_invoice'    AS table, max(created_at) FROM sales_invoice
UNION ALL SELECT 'attendance_record', max(created_at) FROM attendance_record
UNION ALL SELECT 'audit_log',         max(created_at) FROM audit_log;

-- Sample read: pull the most recent 5 invoices and eyeball them in the live app
SELECT id, code, dc_date, status FROM sales_invoice
ORDER BY id DESC LIMIT 5;

-- Sequence sanity: this MUST be greater than the largest existing id
SELECT last_value FROM sales_invoice_id_seq;
SELECT MAX(id) FROM sales_invoice;
```

App-level smoke test (5 min):

1. Log in with the owner account on the restored URL.
2. Open the Operations Dashboard. KPIs should populate.
3. Open Sales Invoice list. The most recent invoice from before the incident is present.
4. Open one invoice — its line items and totals match what was on screen before.
5. Open Attendance → Mark for today. The grid loads.

If any of these fail, **do not swap**. Either restore from an earlier point or investigate.

---

## 6. The quarterly drill

A backup you've never tested is not a backup. Run this once a quarter (set a Google Calendar repeating event). Pick a low-traffic afternoon.

**Drill checklist:**

1. Pick the PITR timestamp = 24 hours ago.
2. Run the restore to a new project (§4.1 steps 1–5).
3. Spin up Vercel preview deployment pointing at the restored project (set the env vars on the preview branch, not production).
4. Run all checks in §5 against the preview.
5. Record the result in `docs/RESTORE_DRILLS.md` with: date, restore type, restore duration (start → preview live), any anomalies, fix actions.
6. Delete the restored project and the preview deployment to stop the meter.

**Pass criteria:** All §5 checks pass, restore completes within 30 minutes start-to-finish.

**Fail action:** File a card in the next sprint to fix whatever broke. Block production go-live on it if discovered pre-launch.

---

## 7. Incident response — when production goes down

1. **Stop writes.** Vercel Dashboard → set the project's "Build Output Override" to a static "Under maintenance" page, OR turn on a maintenance flag in Vercel env vars and let `app/middleware.ts` redirect everything to `/maintenance`. (Either approach belongs in the codebase; for v1, use the env var route.)
2. **Assess.** Is the DB corrupt? Did a migration fail? Did a deploy break the app? Match the symptom to one of §4's restore types.
3. **Communicate.** Send Praveen + any active operators a message: "Production is down. ETA to restore: X. Symptoms: Y."
4. **Restore** per §4.
5. **Verify** per §5.
6. **Lift maintenance.** Remove the env var; re-enable writes.
7. **Postmortem.** Write a one-pager: timeline, root cause, fix, prevention. File in `docs/incidents/YYYY-MM-DD-<slug>.md`.

---

## 8. Common gotchas

- **Sequences out of sync after restore from JSON dumps.** Always re-run `setval` for every `*_id_seq`. Symptom: inserts fail with "duplicate key violates unique constraint".
- **RLS policies block your service role.** Service role bypasses RLS. If you ran restore as a regular user, you'll see empty tables. Use the service role key for the restore data load.
- **Time zones in PITR.** Supabase shows timestamps in UTC. Indian Standard Time is UTC+5:30. A 14:00 IST restore point is 08:30 UTC.
- **Vercel env-var changes don't redeploy.** Setting new env vars in Vercel doesn't trigger a build. After repointing Supabase URL/keys, you must manually trigger a redeploy (Deployments → "..." on the latest → "Redeploy").
- **Storage objects (uploaded files) aren't covered by daily backups.** The weekly off-site export covers DB rows only. If you have invoice PDFs or signature images in Storage, mirror that bucket to S3 separately.
- **The audit_log itself can be huge.** During a panic restore, partial-load the audit_log last and accept partial coverage if needed — it's append-only and won't break referential integrity.

---

## 9. Open decisions before production

- **D14 (from Correction Guide §7):** When to upgrade to Vercel Pro + Supabase Pro? Recommended: before the first non-owner user logs in. This runbook assumes Pro.
- **Off-site bucket location:** Currently planned to live in Supabase Storage on the same project. For true off-site, mirror to AWS S3, Backblaze B2, or Google Drive. Decide at production-go-live time.
- **Drill cadence:** Quarterly above is the recommendation. Higher-stakes operations may want monthly.
- **Retention for the off-site export:** 90 days currently. Some businesses need 7 years for tax/audit. If GST / income-tax compliance requires longer, extend the prune cutoff in the Edge Function.

---

End of runbook. Next revision when the drill checklist surfaces something this document doesn't cover.
