# PPK TEX ERP — Correction Guide v1.1 (text extract)

> Companion file. The authoritative copy is the original Word document
> uploaded by the owner: `PPK_TEX_ERP_Correction_Guide_v1.1.docx`.
> This markdown copy lives in the repo so the AI agent and reviewers can
> quote and link to specific sections during work.

## Status (as of 16-May-2026)

| Group | Cards | Done | In progress | Blocked / pending |
|-------|-------|------|-------------|-------------------|
| 1. Foundation Fixes (F1–F5)         | 5  | 5 | — | — |
| 2. True Cost Engine (T1–T4)         | 4  | — | — | 4 |
| 3. Production Intelligence (P1–P5)  | 5  | — | — | 5 |
| 4. Reports & Dashboards (R1–R12)    | 12 | — | — | 12 |
| 5. Attendance (A1–A7)               | 7  | 2 | — | 5 |
| 6. Production Hardening (H1–H9)     | 9  | — | — | 9 |
| **Totals**                          | **42** | **7** | **0** | **35** |

**F5 was added mid-batch** after a live Supabase advisor scan turned up 7
ERROR-level RLS-bypassing views, a permissive `notification` INSERT policy,
and 11 functions with a mutable `search_path`. Fixed in migration `004` —
see CORR-F5 below.

## Cards completed in this batch (Group 1, 16-May-2026)

### CORR-F1 — Re-enable TypeScript strict mode
* `next.config.mjs`: `typescript.ignoreBuildErrors = false`, `eslint.ignoreDuringBuilds = false`.
* `tsconfig.json`: added `noUncheckedIndexedAccess` + `noImplicitOverride`.
* Follow-up: run `npm run typecheck` and fix any newly-surfaced errors with
  minimal changes. The Supabase typegen output (`lib/database.types.ts`)
  is currently a placeholder stub — running `npm run typegen` against the
  live project will let queries type-check correctly.

### CORR-F2 — Money/measurement column audit
* `scripts/audit-numeric-columns.sql` — runs against the live Postgres and
  prints every suspect column with a verdict (OK / VIOLATION).
* `db/migrations/003_money_numeric_types.sql` — no-op migration with a
  documented audit. Local grep over `schema.sql`, `001_sizing_pavu.sql`,
  and `002_invoices_expansion.sql` found zero `float8`/`double precision`/`real`
  in any money or weight column.

### CORR-F3 — Test infrastructure
* Added dev-deps: `vitest`, `@vitest/coverage-v8`, `@testing-library/react`,
  `@testing-library/jest-dom`, `jsdom`, `@playwright/test`.
* Added runtime dep: `decimal.js`.
* New scripts: `test`, `test:watch`, `test:coverage`, `test:e2e`, `typecheck`.
* `vitest.config.ts` — node env by default, jsdom opt-in per-file.
* `playwright.config.ts` — boots dev server, runs Chromium smoke test.
* `lib/money.ts` + `lib/money.test.ts` — full decimal.js wrapper plus
  `formatINR()` Indian-comma formatter and paise⇄rupees helpers.
* `tests/e2e/login.spec.ts` — smoke test that the login page renders.

### CORR-F4 — Cost formula library
All 14 formulas from FabricCosting_FrozenSpec_v1.1 §A.2 implemented as
pure Decimal-returning functions plus Vitest suites:

* `warpMetre`, `weftMetre`, `warpCost`, `weftCost`
* `pickCost`, `bobbinCost`
* `porvaiNeC`, `porvaiWeftMetre`, `porvaiCost`
* `quotedCost`, `trueCostInHouse`, `trueCostVendor`
* `bobbinConsumption` (+ `bobbinPiecesSplit`), `bobbinIssueToVendor`
* `weightedAverage`

`lib/formulas/index.ts` re-exports all functions and their argument types.
Coverage threshold set to ≥95% on `lib/formulas/**` in `vitest.config.ts`.

### CORR-F5 — Database security advisor cleanup (added 16-May-2026)

