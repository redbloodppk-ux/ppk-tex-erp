-- =============================================================================
-- PPK TEX ERP — Seed data
-- Run AFTER schema.sql + rls.sql
-- Contains:
--   * Company profile
--   * System constants (1848, 1690, 5315) and LOOMS overhead breakdown
--   * Document numbering registry
--   * Yarn counts seen across spec + prototypes
--   * Fabric qualities (Costing Master)
--   * Bobbin types
--   * Sample customers, mills, vendors, employees
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Company profile
-- -----------------------------------------------------------------------------
INSERT INTO company_profile (
  legal_name, display_name, gstin, pan,
  address_line1, address_line2, city, state, pincode,
  phone, email, website, fy_start_month, base_currency
) VALUES (
  'PPK Tex Industries', 'PPK TEX',
  '33AAAFP1234C1Z5', 'AAAFP1234C',
  'Plot 12, SIDCO Industrial Estate', 'Ganapathy',
  'Coimbatore', 'Tamil Nadu', '641021',
  '+91 422 2540123', 'hello@ppktex.in', 'https://ppktex.in',
  4, 'INR'
);

-- -----------------------------------------------------------------------------
-- 2. System config — textile constants & LOOMS overhead breakdown
-- -----------------------------------------------------------------------------
INSERT INTO system_config (key, value, description) VALUES
  ('textile_constants',
   '{"woven_warp": 1848, "weft": 1690, "denier_to_nec": 5315}',
   'Frozen textile constants from Costing Spec v1.1. Do not modify.'),

  ('looms_overhead_breakdown',
   '{"power": 2.10, "labour": 1.84, "maintenance": 0.62, "depreciation": 0.48, "insurance": 0.10}',
   'LOOMS overhead per metre breakdown (₹/m). Total = 5.14. Used for True Cost on in-house fabric.'),

  ('default_yarn_wastage_pct', '0.02', 'Default yarn wastage applied to warp + weft (2%).'),

  ('default_porvai_wastage_pct', '0.02', 'Default porvai wastage (2%).'),

  ('default_bobbin_loading_per_m', '0.10', 'Default bobbin handling charge ₹/m.'),

  ('selvedge_defaults',
   '{"plain": 0, "cotton_towel": 50, "white_towel": 50, "dobby_towel": 50}',
   'Selvedge ends defaults per fabric type.'),

  ('approval_thresholds',
   '{"costing_create": "mill_manager", "costing_approve": "owner", "discount_pct_max": 5}',
   'Who can do what without owner sign-off.'),

  ('attendance_lock_days', '7', 'Days after which attendance edits require admin override.'),

  ('attendance_edit_window_hours', '24', 'Window during which supervisor can edit without approval.'),

  ('pwa_offline_features',
   '["wages_entry", "customer_payment", "purchase_payment", "fabric_costing_calc", "attendance_marking"]',
   'Features cached for offline use in PWA (per Master Spec v3.0 §2.5 + Module 11 §1.1).');

-- -----------------------------------------------------------------------------
-- 3. Document numbering
-- -----------------------------------------------------------------------------
INSERT INTO doc_sequence (doc_type, prefix, format, fy_code, next_value, reset_yearly) VALUES
  ('so',       'SO',  '{prefix}-{fy}-{seq:0000}',  '2026',   39, true),
  ('invoice',  'INV', '{prefix}/{fy}/{seq:0000}',  '26-27', 143, true),
  ('po',       'PO',  '{prefix}-{fy}-{seq:0000}',  '2026',   19, true),
  ('jw',       'JW',  '{prefix}-{fy}-{seq:0000}',  '2026',   25, true),
  ('ow',       'OW',  '{prefix}-{fy}-{seq:0000}',  '2026',   13, true),
  ('rl',       'RL',  '{prefix}-{fy}-{seq:0000}',  '2026',    9, true),
  ('pay',      'PAY', '{prefix}-{fy}-{seq:0000}',  '2026',    1, true),
  ('cust',     'CUST','{prefix}-{seq:0000}',        '',      33, false),
  ('emp',      'EMP', '{prefix}-{seq:0000}',        '',      27, false),
  ('mill',     'MILL','{prefix}-{seq:000}',         '',       9, false),
  ('vendor',   'VEN', '{prefix}-{seq:000}',         '',       8, false),
  ('lot',      'LOT', '{prefix}-{fy}-{seq:0000}',  '2026',   43, true);

