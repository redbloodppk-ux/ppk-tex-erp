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

### B6. `next build` never completed

Every change was verified with `tsc --noEmit` and vitest. A full
`next build` was started once and was still running after 20 minutes
(node_modules on Dropbox). Worth running once cleanly before you next deploy.

---

## C. From the audit — items 6 and 7

### C1. `party` and `customer` are two tables joined by NAME — the biggest
structural risk

192 parties, 167 customers, linked by `c.name = p.name` and
`.ilike('party_name', …)`. `invoice` carries both `customer_id` and a
`party_name` text column; 9 invoices already have a null `customer_id`.

Works only because all 192 names happen to be unique. Rename a party and its
invoice history stops matching — silently. Needs its own spec and a careful
migration; the biggest win and the biggest effort left.

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
