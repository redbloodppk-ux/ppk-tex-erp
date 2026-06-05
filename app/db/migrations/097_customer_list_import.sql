-- 097_customer_list_import.sql
--
-- Bulk import 158 customers from the legacy "customer list" Excel master.
-- Each row becomes a party with party_type_ids = {Customer}. The existing
-- triggers do the rest:
--   072 / fn_party_link_ledger       → creates the CUSTOMER ledger row
--   081 / fn_party_sync_legacy_type  → syncs party_type_id from array
--   096 / fn_party_to_customer_sync  → creates the matching customer row
-- so this single INSERT walks the full party → ledger → customer chain.
--
-- Normalisations applied during import:
--   - GSTIN: all spaces stripped (the legacy file stores them as
--     "33 AOJPS3994L 1 Z 6" — we want "33AOJPS3994L1Z6").
--   - Pincode: spaces stripped ("638 003" → "638003").
--   - State: TAMILNADU / MAHARASTRA / RAJASTHAN / GUJARAT mapped to
--     properly cased "Tamil Nadu" / "Maharashtra" / "Rajasthan" /
--     "Gujarat"; anything else passes through initcap().
--   - City: initcap() so "ERODE" → "Erode".
--
-- The WHERE NOT EXISTS guard at the bottom makes this migration
-- idempotent: re-running it is a no-op for names already in party.

BEGIN;

DO $$
DECLARE
  v_customer_type_id bigint;