-- -----------------------------------------------------------------------------
-- 4. Yarn counts
-- -----------------------------------------------------------------------------
INSERT INTO yarn_count (code, display_name, yarn_type, ne, denier, tex, is_doubled, is_slub, reorder_kg, notes) VALUES
  -- Cotton (single ply)
  ('C-30',    '30s combed cotton',     'cotton',    30,    NULL, 19.68, false, false, 200, 'Most-used. Hero seller.'),
  ('C-40',    '40s combed cotton',     'cotton',    40,    NULL, 14.76, false, false, 150, 'Common warp & weft.'),
  ('C-40CD',  '40s carded cotton',     'cotton',    40,    NULL, 14.76, false, false, 100, 'Cheaper alternative to combed.'),
  ('C-65.5',  '65.5s combed cotton',   'cotton',    65.5,  NULL,  9.01, false, false,  80, 'Fine count for premium cotton.'),
  ('C-60',    '60s combed cotton',     'cotton',    60,    NULL,  9.84, false, false,  60, NULL),
  ('C-80',    '80s combed cotton',     'cotton',    80,    NULL,  7.38, false, false,  40, 'Very fine; voile/dupatta.'),
  ('C-100',   '100s combed cotton',    'cotton',    100,   NULL,  5.91, false, false,  20, 'Ultra-fine.'),
  ('C-20',    '20s coarse cotton',     'cotton',    20,    NULL, 29.53, false, false, 100, 'Heavier fabrics.'),

  -- Doubled (two-ply)
  ('C-2-40',  '2/40s doubled cotton',  'cotton',    20,    NULL, 29.53, true,  false, 120, 'Two-ply 40s = 20s equivalent.'),
  ('C-2-20',  '2/20s doubled cotton',  'cotton',    10,    NULL, 59.05, true,  false,  60, 'Coarse two-ply.'),

  -- Slub
  ('C-20S',   '20s slub cotton',       'cotton',    20,    NULL, 29.53, false, true,   40, 'Slub yarn — uneven texture.'),

  -- Polyester (Porvai)
  ('P-150D',  '150D Porvai polyester', 'polyester', NULL,  150,    NULL, false, false, 30, 'For dobby towels. NeC = 5315/150 = 35.43.'),
  ('P-100D',  '100D Porvai polyester', 'polyester', NULL,  100,    NULL, false, false, 15, 'Finer porvai.'),
  ('P-300D',  '300D Porvai polyester', 'polyester', NULL,  300,    NULL, false, false, 15, 'Coarser porvai.');

-- -----------------------------------------------------------------------------
-- 5. Mills (yarn suppliers)
-- -----------------------------------------------------------------------------
INSERT INTO mill (code, name, contact_person, gstin, phone, email, address, city, state, is_preferred) VALUES
  ('MILL-001', 'Sri Selvam Spinning Mills', 'Selvam K',     '33AABCS1234A1Z9', '+91 9842012345', 'sales@selvamspinning.in', 'Pollachi Main Road', 'Pollachi', 'Tamil Nadu', true),
  ('MILL-002', 'JK Cotton Mills',           'Karthik R',    '33AAACJ5678B2Z1', '+91 9442098765', 'jk@jkcotton.in',          'Avinashi Road',     'Tirupur',  'Tamil Nadu', false),
  ('MILL-003', 'Ramanathan Textiles',       'Ramanathan S', '33AABCR3456C1Z3', '+91 9486012345', 'info@ramantex.in',        'Kuniyamuthur',      'Coimbatore','Tamil Nadu', false),
  ('MILL-004', 'Premier Polyester',         'Murugan V',    '33AABCP7890D1Z2', '+91 9444012321', 'sales@premierpoly.in',    'Avinashi',           'Tirupur',  'Tamil Nadu', true),
  ('MILL-005', 'Lotus Spinners',            'Sundar L',     '33AABCL2345E1Z4', '+91 9842056789', 'lotus@lotusspin.in',      'SIDCO',              'Coimbatore','Tamil Nadu', false);

