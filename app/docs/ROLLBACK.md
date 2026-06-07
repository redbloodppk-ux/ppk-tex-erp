# Rollback Runbook — PPK TEX ERP

**Card:** CORR-H8 (Production Hardening)
**Companion to:** `docs/RESTORE.md` (full DB restore)
**Last reviewed:** 7 Jun 2026

This runbook covers reversible-migration discipline, the 60-day shakedown undo policy, and the per-entity rollback procedures for the four most common "Oh no" moments: a wrongly-saved sales invoice, fabric receipt, payment, or costing approval. For full DB restore (rare, much heavier) see `RESTORE.md`.

---

## 1. When to roll back vs. restore

Pick the smallest tool for the problem.

| Scope of damage | Tool | Time |
|---|---|---|
| One specific row was entered wrong | Per-entity rollback (§5) | 1–2 min |
| A batch import created 50 wrong rows | Per-entity rollback with a script (§5.5) | 10–30 min |
| A migration ran and changed the schema in a bad way | Reversed migration (§3) | 5–15 min |
| The whole DB is corrupted | Full restore from backup (`RESTORE.md` §4) | 30–60 min |
| Code deploy broke the app, DB is fine | Vercel "Promote previous deployment" (`RESTORE.md` §4.4) | < 1 min |

The default for v1.0 is **per-entity rollback wherever possible**; full restore is the nuclear option.

---

## 2. The 60-day shakedown window

For the first 60 days after the first production user logs in, every transactional module exposes an **Undo Last Action** button to the user who created the record. This is generous on purpose — the operator is learning the app and we expect mistakes.

- Window: **60 calendar days** from production go-live date.
- Who can undo: the user who created the record, plus any user with `owner` or `mill_manager` role.
- Audit: every undo writes an `audit_log` row with `action='rollback'` and a copy of the deleted row in `old_values`.
- After day 60: the Undo button is hidden from staff. Owner can still undo via the admin tools, but must provide a reason that goes into the audit log.

This window is recorded in `lib/rollback/window.ts`:

```ts
// Set this to the date production was first opened to non-owner users.
export const SHAKEDOWN_START_DATE = '2026-06-15'; // ← UPDATE ON GO-LIVE
export const SHAKEDOWN_DAYS = 60;
export function isInShakedown(now = new Date()): boolean {
  const start = new Date(SHAKEDOWN_START_DATE + 'T00:00:00');
  const end = new Date(start);
  end.setDate(end.getDate() + SHAKEDOWN_DAYS);
  return now <= end;
}
```

**Decision needed (D15):** Confirm 60 days is the right window. The Correction Guide flagged this as too generous; we recommend keeping it for v1 specifically because operators need slack while learning. Tighten in v1.1 once confidence is high.

---

## 3. Migration discipline (reversible by default)

### 3.1 The pairing convention

For every migration `NNN_<name>.sql` that does anything destructive (DROP, ALTER COLUMN with type change, RENAME), we also create `NNN_<name>_rollback.sql` that puts the schema back. The rollback file lives next to the forward file in `app/db/migrations/`.

A migration is "destructive" if any of the following are true:

