-- 318: Part of a receipt that is OTHER INCOME (e.g. a tenant's other
-- charges collected with the rent) — not a payment against a bill and not
-- an advance. Dashboard outstanding, party advance and the party ledger
-- leave it out of the party's balance; the bank / cash side keeps the full
-- amount received.
ALTER TABLE public.payment ADD COLUMN IF NOT EXISTS other_charges numeric(14,2) NOT NULL DEFAULT 0;

-- Backfill (13-Oct-2026, PPK: "all other charges"): the unallocated part
-- of every receipt from the two rental tenants, VARNAA COTTON MILLS (32)
-- and VENKATESHWARRA STORES (33).
UPDATE public.payment p SET other_charges = greatest(0, p.amount
   - coalesce((SELECT sum(a.amount) FROM public.payment_allocation a WHERE a.payment_id = p.id), 0)
   - coalesce((SELECT sum(o.amount) FROM public.payment_opening_allocation o WHERE o.payment_id = p.id), 0))
 WHERE p.party_id IN (32, 33) AND p.direction = 'in' AND p.status = 'active';
