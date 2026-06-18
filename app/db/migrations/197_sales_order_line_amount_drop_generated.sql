-- 197_sales_order_line_amount_drop_generated.sql
--
-- sales_order_line.amount was defined as:
--   GENERATED ALWAYS AS (quantity_m * rate_per_m) STORED
--
-- That formula assumes the line is always priced per metre. For piece-based
-- pricing (UoM = pcs, rate in Rs/pc) the correct amount is pieces * rate_per_pc,
-- which the generated column cannot express -- and inserting the app-computed
-- amount raised: "cannot insert a non-DEFAULT value into column amount".
--
-- The application (orders/new/so-form.tsx) already computes the correct line
-- amount for both metres and pieces, so make amount a normal stored column and
-- let the app write it. Existing row values are preserved by DROP EXPRESSION.

ALTER TABLE public.sales_order_line ALTER COLUMN amount DROP EXPRESSION;