Live Supabase scan (`get_advisors → security`) surfaced **7 ERRORs** and a
batch of WARNs on the freshly applied schema. Migration
`db/migrations/004_security_hardening.sql` closes all 7 ERRORs.

**What broke**

| # | Finding | Risk |
|---|---------|------|
| 1 | `v_costing_computed`, `v_costing_two_cost`, `v_customer_outstanding`, `v_looms_overhead`, `v_sizing_job_balance`, `v_yarn_days_of_cover`, `v_yarn_weighted_avg` — created without `WITH (security_invoker=on)` | Views ran as the **table owner**, bypassing every RLS policy on the underlying tables. Any logged-in user could read all mills. |
| 2 | `notification` table policy `p_notif_insert` was `FOR INSERT … WITH CHECK (true)` | Any authenticated user could forge notification rows for another user. |
| 3 | 11 application functions had no `search_path` pinned (`fn_audit_row`, `fn_autogen_code`, `fn_invoice_auto_no`, `fn_next_doc_no`, `fn_pa_sync_pavu_status`, `fn_pavu_autogen_code`, `fn_set_updated_at`, `fn_sizing_autogen_code`, `current_user_role`, `is_owner_or_auditor`, `can_write_master`) | `SECURITY DEFINER` functions become hijackable if a malicious schema injects same-named helpers. |
| 4 | `fn_audit_row()` and `fn_autogen_code()` (SECURITY DEFINER triggers) had EXECUTE granted to PUBLIC | A user with REST access could call them directly and write arbitrary audit/code rows. |
| 5 | `current_user_role()`, `is_owner_or_auditor()`, `can_write_master()` (SECURITY DEFINER) were callable by `anon` | No reason for unauthenticated users to introspect role helpers. |

**What was done (migration 004)**

* `ALTER VIEW … SET (security_invoker = on)` on all 7 views — RLS is now
  enforced as the caller's identity, not the owner's.
* `DROP POLICY p_notif_insert` + recreated as
  `WITH CHECK (user_id = auth.uid())`.
* `ALTER FUNCTION … SET search_path = public, pg_temp` on every one of the
  11 application functions.
* `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` on `fn_audit_row()`
  and `fn_autogen_code()` (triggers fire under the table owner's rights, so
  nothing breaks).
* `REVOKE EXECUTE … FROM PUBLIC, anon` then `GRANT EXECUTE … TO
  authenticated` on `current_user_role()`, `is_owner_or_auditor()`,
  `can_write_master(text)` — RLS policies still need to call these.

**After the fix**

Re-running the advisor: **0 ERRORs** (down from 7). The 6 remaining WARNs
are accepted/expected and documented:

* `extension_in_public` × 2 (`pg_trgm`, `btree_gist`) — Supabase
  pre-installs these in `public`; moving them risks breaking dependent
  operator classes. Accepted.
* `authenticated_security_definer_function_executable` × 3
  (`can_write_master`, `current_user_role`, `is_owner_or_auditor`) — these
  are *intentionally* callable by `authenticated` because RLS policies
  invoke them in `USING` / `WITH CHECK` clauses. They are now `anon`-free
  and the search_path is pinned, so the SECURITY DEFINER path is safe.
* `auth_leaked_password_protection` — N/A: PPK TEX uses OTP magic-link
  auth, no passwords.



Per the owner's instruction "When changing tools please make sure yourself
that we needed for our project if it so then you can change tools":

