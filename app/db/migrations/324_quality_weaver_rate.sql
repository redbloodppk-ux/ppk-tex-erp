-- 324: Quality-level weaver wage rate.
-- fabric_quality.weaver_rate_per_m (NOT rate_per_m - that is the SALE price
-- used to prefill invoices). When set, fn_shift_log_snapshot_quality_rate()
-- uses it for every loom weaving that quality on the log date, ahead of the
-- loom's default_rate_per_m. Society saree (FQ-0008): Rs 10 per 5.5 m saree
-- = Rs 1.82 per real metre; counted in 137 cm units (migration 323).
ALTER TABLE fabric_quality ADD COLUMN IF NOT EXISTS weaver_rate_per_m numeric(8,2);
UPDATE fabric_quality SET weaver_rate_per_m = 1.82 WHERE id = 14;
-- fn_shift_log_snapshot_quality_rate(): new block, before the loom fallback:
--   IF NEW.rate_per_m IS NULL AND NEW.fabric_quality_id IS NOT NULL THEN
--     SELECT fq.weaver_rate_per_m INTO v_q_rate FROM fabric_quality fq WHERE fq.id = NEW.fabric_quality_id;
--     IF v_q_rate > 0 THEN NEW.rate_per_m := v_q_rate; END IF;
--   END IF;
