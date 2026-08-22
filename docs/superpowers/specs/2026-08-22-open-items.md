# PPK TEX ERP — Open Items

**As at:** 2026-08-22, end of session
**Everything below is verified against the live database, not recalled.**

---

## A. Needs YOUR input — I cannot resolve these

### A1. Warp still overstated on two specs — needs a beam reading

| Spec | Book says | Beams on record | Overstated by |
|---|---|---|---|
| 1670 · DOBBY-CT-TOWEL-31 | 26,480.00 | 26,480.00 | **0** ✓ |
| 1770 · DOBBY-OE-TOWEL-31 | 3,354.40 | 2,560.00 | **794.40** |
| 1770 · COLOR-OE | 0.00 | 0 | **0** ✓ |
| 2400 · TOWEL-34 / LUREX | 3,098.20 | 1,280.00 | **1,818.20** |

1770 has moved since this morning (3,800 → 2,560), so a beam finished during
the day. Both remaining gaps close on their own when the running beams come
off — tell me and I'll zero them, same as COLOR-OE.

1670 reconciles exactly to its beams, but that treats all ten loom beams as
untouched. A rough read on the two oldest — **3774 (L-04)** and **3775 (L-05)**,
both sized 02-Jul — would tighten it. The other eight are recent.

### A2. April–May warp that was never entered

~16,900 m of inflow missing, which is why 15 receipt lines still show negative:

| Spec | Missing |
|---|---|
| 1770 · count 1 | 6,574.20 m |
| 1770 · count 9 (COLOR-OE) | 1,171.65 m |
| 2400 | 9,123.10 m |

Pavu records start 06-Jun; receipts start 06-Apr. Beams sized before the pavu
module existed were never entered. You chose to leave the negatives visible.
Only your records can close this.

### A3. Two loose ends on COLOR-OE

- **~3,404 m of April beams** bought or used but never entered. Worth checking
  April supplier bills from **party 192**.
- **The returned ~1,200 m of cloth** — if it was re-delivered on a second DC,
  you have two receipts for one weaving. Tell me roughly when it came back and
  I can check for a duplicate.

### A4. L-09 quality mismatch — is it intentional?

The loom's `fabric_quality_id` points at **COTTON THALAPATHY 60×46 = 30"**, but
the pavu mounted on 19-Aug runs under costing **COST-0001 = 31"**. Two different
qualities. Might be deliberate, might be a mis-set loom.

---

## B. Known gaps — my recommendation, your call

### B1. No audit trail on production tables — HIGH

`audit_log` covers 9 tables (attendance, customer, payment, invoice, costing,
sales orders, config…) but **not** `loom`, `pavu`, `pavu_assign` or
`jobwork_warp_beam`.

That is why "when did L-09's quality change?" had to be inferred from mount
history, and why the 2190/2200 mix-up left no record of who changed what.
For tables where a wrong value silently mis-routes stock, that is the gap
worth closing first. Same `fn_audit_row` already running elsewhere — small
migration.

### B2. `lib/database.types.ts` is stale

Still declares the 5 tables and 5 columns dropped in migration 259.
Harmless today (those paths cast through `any`), but wrong. Needs a token
I don't have:

```
npx supabase login
npm run typegen
```

### B3. Two pre-existing test failures

`lib/money.test.ts` (formatINR null case) and `lib/dc-leftover.test.ts`.
Both fail identically with all of today's work stashed — they predate this
session and are untouched by it. 127 other tests pass.

### B4. `pavu_assign.metres_produced` is badly under-recorded

Beams marked *finished* show only 7,054 m woven against 15,920 m of beam.
It is not used for stock (receipts are), but it means loom output and beam
wastage can't be measured from it.

### B5. Security / RLS never audited

Not examined at all this session. Worth its own pass — particularly with
Supabase keys sitting in a Dropbox folder.

### B6a. `node_modules` is only half-downloaded from Dropbox

`typescript`, `next`, `react` and `react-dom` are online-only placeholders —
any tool that opens them gets an I/O error, so `tsc` and `vitest` cannot run
in this folder as it stands. The party_id change was typechecked against a
separately installed TypeScript instead, which catches real type errors but
not missing-module ones.

Fix: right-click `node_modules` in Dropbox → **Make available offline**, or
keep the checkout outside Dropbox and let Dropbox hold only the source.

### B6b. Git line endings

Windows Git has `core.autocrlf=true`, so the working copy is CRLF and the
repository is LF. Any tool that rewrites a file with LF endings makes a
non-Windows Git report the whole file as changed — 69,000 phantom lines
across 96 files at one point in this session. Nothing was wrong; run
`git status` from Windows and it comes back clean. Worth knowing before
committing what looks like a huge diff.

### B6. `next build` never completed

Every change was verified with `tsc --noEmit` and vitest. A full
`next build` was started once and was still running after 20 minutes
(node_modules on Dropbox). Worth running once cleanly before you next deploy.

---

## C. From the audit — items 6 and 7

### C1. `party` and `customer` are two tables joined by NAME — the biggest
structural risk

**Half done.** `invoice.party_id` now exists as a real FK (migration 262) and
every place that looks up a party's invoices uses it:

| Site | Status |
|---|---|
| `lib/party-bills.ts` (payments, bill picker, contra) | party_id ✓ |
| Party statement print | party_id ✓ (commit da80035) |
| Payments → Transactions tab | party_id ✓ (commit da80035) |
| `invoices/new` HSN/UOM prefill | name match, deliberate — cosmetic only |

Verified before and after: all 94 invoices carry a `party_id`, and each one
resolves to exactly the party the old name match found. Renaming a party can
no longer detach its invoice history.

Two of those queries keep a **second** query for rows with a null `party_id`.
That is not belt-and-braces — the invoice form writes `party_id = null` for
**debit notes**, because a debit note is raised against a *vendor ledger*,
which is not a party. None exist yet, so the path is untested; the first debit
note you raise will exercise it.

**Still open:** retiring the `customer` table. 167 customers, 90 rows pointing
at it across `invoice` and `sales_order`, and **6 views** depend on it
(`v_agent_commission_report`, `v_cashflow_recent`, `v_customer_ageing`,
`v_customer_outstanding`, `v_invoice_delivery_status`, `v_sales_register`).
The views are what make this a separate piece of work.

### C2. Three very large files

`jobwork/page.tsx` 3,852 · `warehouse/page.tsx` 3,569 · `payments/page.tsx`
2,557. Best split opportunistically as you touch them, not as a project.

---

## D. Verified clean — no action needed

So the absence of a finding is real:

- **No other warp batch** disagrees with its quality's expected ends —
  WBG-0024 was the only one.
- Money integrity: 0 issues across allocations, invoice balances,
  over-allocation, orphans, duplicate names, negative yarn stock.
- Ledger foreign keys after the merge: 0 broken.
- Backup: running again, verified end-to-end, 7.5 MB, 88 tables.
- `payment.stream` backfill: 0 constraint violations.

---

## E. Habit worth keeping

Your Dropbox checkout was **80 commits behind** GitHub when we started, and
my first push would have reverted a fix you made in July. Run `git pull` in
that folder before working in it.