-- -----------------------------------------------------------------------------
-- 6. Vendors (weaving / sizing)
-- -----------------------------------------------------------------------------
INSERT INTO vendor (code, name, vendor_type, contact_person, gstin, phone, default_pick_paise, payment_terms_days, status) VALUES
  ('VEN-001', 'Annamalai Weaving Unit',    'weaving', 'Annamalai S',  '33AABCA1111X1Z5', '+91 9842111111', 4.20, 30, 'active'),
  ('VEN-002', 'Pasupathi Powerlooms',      'weaving', 'Pasupathi K',  '33AABCP2222Y1Z6', '+91 9842222222', 4.10, 30, 'active'),
  ('VEN-003', 'Krishnan Sizing Unit',      'sizing',  'Krishnan M',   '33AABCK3333Z1Z7', '+91 9842333333', NULL, 30, 'active'),
  ('VEN-004', 'Devi Folding & Packing',    'folding', 'Devi R',       '33AABCD4444A1Z8', '+91 9842444444', NULL, 15, 'active'),
  ('VEN-005', 'Tirupur Mega Weaving',      'weaving', 'Velmurugan P', '33AABCT5555B1Z9', '+91 9842555555', 4.30, 45, 'active');

-- -----------------------------------------------------------------------------
-- 7. Bobbins (small warp beams)
-- -----------------------------------------------------------------------------
INSERT INTO bobbin (code, description, ends_per_bobbin, bobbin_metre, bobbin_price, is_lurex, vendor_id, reorder_pieces, loading_per_metre) VALUES
  ('BB-36-1500',  '36-end Cotton Warp Beam, 1500m',  36,  1500, 2400, false, 5, 10, 0.10),
  ('BB-48-2000',  '48-end Cotton Warp Beam, 2000m',  48,  2000, 3600, false, 5, 10, 0.10),
  ('BB-72-2000',  '72-end Cotton Warp Beam, 2000m',  72,  2000, 4704, false, 5, 12, 0.10),
  ('BB-120-2000', '120-end Cotton Warp Beam, 2000m', 120, 2000, 7200, false, 5,  8, 0.10),
  ('LX-24-1000',  'Lurex Decorative Bobbin, 1000m',  24,  1000, 1800, true,  5, 15, 0.15);

-- Initial bobbin stock at main godown
INSERT INTO bobbin_stock (bobbin_id, location, quantity_pcs)
SELECT id, 'main_godown', reorder_pieces * 2 FROM bobbin;

-- -----------------------------------------------------------------------------
-- 8. Looms (in-house)
-- -----------------------------------------------------------------------------
INSERT INTO loom (loom_code, loom_type, width_in, status, notes) VALUES
  ('L-01', 'auto',      63, 'running', 'Sulzer Ruti'),
  ('L-02', 'auto',      63, 'running', 'Sulzer Ruti'),
  ('L-03', 'auto',      63, 'running', 'Sulzer Ruti'),
  ('L-04', 'auto',      63, 'running', NULL),
  ('L-05', 'powerloom', 56, 'running', NULL),
  ('L-06', 'powerloom', 56, 'running', NULL),
  ('L-07', 'powerloom', 56, 'idle',    'Awaiting beam'),
  ('L-08', 'powerloom', 56, 'maintenance', 'Picker stick replacement'),
  ('L-09', 'rapier',    72, 'running', 'For wider towels'),
  ('L-10', 'rapier',    72, 'running', 'For wider towels');