- `DROP TABLE`, `DROP COLUMN`, `DROP TYPE`
- `ALTER COLUMN ... TYPE` (changes type)
- `ALTER TYPE ... DROP VALUE` (PostgreSQL doesn't really support this; use a fresh enum + swap)
- `RENAME TABLE`, `RENAME COLUMN`
- `TRUNCATE`
- `DELETE FROM` with no `WHERE` clause

Non-destructive migrations (pure adds: `CREATE TABLE`, `ADD COLUMN`, `CREATE INDEX`, `CREATE TRIGGER`, `ALTER TYPE ... ADD VALUE`) don't need a rollback file. They're not the same as "reversible" — adding a column technically can be reversed by dropping it, but if data has flowed into it, dropping would lose data, so we treat the forward migration as the point of no return.

### 3.2 Writing a rollback migration

A rollback migration has the same shape as a forward migration but in reverse. Example pair:

**Forward (`130_drop_legacy_paise_column.sql`)** — destructive:

```sql
BEGIN;
ALTER TABLE public.bobbin DROP COLUMN IF EXISTS pick_paise_legacy;
COMMIT;
```

**Rollback (`130_drop_legacy_paise_column_rollback.sql`):**

```sql
BEGIN;
-- WARNING: this only restores the schema, not the data. Anything stored
-- in pick_paise_legacy before the forward migration ran is lost.
ALTER TABLE public.bobbin
  ADD COLUMN pick_paise_legacy numeric(15,2);
COMMIT;
```

The rollback file is committed alongside the forward file. We don't auto-run it; it's a one-line `psql -f` away if needed.

### 3.3 Running a migration rollback

```bash
# From the project root, with $DATABASE_URL pointing at the Supabase project.
psql "$DATABASE_URL" -f app/db/migrations/130_drop_legacy_paise_column_rollback.sql
```

Always run it on a Supabase **branch** first (Supabase Dashboard → Database → Branching → create a branch from main), verify, then promote.

### 3.4 What if a migration has no rollback file?

For migrations 001–129 (everything shipped before this runbook), only a handful are destructive. If you need to reverse one of those, you have two options:

1. **Hand-write the rollback** based on the forward file. Test on a Supabase branch first.
2. **Full restore** from PITR (`RESTORE.md` §4.1) — slower but safer when the migration corrupted data, not just schema.

From migration 130 onwards, the pairing convention is mandatory for destructive changes. CI should reject a PR that drops/renames without a paired rollback (open follow-up: add a check to `.github/workflows/`).

---

## 4. The per-entity rollback library

Each transactional entity has a TypeScript helper in `lib/rollback/` that knows how to undo a single record. These helpers are the implementation behind the in-app Undo Last Action buttons.

| Entity | Helper | Cascades that get reversed |
|---|---|---|
| Sales invoice | `lib/rollback/sales-invoice.ts` | Reverses ledger postings, restores yarn lot `current_kg`, releases reserved bobbin stock, deletes invoice items, then the invoice. |
| Fabric receipt | `lib/rollback/fabric-receipt.ts` | Reverses stock reductions (pavu metres, yarn kg, bobbin metres), unlinks the DC, flips DC status back to `draft`, deletes receipt items, then the receipt. |
| Payment | `lib/rollback/payment.ts` | Reverses ledger postings, marks the invoice unpaid (if it was marked paid), deletes the payment row. |
| Costing approval | `lib/rollback/costing-approval.ts` | Flips `fabric_quality.status` from `active` back to `pending_approval`, clears `approved_by` and `approved_at`, restores `approval_status='pending'`. |

Each helper takes a single record id and runs inside a Postgres transaction. If any step fails, the whole undo aborts and nothing changes.

**Shape of a rollback helper:**

```ts
// lib/rollback/sales-invoice.ts
export async function rollbackSalesInvoice(
  supabase: SupabaseClient,
  invoiceId: number,
  reason: string,
  actorUserId: string,
): Promise<RollbackResult> {
  return supabase.rpc('fn_rollback_sales_invoice', {
    p_invoice_id: invoiceId,
    p_reason: reason,
    p_actor: actorUserId,
  });
}
```

The actual cascade logic lives in a Postgres function (`fn_rollback_<entity>`) so it runs atomically inside one transaction. The TypeScript helper is a thin wrapper that the UI and the API route call.

---

## 5. Per-entity rollback procedures

### 5.1 Rolling back a sales invoice

**Symptoms:** Wrong customer, wrong quality, wrong rate, double-saved.

**Steps:**

1. Owner / mill_manager opens Sales Invoice list → finds the invoice → clicks "Undo Last Action".
2. Confirm modal asks for a one-line reason. Type it.
3. The system runs `fn_rollback_sales_invoice(invoice_id, reason, actor)`:
   - Reverses the ledger entries (customer debit, sales credit, GST credit). Stamps the reversal with `reference = 'rollback:<invoice_code>'`.
   - Adds back the FIFO-consumed yarn lot kg (reads the `consumption_trace` from the linked production batch and increments each lot's `current_kg`).
   - Releases any reserved bobbin stock back to `bobbin.quantity`.
   - Deletes `sales_invoice_item` rows.
   - Deletes the `sales_invoice` row.
4. Audit log row written with `entity='sales_invoice'`, `action='rollback'`, `old_values=<full JSONB snapshot>`, `reason=<owner's reason>`.
5. The invoice is gone from the list. The next invoice number is **not** rewound — gaps in the invoice sequence are normal and audit-safe.

**Gotchas:**

- If the invoice has already been paid (linked `payment` row), the system blocks the undo and tells you to roll back the payment first (§5.3).
- If the invoice is linked to a confirmed DC, the DC's status reverts to `draft` and its `invoice_id` is cleared. The DC itself is not deleted.

### 5.2 Rolling back a fabric receipt

**Symptoms:** Wrong metres, wrong quality, receipt for the wrong DC.

**Steps:**

1. Owner / mill_manager opens Fabric Receipt detail → Undo.
2. Confirm with reason.
3. `fn_rollback_fabric_receipt(receipt_id, reason, actor)`:
   - Reverses stock reductions applied by `applyFabricReceiptStockReductions` (re-adds pavu metres, weft kg, porvai kg, bobbin metres in FIFO order). Uses the `stock_snapshot` JSON on the receipt to know exactly what to undo.
   - Clears the `delivery_challan.fabric_receipt_id` and flips its `status` back to `draft`.
   - Deletes `fabric_receipt_item` rows.
   - Deletes the `fabric_receipt` row.
4. Audit log row written.

**Gotchas:**

- If a sales invoice was already raised against the resulting batch, the system blocks the undo. Roll back the invoice first.
- The yarn lots restored are the same lots that were originally consumed; FIFO is reversed in LIFO order so the most-recent consumption is reversed first. This is intentional — the original lot identities are preserved.

### 5.3 Rolling back a payment

**Symptoms:** Wrong amount, paid against wrong invoice, double-entered.

**Steps:**

1. Owner / accounts opens the Payment list → Undo.
2. Confirm with reason.
3. `fn_rollback_payment(payment_id, reason, actor)`:
   - Reverses the ledger entries (bank debit, customer credit — opposite direction of the original).
   - Marks any linked invoice as `paid_status='unpaid'` (or `partial` if there were multiple payments and this one being removed brings it back to partial).
   - Deletes the `payment` row.
4. Audit log row written.

**Gotchas:**

- Bank reconciliation: if the bank has already shown this payment as cleared, the rollback doesn't notify the bank. Your bank reconciliation report will show a mismatch until you re-enter the correct payment.

### 5.4 Rolling back a costing approval

**Symptoms:** Owner approved a costing that turned out wrong.

**Steps:**

1. Owner opens Pending Approvals → tab "Recently approved" → Undo.
2. Confirm with reason.
3. `fn_rollback_costing_approval(quality_id, reason, actor)`:
   - Flips `fabric_quality.approval_status` from `approved` to `pending`.
   - Clears `approved_by` and `approved_at`.
   - Flips `fabric_quality.active` from `true` to `false` so sales orders can no longer select it until re-approved.
4. Audit log row written.

**Gotchas:**

- If any sales order has already used the quality, this rollback doesn't cancel those orders — it only prevents new ones. Communicate with sales separately.

### 5.5 Bulk rollback (rare)

If a batch import or a buggy save created many wrong rows at once, write a one-off script in `scripts/rollback/<incident-name>.ts` that loops over the rows and calls the relevant helper for each. Always:

1. Run on a Supabase branch first.
2. Dry-run mode: log what would be undone without actually undoing.
3. Get owner approval before pointing it at production.
4. Document the script + the outcome in `docs/incidents/`.

---

## 6. Verifying a rollback

After any rollback (single or bulk), run these checks:

```sql
-- Ledger balance for the affected party should equal pre-rollback expected
SELECT party_id, sum(debit - credit) AS balance
FROM ledger_entry
WHERE party_id = <party_id>
GROUP BY party_id;

-- Yarn lot kg should be back where it was
SELECT id, lot_code, current_kg FROM yarn_lot WHERE id = <lot_id>;

-- Audit log proves the rollback happened
SELECT id, entity, entity_id, action, reason, actor_user_id, created_at
FROM audit_log
WHERE action = 'rollback'
ORDER BY created_at DESC LIMIT 10;

-- Document sequences should NOT have been rewound (gap is expected)
SELECT last_value FROM sales_invoice_id_seq;
```

App-level smoke test:

1. Customer ledger should show no entries for the rolled-back invoice.
2. Yarn stock report should show the restored kg.
3. Audit log viewer (CORR-H3) lists the rollback with the reason.

---

## 7. What rollback can't fix

- **External notifications.** If an invoice PDF was emailed to the customer before rollback, the customer still has the PDF. You need to send a "please disregard" follow-up email manually.
- **Bank statements.** The bank still has the original transaction. Reconcile manually.
- **GST returns.** If the invoice was included in an already-filed GSTR-1, you have to file a credit note in the next return, not just delete the invoice. Talk to your CA.
- **Printed paperwork.** A printed DC handed to the truck driver is in the truck. Send WhatsApp instructions if needed.

The Undo button is for in-app data hygiene. Anything that already left the building needs a real-world follow-up.

---

## 8. Open decisions

- **D15 (from Correction Guide §7):** Confirm 60-day shakedown window or pick a different number. Recommendation: keep 60 for v1.0.
- **Migration rollback CI gate:** Add a GitHub Action that fails the PR if a migration with destructive verbs is missing its paired `_rollback.sql`. Currently this is a convention not an enforcement. File as a v1.1 follow-up.
- **Auto-revoke for stale undo windows:** Should an invoice older than 7 days require owner approval to undo even during the shakedown? Currently no — keep it simple for v1.

---

End of runbook. Next revision when an actual rollback in production surfaces a gap.
