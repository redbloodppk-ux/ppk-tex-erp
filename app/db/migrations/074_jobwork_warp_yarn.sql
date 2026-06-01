-- 074_jobwork_warp_yarn.sql
--
-- Fifth jobwork input: sized warp yarn issued to a jobwork (sizing) party
-- for a specific fabric quality. Each row records the date, party, the
-- target fabric quality + ends spec + warp count, the kg / rate / cost
-- of yarn handed over, plus a DC reference.

BEGIN;

CREATE TABLE IF NOT EXISTS public.jobwork_warp_yarn (
  id                bigserial PRIMARY KEY,
  jobwork_party_id  bigint NOT NULL REFERENCES public.jobwork_party(id) ON DELETE RESTRICT,
  fabric_quality_id bigint REFERENCES public.fabric_quality(id) ON DELETE SET NULL,
  ends_id           bigint REFERENCES public.ends_master(id) ON DELETE SET NULL,
  warp_count_id     bigint REFERENCES public.yarn_count(id) ON DELETE SET NULL,
  given_date        date NOT NULL DEFAULT CURRENT_DATE,
  total_kg          numeric(12,3),
  sizing_rate_per_kg numeric(10,2),
  total_cost        numeric(14,2),
  reference_no      text,
  notes             text,
  status            public.record_status NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid
);

CREATE INDEX IF NOT EXISTS idx_jobwork_warp_yarn_party   ON public.jobwork_warp_yarn(jobwork_party_id);
CREATE INDEX IF NOT EXISTS idx_jobwork_warp_yarn_quality ON public.jobwork_warp_yarn(fabric_quality_id);
CREATE INDEX IF NOT EXISTS idx_jobwork_warp_yarn_date    ON public.jobwork_warp_yarn(given_date);

ALTER TABLE public.jobwork_warp_yarn ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_jobwork_warp_yarn_select ON public.jobwork_warp_yarn;
CREATE POLICY p_jobwork_warp_yarn_select ON public.jobwork_warp_yarn FOR SELECT USING (true);
DROP POLICY IF EXISTS p_jobwork_warp_yarn_modify ON public.jobwork_warp_yarn;
CREATE POLICY p_jobwork_warp_yarn_modify ON public.jobwork_warp_yarn FOR ALL USING (true) WITH CHECK (true);

COMMIT;
