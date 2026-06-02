/**
 * PPK TEX company details + bank info - single source of truth for every
 * print template (DC, invoice, jobwork bill, credit note, debit note...).
 * Update these strings once and every printed document picks up the
 * change. Eventually this can move to a `company_master` row in the DB
 * with an admin Settings page; until then it lives here.
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
  bank: {
    name: 'YES BANK',
    accountNo: '062363400000783',
    ifsc: 'YESB0000623',
    branch: 'ERODE',
  },
  declaration:
    'We declare that this invoice shows the actual price of the goods described ' +
    'and that all particulars are true and correct.',
} as const;
