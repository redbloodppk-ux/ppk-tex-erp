-- 325: Block a DC that is a double-save of one just created.
-- JDC/26-27/0069 and 0070 (22-Oct-2026) were the same DC saved twice, 11 s
-- apart. 0070 was cancelled (number freed). The DC form now also locks Save
-- while saving and stays disabled until it navigates away.
CREATE OR REPLACE FUNCTION public.fn_dc_block_duplicate()
 RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE v_code text;
BEGIN
  SELECT d.code INTO v_code
  FROM public.delivery_challan d
  WHERE d.party_id IS NOT DISTINCT FROM NEW.party_id
    AND d.dc_date = NEW.dc_date
    AND d.production_mode IS NOT DISTINCT FROM NEW.production_mode
    AND COALESCE(d.total_metres, 0) = COALESCE(NEW.total_metres, 0)
    AND COALESCE(d.total_pieces, 0) = COALESCE(NEW.total_pieces, 0)
    AND COALESCE(d.total_bundles, 0) = COALESCE(NEW.total_bundles, 0)
    AND d.status <> 'cancelled'
    AND d.created_at > now() - interval '10 minutes'
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'This DC looks like a duplicate of % (same party, date and quantities, saved a moment ago). Open % instead of saving again.', v_code, v_code;
  END IF;
  RETURN NEW;
END $function$;

CREATE TRIGGER trg_dc_block_duplicate BEFORE INSERT ON public.delivery_challan
  FOR EACH ROW EXECUTE FUNCTION public.fn_dc_block_duplicate();
