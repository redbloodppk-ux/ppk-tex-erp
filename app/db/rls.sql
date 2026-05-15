-- =============================================================================
-- PPK TEX ERP — Row Level Security policies
-- Run AFTER schema.sql, BEFORE seed.sql
--
-- Role matrix (from Module 18 spec):
--   owner          — full read/write on everything
--   mill_manager   — production, inventory, vendors, employees, attendance
--   sales_manager  — customers, sales orders, invoices, costing (read-only on costing)
--   accounts       — invoices, payments, ledgers (no costing details)
--   floor_operator — own attendance only, read-only production batches assigned to them
--   auditor        — read-only on everything
-- =============================================================================

-- Helper function: get current user's role
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS user_role AS $$
  SELECT role FROM app_user WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Helper: is owner or auditor (full read access)
CREATE OR REPLACE FUNCTION is_owner_or_auditor()
RETURNS boolean AS $$
  SELECT current_user_role() IN ('owner', 'auditor');
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Helper: can write masters (owner, mill_manager, sales_manager based on table)
CREATE OR REPLACE FUNCTION can_write_master(p_master text)
RETURNS boolean AS $$
DECLARE r user_role := current_user_role();
BEGIN
  IF r = 'owner' THEN RETURN true; END IF;
  CASE p_master
    WHEN 'customer'   THEN RETURN r IN ('sales_manager');
    WHEN 'mill'       THEN RETURN r IN ('mill_manager');
    WHEN 'vendor'     THEN RETURN r IN ('mill_manager');
    WHEN 'yarn_count' THEN RETURN r IN ('mill_manager');
    WHEN 'bobbin'     THEN RETURN r IN ('mill_manager');
    WHEN 'employee'   THEN RETURN r IN ('mill_manager');
    WHEN 'costing'    THEN RETURN r IN ('mill_manager');  -- approval only by owner
    ELSE RETURN false;
  END CASE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Enable RLS on every table
ALTER TABLE company_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config   ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user        ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer        ENABLE ROW LEVEL SECURITY;
ALTER TABLE mill            ENABLE ROW LEVEL SECURITY;
ALTER TABLE yarn_count      ENABLE ROW LEVEL SECURITY;
ALTER TABLE bobbin          ENABLE ROW LEVEL SECURITY;
ALTER TABLE bobbin_stock    ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor          ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE costing_master  ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee        ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_day  ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE yarn_lot        ENABLE ROW LEVEL SECURITY;
ALTER TABLE yarn_purchase   ENABLE ROW LEVEL SECURITY;
ALTER TABLE yarn_purchase_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice         ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line    ENABLE ROW LEVEL SECURITY;
ALTER TABLE loom            ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE outsource_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobwork_order   ENABLE ROW LEVEL SECURITY;
ALTER TABLE resale_lot      ENABLE ROW LEVEL SECURITY;
ALTER TABLE fabric_stock    ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment         ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_sequence    ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification    ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_export   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log       ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- Universal read for owner/auditor — wildcard policy template
-- -----------------------------------------------------------------------------

-- Company profile
CREATE POLICY p_company_read  ON company_profile FOR SELECT USING (true);
CREATE POLICY p_company_write ON company_profile FOR ALL USING (current_user_role() = 'owner');

-- System config
CREATE POLICY p_config_read  ON system_config FOR SELECT USING (true);
CREATE POLICY p_config_write ON system_config FOR ALL USING (current_user_role() = 'owner');

-- App user — see self, owner sees all
CREATE POLICY p_user_self_read ON app_user FOR SELECT
  USING (id = auth.uid() OR current_user_role() IN ('owner','auditor'));
CREATE POLICY p_user_owner_write ON app_user FOR ALL
  USING (current_user_role() = 'owner');
CREATE POLICY p_user_self_update ON app_user FOR UPDATE
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- -----------------------------------------------------------------------------
-- Masters
-- -----------------------------------------------------------------------------
CREATE POLICY p_customer_read  ON customer FOR SELECT
  USING (current_user_role() IN ('owner','auditor','sales_manager','accounts','mill_manager'));
CREATE POLICY p_customer_write ON customer FOR ALL
  USING (can_write_master('customer'));

CREATE POLICY p_mill_read  ON mill FOR SELECT USING (true);
CREATE POLICY p_mill_write ON mill FOR ALL USING (can_write_master('mill'));