-- -----------------------------------------------------------------------------
-- 9. Sample customers
-- -----------------------------------------------------------------------------
INSERT INTO customer (code, name, contact_person, gstin, pan, phone, email,
                      billing_address, city, state, pincode,
                      payment_terms_days, credit_limit, is_vip, status) VALUES
  ('CUST-0001', 'SKM Garments',        'Mohan SKM',       '33AABCS9876P1Z2', 'AABCS9876P', '+91 9876543210', 'orders@skmgarments.in',
   '12, Avinashi Road', 'Tirupur', 'Tamil Nadu', '641603', 30, 2000000, true,  'active'),
  ('CUST-0002', 'Arul Textiles',       'Arul N',          '33AABCA1234B1Z3', 'AABCA1234B', '+91 9842111122', 'arul@arultex.in',
   '8, Mettupalayam Road', 'Coimbatore', 'Tamil Nadu', '641043', 45, 1000000, true,  'active'),
  ('CUST-0003', 'Ravi Tex',            'Ravi K',          '33AABCR5678C1Z4', 'AABCR5678C', '+91 9442223344', 'ravi@ravitex.in',
   '21, Trichy Road', 'Coimbatore', 'Tamil Nadu', '641018', 30, 800000, false, 'active'),
  ('CUST-0004', 'Ganesh Apparels',     'Ganesh V',        '33AABCG3456D1Z5', 'AABCG3456D', '+91 9486012345', 'ganesh@ganeshapp.in',
   '5, Race Course', 'Coimbatore', 'Tamil Nadu', '641018', 30, 500000, false, 'active'),
  ('CUST-0005', 'Priya Textiles',      'Priya R',         '33AABCP7890E1Z6', 'AABCP7890E', '+91 9442334455', 'priya@priyatex.in',
   '14, Big Bazaar Street', 'Pollachi', 'Tamil Nadu', '642001', 30, 600000, true,  'active'),
  ('CUST-0006', 'Venkateshwara Silks', 'Venkat S',        '33AABCV2345F1Z7', 'AABCV2345F', '+91 9444056789', 'venkat@vsilks.in',
   '67, Kamaraj Road', 'Erode', 'Tamil Nadu', '638001', 60, 400000, false, 'active'),
  ('CUST-0007', 'Mohan Apparels',      'Karthik Subramanian','33AABCS4567K1Z9','AABCS4567K','+91 9842090909','karthik@mohanapparels.in',
   'Plot 21, SIPCOT Industrial Park', 'Tirupur', 'Tamil Nadu', '641604', 45, 1500000, true, 'active'),
  ('CUST-0008', 'Lakshmi Fabrics',     'Lakshmi T',       '33AABCL6789G1Z8', 'AABCL6789G', '+91 9842445566', 'sales@lakshmifab.in',
   '32, RS Puram', 'Coimbatore', 'Tamil Nadu', '641002', 30, 700000, false, 'active'),
  ('CUST-0009', 'Bombay Textile',      'Sanjay M',        '27AABCB1111H1Z9', 'AABCB1111H', '+91 9892334455', 'sanjay@bombaytex.in',
   '12, Dadar West', 'Mumbai', 'Maharashtra', '400028', 60, 1200000, false, 'active');

-- -----------------------------------------------------------------------------
-- 10. Sample employees
-- -----------------------------------------------------------------------------
INSERT INTO employee (code, full_name, role, default_shift, date_of_joining, phone, status) VALUES
  ('EMP-0001', 'Selvam M',      'weaver',  'morning', '2018-03-15', '+91 9842100001', 'active'),
  ('EMP-0002', 'Ramaswamy K',   'weaver',  'morning', '2019-06-20', '+91 9842100002', 'active'),
  ('EMP-0003', 'Murugan P',     'weaver',  'night',   '2020-01-10', '+91 9842100003', 'active'),
  ('EMP-0004', 'Sundaram R',    'weaver',  'either',  '2017-08-05', '+91 9842100004', 'active'),
  ('EMP-0005', 'Balu V',        'weaver',  'morning', '2021-04-12', '+91 9842100005', 'active'),
  ('EMP-0006', 'Pandian S',     'weaver',  'night',   '2018-11-22', '+91 9842100006', 'active'),
  ('EMP-0007', 'Kumar T',       'weaver',  'morning', '2022-02-14', '+91 9842100007', 'active'),
  ('EMP-0008', 'Velu N',        'weaver',  'night',   '2019-09-30', '+91 9842100008', 'active'),
  ('EMP-0009', 'Lakshmi M',     'winder',  'morning', '2020-07-18', '+91 9842100009', 'active'),
  ('EMP-0010', 'Komala K',      'winder',  'morning', '2021-10-05', '+91 9842100010', 'active'),
  ('EMP-0011', 'Kala R',        'folder',  'morning', '2018-05-25', '+91 9842100011', 'active'),
  ('EMP-0012', 'Saraswathi P',  'folder',  'morning', '2019-12-10', '+91 9842100012', 'active'),
  ('EMP-0013', 'Karthik V',     'fitter',  'morning', '2016-04-01', '+91 9842100013', 'active'),
  ('EMP-0014', 'Mani D',        'fitter',  'night',   '2017-07-15', '+91 9842100014', 'active'),
  ('EMP-0015', 'Senthil P',     'auto',    'morning', '2020-02-20', '+91 9842100015', 'active'),
  ('EMP-0016', 'Raju K',        'knotter', 'either',  '2019-08-08', '+91 9842100016', 'active'),
  ('EMP-0017', 'Praveen Kumar', 'office',  'morning', '2010-01-01', '+91 9842100099', 'active'),
  ('EMP-0018', 'Ravi Sundaram', 'office',  'morning', '2015-06-15', '+91 9842100098', 'active'),
  ('EMP-0019', 'Karthik Selvam','office',  'morning', '2018-03-20', '+91 9842100097', 'active'),
  ('EMP-0020', 'Lakshmi Murthy','office',  'morning', '2019-11-12', '+91 9842100096', 'active');