| Tool                     | Status              | Reason                                                                 |
|--------------------------|---------------------|------------------------------------------------------------------------|
| Authentication (OTP)     | **Left as-is**      | Owner directive: don't touch auth.                                     |
| `decimal.js`             | **Added**           | Required by §1.5 ("never use Number for money") and CORR-F2/F4.       |
| `vitest` + `@vitest/coverage-v8` | **Added**   | Required by CORR-F3; mandatory in §1.7 DoD.                            |
| `@playwright/test`       | **Added**           | Required by CORR-F3 and CORR-H9 (15 E2E scenarios).                    |
| `@testing-library/react` + `jsdom` | **Added** | Needed when CORR cards add component tests; harmless to install now.   |
| Radix UI primitives      | **Skipped**         | Optional in §3 ("only for accessible modal/dropdown/popover"). The codebase has no live need yet; add when first non-trivial modal is built. |
| Zustand                  | **Skipped**         | §3 says "for client-side state". Codebase has no cross-component client state today. Add when first needed. |
| TanStack Query           | **Skipped**         | §3 says "only when client-side caching of API data is needed". Server Components handle today's reads. Add when first needed. |
| `exceljs`                | **Skipped (for now)**| Needed by CORR-R12 (Excel export). Will be added when Group 4 begins. |
| `next-pwa`               | **Already present** | Used by the existing offline-cache config; no change needed.           |
| Supabase service-role key in client | **Verified absent** | §1.6 critical-don't. Codebase uses `@supabase/ssr` cookie auth, no service role exposure. |

## Pending (large) — sequenced backlog

The remaining 37 cards are listed (with full acceptance criteria) inside the
master document, not re-typed here. The recommended build order is the
sequence in §5: T1→T4, P1→P5, R1→R12, A1→A7, H1→H9. Each card is roughly
one Claude Code session of work.

## Items still needing owner input (Section 7 in the guide)

These are blockers for specific cards and should NOT be guessed by the agent.

* ~~**D8** Repo visibility — keep public or switch to private? (recommended private)~~  ✅ **RESOLVED 16-May-2026** — stays **public** during build, switch to **private** after ERP is delivered. See §Owner decisions log.
* ~~**D9** Yarn wastage default — confirm 2% or specify a different default~~  ✅ **RESOLVED 16-May-2026** — see §Owner decisions log below.
* ~~**D10** Sizing vendor pricing — confirm `sizing_rate_per_kg` lives on the vendor row~~  ✅ **RESOLVED 16-May-2026** — keep per-job only (Option B). See §Owner decisions log.
* ~~**D11** Invoice 5 doc types + returns — list the 5 types explicitly~~  ✅ **RESOLVED 16-May-2026** — 5 confirmed, DC added as separate doc, general_sale split into sub-prefixes. See §Owner decisions log.
* ~~**D12** Production URL → Supabase Site URL allowlist (10-minute owner task)~~  ✅ **RESOLVED 16-May-2026** — prod URL `https://ppk-tex-erp.vercel.app`. See §Owner decisions log.
* ~~**D13** Confirm role-name casing maps cleanly to the 6 application roles~~  ✅ **RESOLVED 16-May-2026** — DB / RLS / frontend already aligned on `owner, mill_manager, sales_manager, accounts, floor_operator, auditor`. STACK_v1.1.md doc-only fix applied. See §Owner decisions log.
* **D14** Hosting upgrade trigger — at what point do we move to Vercel Pro + Supabase Pro?
* **D15** Rollback shakedown window — keep 60 days or shorten?

## Owner decisions log

### D9 — Yarn wastage default (resolved 16-May-2026)

**Decision**: default wastage = **2 %**, but **editable per costing**.

**Implementation rules**

* `app_settings.yarn_wastage_default_pct numeric(5,4) NOT NULL DEFAULT 0.0200` — single
  row, mutable only by `owner` role.
* Every `costing` (and `costing_construction` line) carries its own
  `wastage_pct numeric(5,4)` column.
  - When a new costing row is created, the form pre-fills from
    `app_settings.yarn_wastage_default_pct`.
  - Mill-manager / accounts users can override the per-line value at entry
    time; the override is captured in `audit_log`.
* The cost formulas (`warpCost`, `weftCost`, `quotedCost`, `trueCostInHouse`,
  `trueCostVendor`) already accept `wastage` as a parameter — no formula
  change needed.
* UI: Settings → "Costing defaults" page lets the owner change the global
  default (effective for *new* costings only — historical rows are never
  back-mutated).
* Validation: `0 ≤ wastage_pct ≤ 0.20` (zod). Anything above 20 % requires
  a comment in the costing notes.

**Cards unblocked by this decision**: CORR-T1, CORR-T2, CORR-T4, CORR-R5
(margin analysis), CORR-R6 (variance dashboard).

