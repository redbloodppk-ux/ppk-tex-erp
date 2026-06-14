-- 163_doc_sequence_auto_fy_rotation.sql
--
-- fn_next_doc_no now auto-rotates the financial-year prefix on the
-- first invoice / DC of a new FY. Previously the function just blindly
-- incremented doc_sequence.next_value and used whatever fy_code was
-- stored — so on 1 April the operator had to remember to manually
-- update every doc_sequence row's fy_code + reset next_value to 1.
-- With this change:
--
--   • A helper public.fn_fy_code(d date) returns the Indian-FY code
--     for a given date (e.g. 2026-06-13 -> '26-27', 2027-04-01 -> '27-28').
--   • Before issuing the next number for a doc_type whose
--     reset_yearly = TRUE, fn_next_doc_no compares the current
--     fy_code with fn_fy_code(CURRENT_DATE). If they differ, the
--     row's fy_code is rolled forward and next_value reset to 1
--     in the same UPDATE that hands out the number.
--   • reset_yearly = FALSE rows (e.g. party codes that aren't FY-
--     scoped) are unchanged.

CREATE OR REPLACE FUNCTION public.fn_fy_code(d date)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  -- Indian financial year runs 1 April -> 31 March.
  -- Apr-Dec of year Y  -> 'YY-(YY+1)' (e.g. Jun 2026 -> '26-27')
  -- Jan-Mar of year Y  -> '(YY-1)-YY' (e.g. Feb 2027 -> '26-27')
  SELECT CASE
    WHEN EXTRACT(MONTH FROM d) >= 4
      THEN to_char(EXTRACT(YEAR FROM d)::int      % 100, 'FM00')
        || '-'
        || to_char((EXTRACT(YEAR FROM d)::int + 1) % 100, 'FM00')
      ELSE to_char((EXTRACT(YEAR FROM d)::int - 1) % 100, 'FM00')
        || '-'
        || to_char(EXTRACT(YEAR FROM d)::int      % 100, 'FM00')
  END;
$$;

CREATE OR REPLACE FUNCTION public.fn_next_doc_no(p_doc_type text)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_row        doc_sequence%ROWTYPE;
  v_pad_zeros  text;
  v_pad_width  int;
  v_seq_str    text;
  v_out        text;
  v_today_fy   text;
BEGIN
  v_today_fy := public.fn_fy_code(CURRENT_DATE);

  -- Atomic increment with optional FY rollover. The single UPDATE
  -- both rolls the fy_code AND hands out the next number, so under
  -- concurrent inserts on 1 April only one row sees seq=1 — the
  -- rest get seq=2,3,4... in the new FY automatically.
  UPDATE doc_sequence
    SET fy_code = CASE
                    WHEN reset_yearly AND fy_code IS DISTINCT FROM v_today_fy
                      THEN v_today_fy
                      ELSE fy_code
                  END,
        next_value = CASE
                       WHEN reset_yearly AND fy_code IS DISTINCT FROM v_today_fy
                         THEN 2   -- this call consumes seq=1, next caller gets 2
                         ELSE next_value + 1
                     END,
        updated_at = NOW()
    WHERE doc_type = p_doc_type
    RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown doc_type: %', p_doc_type;
  END IF;

  -- After the UPDATE the row holds the NEW values. The number we
  -- hand to the caller is (next_value - 1) under normal flow; on
  -- a fresh rollover it's 1 (since we set next_value to 2 above).
  v_pad_zeros := (regexp_match(v_row.format, '\{seq:(0+)\}'))[1];
  v_pad_width := COALESCE(length(v_pad_zeros), 4);
  v_seq_str   := LPAD((v_row.next_value - 1)::text, v_pad_width, '0');

  -- Render template
  v_out := v_row.format;
  v_out := replace(v_out, '{prefix}', v_row.prefix);
  v_out := replace(v_out, '{fy}', v_row.fy_code);
  v_out := regexp_replace(v_out, '\{seq:0+\}', v_seq_str);

  -- Clean up: collapse any "--" or "//" that resulted from an empty {fy}
  v_out := regexp_replace(v_out, '([-/])\1+', '\1', 'g');
  v_out := regexp_replace(v_out, '^[-/]+|[-/]+$', '', 'g');

  RETURN v_out;
END;
$func$;

COMMENT ON FUNCTION public.fn_next_doc_no(text) IS
  'Allocates the next document number for the given doc_type. When '
  'the row has reset_yearly = TRUE and the stored fy_code differs '
  'from the current financial year (per fn_fy_code), the FY is '
  'rolled forward and next_value reset to 1 in the same atomic '
  'UPDATE — so 1-April rollover is automatic and race-safe.';

COMMENT ON FUNCTION public.fn_fy_code(date) IS
  'Returns the Indian FY code (e.g. ''26-27'') for the given date. '
  'FY runs 1 April -> 31 March.';