CREATE POLICY p_yarn_count_read  ON yarn_count FOR SELECT USING (true);
CREATE POLICY p_yarn_count_write ON yarn_count FOR ALL USING (can_write_master('yarn_count'));

CREATE POLICY p_bobbin_read  ON bobbin FOR SELECT USING (true);
CREATE POLICY p_bobbin_write ON bobbin FOR ALL USING (can_write_master('bobbin'));

CREATE POLICY p_bobbin_stock_read  ON bobbin_stock FOR SELECT USING (true);
CREATE POLICY p_bobbin_stock_write ON bobbin_stock FOR ALL
  USING (current_user_role() IN ('owner','mill_manager'));

CREATE POLICY p_vendor_read  ON vendor FOR SELECT USING (true);
CREATE POLICY p_vendor_write ON vendor FOR ALL USING (can_write_master('vendor'));

CREATE POLICY p_vendor_perf_read  ON vendor_performance FOR SELECT USING (true);
CREATE POLICY p_vendor_perf_write ON vendor_performance FOR ALL
  USING (current_user_role() IN ('owner','mill_manager'));

-- Costing master — anyone can read; mill_manager can create as draft, owner approves
CREATE POLICY p_costing_read  ON costing_master FOR SELECT USING (true);
CREATE POLICY p_costing_insert ON costing_master FOR INSERT
  WITH CHECK (current_user_role() IN ('owner','mill_manager','sales_manager'));
CREATE POLICY p_costing_update ON costing_master FOR UPDATE
  USING (
    current_user_role() = 'owner' OR
    (current_user_role() IN ('mill_manager','sales_manager')
     AND approval_status = 'pending')
  );
CREATE POLICY p_costing_delete ON costing_master FOR DELETE
  USING (current_user_role() = 'owner');

-- Customer price history — read by sales/accounts/owner
CREATE POLICY p_cph_read ON customer_price_history FOR SELECT
  USING (current_user_role() IN ('owner','auditor','sales_manager','accounts'));
CREATE POLICY p_cph_write ON customer_price_history FOR INSERT
  WITH CHECK (current_user_role() IN ('owner','sales_manager'));

-- -----------------------------------------------------------------------------
-- Employees & attendance — Floor operators see own attendance only
-- -----------------------------------------------------------------------------
CREATE POLICY p_employee_read ON employee FOR SELECT
  USING (current_user_role() IN ('owner','auditor','mill_manager','accounts'));
CREATE POLICY p_employee_write ON employee FOR ALL
  USING (can_write_master('employee'));

CREATE POLICY p_att_day_read ON attendance_day FOR SELECT USING (true);
CREATE POLICY p_att_day_write ON attendance_day FOR ALL
  USING (current_user_role() IN ('owner','mill_manager'));

-- Floor operator: see only own entries; mill_manager/owner see all
CREATE POLICY p_att_entry_read ON attendance_entry FOR SELECT
  USING (
    current_user_role() IN ('owner','auditor','mill_manager','accounts') OR
    employee_id IN (
      SELECT id FROM employee WHERE code = (
        SELECT raw_user_meta_data->>'employee_code' FROM auth.users WHERE id = auth.uid()
      )
    )
  );
CREATE POLICY p_att_entry_write ON attendance_entry FOR ALL
  USING (current_user_role() IN ('owner','mill_manager'));

-- -----------------------------------------------------------------------------
-- Inventory & purchases
-- -----------------------------------------------------------------------------
CREATE POLICY p_lot_read  ON yarn_lot FOR SELECT USING (true);
CREATE POLICY p_lot_write ON yarn_lot FOR ALL
  USING (current_user_role() IN ('owner','mill_manager'));

CREATE POLICY p_purchase_read ON yarn_purchase FOR SELECT
  USING (current_user_role() IN ('owner','auditor','mill_manager','accounts'));
CREATE POLICY p_purchase_write ON yarn_purchase FOR ALL
  USING (current_user_role() IN ('owner','mill_manager','accounts'));

CREATE POLICY p_purchase_line_read ON yarn_purchase_line FOR SELECT
  USING (current_user_role() IN ('owner','auditor','mill_manager','accounts'));
CREATE POLICY p_purchase_line_write ON yarn_purchase_line FOR ALL
  USING (current_user_role() IN ('owner','mill_manager','accounts'));

