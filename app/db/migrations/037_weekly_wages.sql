-- ────────────────────────────────────────────────────────────────────────────
-- Migration 037 — Weekly wages: per-employee weekly_salary, FY-week helper,
--                  and weekly_wage_summary snapshot table.
-- ────────────────────────────────────────────────────────────────────────────

-- weekly_salary on employee
ALTER TABLE public.employee
  ADD COLUMN IF NOT EXISTS weekly_salary numeric(10,2);

COMMENT ON COLUMN public.employee.weekly_salary IS
  'Predefined weekly salary in INR for weekly-basis employees. Auto-fills the wage_entry amount when kind=settlement.';

-- Financial-year week helper (April-March FY, ISO-style: Week 1 = first week with 4+ April days)
CREATE OR REPLACE FUNCTION public.fy_week_number(d date)
RETURNS TABLE(fy_label text, week_no int, week_start date, week_end date)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  fy_start_year int;
  apr1 date;
  apr1_dow int;       -- 1=Mon ... 7=Sun (ISO)
  week1_start date;
  iso_week_start date; -- Monday of d's week
BEGIN
  -- Pick FY: April-March. If month >= 4, FY starts this calendar year.
  fy_start_year := CASE WHEN EXTRACT(MONTH FROM d) >= 4 THEN EXTRACT(YEAR FROM d)::int
                        ELSE EXTRACT(YEAR FROM d)::int - 1 END;
  apr1 := make_date(fy_start_year, 4, 1);
  apr1_dow := EXTRACT(ISODOW FROM apr1)::int;  -- Mon=1..Sun=7
  -- Week1 = the Mon-Sun week that holds 4+ April days. Equivalent: if Apr 1 falls Mon-Thu,
  -- Week 1 starts on the Monday before/at Apr 1; if Fri-Sun, Week 1 starts on the next Monday.
  IF apr1_dow <= 4 THEN
    week1_start := apr1 - (apr1_dow - 1);
  ELSE
    week1_start := apr1 + (8 - apr1_dow);
  END IF;
  iso_week_start := d - (EXTRACT(ISODOW FROM d)::int - 1);
  week_no := ((iso_week_start - week1_start) / 7) + 1;
  week_start := iso_week_start;
  week_end := iso_week_start + 6;
  fy_label := 'FY ' || fy_start_year::text || '-' || lpad(((fy_start_year + 1) % 100)::text, 2, '0');
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fy_week_number(date) TO authenticated, anon, service_role;

-- Snapshot table for saved weekly summaries
CREATE TABLE IF NOT EXISTS public.weekly_wage_summary (
  id            bigserial PRIMARY KEY,
  fy_label      text NOT NULL,
  week_no       int  NOT NULL,
  week_start    date NOT NULL,
  week_end      date NOT NULL,
  totals        jsonb NOT NULL,        -- {wages, advances, adjustments, same_day, expenses, net_cash_out}
  per_employee  jsonb NOT NULL,        -- [{employee_id, full_name, book_salary, advances, adjustments, net_payable}]
  wage_entries  jsonb NOT NULL,        -- raw rows
  expenses      jsonb NOT NULL,        -- raw rows
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES auth.users(id),
  UNIQUE (fy_label, week_no)
);

ALTER TABLE public.weekly_wage_summary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS weekly_wage_summary_read ON public.weekly_wage_summary;
CREATE POLICY weekly_wage_summary_read ON public.weekly_wage_summary FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS weekly_wage_summary_write ON public.weekly_wage_summary;
CREATE POLICY weekly_wage_summary_write ON public.weekly_wage_summary FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
