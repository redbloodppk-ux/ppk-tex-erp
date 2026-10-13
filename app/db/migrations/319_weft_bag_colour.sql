-- 319: Weft yarn COLOUR on the weft bag, not in the yarn count.
-- A fabric quality (e.g. FQ-0008 SOCIETY SAREE) keeps one weft count
-- (60s combed); the party may send a different colour each lot. Colour is
-- recorded per bag, so no new quality or count is needed per colour, and
-- fabric receipts keep consuming the bags of that count FIFO.
ALTER TABLE public.jobwork_weft_bag ADD COLUMN IF NOT EXISTS colour text;

-- 13-Oct-2026: YC-0006 "60S COMBED G.YELLOW" folded into YC-0005 "60S COMBED".
UPDATE public.jobwork_weft_bag SET yarn_count_id = 19, colour = 'G.YELLOW' WHERE id = 22 AND yarn_count_id = 20;
UPDATE public.fabric_quality SET calc_snapshot = jsonb_set(calc_snapshot, '{weftCountId}', '"19"')
 WHERE id = 14 AND calc_snapshot->>'weftCountId' = '20';
UPDATE public.yarn_count SET status = 'archived' WHERE id = 20;