### D10 — Sizing vendor pricing location (resolved 16-May-2026)

**Decision**: keep `sizing_rate_per_kg` **per `sizing_job` only** (Option B).
No vendor-level default, no count-based lookup table.

**Implementation rules**

* `sizing_job.sizing_rate_per_kg numeric(10,4) NOT NULL DEFAULT 0` — already
  present in `001_sizing_pavu.sql`, no schema change needed.
* The Sizing-Job form requires the user to type the rate at entry time.
* Zod validation: `sizing_rate_per_kg ≥ 0`. If left at 0 (no billing yet),
  `charges_amount` must also be 0 — enforced as a CHECK constraint in a
  future migration if/when we add billing automation.
* Reports (CORR-R3 sizing-cost view, CORR-R5 margin) will read the rate
  directly off the job row — no vendor-master join for pricing.

**Schema change required**: none.
**Cards unblocked**: CORR-T3 (sizing cost into True Cost), CORR-R3 (sizing
spend report), CORR-R5 (margin analysis).

### D8 — Repo visibility (resolved 16-May-2026)

**Decision**: keep the GitHub repo **public during the build phase**, then
**switch to private once the ERP is fully delivered and live for staff**.

**Implementation rules / safety guardrails (while public)**

* **No secrets in code, ever.** `.env*` files stay in `.gitignore`; only
  `.env.example` (with placeholders) may be committed.
* **No real business data in seeds.** `db/seed.sql` may only contain
  synthetic / sample masters. Real customer, vendor, mill, employee and
  yarn-purchase data goes only into the live Supabase project.
* **No PII or pricing leaks in tests / fixtures.** Any Vitest or Playwright
  fixture that needs realistic data uses obvious placeholders
  (e.g. "Test Customer", "MILL-XXX").
* **No screenshots / dumps of real reports in `docs/` or commit messages.**
* **Service-role key** stays out of the client bundle (already verified in
  CORR-F2 audit — only `@supabase/ssr` cookie auth is used).
* **GitHub Secret Scanning** must be enabled on the repo (free for public
  repos). Push-protection on for committed secrets.

**Switch-to-private checklist (to be run when ERP goes live)**

1. GitHub → repo Settings → "Change visibility" → **Private**.
2. Confirm Vercel deployment continues to work (Vercel's GitHub app already
   has access — no reconnection needed for private repos).
3. Confirm Supabase migrations CI (if any) still runs.
4. Rotate any keys that may have been exposed during the public period
   (Supabase project keys, any third-party API keys).
5. Update repo description / README to remove any "demo" wording.

**Cards unblocked**: none directly, but H7 (backup runbook) and H8 (rollback)
should both note the visibility switch as a pre-go-live step.

### D11 — Invoice doc types, returns, DC & sub-prefixes (resolved 16-May-2026)

**Decision summary**

1. **No proforma invoice.** The 5 doc types in `invoice_doc_type` enum stay
   as-is — `tax_invoice`, `yarn_sale`, `general_sale`, `credit_note`,
   `debit_note`. No quote/proforma layer needed in the ERP.
2. **Delivery Challan is a separate document**, attached to every sales
   invoice (fabric, yarn, general) and every job-work invoice. A new
   `delivery_challan` table is required — DC is NOT a 6th `invoice_doc_type`.
3. **`general_sale` gains a `sub_type` + per-sub-type prefix.** Single
   accounting head, multiple numbering series.

---

#### Detail 1 — 5 invoice types confirmed (no change)

| doc_type      | Prefix | Use                                              | Party    |
|---------------|--------|--------------------------------------------------|----------|
| `tax_invoice` | `INV`  | Fabric sale to customer                          | Customer |
| `yarn_sale`   | `YS`   | Yarn outward to another mill / weaver            | Customer |
| `general_sale`| `GS` / `RNT` | Default `GS`; rent uses `RNT`. See Detail 3 | Customer |
| `credit_note` | `CN`   | Sales return, linked to `original_invoice_id`    | Customer |
| `debit_note`  | `DN`   | Purchase return to mill / vendor                 | Vendor   |