-- -----------------------------------------------------------------------------
-- Sales / invoicing
-- -----------------------------------------------------------------------------
CREATE POLICY p_so_read ON sales_order FOR SELECT
  USING (current_user_role() IN ('owner','auditor','sales_manager','accounts','mill_manager'));
CREATE POLICY p_so_write ON sales_order FOR ALL
  USING (current_user_role() IN ('owner','sales_manager'));

CREATE POLICY p_so_line_read ON sales_order_line FOR SELECT
  USING (current_user_role() IN ('owner','auditor','sales_manager','accounts','mill_manager'));
CREATE POLICY p_so_line_write ON sales_order_line FOR ALL
  USING (current_user_role() IN ('owner','sales_manager'));

CREATE POLICY p_invoice_read ON invoice FOR SELECT
  USING (current_user_role() IN ('owner','auditor','sales_manager','accounts'));
CREATE POLICY p_invoice_write ON invoice FOR ALL
  USING (current_user_role() IN ('owner','accounts','sales_manager'));

CREATE POLICY p_invoice_line_read ON invoice_line FOR SELECT
  USING (current_user_role() IN ('owner','auditor','sales_manager','accounts'));
CREATE POLICY p_invoice_line_write ON invoice_line FOR ALL
  USING (current_user_role() IN ('owner','accounts','sales_manager'));

-- -----------------------------------------------------------------------------
-- Production / outsourcing / jobwork
-- -----------------------------------------------------------------------------
CREATE POLICY p_loom_read ON loom FOR SELECT USING (true);
CREATE POLICY p_loom_write ON loom FOR ALL
  USING (current_user_role() IN ('owner','mill_manager'));

CREATE POLICY p_batch_read ON production_batch FOR SELECT USING (true);
CREATE POLICY p_batch_write ON production_batch FOR ALL
  USING (current_user_role() IN ('owner','mill_manager'));

CREATE POLICY p_ow_read ON outsource_order FOR SELECT
  USING (current_user_role() IN ('owner','auditor','mill_manager','accounts'));
CREATE POLICY p_ow_write ON outsource_order FOR ALL
  USING (current_user_role() IN ('owner','mill_manager'));

CREATE POLICY p_jw_read ON jobwork_order FOR SELECT
  USING (current_user_role() IN ('owner','auditor','mill_manager','accounts','sales_manager'));
CREATE POLICY p_jw_write ON jobwork_order FOR ALL
  USING (current_user_role() IN ('owner','mill_manager'));

CREATE POLICY p_resale_read ON resale_lot FOR SELECT
  USING (current_user_role() IN ('owner','auditor','sales_manager','accounts','mill_manager'));
CREATE POLICY p_resale_write ON resale_lot FOR ALL
  USING (current_user_role() IN ('owner','mill_manager','sales_manager'));

CREATE POLICY p_fabric_stock_read ON fabric_stock FOR SELECT USING (true);
CREATE POLICY p_fabric_stock_write ON fabric_stock FOR ALL
  USING (current_user_role() IN ('owner','mill_manager'));

-- -----------------------------------------------------------------------------
-- Payments & numbering
-- -----------------------------------------------------------------------------
CREATE POLICY p_payment_read ON payment FOR SELECT
  USING (current_user_role() IN ('owner','auditor','accounts','sales_manager'));
CREATE POLICY p_payment_write ON payment FOR ALL
  USING (current_user_role() IN ('owner','accounts'));

CREATE POLICY p_doc_seq_read ON doc_sequence FOR SELECT USING (true);
CREATE POLICY p_doc_seq_write ON doc_sequence FOR ALL
  USING (current_user_role() = 'owner');

-- Notifications — own only
CREATE POLICY p_notif_self ON notification FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY p_notif_self_update ON notification FOR UPDATE
  USING (user_id = auth.uid());
CREATE POLICY p_notif_insert ON notification FOR INSERT WITH CHECK (true);

-- Report exports — own only, owner sees all
CREATE POLICY p_export_read ON report_export FOR SELECT
  USING (generated_by = auth.uid() OR current_user_role() IN ('owner','auditor'));
CREATE POLICY p_export_write ON report_export FOR ALL
  USING (generated_by = auth.uid() OR current_user_role() = 'owner');

-- Audit log — owner & auditor only, read-only
CREATE POLICY p_audit_read ON audit_log FOR SELECT
  USING (current_user_role() IN ('owner','auditor'));
-- No write policy: only the SECURITY DEFINER trigger can insert
