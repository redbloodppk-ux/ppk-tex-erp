-- 070_jobwork_warp_beam_weft_bag.sql
--
-- Two new tables capture jobwork inputs sent out to a jobwork party:
--
--   jobwork_warp_beam : each row is a warp beam (or set of beams) issued
--                      to a party for a specific fabric quality.
--   jobwork_weft_bag  : each row is a bag/lot of weft yarn issued to a
--                      party.
--
-- Together with bobbin (already production_mode-tagged) they let the
-- /app/jobwork Status tab show what each party has been given, broken
-- down by fabric quality and yarn count.

BEGIN;

CREATE TABLE IF NOT EXISTS public.jobwork_warp_beam (
  id                bigserial PRIMARY KEY,
  jobwork_party_id  bigint NOT NULL REFERENCES public.jobwork_party(id) ON DELETE RESTRICT,
  fabric_quality_id bigint REFERENCES public.fabric_quality(id) ON DELETE SET NULL,
  warp_count_id     bigint REFERENCES public.yarn_count(id) ON DELETE SET NULL,
  given_date        date NOT NULL DEFAULT CURRENT_DATE,
  total_ends        integer,
  tape_length_m     numeric(10,2),
  beam_count        integer NOT NULL DEFAULT 1,
  total_metres      numeric(12,2),
  reference_no      text,
  notes             text,
  status            public.record_status NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid
);

CREATE INDEX IF NOT EXISTS idx_jobwork_warp_beam_party   ON public.jobwork_warp_beam(jobwork_party_id);
CREATE INDEX IF NOT EXISTS idx_jobwork_warp_beam_quality ON public.jobwork_warp_beam(fabric_quality_id);
CREATE INDEX IF NOT EXISTS idx_jobwork_warp_beam_date    ON public.jobwork_warp_beam(given_date);

CREATE TABLE IF NOT EXISTS public.jobwork_weft_bag (
  id                bigserial PRIMARY KEY,
  jobwork_party_id  bigint NOT NULL REFERENCES public.jobwork_party(id) ON DELETE RESTRICT,
  yarn_count_id     bigint REFERENCES public.yarn_count(id) ON DELETE SET NULL,
  given_date        date NOT NULL DEFAULT CURRENT_DATE,
  bag_count         integer,
  total_kg          numeric(12,3),
  reference_no      text,
  notes             text,
  status            public.record_status NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid
);

CREATE INDEX IF NOT EXISTS idx_jobwork_weft_bag_party ON public.jobwork_weft_bag(jobwork_party_id);
CREATE INDEX IF NOT EXISTS idx_jobwork_weft_bag_count ON public.jobwork_weft_bag(yarn_count_id);
CREATE INDEX IF NOT EXISTS idx_jobwork_weft_bag_date  ON public.jobwork_weft_bag(given_date);

ALTER TABLE public.jobwork_warp_beam ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_jobwork_warp_beam_select ON public.jobwork_warp_beam;
CREATE POLICY p_jobwork_warp_beam_select ON public.jobwork_warp_beam FOR SELECT USING (true);
DROP POLICY IF EXISTS p_jobwork_warp_beam_modify ON public.jobwork_warp_beam;
CREATE POLICY p_jobwork_warp_beam_modify ON public.jobwork_warp_beam FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.jobwork_weft_bag ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_jobwork_weft_bag_select ON public.jobwork_weft_bag;
CREATE POLICY p_jobwork_weft_bag_select ON public.jobwork_weft_bag FOR SELECT USING (true);
DROP POLICY IF EXISTS p_jobwork_weft_bag_modify ON public.jobwork_weft_bag;
CREATE POLICY p_jobwork_weft_bag_modify ON public.jobwork_weft_bag FOR ALL USING (true) WITH CHECK (true);

COMMIT;