#### Detail 2 — Delivery Challan (new module)

Captured from the uploaded sample `MAHENDRA FABRICS DC009.xlsm`:

**Numbering**: `DC/{FY}/{seq:000}` (3-digit serial, resets each FY).
A new row goes into `doc_sequence` with prefix `DC`.

**Table — `delivery_challan` (header)**
```
id                   bigserial PK
dc_no                text NOT NULL UNIQUE       -- auto: DC/26-27/009
dc_date              date NOT NULL
copy_type            text NOT NULL CHECK (copy_type IN ('original','duplicate','triplicate'))

-- Linkage (exactly one of these must be set)
invoice_id           bigint REFERENCES invoice(id)              -- for sales-invoice DCs
jobwork_id           bigint REFERENCES jobwork(id)              -- for job-work DCs
                                                                -- (jobwork table to be confirmed in P-cards)

-- Party
party_kind           text NOT NULL CHECK (party_kind IN ('customer','vendor'))
customer_id          bigint REFERENCES customer(id)             -- when party_kind='customer'
vendor_id            bigint REFERENCES vendor(id)               -- when party_kind='vendor' (job-work DC)
bill_to_name         text NOT NULL                              -- denormalised snapshot
bill_to_gstin        text
bill_to_address      text NOT NULL
ship_to_name         text NOT NULL                              -- often same as bill_to
ship_to_gstin        text
ship_to_address      text NOT NULL
place_of_supply      text NOT NULL                              -- e.g. 'TAMILNADU'
state_code           text NOT NULL                              -- e.g. '33'

-- Item description (single fabric quality per DC, as per the sample)
quality_desc         text NOT NULL                              -- "WHITE THALAPATHY TOWEL 1.40L 62 X 46 = 30\""
agent_name           text                                       -- 'DIRECT' or agent name

-- Delivery details
vehicle_num          text
fabric_quality       text                                       -- e.g. '60 X 46'
fabric_width         text                                       -- e.g. '30 INCH'
fabric_pinning_cm    numeric(6,2)                               -- e.g. 73.00
fabric_weight_gsm    text                                       -- '110+ GMS' (free-text)
total_metres         numeric(12,3) NOT NULL DEFAULT 0           -- = SUM(dc_line.metres)
total_pieces         integer NOT NULL DEFAULT 0                 -- = COUNT(dc_line)
total_bundles        integer NOT NULL DEFAULT 0

-- Status & audit
status               text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','cancelled'))
created_at, created_by, updated_at, updated_by                  -- standard audit columns

CONSTRAINT dc_linkage CHECK ((invoice_id IS NOT NULL) <> (jobwork_id IS NOT NULL))
CONSTRAINT dc_party   CHECK (
  (party_kind='customer' AND customer_id IS NOT NULL AND vendor_id IS NULL) OR
  (party_kind='vendor'   AND vendor_id   IS NOT NULL AND customer_id IS NULL)
)
```

**Table — `dc_line` (piece-by-piece quantity grid)**
```
id              bigserial PK
dc_id           bigint NOT NULL REFERENCES delivery_challan(id) ON DELETE CASCADE
piece_no        integer NOT NULL                                 -- 1, 2, 3, … (matches the 1-14 grid in the sample)
metres          numeric(8,3) NOT NULL DEFAULT 0
bundle_no       integer                                          -- optional grouping
remarks         text
UNIQUE (dc_id, piece_no)
```

**Auto-computed columns**
- `total_metres` = `SUM(dc_line.metres)` — refresh in Server Action on save.
- `total_pieces` = `COUNT(dc_line WHERE metres > 0)`.
- `total_bundles` = entered manually by user (the sample shows 2 bundles for
  10 pieces — the bundling is not 1:1 with pieces).

**PDF layout**
- Re-create the exact look of the sample DC (header logo + address block,
  bill-to/ship-to side-by-side, 7-column × 2-row piece grid, delivery details
  footer, signatory block). To be built in the DC card (will sit under H-cards
  as part of "PDF templates").

