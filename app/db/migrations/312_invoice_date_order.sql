-- ============================================================================
-- 312: Invoice dates must run in number order within each series.
--
-- PPK, 2026-10-03: "for all invoice date scenarios, the current invoice date
-- will be greater or equal than last invoice date".
--
-- Before: only the New Invoice and New Job-work Bill screens checked, by
-- doc_type, in the browser. Editing an invoice's date was not checked, and
-- doc_type is not the numbering series (rental vs general sale, jobwork with
-- vs without GST each have their own series).
--
-- Now a trigger on invoice checks every insert and every change of date or
-- number. The series is the invoice number without its running suffix
-- (INV/26-27/0071 -> INV/26-27), so it follows fn_invoice_auto_no exactly and
-- resets with the financial year like the numbers do.
--   * date must be >= the latest date of any LOWER number in the series
--   * date must be <= the earliest date of any HIGHER number in the series
--     (so an edit cannot jump past the next invoice either)
-- Cancelled invoices keep their number, so they still count.
-- Checked 2026-10-03: no existing invoice breaks the rule.
-- Runs after trg_invoice_auto_no (alphabetical), so the new number exists.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_invoice_date_order()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_series text;
  v_seq    int;
  v_prev   record;
  v_next   record;
BEGIN
  IF NEW.invoice_date IS NULL OR NEW.invoice_no IS NULL OR NEW.invoice_no !~ '/' THEN
    RETURN NEW;
  END IF;
  v_series := regexp_replace(NEW.invoice_no, '/[^/]*$', '');
  v_seq := NULLIF(regexp_replace(substring(NEW.invoice_no FROM '[^/]*$'), '\D', '', 'g'), '')::int;
  IF v_seq IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT i.invoice_no, i.invoice_date INTO v_prev
    FROM public.invoice i
   WHERE i.id IS DISTINCT FROM NEW.id
     AND i.invoice_date IS NOT NULL
     AND i.invoice_no LIKE v_series || '/%'
     AND regexp_replace(i.invoice_no, '/[^/]*$', '') = v_series
     AND NULLIF(regexp_replace(substring(i.invoice_no FROM '[^/]*$'), '\D', '', 'g'), '')::int < v_seq
   ORDER BY i.invoice_date DESC
   LIMIT 1;
  IF FOUND AND NEW.invoice_date < v_prev.invoice_date THEN
    RAISE EXCEPTION 'Date % is before % dated %. Invoice numbers run in date order - pick a date on or after %.',
      to_char(NEW.invoice_date, 'DD-Mon-YYYY'), v_prev.invoice_no,
      to_char(v_prev.invoice_date, 'DD-Mon-YYYY'), to_char(v_prev.invoice_date, 'DD-Mon-YYYY')
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT i.invoice_no, i.invoice_date INTO v_next
    FROM public.invoice i
   WHERE i.id IS DISTINCT FROM NEW.id
     AND i.invoice_date IS NOT NULL
     AND i.invoice_no LIKE v_series || '/%'
     AND regexp_replace(i.invoice_no, '/[^/]*$', '') = v_series
     AND NULLIF(regexp_replace(substring(i.invoice_no FROM '[^/]*$'), '\D', '', 'g'), '')::int > v_seq
   ORDER BY i.invoice_date ASC
   LIMIT 1;
  IF FOUND AND NEW.invoice_date > v_next.invoice_date THEN
    RAISE EXCEPTION 'Date % is after the next invoice % dated %. Invoice numbers run in date order - pick a date on or before %.',
      to_char(NEW.invoice_date, 'DD-Mon-YYYY'), v_next.invoice_no,
      to_char(v_next.invoice_date, 'DD-Mon-YYYY'), to_char(v_next.invoice_date, 'DD-Mon-YYYY')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_date_order ON public.invoice;
CREATE TRIGGER trg_invoice_date_order
  BEFORE INSERT OR UPDATE OF invoice_date, invoice_no ON public.invoice
  FOR EACH ROW EXECUTE FUNCTION public.fn_invoice_date_order();