-- -----------------------------------------------------------------------------
-- 11. Fabric Qualities (Costing Master) — sample qualities from prototypes
-- -----------------------------------------------------------------------------
-- 30s plain grey — hero seller (42% of volume)
INSERT INTO costing_master (
  quality_code, quality_name, fabric_type, production_mode,
  warp_count_id, warp_ends, tape_length_m, shrinkage_pct, yarn_wastage_pct,
  weft_count_id, pick_ppi, fabric_length_m, weft_allowance_m,
  reed_count, fabric_width_in, selvedge_ends,
  pick_paise_market, sizing_cost_per_m, auto_cost_per_m,
  warp_commission_per_m, fabric_commission_per_m,
  approval_status, save_path, notes
) VALUES (
  '30HT-PLAIN-GREY', '30s Plain Grey', 'woven', 'inhouse',
  (SELECT id FROM yarn_count WHERE code='C-30'), 3192, 41.5, 0.025, 0.02,
  (SELECT id FROM yarn_count WHERE code='C-30'), 38, 52.75, 2,
  56, 53, 0,
  4.20, 2.20, 0.30, 0.50, 0.40,
  'approved', 'formal', 'Hero seller — 42% of volume.'
);

INSERT INTO costing_master (
  quality_code, quality_name, fabric_type, production_mode,
  warp_count_id, tape_length_m, shrinkage_pct, yarn_wastage_pct,
  weft_count_id, pick_ppi, fabric_length_m, weft_allowance_m,
  reed_count, fabric_width_in, selvedge_ends,
  pick_paise_market, sizing_cost_per_m, auto_cost_per_m,
  warp_commission_per_m, fabric_commission_per_m,
  approval_status, save_path
) VALUES
  ('40HT-PLAIN-BLEACH', '40s Plain Bleached', 'woven', 'inhouse',
   (SELECT id FROM yarn_count WHERE code='C-40'), 41.5, 0.022, 0.02,
   (SELECT id FROM yarn_count WHERE code='C-40'), 46, 52.75, 2,
   68, 53, 0, 4.50, 2.40, 0.30, 0.50, 0.40, 'approved', 'formal'),

  ('40HT-POPLIN', '40s Poplin', 'woven', 'inhouse',
   (SELECT id FROM yarn_count WHERE code='C-40'), 42.5, 0.020, 0.02,
   (SELECT id FROM yarn_count WHERE code='C-40'), 56, 48.0, 3,
   72, 48, 0, 4.80, 2.60, 0.30, 0.50, 0.40, 'approved', 'formal'),

  ('65HT-DOBBY', '65.5s Dobby', 'woven', 'both',
   (SELECT id FROM yarn_count WHERE code='C-65.5'), 42.5, 0.018, 0.02,
   (SELECT id FROM yarn_count WHERE code='C-65.5'), 56, 48.0, 3,
   72, 48, 0, 5.20, 2.80, 0.30, 0.50, 0.50, 'approved', 'formal'),

  ('40HT-TWILL', '40s Twill', 'woven', 'inhouse',
   (SELECT id FROM yarn_count WHERE code='C-40'), 42.5, 0.022, 0.02,
   (SELECT id FROM yarn_count WHERE code='C-40'), 52, 48.0, 3,
   68, 48, 0, 4.60, 2.40, 0.30, 0.50, 0.40, 'approved', 'formal'),

  ('60HT-SATIN', '60s Satin', 'woven', 'inhouse',
   (SELECT id FROM yarn_count WHERE code='C-60'), 42.5, 0.020, 0.02,
   (SELECT id FROM yarn_count WHERE code='C-60'), 60, 48.0, 3,
   76, 48, 0, 5.40, 2.80, 0.30, 0.50, 0.50, 'approved', 'formal'),

  ('20HT-SLUB', '20s Slub Cotton', 'woven', 'inhouse',
   (SELECT id FROM yarn_count WHERE code='C-20S'), 41.5, 0.025, 0.025,
   (SELECT id FROM yarn_count WHERE code='C-20'),  32, 48.0, 2,
   48, 48, 0, 4.00, 2.20, 0.30, 0.50, 0.40, 'approved', 'formal'),

  ('80HT-VOILE', '80s Voile Dupatta', 'dupatta', 'inhouse',
   (SELECT id FROM yarn_count WHERE code='C-80'), 41.5, 0.020, 0.02,
   (SELECT id FROM yarn_count WHERE code='C-80'), 64, 48.0, 3,
   80, 36, 0, 5.80, 3.00, 0.30, 0.50, 0.60, 'approved', 'formal'),

  ('CHK-30-MULTI', '30s Multi-Check', 'woven', 'inhouse',
   (SELECT id FROM yarn_count WHERE code='C-30'), 41.5, 0.025, 0.02,
   (SELECT id FROM yarn_count WHERE code='C-30'), 38, 52.75, 2,
   56, 53, 0, 4.30, 2.20, 0.30, 0.50, 0.40, 'approved', 'formal');