**Wiring rules**
- Every `tax_invoice`, `yarn_sale`, and `general_sale` row **must** have at
  least one `delivery_challan` row before the invoice can be marked
  `delivered`. Multiple DCs can roll up into one invoice (split deliveries),
  but the totals on the invoice must equal the sum of its DCs.
- Job-work DCs (sending fabric out for finishing) link to the future
  `jobwork` table — schema to be finalised in a P-card.

#### Detail 3 — `general_sale` sub-types & prefixes (resolved 16-May-2026)

**Decision**: only **rent** gets a dedicated prefix. Everything else
(scrap, service, misc, anything new) stays under the existing `GS` prefix.

The `general_sale` doc_type stays single (so GSTR-1 reporting rolls up
cleanly). One small column added to `invoice`:

```
ALTER TABLE invoice
  ADD COLUMN general_sale_sub_type text
    NOT NULL DEFAULT 'general'
    CHECK (general_sale_sub_type IN ('general','rent'));

ALTER TABLE invoice
  ADD CONSTRAINT invoice_general_sub_check CHECK (
    doc_type <> 'general_sale' OR general_sale_sub_type IS NOT NULL
  );
```

**Prefix mapping**

| `doc_type`     | `general_sale_sub_type` | Prefix | Use                          |
|----------------|-------------------------|--------|------------------------------|
| `general_sale` | `rent`                  | `RNT`  | Rental income (loom / shed)  |
| `general_sale` | `general` (default)     | `GS`   | Scrap, service, misc — everything else |

`doc_sequence` gets one new row (`RNT`). The `fn_invoice_auto_no()` trigger
gets a branch: when `doc_type = 'general_sale' AND general_sale_sub_type = 'rent'`,
pull next number from `RNT` series; otherwise from existing `GS` series.

**Schema changes required**
1. New migration `004_delivery_challan.sql` — creates `delivery_challan` +
   `dc_line` + `doc_sequence` row for `DC` + auto-no trigger.
2. New migration `005_general_sale_subtypes.sql` — adds
   `general_sale_sub_type` column + check + 4 `doc_sequence` rows + trigger
   branch update.
3. RLS policies for the new tables (6 roles).

**Cards unblocked / created**
- New card **CORR-R-DC1**: Build DC entry screen + PDF (will slot before
  CORR-R12).
- Closes blockers on CORR-R11 (invoice → DC delivery report) and CORR-R12
  (Excel export needs DC totals).

**Follow-up questions — resolved 16-May-2026**
- ✅ Sub-prefixes: **only `rent` (RNT) gets its own; everything else uses `GS`.**
  See Detail 3 above for the simplified 2-value enum.
- ✅ Return DC: **not needed.** Customer returns are handled by the
  `credit_note` alone — no reverse DC. The `delivery_challan` table
  therefore does NOT need a `dc_kind` ('outward'/'return') enum.

### D12 — Production URL & Supabase allowlist (resolved 16-May-2026)

**Decisions**

| Setting             | Value                                                       |
|---------------------|-------------------------------------------------------------|
| Production URL      | `https://ppk-tex-erp.vercel.app`                            |
| Staging URLs        | Vercel preview branches (default; `*-git-<branch>-*.vercel.app`) |
| Custom domain       | None (deferred — may add `erp.ppktex.in` post-launch)       |
| PWA install URL     | Same as Production URL (`https://ppk-tex-erp.vercel.app`)   |

**Owner task — paste these into Supabase Dashboard**

Go to **Supabase Dashboard → Project → Authentication → URL Configuration**.

1. **Site URL** (single field, canonical primary URL):
   ```
   https://ppk-tex-erp.vercel.app
   ```

2. **Redirect URLs** (allowlist — one per line; supports `*` and `**` wildcards):
   ```
   https://ppk-tex-erp.vercel.app/auth/callback
   https://ppk-tex-erp.vercel.app/**
   https://ppk-tex-erp-*.vercel.app/auth/callback
   https://ppk-tex-erp-*.vercel.app/**
   http://localhost:3000/auth/callback
   http://localhost:3000/**
   ```

   Line-by-line meaning:
   - Lines 1-2: production deployment callback + any in-app redirect after login.
   - Lines 3-4: every Vercel preview deployment (matches PR previews, staging
     branches, `git-<branch>` builds). Without these, magic links from
     preview deploys silently fail.
   - Lines 5-6: local development with `npm run dev`.