BEGIN
  SELECT id INTO v_customer_type_id
  FROM public.party_type_master
  WHERE name = 'Customer';

  IF v_customer_type_id IS NULL THEN
    RAISE EXCEPTION 'party_type_master row for Customer not found - apply migration 071 first';
  END IF;

  INSERT INTO public.party (
    name, gstin, billing_address, city, state, pincode, state_code,
    party_type_ids
  )
  SELECT
    trim(v.name),
    NULLIF(REPLACE(v.gstin, ' ', ''), ''),
    v.billing_address,
    NULLIF(initcap(trim(v.city)), ''),
    CASE upper(trim(v.state))
      WHEN 'TAMILNADU'  THEN 'Tamil Nadu'
      WHEN 'MAHARASTRA' THEN 'Maharashtra'
      WHEN 'RAJASTHAN'  THEN 'Rajasthan'
      WHEN 'GUJARAT'    THEN 'Gujarat'
      ELSE initcap(trim(v.state))
    END,
    NULLIF(REPLACE(v.pincode, ' ', ''), ''),
    NULLIF(trim(v.state_code), ''),
    ARRAY[v_customer_type_id]::bigint[]
  FROM (VALUES
    ('A S FABRICS',                              '33 AOJPS3994L 1 Z 6',  '204/59 CHINAPPA LAYOUT, KARUNGALPALAYAM',                                                              'ERODE',    'TAMILNADU', '',       '33'),
    ('AARYAN EXPORTS',                           '33 AEEPK3878E 2 Z J',  '71/38 POONKUDARANAR STREET, KARUNGALPALAYM',                                                            'ERODE',    'TAMILNADU', '638003', '33'),
    ('AATHI VINAYAGA TEX',                       '33 GXZPS4071P 1 Z 8',  'NO 13 MGR STREET, VEERAPPANCHATRAM',                                                                    'ERODE',    'TAMILNADU', '638004', '33'),
    ('AAYESHA TEXTILES MILLS',                   '33 ATWPD7265M 1 Z O',  '25/1 LAKSHMI NARAYAN NAGAR, INDIRA NAGAR',                                                              'ERODE',    'TAMILNADU', '638003', '33'),
    ('ABHINANDAN CORPORATION',                   '33 ABCFA9663Q 1 Z V',  '38 GANAPATHIPURAM, KARUNGALPALAYAM',                                                                    'ERODE',    'TAMILNADU', '638003', '33'),
    ('AMBIKA TEXTILES',                          '33 AALFA2297A 1 Z T',  '333/2A2 PERIYASEMUR MAIN ROAD',                                                                         'ERODE',    'TAMILNADU', '638004', '33'),
    ('AMMAN TEXTILE',                            '33 AAPPC2457C 1 Z 4',  '22/127 SUBBAIAN STREET, KARUNGALPALAYAM',                                                               'ERODE',    'TAMILNADU', '638003', '33'),
    ('AMUTHA TEX',                               '33 AVHPK4481 H 2 Z I', '46/3 VINAYAGAR KOVIL 6TH ST BHARATHI NAGAR, MOOLAPALAYAM',                                              'ERODE',    'TAMILNADU', '638002', '33'),
    ('ANIL LUNGI COMPANY',                       '33 BJIPB9378N 2 Z M',  '8/9, KARPAGAM LAYOUT 5TH STREET, INDIRA NAGAR',                                                         'ERODE',    'TAMILNADU', '638003', '33'),
    ('ANUJ EXPORTS',                             '33 ABJFA0123C 1 Z C',  'NO 165 KAS NAGAR, KARUNGALPALAYAM',                                                                     'ERODE',    'TAMILNADU', '638003', '33'),
    ('ASHAPURI IMPEX',                           '33 ADVPL6253A 1 Z L',  '904 KNK ROAD, THIRUNAGAR COLONY',                                                                       'ERODE',    'TAMILNADU', '638003', '33'),
    ('ASHTALAXMI FABRICS',                       '33 ABKFA0899C 1 Z K',  '51 MEENAKSHI SUNDHARAM ROAD, THIRUNAGAR COLONY',                                                        'ERODE',    'TAMILNADU', '638003', '33'),
    ('ASHWINI HANDLOOM',                         '33 AJRPM3450A 1 Z I',  '26 NMS COMPOUND',                                                                                       'ERODE',    'TAMILNADU', '638001', '33'),
    ('BADRINATH TEXFAB',                         '33 CQZPP0385A 1 Z N',  '3/2 1ST FLOOR, MARAPALAM ROAD NO 4, KAS NAGAR, NEAR BOMBAY STORE',                                      'ERODE',    'TAMILNADU', '638003', '33'),
    ('BALAJI CORPORATIONS',                      '33 AASFB1920A 1 Z 1',  '32 GANPATHIPURAM, OLD REGISTRAR OFFICE ROAD, KARUNGALPALAYAM',                                          'ERODE',    'TAMILNADU', '638003', '33'),
    ('BALAJI ENTERPRISE',                        '33 AAGFB5982N 1 Z 0',  '71/38 POONKUNARANAR STREET, KARUNGALPALAYAM',                                                           'ERODE',    'TAMILNADU', '638003', '33'),
    ('BALAJI TEXTILE AGENCY',                    '33 BAUPM3769D 1 Z D',  '17 WARD 59 MARAPALAYAM ROAD, KAS NAGAR',                                                                'ERODE',    'TAMILNADU', '638003', '33'),
    ('BHARAT COTTON MILLS',                      '33 ACRPD1356K 1 Z K',  '91 MADHAVA KRISHNA STREET',                                                                             'ERODE',    'TAMILNADU', '638001', '33'),
    ('CHITRA FABRICS',                           '33 AJUPS1364C 1 Z 4',  '72/3 VIVEKANANDHAR SALAI, VK VALASU',                                                                   'ERODE',    'TAMILNADU', '638011', '33'),
    ('D V FASHION',                              '33 ACLPR2568P 1 Z U',  '86 MARAPALAM 1ST STREET, KAS NAGAR, KARUNGALPALAYAM',                                                   'ERODE',    'TAMILNADU', '638003', '33'),
    ('DADA COTTON MILLS',                        '33 NXIPS5615B 1 Z B',  '5 MARAPALAM ROAD, KARUNGALPALAYAM',                                                                     'ERODE',    'TAMILNADU', '638003', '33'),
    ('DANARANI TEXTILES',                        '33 BREPD0366A 1 Z M',  'NO 18/30 KRISHNAMOORTHY THOTTAM, KARUNGALPALAYAM',                                                      'ERODE',    'TAMILNADU', '638003', '33'),
    ('DK TEXTILES',                              '33 ACBPA4731D 1 Z H',  'D/1 KAS NAGAR, MARAPALAYAM ROAD 8, KARUNGALPALAYAM',                                                    'ERODE',    'TAMILNADU', '638003', '33'),
    ('EASWARI TEX',                              '33 AGPPT1405M 1 Z 4',  '14 EAST STREET, SAMALAPURAM PO, MANGALEM',                                                              'TIRUPUR',  'TAMILNADU', '641663', '33'),
    ('ERODE VISCOSE RAYON FABRICS',              '33 AAHFE4031A 1 Z 9',  'NO 6 PERIYAVALASU ROAD, VEERAPANCHATRAM',                                                               'ERODE',    'TAMILNADU', '639003', '33'),
    ('GG FASHION',                               '33 BFSPS4347Q 1 Z G',  'NO 9 MARAPALAYAM, KAS NAGAR, KARUNGALPALAYAM',                                                          'ERODE',    'TAMILNADU', '638003', '33'),
    ('H T FABRICS',                              '33 DTGPK6215K 1 Z M',  '78/3 MOSIKEERANAR STREET',                                                                              'ERODE',    'TAMILNADU', '638003', '33'),
    ('HANUMAN TEX FAB',                          '33 AAKFH9191D 1 Z A',  'KOTTIAR STREET, INDRA NAGAR',                                                                           'ERODE',    'TAMILNADU', '638003', '33'),
    ('HARSHIKA EXPORT',                          '33 ABNPC1740P 1 Z L',  '120 KANNAYAN STREET, THIRUNAGAR COLONY',                                                                'ERODE',    'TAMILNADU', '638003', '33'),
    ('HIMANSHU ENTERPRISES',                     '33 AMJPH3271P 1 Z R',  '901 KNK ROAD, THIRUNAGAR COLONY',                                                                       'ERODE',    'TAMILNADU', '638003', '33'),
    ('JAI JINENDRA IMPEX',                       '33 AAVPB9636N 1 Z 1',  '14/2 BHAWANI MAIN ROAD',                                                                                'ERODE',    'TAMILNADU', '638003', '33'),
    ('JETHIYA GLOBAL',                           '33 AEFPP5693F 2 Z A',  '232-233 CUTCHERY STREET',                                                                               'ERODE',    'TAMILNADU', '638001', '33'),
    ('KALPATRU YARNS PRIVATE LIMITED',           '33 AACCK3657Q 1 Z 3',  '306-A AGRAHARAM STREET',                                                                                'ERODE',    'TAMILNADU', '638001', '33'),
    ('KARANI''S COTTON MILLS',                   '33 AADHG1159F 1 Z Q',  '10, S.S LAYOUT, MEERAMOHIDEEN STREET',                                                                  'ERODE',    'TAMILNADU', '638003', '33'),
    ('KRISHNA COTTON MILLS',                     '33 AYBPK6945K 1 Z 7',  '11 KRISHNAMOORTHY THOTTAM, KARUNGALPALAYAM',                                                            'ERODE',    'TAMILNADU', '638003', '33'),
    ('KUNDAN TEXTILE MILLS',                     '33 ACWPJ7850R 1 Z K',  '324-B AGRAHARAM STREET',                                                                                'ERODE',    'TAMILNADU', '638001', '33'),
    ('KUSHAL TEX',                               '33 AFCPJ1229D 1 Z 6',  '2ND FLOOR S3, PUMPING STATION ROAD, 5TH CROSS',                                                         'ERODE',    'TAMILNADU', '638003', '33'),
    ('LAXMI TEXTILE',                            '33 ABTPJ7599M 1 Z L',  '14-3, 1ST FLOOR, BHAVANI MAIN ROAD, FAIRLAND COLONY',                                                   'ERODE',    'TAMILNADU', '638004', '33'),
    ('M K AGENCYS',                              '33 ABDPK6986B 1 Z Q',  '30, GANAPATHI PURAM, KARUNGALPALAYAM',                                                                  'ERODE',    'TAMILNADU', '639003', '33'),
    ('M K EXPORTS',                              '33 ABSFM1675L 1 Z P',  '23, KRISHNAPALAYAM ROAD, KARUNGALPALAYAM',                                                              'ERODE',    'TAMILNADU', '638003', '33'),
    ('M M ENTERPRISES',                          '33 ABHFM3019R 1 Z Y',  '43/1 KANNIYAN STREET, THIRUNAGAR COLONY',                                                               'ERODE',    'TAMILNADU', '638003', '33'),
    ('M R FABRICS',                              '33 AAYFM3307L 1 Z W',  '18TH PHUDDU THOTTAM, 1ST STREET, 1ST FLOOR, SHERIF COLONY',                                             'TIRUPUR',  'TAMILNADU', '638003', '33'),
    ('M R TRADING CO',                           '33 CVOPP7205B 1 Z P',  '1ST FLOOR, 28/1 3RD STREET, RKV NAGAR, THIRUNAGAR COLONY',                                              'ERODE',    'TAMILNADU', '638003', '33'),
    ('M. RAMAKRISHNA TEXTILE MILLS',             '33 AGOPM4567C 2 Z B',  '',                                                                                                      'ERODE',    'TAMILNADU', '638003', '33'),
    ('MAA BHUWAL FAB TEX',                       '33 AFGPC7300C 1 Z B',  'HO, 36 KANNAIYAN STREET, THIRUNAGAR COLONY',                                                            'ERODE',    'TAMILNADU', '638003', '33'),
    ('MAA THANAPATTI TEXTIES',                   '33 DKIPK1857E 1 Z 9',  '3, GROUND FLOOR, RANGANATHAN STREET, KARUNGALAPALAYAM',                                                 'ERODE',    'TAMILNADU', '638003', '33'),
    ('MAA VANKAL EXPORTS',                       '33 ABGFM3765M 1 Z W',  '29/62 POOKUNDARANAR STREET, KARUNGALPALAYAM',                                                           'ERODE',    'TAMILNADU', '638003', '33'),
    ('MADHANI EXPORTS',                          '33 BJUPR9893Q 1 Z L',  '219 MARAPALAM MAIN ROAD, KAS NAGAR, KARUNGALPALAYAM',                                                   'ERODE',    'TAMILNADU', '638003', '33'),
    ('MAHA MAYA COTTON MILLS',                   '33 BWGPB7709C 1 Z Z',  '9 OLD STATE BANK COLONY, THIRUNAGAR COLONY',                                                            'ERODE',    'TAMILNADU', '640003', '33'),
    ('MAHALAXMI EXPORT SYNDICATE',               '33 ABGPL0945E 1 Z 1',  '7/2 OTTUKKARA CHINNAYA STREET',                                                                         'ERODE',    'TAMILNADU', '638003', '33'),
    ('MAHALAXMI INDUSTRIES',                     '33 AARPB3471D 1 Z 1',  '61 EM BALASUBARAMANI STREET, THIRUNAGAR COLONY',                                                        'ERODE',    'TAMILNADU', '638003', '33'),
    ('MAHAVEER COTTON MILLS',                    '33 ADAPJ7669R 1 Z V',  '8/1 MARAPALAYAM ROAD, KAS NAGAR',                                                                       'ERODE',    'TAMILNADU', '638003', '33'),
    ('MALAR TEX',                                '33 ABTFM8991J 1 Z B',  'SF NO 474/7 MUNIYAPPAN KOVIL STREET, MANICKAMPALAYAM, VEERAPPANCHATRAM',                                'ERODE',    'TAMILNADU', '638004', '33'),
    ('MANI DARSHAN TEXTILES',                    '33 AFYPB9585L 1 Z K',  '8/2 MOSSIKIRIN STREET 6, OPP KBN HOSPITAL',                                                             'ERODE',    'TAMILNADU', '638003', '33'),
    ('MANI EXPORTS',                             '33 AARPB1627K 1 Z S',  '11/12 KRISHNAMOORTHI THOTTAM, NEAR MEENAKSHI KALYANA MANDAP, KARUNGALPALAYAM',                          'ERODE',    'TAMILNADU', '638003', '33'),
    ('MANOJ EXPORTS',                            '33 ABIFM1400B 1 Z 5',  '61 EM BALASUBARAMANI STREET, THIRUNAGAR COLONY',                                                        'ERODE',    'TAMILNADU', '638003', '33'),
    ('MARUDHAR FABRICS',                         '33 AJJPM3002C 2 Z X',  '37/1 MOSIKEERNAR STREET 5, INDIRA NAGAR',                                                               'ERODE',    'TAMILNADU', '638003', '33'),
    ('MEHRAULI TEXTILES',                        '33 ABDFM7506M 1 Z 4',  'DOOR NO 27/1 KRISHAMPALAYAM ROAD, KARUNGALPALAYAM',                                                     'ERODE',    'TAMILNADU', '638003', '33'),
    ('MISTHI ENTERPRISE',                        '33 AAEHP9674F 1 Z W',  '14/2 BHAWANI MAIN ROAD',                                                                                'ERODE',    'TAMILNADU', '638003', '33'),
    ('MOHAN PANKAJ TEXTILE',                     '33 AKAPK6049D 1 Z K',  '25 A MARAPALAYAM ROAD-1, KAS NAGAR',                                                                    'ERODE',    'TAMILNADU', '638003', '33'),
    ('MT FASHION',                               '33 ABKFM7721K 1 Z 0',  '1/5 KURUNJI NAGAR, EXNT SHERIFF COLONY',                                                                'THIRUPUR', 'TAMILNADU', '638003', '33'),
    ('MURUGAN TEX',                              '33 EGIPK4737 A 1 Z O', '247/2 KANDHAIYAN THOTTAM, PERIYASEMUR VILLAGE',                                                         'ERODE',    'TAMILNADU', '638004', '33'),
    ('NAKODA TEXTILES',                          '33 AALPC2508G 1 Z 8',  '44 ERRUKADU STREET, KARUVAMPALAYAM',                                                                    'TIRUPUR',  'TAMILNADU', '641604', '33'),
    ('NAKUL FAB TEX',                            '33 AAXPB6444L 1 Z B',  '14/2 BHAWANI MAIN ROAD',                                                                                'ERODE',    'TAMILNADU', '638003', '33'),
    ('NAMBI MILLS',                              '33 AYLPN2256L 2 Z 3',  '62/3 DR RADHAKRISHNAN STREET',                                                                          'ERODE',    'TAMILNADU', '638011', '33'),
    ('NAVRANGI FABRICS',                         '33 ACFPB6762K 1 Z M',  '45/65, GROUND FLOOR, PERIYAR STREET',                                                                   'ERODE',    'TAMILNADU', '638001', '33'),
    ('NEW BAARATH MILLS',                        '33 AACFN0418P 1 Z B',  '133, NMS COMPOUND, GANDHI MARKET',                                                                      'ERODE',    'TAMILNADU', '638001', '33'),
    ('NEW INDIA TEXTILES CORPORATION',           '33 ARRPK2124M 1 Z M',  '46 KOTTAIYAR STREET, INDIRA NAGAR',                                                                     'ERODE',    'TAMILNADU', '638003', '33'),
    ('O P TEXTILE MILLS',                        '33 AAGPO5365G 1 Z O',  '27/2 KRISHNAMPALAYAM ROAD, NEAR KARUNGALPALAYAM EB OFFICE',                                             'ERODE',    'TAMILNADU', '638003', '33'),
    ('P.R.FABRICS',                              '33 AADHB6467P 1 Z X',  '18TH PHUDDU THOTTAM 1ST STREET, 1ST FLOOR, SHERIF COLONY',                                              'THIRUPUR', 'TAMILNADU', '',       '33'),
    ('PADMAVATI INDUSTRIES',                     '27 ABJPV8499E I Z S',  'RN 29 2ND FLOOR 30/32 PRABHU SUNDER CHS RAM WADI 1ST X LANE, KALBADEVI ROAD',                           'MUMBAI',   'MAHARASTRA','400002', '27'),
    ('PONKALIAMMAN TEXTILES',                    '33 CYAPD1084P 1 Z F',  '123, EAST STREET, LAKKAPURAM',                                                                          'ERODE',    'TAMILNADU', '638002', '33'),
    ('PRADEEP EXPORT',                           '33 CHXPP2408P 1 Z L',  '89 MOSIKEERANAR STREET, INDIRANAGAR',                                                                   'ERODE',    'TAMILNADU', '638001', '33'),
    ('PRANJAL AGENCY',                           '08 AAAHB6749R 1 Z O',  'NO 22 SUBHASH VIKAR PAL ROAD',                                                                          'JODHPUR',  'RAJASTHAN', '342001', '08'),
    ('R P MILLS',                                '33 BOAPP9394B 1 Z W',  'PRADEEP TOWER, 51, MARAPPA II STREET',                                                                  'ERODE',    'TAMILNADU', '638009', '33'),
    ('R S COTTON MILL',                          '33 ACQPG4025R 1 Z 8',  '32 MARAPALLAM ROAD-1, KARUNGALPALAYAM',                                                                 'ERODE',    'TAMILNADU', '638003', '33'),
    ('RADHA TEXTILE MILLS',                      '33 ACWPV1929R 1 Z G',  '650, MEENAKSHI SUNDRAM STREET, THIRUNAGAR COLONY (OPP. V.O.C PARK)',                                    'ERODE',    'TAMILNADU', '638003', '33'),
    ('RADHEY EXPOFAB',                           '33 AFEPA9465N 1 Z 6',  '10, RAJAGANAPATHY NAGAR, WATER OFFICE ROAD',                                                            'ERODE',    'TAMILNADU', '638003', '33'),
    ('RADHEY IMPEX',                             '33 AAHHA0873J 1 Z G',  '10, RAJAGANAPATHY NAGAR, WATER OFFICE ROAD',                                                            'ERODE',    'TAMILNADU', '638003', '33'),
    ('RAHUL TEXTILES MILLS',                     '33 AIJPS3780N 1 Z M',  '25/4 LAXMI NARAYANAN NAGAR, INDIRA NAGAR',                                                              'ERODE',    'TAMILNADU', '638003', '33'),
    ('RAMDEV EXPORTS',                           '33 AGWPJ6054F 1 Z 7',  'NO 4 OLD STATE BANK COLONY, THIRUNAGAR COLONY',                                                         'ERODE',    'TAMILNADU', '638003', '33'),
    ('RAMDEV FABRICS',                           '33 ADIPV6213H 1 Z I',  'NO 4 OLD STATE BANK COLONY, THIRUNAGAR COLONY',                                                         'ERODE',    'TAMILNADU', '638003', '33'),
    ('RASHMI TRADING CORPORATION',               '33 AIBPR1220J 1 Z 0',  '96 MADHAV STREET',                                                                                      'ERODE',    'TAMILNADU', '638001', '33'),
    ('RISHABH EXPORT',                           '33 BFMPS0209F 1 Z O',  '2, 5TH STREET, KRISHNAMPALAYAM ROAD, KARUNGALPALAYAM',                                                  'ERODE',    'TAMILNADU', '638003', '33'),
    ('S M TEX FEB',                              '33 AAKHS6071B 1 Z A',  '150/C MADHAV KRISHNA STREET',                                                                           'ERODE',    'TAMILNADU', '638001', '33'),
    ('SAKTHE TEXTILES',                          '33 BDFPR8588B 1 Z A',  '31/61 MEERA MOHIDEN STREET, SS LAYOUT, KARUNGALPALAYAM',                                                'ERODE',    'TAMILNADU', '638003', '33'),
    ('SANJAY ENTERPRISES',                       '33 AWHPB6981 A 1 Z V', '9, KARPAGAM LAYOUT 5TH, INDRA NAGAR',                                                                   'ERODE',    'TAMILNADU', '638003', '33'),
    ('SARITA FABRICS',                           '33 AAAHO3221P 1 Z 9',  '80/3 KRISHNA TALKIES ROAD',                                                                             'ERODE',    'TAMILNADU', '638003', '33'),
    ('SARVOTAM APPARELS',                        '08 AAHFS7022D 1 Z D',  'E-635, A ROAD NO 8, M.I.A 2ND PHASE, BASNI',                                                            'JODHPUR',  'RAJASTHAN', '342005', '08'),
    ('SAYAR FAB TEX',                            '33 AAPHM8951F 1 Z U',  '31 RKV 3RD CROSS, THIRUNAGAR COLONY',                                                                   'ERODE',    'TAMILNADU', '638001', '33'),
    ('SHANTHI TEX',                              '33 CHUPS5337P 1Z B',   '90 KOTHUKKARAR STREET, PERIYAVALASU, VEERAPPANCHATRAM',                                                 'ERODE',    'TAMILNADU', '638004', '33'),
    ('SHREE BANUMATHI TEXTILES',                 '33 DDQPP6175K 1 Z T',  '48 KASIYANNAN STREET',                                                                                  'ERODE',    'TAMILNADU', '638001', '33'),
    ('SHREE KRISHNA TEXTILES',                   '33 AIGPK8324B 1 Z 0',  'NO 6/5 MARRAPALAM ROAD, K.A.S NAGAR, KARUNGALPALAYAM, 3RD STREET, ERODE',                               'ERODE',    'TAMILNADU', '638003', '33'),
    ('SHREE LAKSHMI ENTERPRISES',                '33 AVQPS6315R 1 Z O',  '20 PANDIAN STREET, SURAMPATTI VALASU',                                                                  'ERODE',    'TAMILNADU', '638009', '33'),
    ('SHREE MOHAN TRADING COMPANY',              '33 AKEPK7809H 1 Z 6',  'D.NO 8/1 FIRST FLOOR, KOTHUKARE NALLA STREET, KAMARAJAR STREET',                                        'ERODE',    'TAMILNADU', '638001', '33'),
    ('SHREE PADAM PRABHU MILLS',                 '33 ACBPL3375L 1 Z J',  'NO 7 2ND FLOOR NMS COMPOUND',                                                                           'ERODE',    'TAMILNADU', '638003', '33'),
    ('SHREE PADMAVATI ENTERPRISES',              '33 AAJHK8670H 1 Z Y',  '30 ABDULGANI STREET, TIRUNAGAR COLONY',                                                                 'ERODE',    'TAMILNADU', '638003', '33'),
    ('SHREE PADMAVATI EXPORTS',                  '33 ACEPV7648D 1 Z F',  '30 ABDULGANI STREET, TIRUNAGAR COLONY',                                                                 'ERODE',    'TAMILNADU', '639003', '33'),
    ('SHREE RADHE TEXTILES',                     '24 BLYPK4571N 1 Z 8',  '42, SHIVSHAKTI ESTATE, BEHIND PRINCE HOTEL, OPP EVERGREEN HOTEL, NAROL',                                'AMHEDABAD','GUJARAT',  '382405', '24'),
    ('SHREE RAJA GANAPATHI TRADERS',             '33 GWFPS7648D 1 Z 6',  'NO 183 V J COMPLEX, BRANDA STREET',                                                                     'ERODE',    'TAMILNADU', '638001', '33'),
    ('SHREE RAMDEV AGENCY',                      '33 AAZPL9384K 1 Z O',  '4/5 KONGU NAGAR, KARUNGALPALAYAM',                                                                      'ERODE',    'TAMILNADU', '638003', '33'),
    ('SHREE SHYAM ENTERPRISES',                  '33 AAMPU9481D 1 Z 9',  '132-B KRISHNA TALKIES ROAD',                                                                            'ERODE',    'TAMILNADU', '638003', '33'),
    ('SHRI GIRIRAJ TEXTILES',                    '33 AABHB4561N 2 Z B',  '593, CAUVERY ROAD',                                                                                     'ERODE',    'TAMILNADU', '638003', '33'),
    ('SHRI RAMDEV EXPORTS',                      '33 AEAFS7117N 1 Z U',  '4 OLD STATE BANK COLONY, THIRUNAGAR COLONY',                                                            'ERODE',    'TAMILNADU', '638003', '33'),
    ('SHRI SAMBHAV EXPORTS',                     '33 ADXPJ0247J 1 Z C',  '4/5 KONGU NAGAR, KARUNGALPALAYAM',                                                                      'ERODE',    'TAMILNADU', '638003', '33'),
    ('SHRI VENUS TEXTILES',                      '33 BAYPS8570A 1 Z 8',  '9/253 PULIYANKADU THOTTAM, KARAIPUDUR, ARULPURAM (PO)',                                                 'TIRUPUR',  'TAMILNADU', '641605', '33'),
    ('SIDHI VINAYAK TEXTILE',                    '33 DKIPK1430D 1 Z Q',  '36, KANNIYAN STREET 1 WD-29',                                                                           'ERODE',    'TAMILNADU', '638003', '33'),
    ('SIMANDHAR FABRICS',                        '33 ADQFS8913D 1 Z V',  'S.3 PUMPING STATION ROAD, 5TH CROSS ROAD',                                                              'ERODE',    'TAMILNADU', '638003', '33'),
    ('SREE SIVASAKTHI TEXTILES',                 '33 ABWFS3748L 1 Z D',  'SF NO 1037/2A RATTAISUTRIPALAYAM, ANUMANPALLI ROAD, AVAL POONDURAI (PO)',                               'ERODE',    'TAMILNADU', '638115', '33'),
    ('SRI AMMAN TEX',                            '33 APEPM7698P 1 Z Y',  '215 RAM NAGAR, MANICKAMPALAYAM, PERIYASEMUR',                                                           'ERODE',    'TAMILNADU', '638004', '33'),
    ('SRI ARULMURUGAN TEXTILES',                 '33 AGNPC2942A 1 Z 0',  '215 RAMNAGAR 5TH STREET, MANICKAMPALAYAM',                                                              'ERODE',    'TAMILNADU', '638004', '33'),
    ('SRI ASTALAKSHMI MILLS',                    '33 ABEFS3379P 1 Z K',  '74 SKC ROAD, KAIKOLAN THOTTAM',                                                                         'ERODE',    'TAMILNADU', '638001', '33'),
    ('SRI BALAJI TEXTILE MILLSS',                '33 ADRPM8275B 1 Z C',  'SF NO 84/2 MULLAMPARAPPU, NATHAGOUNDENPALAYAM (PO)',                                                    'ERODE',    'TAMILNADU', '638115', '33'),
    ('SRI CHITRA TEX',                           '33 AICPP5457E 2 Z C',  '4-4A, 2ND LAYOUT, 4TH STREET, VVCR NAGAR',                                                              'ERODE',    'TAMILNADU', '638001', '33'),
    ('SRI JAGAADES TEXTILES',                    '33 AEKPA5390M 1 Z C',  '12/195 BRINDHA STREET',                                                                                 'ERODE',    'TAMILNADU', '638001', '33'),
    ('SRI JAYANTHI TEXTILES',                    '33 ADKPR2149G 2 Z I',  '4 AMMAN STREET, CAUVERY ROAD, VEERAPPANCHATRAM',                                                        'ERODE',    'TAMILNADU', '638004', '33'),
    ('SRI JIN KUSHAL EXPORTS',                   '33 BCRPN1158C 1 Z Q',  '19 OLD STATE BANK COLONY, THIRUNAGAR COLONY',                                                           'ERODE',    'TAMILNADU', '638003', '33'),
    ('SRI KANDHAN TEXTILES',                     '33 BBKPC6768F 1 Z M',  'NO 16/11 SATHY MAIN ROAD, KANDHASAMIYUR, PALLAPALAYAM',                                                 'ERODE',    'TAMILNADU', '638455', '33'),
    ('SRI KRISHAN FABRICS',                      '33 CORPB6946K 1 Z H',  '36 KANNIYAN STREET',                                                                                    'ERODE',    'TAMILNADU', '638003', '33'),
    ('SRI KRISHNA TEX',                          '33 CROPD5053R 1 Z A',  '95/58-2 SANJAI NAGAR, NARAYANAVALSU',                                                                   'ERODE',    'TAMILNADU', '638011', '33'),
    ('SRI RL TEXTILES',                          '33 DBMPR9206K 1 Z 5',  '009/C LVB NAGAR, KONGAMPALAYAM, CHITTODE',                                                              'ERODE',    'TAMILNADU', '',       '33'),
    ('SRI S V TEX',                              '33 EMIPS7038Q 1 Z 6',  '112-C S S P NAGAR, VILLARASAMPATTI (PO)',                                                               'ERODE',    'TAMILNADU', '638107', '33'),
    ('SRI SAYAM EXPORTS',                        '33 BGPPJ4582 A 1 Z I', '70-B KRISHNA PALAYAM ROAD, KARUNGAL PALAYAM',                                                           'ERODE',    'TAMILNADU', '638003', '33'),
    ('SRI SELVALAXMI TEX',                       '33 DSLPP2353F 1 Z Q',  '14/15 MARAPPAN STREET, VEERAPPAN CHATHRAM',                                                             'ERODE',    'TAMILNADU', '638004', '33'),
    ('SRI V BALAJI SPINNING MILLS INDIA (P) LTD','33 AAJCS1775J 1 Z 3',  '135/5 KILIAMPATTI ROAD, MULLAMPARAPPU',                                                                 'ERODE',    'TAMILNADU', '638115', '33'),
    ('SRI VEDHALAKSHMI TEX',                     '33 AECPT4162J 1 Z F',  '',                                                                                                      'ERODE',    'TAMILNADU', '638101', '33'),
    ('SRI VIMALA NEHRU EXPORTS PVT LTD',         '33 AAKCS2216H 1 Z L',  '255, AGRAHARAM STREET (OPP MAHAJANA HIGH SCHOOL)',                                                      'ERODE',    'TAMILNADU', '638001', '33'),
    ('SRINIVASAN AND COMPANY',                   '33 AFBPR7765M 1 Z V',  'SANGU NAGAR CROSS STREET, WARD NO 36',                                                                  'ERODE',    'TAMILNADU', '638009', '33'),
    ('SRRI LAKSHMI DURGA EXPORT',                '33 ARCPS9357F 1 Z J',  '23-H NETHAJI NAGAR, SG VALASU SOUTH, MANICKKAMPALAYAM',                                                 'ERODE',    'TAMILNADU', '638004', '33'),
    ('STAG ENTERPRISES',                         '33 AEFFS1262M 1 Z X',  '44/31A, VALLIAMMAI 1ST STREET, PERIYAVALASU',                                                           'ERODE',    'TAMILNADU', '638003', '33'),
    ('SUBA TEXTILE',                             '33 ABGFM8895E 1 Z W',  '147 KOTHUKKARAR THOTTAM, OPP CMC COLLEGE, VEERAPPANCHATRAM',                                            'ERODE',    'TAMILNADU', '638004', '33'),
    ('SURANA ENTERPRISES',                       '33 AAFPV9559E 2 Z 9',  '4 PERUMAL STREET, K.K THOTTOM',                                                                         'ERODE',    'TAMILNADU', '638003', '33'),
    ('SURESH APPARELS',                          '33 ADJFS5451R 1 Z E',  'S.1 PUMPING STATION ROAD, 5TH CROSS ROAD',                                                              'ERODE',    'TAMILNADU', '638003', '33'),
    ('SURESH TRADING COMPANY',                   '33 ACTFS8296H 1 Z A',  'S4, PUMPING STATION ROAD, 5TH CROSS ROAD',                                                              'ERODE',    'TAMILNADU', '638003', '33'),
    ('SWASTIK TEX FAB',                          '33 AGNPD0885F 1 Z J',  'PLOT NO 38, TS NO 24/3 WARD-D, BLOCK NO 2, PEELAMEDU VILLAGE, KAS NAGAR, KARUNGALPALAYAM',              'ERODE',    'TAMILNADU', '638003', '33'),
    ('TEXCOTTON INDIA PRIVATE LIMITED',          '33 AACCT3112D 1 Z 3',  '41/1 ANNAMALAI LAYOUT, OPP TO BUS STAND',                                                               'ERODE',    'TAMILNADU', '638011', '33'),
    ('THINDAL MURUGAN TEX',                      '33 BUPPR8954L 1 Z M',  '132/17, KAVERY ROAD, VEERAPAN CHATRAM',                                                                 'ERODE',    'TAMILNADU', '638004', '33'),
    ('UJJAVAL AGENCY',                           '33 ADXPJ0246K 1 Z B',  '4/5 KONGU NAGAR, KARUNGALPALAYAM',                                                                      'ERODE',    'TAMILNADU', '638003', '33'),
    ('V.M.TEX',                                  '33 AAOFV8569P 1 Z Z',  'NO.15 LAXMANA STREET, NEAR CITY UNION BANK, SURAMPATTI',                                                'ERODE',    'TAMILNADU', '638009', '33'),
    ('VANKAL EXPORTS',                           '33 AARPD2036J 1 Z V',  '44/1 KANNIYAN STREET, THIRUNAGAR COLONY',                                                               'ERODE',    'TAMILNADU', '638003', '33'),
    ('VARDHAMAN SAFETY EQUIPMENTS',              '33 AHCPA0231E 1 Z H',  '49/55 KOTTIAR STREET, INDRA NAGAR',                                                                     'ERODE',    'TAMILNADU', '638003', '33'),
    ('VASUDEV TEXTILE MILLS',                    '33 CCHPJ1782K 1 Z G',  '85 MARAPALM MAIN ROAD, NEAR MAHESWARI BHAVAN, KAS NAGAR, KARUNGALPALAYAM',                              'ERODE',    'TAMILNADU', '638003', '33'),
    ('VEER BHADRA EXPORTS',                      '33 AJNPB7772J 1 Z X',  '8/2 MOSSIKIRIN STREET 6, OPP KBN HOSPITAL',                                                             'ERODE',    'TAMILNADU', '638003', '33'),
    ('VEETRAG ENTERPRISES',                      '33 AAEFV1908L 1 Z 4',  'S3 PUMPING STATION ROAD, 5TH CROSS ROAD',                                                               'ERODE',    'TAMILNADU', '638003', '33'),
    ('VELAVAN TEXTILES',                         '33 HYVPS2077H 1 Z O',  '106/B MUTHUR MAIN ROAD, LAKKAPURAM',                                                                    'ERODE',    'TAMILNADU', '638002', '33'),
    ('VIKAS FABRICS',                            '33 AADFV5356R 1 Z J',  '19 KASIANNA STREET, SAIT COLONY',                                                                       'ERODE',    'TAMILNADU', '638001', '33'),
    ('VIMAL EXPORTS',                            '33 AANFV6520F 1 Z 6',  '35, KRISHNAMPALAYAM ROAD, KARUNGALPALAYAM',                                                             'ERODE',    'TAMILNADU', '638003', '33'),
    ('VISHAL TEXTILES',                          '33 AAQPL8788C 1 Z 8',  '324, AGRAHARAM STREET, ARIHANT KRIPA',                                                                  'ERODE',    'TAMILNADU', '638001', '33'),
    ('VISHNU LAKSHMI CREATION',                  '33 ABDPK4282G 1 Z V',  '35, KRISHNAMPALAYAM ROAD, KARUNGALPALAYAM',                                                             'ERODE',    'TAMILNADU', '638003', '33'),
    ('VISHNU TEX',                               '33 BRWPG6474L 1 Z 1',  '27/1 P M NAGAR, SEELANAICKENPATTI',                                                                     'SALEM',    'TAMILNADU', '636201', '33'),
    ('VR FABRIC',                                '33 ADFPV1392L 1 Z 6',  'DN 15 OLD STATE BANK COLONY, THIRUNAGAR COLONY',                                                        'ERODE',    'TAMILNADU', '638003', '33'),
    ('YUV EXPORTS',                              '33 FVPPS6381M 1 Z K',  '220/1 MARAPALM MAIN ROAD, KARUNGALPALAYAM',                                                             'ERODE',    'TAMILNADU', '638003', '33'),
    ('NIRMAL & CO',                              '33 ALZPS5351G 1 Z K',  'PRADEEP TOWER, 51, MARAPPA II STREET',                                                                  'ERODE',    'TAMILNADU', '638009', '33'),
    ('CHAITANYA TEXTILES MILLS',                 '33 AARFC5719P 1 Z T',  '76 KARPAGAM LAYOUT, INDIRA NAGAR',                                                                      'ERODE',    'TAMILNADU', '638003', '33'),
    ('AKSHITA COTTON MILLS',                     '33 ALOPK6264H 1 Z V',  '285 AGRAHARAM STREET, OPP RAGHAVENDRA KOVIL',                                                           'ERODE',    'TAMILNADU', '638003', '33'),
    ('MAHENDRA FABRICS',                         '33 AMNPY8869J 1 Z W',  '38, 1ST STREET MARAPALAM ROAD, KAS NAGAR, KARUNGALPALAYAM',                                             'ERODE',    'TAMILNADU', '638003', '33')
  ) AS v(name, gstin, billing_address, city, state, pincode, state_code)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.party p WHERE upper(trim(p.name)) = upper(trim(v.name))
  );

  RAISE NOTICE 'Imported customer parties. New row count: %', (
    SELECT count(*) FROM public.party p
    JOIN public.party_type_master pt ON pt.id = ANY(p.party_type_ids)
    WHERE pt.name = 'Customer'
  );
END $$;

COMMIT;
