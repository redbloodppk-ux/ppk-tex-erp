-- 093_bobbin_return.sql
-- Tracks empty bobbin pieces returned to a supplier after weaving.
-- One row per return event. Aggregating against bobbin.original_quantity
-- gives the "still with party" balance per spec.

BEGIN;

CREATE TABLE IF NOT EXISTS public.bobbin_return (
  id                  bigserial PRIMARY KEY,
  bobbin_id           bigint NOT NULL REFERENCES public.bobbin(id) ON DELETE RESTRICT,
  supplier_party_id   bigint REFERENCES public.party(id) ON DELETE SET NULL,
  jobwork_party_id    bigint REFERENCES public.jobwork_party(id) ON DELETE SET NULL,
  return_date         date NOT NULL DEFAULT CURRENT_DATE,
  quantity_pcs        integer NOT NULL DEFAULT 0,
  reference_no        text,
  notes               text,
  status              text NOT NULL DEFAULT 'active',
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid
);

CREATE INDEX IF NOT EXISTS idx_bobbin_return_bobbin   ON public.bobbin_return(bobbin_id);
CREATE INDEX IF NOT EXISTS idx_bobbin_return_supplier ON public.bobbin_return(supplier_party_id);
CREATE INDEX IF NOT EXISTS idx_bobbin_return_party    ON public.bobbin_return(jobwork_party_id);
CREATE INDEX IF NOT EXISTS idx_bobbin_return_date     ON public.bobbin_return(return_date);

ALTER TABLE public.bobbin_return ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_bobbin_return_select ON public.bobbin_return;
CREATE POLICY p_bobbin_return_select ON public.bobbin_return FOR SELECT USING (true);
DROP POLICY IF EXISTS p_bobbin_return_modify ON public.bobbin_return;
CREATE POLICY p_bobbin_return_modify ON public.bobbin_return FOR ALL USING (true) WITH CHECK (true);

COMMIT;