3. Click **Save**.

**Vercel — Production environment variables**

In **Vercel Dashboard → Project `ppk-tex-erp` → Settings → Environment Variables**,
make sure these are set for the **Production** environment (and re-deploy
afterwards):

| Key                              | Value                              |
|----------------------------------|------------------------------------|
| `NEXT_PUBLIC_SUPABASE_URL`       | `https://<project-id>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | `<anon key from Supabase>`         |
| `SUPABASE_SERVICE_ROLE_KEY`      | `<service role key>` — **server only, never expose** |
| `SUPABASE_PROJECT_ID`            | `<project-id>`                     |
| `NEXT_PUBLIC_SITE_URL`           | `https://ppk-tex-erp.vercel.app`   |
| `NEXT_PUBLIC_DEFAULT_TZ`         | `Asia/Kolkata`                     |

Repeat the same set for the **Preview** environment if you want previews
to talk to a separate Supabase staging project (recommended later; not
required for this card).

**Verification (3-minute smoke test)**

1. Visit `https://ppk-tex-erp.vercel.app/login` in incognito.
2. Enter the owner email (`redbloodppk@gmail.com`) and request OTP.
3. Open the email — the magic-link URL should start with
   `https://ppk-tex-erp.vercel.app/auth/callback?code=…`. **Not** localhost,
   **not** the Supabase project URL.
4. Click the link. You should land on `/app/dashboard` with a valid session.
5. If you instead see "Email link is invalid or has expired" — recheck the
   Redirect URLs allowlist (most common mistake: missing the `/**` wildcard
   line).

**Repo change made in this card**: `.env.example` updated to reference
the production URL as the canonical example, with the localhost default
moved to a clarifying comment.

### D13 — Role-name casing & 6-role mapping (resolved 16-May-2026)

**Decision**: **Option A — keep all 6 names as-is.** The DB enum, RLS
helpers, and frontend types were already consistent; only `STACK_v1.1.md`
held stale names from a much earlier draft.

**The 6 roles (locked in)**

| Role             | Purpose                                                                                              |
|------------------|------------------------------------------------------------------------------------------------------|
| `owner`          | Full access. Only role that can approve costings, edit users, edit company/system config.            |
| `mill_manager`   | Day-to-day operations: yarn, sizing, pavu, production, bobbin, outsource/jobwork/resale, attendance, all masters. |
| `sales_manager`  | Customers, sales orders, costing (read), invoices, customer payments, reports.                       |
| `accounts`       | Invoices, customer payments, purchase payments, wages, attendance, reports.                          |
| `floor_operator` | Sizing, pavu, production, attendance entry — shop-floor data-entry role. **Default for new users.**  |
| `auditor`        | Read-only across everything, plus audit-log access.                                                  |

**Verified alignment**

| Layer                                    | Status                                  |
|------------------------------------------|-----------------------------------------|
| Live DB `user_role` enum                 | ✅ all 6 present (Supabase verified)    |
| `db/schema.sql`                          | ✅ matches                              |
| `db/rls.sql` (`current_user_role`, `is_owner_or_auditor`, `can_write_master`) | ✅ matches |
| Frontend types (`sidebar.tsx`, `app-shell.tsx`, `layout.tsx`) | ✅ matches              |
| `docs/STACK_v1.1.md`                     | ✅ fixed in this card (was listing stale `supervisor` + `staff`) |

**Implication for downstream cards**: any new RLS policy, role check, or
UI gate must use exactly these 6 strings. No new enum value is introduced
without a fresh owner decision.



**Cards unblocked**: CORR-H1 (PWA install flow needs a stable Site URL),
CORR-H8 (rollback runbook needs a known production target),
CORR-H9 (Playwright E2E suite will smoke-test against the production URL).
  