-- ============================================================================
-- 297: Stop a hand-written document number from blocking the next real one.
--
-- PPK, 2026-09-13, trying to record a rent receipt:
--   "duplicate key value violates unique constraint bank_entry_entry_no_key"
--
-- MY MISTAKE, AND ITS SHAPE
-- Migration 296 inserted BE/26-27/0086 with the number written out by hand.
-- Document numbers do not come from the table - they come from the
-- doc_sequence counter, which fn_next_doc_no bumps. Writing the number
-- directly left that counter still pointing at 86, so the next entry PPK
-- created through the screen was handed 0086 as well and the unique index
-- refused it.
--
-- I did the same thing three times in 296 without noticing:
--   bank_entry    BE/26-27/0086   counter at 86, would re-issue 0086
--   ledger_group  LG-0020         counter at 20, would re-issue LG-0020
--   ledger_type   LT-0055         counter at 55, would re-issue LT-0055
-- Only the first had been reached yet. The other two would have failed the
-- next time anyone added a ledger group or type through the UI.
-- (LED-PLANT-MACHINERY is safe - it is a name, not a number, so it never
-- competes with the LED-0226 series.)
--
-- TWO PARTS: CATCH UP, THEN MAKE IT NOT MATTER
--
-- 1. fn_doc_sequence_catch_up reads what is actually in the table and moves
--    the counter past it. Data-driven, not a hardcoded 87 - a hardcoded
--    number is the same class of mistake that caused this.
--
-- 2. The two autogen triggers now retry when the number they were handed is
--    already taken, so a hand-written row can never again block a real one.
--    This is the part that matters: catching up today fixes today, the
--    retry fixes every future migration that forgets, including mine.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Move a counter past whatever is already in its table
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_doc_sequence_catch_up(
  p_doc_type text,
  p_table    text,
  p_column   text
)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  v_max  int;
  v_next int;
BEGIN
  -- The trailing digits of the code are the sequence; everything before is
  -- prefix and financial year.
  EXECUTE format(
    'SELECT COALESCE(MAX(NULLIF(regexp_replace(%I, ''^.*[^0-9]'', ''''), ''''))::int, 0)
       FROM public.%I
      WHERE %I ~ ''[0-9]+$''',
    p_column, p_table, p_column
  ) INTO v_max;

  UPDATE public.doc_sequence
     SET next_value = GREATEST(next_value, v_max + 1),
         updated_at = NOW()
   WHERE doc_type = p_doc_type
  RETURNING next_value INTO v_next;

  RETURN v_next;
END $$;

COMMENT ON FUNCTION public.fn_doc_sequence_catch_up(text, text, text) IS
  'Advances a doc_sequence counter past the highest number already in its table. Call this after any migration that inserts a row with a hand-written document number. See migration 297.';

SELECT public.fn_doc_sequence_catch_up('bank_entry',   'bank_entry',   'entry_no');
SELECT public.fn_doc_sequence_catch_up('ledger_group', 'ledger_group', 'code');
SELECT public.fn_doc_sequence_catch_up('ledger_type',  'ledger_type',  'code');

-- ----------------------------------------------------------------------------
-- 2. Retry instead of failing, when a number is already taken
--
-- Both triggers keep their existing behaviour exactly: a caller-supplied
-- code is still respected, and the doc_type routing is untouched. The only
-- change is that a generated value which collides is discarded and another
-- is drawn, up to 50 times, rather than being forced onto the row.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_bank_entry_autogen()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_no    text;
  v_taken boolean;
BEGIN
  IF NEW.entry_no IS NOT NULL AND NEW.entry_no <> '' THEN
    RETURN NEW;
  END IF;

  FOR i IN 1..50 LOOP
    v_no := public.fn_next_doc_no('bank_entry');
    SELECT EXISTS (SELECT 1 FROM public.bank_entry WHERE entry_no = v_no) INTO v_taken;
    IF NOT v_taken THEN
      NEW.entry_no := v_no;
      RETURN NEW;
    END IF;
  END LOOP;

  RAISE EXCEPTION
    'Could not find a free bank entry number after 50 tries (last: %). The doc_sequence counter for bank_entry is far behind the table.', v_no;
END $$;

CREATE OR REPLACE FUNCTION public.fn_autogen_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_doc_type text;
  v_code     text;
  v_taken    boolean;
BEGIN
  IF NEW.code IS NOT NULL AND NEW.code <> '' THEN RETURN NEW; END IF;

  v_doc_type := CASE TG_TABLE_NAME
    WHEN 'customer'           THEN 'cust'
    WHEN 'employee'           THEN 'emp'
    WHEN 'mill'               THEN 'mill'
    WHEN 'vendor'             THEN 'vendor'
    WHEN 'yarn_count'         THEN 'yc'
    WHEN 'ends_master'        THEN 'ends'
    WHEN 'fabric_quality'     THEN 'fq'
    WHEN 'bobbin'             THEN 'bobbin'
    WHEN 'ledger_type'        THEN 'ledger_type'
    WHEN 'ledger_group'       THEN 'ledger_group'
    WHEN 'ledger'             THEN 'ledger'
    WHEN 'fabric_type_master' THEN 'fabric_type'
    WHEN 'jobwork_party'      THEN 'jobwork_party'   -- overridden below by kind
    WHEN 'party_type_master'  THEN 'party_type'
    WHEN 'party'              THEN 'party'
    WHEN 'fabric_receipt'     THEN 'fabric_receipt'
    WHEN 'delivery_challan'   THEN 'dc'              -- overridden below by production_mode
    ELSE NULL
  END;

  -- Jobwork / outsource DC prefix routing — kept from migration 088.
  IF TG_TABLE_NAME = 'delivery_challan' THEN
    DECLARE pm text;
    BEGIN
      pm := COALESCE(to_jsonb(NEW)->>'production_mode', 'inhouse');
      IF pm = 'jobwork' THEN
        v_doc_type := 'jobwork_dc';
      ELSIF pm = 'outsource' THEN
        v_doc_type := 'outsource_dc';
      END IF;
    END;
  END IF;

  -- jobwork_party prefix routing by `kind`.
  IF TG_TABLE_NAME = 'jobwork_party' THEN
    IF COALESCE(to_jsonb(NEW)->>'kind', 'jobwork') = 'outsource' THEN
      v_doc_type := 'outsource_party';
    END IF;
  END IF;

  IF v_doc_type IS NULL THEN RETURN NEW; END IF;

  FOR i IN 1..50 LOOP
    v_code := public.fn_next_doc_no(v_doc_type);
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE code = $1)', TG_TABLE_NAME)
      INTO v_taken USING v_code;
    IF NOT v_taken THEN
      NEW.code := v_code;
      RETURN NEW;
    END IF;
  END LOOP;

  RAISE EXCEPTION
    'Could not find a free code for % after 50 tries (last: %). The doc_sequence counter for % is far behind the table.',
    TG_TABLE_NAME, v_code, v_doc_type;
END $$;

-- Verify:
--   select doc_type, next_value from doc_sequence
--    where doc_type in ('bank_entry','ledger_group','ledger_type');
--   -- expect 87, 21, 56
