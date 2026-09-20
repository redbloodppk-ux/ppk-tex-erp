-- ============================================================================
-- 303: Free the August rent bill that was settled with April's money.
--
-- PPK, 2026-09-20: "venkateshwara aug bill was settled yesterday so fix that".
--
-- WHAT HAPPENED
-- RN/26-27/0010, dated 31-Aug-2026 for Rs 9,440, showed as PAID. It had been
-- auto-matched against:
--
--   PAY/26-27/0087  15-Apr-2026   Rs 8,000
--   PAY/26-27/0089  16-May-2026   Rs 1,440
--
-- Money received in April and May, settling a bill raised at the end of
-- August. Applying an older advance to a newer invoice is normally correct,
-- so the allocator was not misbehaving - it was starved. Those two payments
-- were April's and May's rent AND maintenance, but only the rent half was
-- ever invoiced, so the maintenance half looked like unallocated credit and
-- the first bill that came along absorbed it.
--
-- The effect on PPK: when he went to record the money that actually arrived
-- on 19-Sep, the screen said "No unpaid bills for this party" and there was
-- nothing to match it to.
--
-- WHAT THIS DOES, AND DELIBERATELY DOES NOT DO
-- It removes only those two allocation rows. The payments themselves are
-- untouched - not a rupee moves, and no receipt is deleted. The money goes
-- back to being unmatched on the two payments it actually arrived with,
-- which is the truth until the missing maintenance invoices exist.
--
-- fn_payment_allocation_sync_invoice recalculates the invoice from its
-- remaining allocations, so amount_paid, balance and status follow on their
-- own; nothing is written to the invoice by hand here.
--
-- AFTER THIS
--   RN/26-27/0010   balance Rs 9,440, status issued - ready for the 19-Sep receipt
--   PAY/26-27/0087  Rs 17,440 unmatched (was Rs 9,440)
--   PAY/26-27/0089  Rs 16,000 unmatched (was Rs 14,560)
--
-- The Rs 1,13,010 of maintenance received across both tenants and never
-- invoiced is NOT addressed here. That needs the back-dated maintenance
-- invoices, which need PPK's CA to rule on the treatment first. This
-- migration only unblocks the bill in front of him.
-- ============================================================================

DELETE FROM public.payment_allocation pa
USING public.invoice i, public.payment p
WHERE pa.invoice_id = i.id
  AND pa.payment_id = p.id
  AND i.invoice_no = 'RN/26-27/0010'
  AND p.payment_no IN ('PAY/26-27/0087', 'PAY/26-27/0089');

-- Verify:
--   select invoice_no, total, amount_paid, balance, status
--     from invoice where invoice_no = 'RN/26-27/0010';
--   -- expect amount_paid 0, status issued
