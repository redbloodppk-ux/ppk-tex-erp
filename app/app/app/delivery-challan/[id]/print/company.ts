/**
 * PPK TEX company details — single source of truth for the DC print layout
 * (and any future invoice / report print layout). Edit these strings once
 * and every printed document picks up the change.
 *
 * Eventually these can move into a `company_master` table in the database
 * with an admin Settings screen; for now they live here as constants so
 * the print template can render without any extra DB calls.
 */
export const COMPANY = {
  name: 'PPK TEX',
  tagline: 'EST 1988 \u00b7 ERODE',
  address: '135 SASTRI ROAD, SURAMPATTI, ERODE, INDIA, TAMILNADU, 638 009',
  state: 'TAMILNADU',
  stateCode: '33',
  gstin: '33CKBPP6334H1Z8',
  phones: ['99435-99212', '88255-24248'],
  email: 'PPKTEX1988@GMAIL.COM',
} as const;