-- 30s Cotton Towel with Porvai (dobby pattern)
INSERT INTO costing_master (
  quality_code, quality_name, fabric_type, production_mode,
  warp_count_id, tape_length_m, shrinkage_pct, yarn_wastage_pct,
  weft_count_id, pick_ppi, fabric_length_m, weft_allowance_m,
  reed_count, fabric_width_in, selvedge_ends,
  use_porvai, porvai_count_id, porvai_slevage_length_m, porvai_wastage_pct,
  use_bobbin_1, bobbin_1_id, bobbin_1_loading,
  pick_paise_market, sizing_cost_per_m, auto_cost_per_m,
  warp_commission_per_m, fabric_commission_per_m,
  approval_status, save_path, notes
) VALUES (
  'TOW-30-DOBBY-P', '30s Cotton Dobby Towel (Porvai)', 'towel', 'inhouse',
  (SELECT id FROM yarn_count WHERE code='C-30'), 41.5, 0.030, 0.02,
  (SELECT id FROM yarn_count WHERE code='C-30'), 42, 48.0, 2,
  56, 48, 50,
  true, (SELECT id FROM yarn_count WHERE code='P-150D'), 2.5, 0.02,
  true, (SELECT id FROM bobbin WHERE code='BB-72-2000'), 0.10,
  4.40, 2.30, 0.30, 0.50, 0.40,
  'approved', 'formal',
  'Premium dobby towel with polyester selvedge. Porvai NeC = 5315/150 = 35.43.'
);

-- -----------------------------------------------------------------------------
-- 12. Sample initial yarn lots (so weighted-avg view returns numbers)
-- -----------------------------------------------------------------------------
INSERT INTO yarn_lot (lot_code, yarn_count_id, mill_id, received_date, received_kg, current_kg, cost_per_kg, notes) VALUES
  ('LOT-2026-0001', (SELECT id FROM yarn_count WHERE code='C-30'),   1, '2026-04-02', 500, 320, 220.50, 'Opening stock'),
  ('LOT-2026-0002', (SELECT id FROM yarn_count WHERE code='C-30'),   1, '2026-04-15', 500, 460, 224.75, NULL),
  ('LOT-2026-0003', (SELECT id FROM yarn_count WHERE code='C-40'),   2, '2026-04-05', 400, 280, 245.20, NULL),
  ('LOT-2026-0004', (SELECT id FROM yarn_count WHERE code='C-65.5'), 1, '2026-04-08', 200, 145, 312.40, NULL),
  ('LOT-2026-0005', (SELECT id FROM yarn_count WHERE code='P-150D'), 4, '2026-04-12', 150,  92, 198.60, 'Porvai stock'),
  ('LOT-2026-0006', (SELECT id FROM yarn_count WHERE code='C-2-40'), 3, '2026-04-18', 250, 200, 252.00, NULL),
  ('LOT-2026-0007', (SELECT id FROM yarn_count WHERE code='C-20S'),  5, '2026-04-22', 180, 140, 198.30, 'Slub yarn'),
  ('LOT-2026-0008', (SELECT id FROM yarn_count WHERE code='C-80'),   1, '2026-04-25', 100,  80, 385.00, 'Fine count');

-- =============================================================================
-- END seed.sql
-- After running: SELECT * FROM v_costing_two_cost; should return 9 qualities
-- with both quoted_cost_per_m and true_cost_per_m populated.
-- =============================================================================
