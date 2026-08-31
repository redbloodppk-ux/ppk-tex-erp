/**
 * fetchLedgerView — shared query + merge logic for the Ledger View report.
 *
 * Used by BOTH the interactive tab (ledger-view-tab.tsx) and its PDF/print
 * page (print/page.tsx) so the two can never drift out of sync. This is a
 * plain module (no 'use client'), so it works with either the browser
 * Supabase client or the server one — both expose the same query builder
 * surface, and every query here is already cast to `any` to sidestep
 * generated-type gaps (views / columns not in Database), exactly as the
 * original inline version did.
 *
 * The result merges ten sources in date order with a running balance
 * column. Cash side:
 *
 *   - payment         — receipts / payments to / from parties or via
 *                       BANK / CASH ledgers
 *   - wage_entry      — wages tagged to a WAGES-type ledger
 *   - expense_entry   — expenses tagged to an EXPENSES-type ledger
 *   - bank_entry      — direct bank/cash transactions tagged to a
 *                       category; rows where either side of the
 *                       contra (bank_ledger_id OR other_ledger_id)
 *                       points at this ledger are surfaced.
 *
 * Bill side (only when the ledger is linked to a party via
 * party.ledger_id):
 *
 *   - invoice              — sales invoices, jobwork/weaving bills,
 *                            credit/debit notes
 *   - party_opening_ledger — pre-ERP opening balances
 *   - sizing_job, bobbin_purchase, yarn_lot, fabric_purchase
 *                          — supplier-side payable bills
 *
 * Inflow / Outflow convention on a party-linked ledger:
 *   - Bills that GROW what the party owes us (sale invoice, debit
 *     note, opening receivable) → Inflow (running balance UP).
 *   - Bills that GROW what WE owe the party (purchases, sizing,
 *     bobbin, yarn, fabric, credit note, opening payable) → Outflow.
 *   - Receipts (payment direction='in') still count as Inflow and
 *     payments out (direction='out') as Outflow, matching the cash
 *     ledger semantic that's been on this page from day one.
 *
 * Bank entry sign convention:
 *   - When the picked ledger IS the bank/cash side (bank_ledger_id
 *     matches), direction='in' → Inflow, direction='out' → Outflow.
 *   - When the picked ledger is the OTHER (offset) side, the sign is
 *     inverted: an "out" from bank is a debit on the offset ledger,
 *     so it counts as an Inflow there ("grew" the expense/asset).
 *     direction='out' → Inflow, direction='in' → Outflow.
 *
 * Synthetic credit-note payments (mode = 'credit_note') are bookkeeping
 * artifacts, not real party-facing transactions: every credit_note
 * invoice already appears via the invoice query as its own "Credit
 * Note" row, and the payment is just how that credit gets allocated
 * internally against a bill / opening balance (see migration 244).
 * Including both would double-count the same economic event, so
 * credit_note-mode payments are excluded here.
 */

import { streamForDocType, type PartyStream } from '@/lib/party-streams';
import { tdsOnTaxable, taxableFromTotal } from '@/lib/tds/withholding';

// Unified ledger-entry shape used by both the tab table and the print page.
export interface LedgerEntry {
  key:           string;
  source:        'payment' | 'wage' | 'expense' | 'bill' | 'bank' | 'loan';
  /** Sub-kind for bill rows so the pill says "sale" / "sizing" / etc.
   *  Bank rows use 'bank_in' / 'bank_out'. */
  bill_kind?:    string;
  /** Which of the party's accounts this row belongs to, where that is
   *  knowable. Undefined for wages, expenses, loans and direct bank
   *  movements, which are not tied to a party account. See
   *  app/lib/party-streams.ts. */
  stream?:       PartyStream;
  date:          string;
  voucher:       string;
  counterparty:  string;
  mode:          string;
  reference:     string | null;
  inflow:        number;
  outflow:       number;
}

interface PaymentRow {
  id: number;
  payment_no: string;
  payment_date: string;
  direction: 'in' | 'out';
  amount: number | string;
  reference: string | null;
  notes: string | null;
  party_id: number | null;
  mode_ledger_id: number | null;
  mode: string;
  party: { id: number; code: string; name: string } | null;
  mode_ledger: { id: number; name: string } | null;
}

export interface LedgerViewParams {
  ledgerId: number;
  /** Empty/undefined = unbounded on that side. */
  startDate?: string;
  endDate?: string;
}

export async function fetchLedgerView(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  { ledgerId, startDate, endDate }: LedgerViewParams,
): Promise<LedgerEntry[]> {
  const numericId = ledgerId;
  const sb = supabase;

  // Step 1: find every party whose ledger_id == picked ledger.
  // Also pull their names so we can match invoices by party_name.
  const { data: matchingParties, error: partyErr } = await sb
    .from('party')
    .select('id, ledger_id, name, tds_pct')
    .eq('ledger_id', numericId);
  if (partyErr) throw new Error(partyErr.message);
  const partyRows = ((matchingParties ?? []) as Array<{
    id: number; ledger_id: number; name: string; tds_pct: number | null;
  }>);
  const partyIds: number[] = partyRows.map((p) => p.id);
  const partyNames: string[] = partyRows.map((p) => p.name);
  // Tax we withhold from this party's bills (migration 271). Only parties
  // with a rate set appear here; everyone else is absent and untouched.
  const tdsPctByParty = new Map<number, number>();
  for (const p of partyRows) {
    const pct = Number(p.tds_pct ?? 0);
    if (Number.isFinite(pct) && pct > 0) tdsPctByParty.set(p.id, pct);
  }

  // Step 2: pull every payment that touches this ledger.
  const orParts: string[] = [`mode_ledger_id.eq.${numericId}`];
  if (partyIds.length > 0) {
    orParts.push(`party_id.in.(${partyIds.join(',')})`);
  }
  let paymentsQ = sb
    .from('payment')
    .select(`
      id, payment_no, payment_date, direction, amount, reference, notes,
      party_id, mode_ledger_id, mode, stream,
      party:party_id ( id, code, name ),
      mode_ledger:mode_ledger_id ( id, name )
    `)
    .eq('status', 'active')
    .neq('mode', 'credit_note')
    .or(orParts.join(','));
  if (startDate) paymentsQ = paymentsQ.gte('payment_date', startDate);
  if (endDate)   paymentsQ = paymentsQ.lte('payment_date', endDate);
  const paymentsRes = await paymentsQ;
  if (paymentsRes.error) throw new Error(paymentsRes.error.message);
  const payments = (paymentsRes.data ?? []) as unknown as PaymentRow[];

  // Step 3: wage + expense entries targeting this ledger, narrowed
  // by the same date range.
  let wagesQ = sb.from('wage_entry')
    .select('id, pay_date, amount, kind, notes, employee:employee_id ( full_name )')
    .eq('target_ledger_id', numericId);
  if (startDate) wagesQ = wagesQ.gte('pay_date', startDate);
  if (endDate)   wagesQ = wagesQ.lte('pay_date', endDate);

  let expensesQ = sb.from('expense_entry')
    .select('id, pay_date, amount, category, notes')
    .eq('target_ledger_id', numericId);
  if (startDate) expensesQ = expensesQ.gte('pay_date', startDate);
  if (endDate)   expensesQ = expensesQ.lte('pay_date', endDate);

  // Funding (paid-from) side — wages/expenses whose CASH or BANK source
  // ledger IS this ledger. These project as a CREDIT (outflow): the money
  // physically left this cash/bank account to pay the wage/expense. Without
  // this, a CASH ledger would only ever show debits (receipts) and its
  // balance would climb forever. (migration 218)
  let wagesSrcQ = sb.from('wage_entry')
    .select('id, pay_date, amount, kind, notes, loan_deduction, employee:employee_id ( full_name )')
    .eq('source_ledger_id', numericId);
  if (startDate) wagesSrcQ = wagesSrcQ.gte('pay_date', startDate);
  if (endDate)   wagesSrcQ = wagesSrcQ.lte('pay_date', endDate);

  // Employee loans disbursed FROM this cash/bank ledger. Each loan is cash
  // that physically left this account, so it projects as a CREDIT (outflow),
  // mirroring the wage/expense funding side. (migration 219)
  let loanSrcQ = sb.from('employee_loan')
    .select('id, loan_date, amount, notes, employee:employee_id ( full_name )')
    .eq('source_ledger_id', numericId);
  if (startDate) loanSrcQ = loanSrcQ.gte('loan_date', startDate);
  if (endDate)   loanSrcQ = loanSrcQ.lte('loan_date', endDate);

  let expensesSrcQ = sb.from('expense_entry')
    .select('id, pay_date, amount, category, notes')
    .eq('source_ledger_id', numericId);
  if (startDate) expensesSrcQ = expensesSrcQ.gte('pay_date', startDate);
  if (endDate)   expensesSrcQ = expensesSrcQ.lte('pay_date', endDate);

  // Bank entries — pull rows where this ledger is either the bank
  // side (bank_ledger_id) or the contra/offset side (other_ledger_id).
  // The sign of the inflow/outflow projection depends on which side
  // matches; see the projection loop below.
  let bankQ = sb.from('bank_entry')
    .select(`
      id, entry_no, entry_date, direction, amount, mode, reference, notes,
      status, bank_ledger_id, other_ledger_id, category_id,
      bank:bank_ledger_id ( id, name ),
      other:other_ledger_id ( id, name ),
      category:category_id ( id, code, name )
    `)
    .eq('status', 'active')
    .or(`bank_ledger_id.eq.${numericId},other_ledger_id.eq.${numericId}`);
  if (startDate) bankQ = bankQ.gte('entry_date', startDate);
  if (endDate)   bankQ = bankQ.lte('entry_date', endDate);

  // Step 3b: bills for the matching parties. Only fires when the
  // ledger is linked to a party (CUSTOMER / SUPPLIER / MILL / etc.).
  // BANK / CASH / WAGES ledgers won't have matching parties and
  // this section is a no-op for them. Same date window applies.
  let invRes: { data: unknown; error: { message: string } | null } = { data: [], error: null };
  let openRes: typeof invRes = { data: [], error: null };
  let sizRes:  typeof invRes = { data: [], error: null };
  let bobRes:  typeof invRes = { data: [], error: null };
  let yarnRes: typeof invRes = { data: [], error: null };
  let fabRes:  typeof invRes = { data: [], error: null };
  let agentRes: typeof invRes = { data: [], error: null };
  if (partyIds.length > 0) {
    // Pull every active invoice where party_name matches any of
    // the linked party names. Supabase doesn't have a clean
    // multi-ilike OR, so we use the "in" operator on an
    // uppercased shadow comparison done client-side after fetch.
    let invQ = sb.from('invoice')
      .select('id, invoice_no, invoice_date, doc_type, total, party_name')
      .neq('status', 'cancelled')
      .in('party_name', partyNames);
    if (startDate) invQ = invQ.gte('invoice_date', startDate);
    if (endDate)   invQ = invQ.lte('invoice_date', endDate);

    let openQ = sb.from('party_opening_ledger')
      .select('id, invoice_no, invoice_date, direction, amount')
      .eq('status', 'active')
      .in('party_id', partyIds);
    if (startDate) openQ = openQ.gte('invoice_date', startDate);
    if (endDate)   openQ = openQ.lte('invoice_date', endDate);

    // charges_amount / gst_pct are pulled for TDS: tax is withheld on the
    // TAXABLE value, never on the GST. See tdsRowFor() below.
    let sizQ = sb.from('sizing_job')
      .select('id, bill_no, bill_date, total_amount, charges_amount, party_id')
      .not('bill_no', 'is', null)
      .in('party_id', partyIds);
    if (startDate) sizQ = sizQ.gte('bill_date', startDate);
    if (endDate)   sizQ = sizQ.lte('bill_date', endDate);

    let bobQ = sb.from('bobbin_purchase')
      .select('id, invoice_no, purchase_date, total_amount, vendor_id')
      .in('vendor_id', partyIds);
    if (startDate) bobQ = bobQ.gte('purchase_date', startDate);
    if (endDate)   bobQ = bobQ.lte('purchase_date', endDate);

    let yarnQ = sb.from('yarn_lot')
      .select('id, lot_code, invoice_no, received_date, total_amount, gst_pct, supplier_party_id')
      .in('supplier_party_id', partyIds);
    if (startDate) yarnQ = yarnQ.gte('received_date', startDate);
    if (endDate)   yarnQ = yarnQ.lte('received_date', endDate);

    // Supplier-mode fabric resale only. Customer-mode rows are
    // accounted for via the synthetic payment created at entry.
    let fabQ = sb.from('fabric_purchase')
      .select('id, code, invoice_no, received_date, total_amount, gst_pct, supplier_party_id')
      .eq('source', 'supplier')
      .eq('status', 'active')
      .in('supplier_party_id', partyIds);
    if (startDate) fabQ = fabQ.gte('received_date', startDate);
    if (endDate)   fabQ = fabQ.lte('received_date', endDate);

    // Agent / broker commission we owe this party. The amount is a
    // payable (what WE owe the agent) earned on a fabric sales invoice
    // OR a yarn / fabric purchase. It has no date column of its own, so
    // we carry the source document's date and number and filter by the
    // chosen range client-side below.
    const agentCommQ = sb.from('agent_commission')
      .select('id, amount, invoice:invoice_id ( invoice_no, invoice_date ), yarn_lot:yarn_lot_id ( lot_code, received_date ), fabric_purchase:fabric_purchase_id ( code, received_date )')
      .eq('status', 'active')
      .in('agent_party_id', partyIds);

    const billRes = await Promise.all([invQ, openQ, sizQ, bobQ, yarnQ, fabQ, agentCommQ]);
    [invRes, openRes, sizRes, bobRes, yarnRes, fabRes, agentRes] = billRes;
  }

  // Ledger opening balance (migration 203) — a single as-on-date figure
  // carried on the ledger row itself. Surfaced for every ledger type that
  // isn't party-backed; the form blanks it for CUSTOMER / SUPPLIER, so the
  // query is naturally a no-op for those.
  const openingLedgerQ = sb.from('ledger')
    .select('opening_date, opening_amount, opening_dr_cr')
    .eq('id', numericId)
    .maybeSingle();

  const [wagesRes, expensesRes, wagesSrcRes, expensesSrcRes, loanSrcRes, bankRes, openingLedgerRes] = await Promise.all([wagesQ, expensesQ, wagesSrcQ, expensesSrcQ, loanSrcQ, bankQ, openingLedgerQ]);
  if (wagesRes.error)    throw new Error(wagesRes.error.message);
  if (expensesRes.error) throw new Error(expensesRes.error.message);
  if (wagesSrcRes.error)    throw new Error(wagesSrcRes.error.message);
  if (expensesSrcRes.error) throw new Error(expensesSrcRes.error.message);
  if (loanSrcRes.error)  throw new Error(loanSrcRes.error.message);
  if (bankRes.error)     throw new Error(bankRes.error.message);

  // Step 4: project into LedgerEntry, sort, return.
  const all: LedgerEntry[] = [];

  // Ledger opening balance row. Dr → grows the running balance (inflow),
  // Cr → reduces it (outflow), mirroring the trial-balance sense. We carry
  // it as a normal dated row so it sorts into place; same date-range filter
  // as every other source.
  const openRow = (openingLedgerRes?.data ?? null) as { opening_date: string | null; opening_amount: number | string | null; opening_dr_cr: 'Dr' | 'Cr' | null } | null;
  if (openRow && openRow.opening_date && openRow.opening_dr_cr) {
    const oAmt = Number(openRow.opening_amount ?? 0);
    const oDate = openRow.opening_date;
    const inRange = (!startDate || oDate >= startDate) && (!endDate || oDate <= endDate);
    if (oAmt > 0 && inRange) {
      const isDr = openRow.opening_dr_cr === 'Dr';
      all.push({
        key:          'ledopen',
        source:       'bill',
        bill_kind:    'opening',
        // Ledger-master opening balance, not a party bill — it belongs
        // to no party account, so no stream.
        date:         oDate,
        voucher:      'OPENING',
        counterparty: '—',
        mode:         isDr ? 'Opening (Dr)' : 'Opening (Cr)',
        reference:    null,
        inflow:       isDr ? oAmt : 0,
        outflow:      isDr ? 0    : oAmt,
      });
    }
  }

  for (const p of payments) {
    const amt = Number(p.amount);
    // A payment touches this ledger from one of two sides, and the
    // inflow/outflow sense flips depending on which one (mirrors the
    // bank_entry bank-side vs. contra-side projection below):
    //   - MODE side: this ledger IS the bank / cash account the money
    //     moved through. Use the cash POV — in → inflow, out → outflow.
    //   - PARTY side: this ledger is the customer / supplier / agent the
    //     payment is FOR. Use the party POV, which is INVERTED. A payment
    //     we paid out to them (out) settles what we owe → reads as Inflow
    //     here; a payment they paid us (in) settles what they owe →
    //     reads as Outflow. So paying an agent their commission shows in
    //     the Inflow column and nets against the commission outflow.
    const isModeSide = Number(p.mode_ledger_id) === numericId;
    const isInflow = isModeSide
      ? p.direction === 'in'
      : p.direction === 'out';
    all.push({
      key:          `pay-${p.id}`,
      source:       'payment',
      date:         p.payment_date,
      voucher:      p.payment_no,
      counterparty: p.party?.name ?? '-',
      mode:         p.mode_ledger?.name ?? '-',
      reference:    p.reference,
      inflow:       isInflow ? amt : 0,
      outflow:      isInflow ? 0   : amt,
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const w of ((wagesRes.data ?? []) as any[])) {
    all.push({
      key:          `wage-${w.id}`,
      source:       'wage',
      date:         w.pay_date,
      voucher:      `WAGE/${w.id}`,
      counterparty: w.employee?.full_name ?? '-',
      mode:         '-',
      reference:    w.kind ?? null,
      inflow:       0,
      outflow:      Number(w.amount ?? 0),
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const x of ((expensesRes.data ?? []) as any[])) {
    all.push({
      key:          `exp-${x.id}`,
      source:       'expense',
      date:         x.pay_date,
      voucher:      `EXP/${x.id}`,
      counterparty: x.category ?? '-',
      mode:         '-',
      reference:    null,
      inflow:       0,
      outflow:      Number(x.amount ?? 0),
    });
  }

  // Funding side: this cash/bank ledger PAID these wages/expenses, so each
  // shows as a Credit (outflow) — money leaving the account. (migration 218)
  // For wages, the cash that actually leaves is (amount − loan_deduction):
  // any loan repayment is withheld from the wage, so it never leaves this
  // account. (migration 219)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const w of ((wagesSrcRes.data ?? []) as any[])) {
    const cashPaid = Number(w.amount ?? 0) - Number(w.loan_deduction ?? 0);
    if (cashPaid <= 0) continue;
    all.push({
      key:          `wage-src-${w.id}`,
      source:       'wage',
      date:         w.pay_date,
      voucher:      `WAGE/${w.id}`,
      counterparty: w.employee?.full_name ?? 'Wages',
      mode:         'Wages paid',
      reference:    w.kind ?? null,
      inflow:       0,
      outflow:      cashPaid,
    });
  }
  // Employee loans disbursed FROM this ledger — cash handed to the worker,
  // a Credit (outflow). Repayments aren't projected here: they're withheld
  // from wages, so they reduce the wage outflow above rather than appearing
  // as a separate inflow. (migration 219)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const l of ((loanSrcRes.data ?? []) as any[])) {
    all.push({
      key:          `loan-src-${l.id}`,
      source:       'loan',
      date:         l.loan_date,
      voucher:      `LOAN/${l.id}`,
      counterparty: l.employee?.full_name ?? 'Employee loan',
      mode:         'Loan given',
      reference:    l.notes ?? null,
      inflow:       0,
      outflow:      Number(l.amount ?? 0),
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const x of ((expensesSrcRes.data ?? []) as any[])) {
    all.push({
      key:          `exp-src-${x.id}`,
      source:       'expense',
      date:         x.pay_date,
      voucher:      `EXP/${x.id}`,
      counterparty: x.category ?? 'Expense',
      mode:         'Expense paid',
      reference:    null,
      inflow:       0,
      outflow:      Number(x.amount ?? 0),
    });
  }

  // Bank entries. The same bank_entry row can appear on either side
  // of the contra (bank or offset). We figure out which side this
  // ledger sits on and project the amount with the right sign:
  //   - On the BANK side: in → inflow, out → outflow (matches the
  //     bank account's POV).
  //   - On the OTHER side: in → outflow, out → inflow (the contra
  //     account moves opposite to the bank).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const be of ((bankRes.data ?? []) as any[])) {
    const amt = Number(be.amount ?? 0);
    if (!Number.isFinite(amt) || amt === 0) continue;
    const isBankSide  = Number(be.bank_ledger_id)  === numericId;
    const isOtherSide = Number(be.other_ledger_id) === numericId;
    // Defensive: skip rows that don't actually touch this ledger
    // (shouldn't happen given the .or filter, but keeps the math
    // honest if Supabase returns something unexpected).
    if (!isBankSide && !isOtherSide) continue;

    let inflow = 0;
    let outflow = 0;
    if (isBankSide) {
      if (be.direction === 'in') inflow = amt;
      else                       outflow = amt;
    } else {
      // isOtherSide — sign inverted relative to bank POV.
      if (be.direction === 'out') inflow = amt;
      else                        outflow = amt;
    }

    // Counterparty label: when we're on the bank side, the
    // interesting "who" is the offset ledger; when we're on the
    // offset side, it's the bank account. Fall back to the
    // category name, then a generic placeholder.
    const counterparty =
      isBankSide
        ? (be.other?.name ?? be.category?.name ?? '(bank entry)')
        : (be.bank?.name  ?? be.category?.name ?? '(bank entry)');

    all.push({
      key:          `bank-${be.id}`,
      source:       'bank',
      bill_kind:    be.direction === 'in' ? 'bank_in' : 'bank_out',
      date:         be.entry_date,
      voucher:      be.entry_no ?? `BE-${be.id}`,
      counterparty,
      mode:         be.mode ?? (be.category?.name ?? '-'),
      reference:    be.reference ?? be.notes ?? null,
      inflow,
      outflow,
    });
  }

  // Bills — direction depends on doc kind.
  //   Inflow (running balance UP for a customer ledger): sale,
  //   jobwork bill, debit note, opening receivable.
  //   Outflow (running balance DOWN — or UP for a supplier
  //   payable): credit note, sizing bill, bobbin / yarn / fabric
  //   purchase, opening payable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ((invRes.data ?? []) as any[])) {
    const amt = Number(r.total ?? 0);
    const doc: string = r.doc_type;
    const isCredit = doc === 'credit_note';
    const isDebitNote = doc === 'debit_note';
    const label = doc === 'tax_invoice'     ? 'Fabric Sale'
                : doc === 'yarn_sale'       ? 'Yarn Sale'
                : doc === 'general_sale'    ? 'General Sale'
                : doc === 'jobwork_invoice' ? 'Jobwork Bill'
                : doc === 'weaving_bill'    ? 'Weaving Bill'
                : doc === 'credit_note'     ? 'Credit Note'
                : doc === 'debit_note'      ? 'Debit Note'
                : doc;
    all.push({
      key:          `inv-${r.id}`,
      source:       'bill',
      bill_kind:    isCredit ? 'credit' : isDebitNote ? 'debit' : 'sale',
      stream:       streamForDocType(doc),
      date:         r.invoice_date,
      voucher:      r.invoice_no,
      counterparty: r.party_name ?? '-',
      mode:         label,
      reference:    null,
      inflow:       isCredit ? 0   : amt,
      outflow:      isCredit ? amt : 0,
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ((openRes.data ?? []) as any[])) {
    const amt = Number(r.amount ?? 0);
    const isReceivable = r.direction === 'receivable';
    all.push({
      key:          `open-${r.id}`,
      source:       'bill',
      bill_kind:    'opening',
      stream:       isReceivable ? 'customer' : 'supplier',
      date:         r.invoice_date,
      voucher:      r.invoice_no,
      counterparty: '—',
      mode:         isReceivable ? 'Opening (Receivable)' : 'Opening (Payable)',
      reference:    null,
      inflow:       isReceivable ? amt : 0,
      outflow:      isReceivable ? 0   : amt,
    });
  }
  // ── TDS withheld from this party's bills ──────────────────────────────
  // The bill is credited GROSS, then this row takes the tax straight back
  // off, so the running balance is what the vendor actually gets paid while
  // the bill still matches the paper they sent. PPK, 2026-08-30, on sizing
  // bill 57: "credit 16904 is correct but actually we need to pay to mill
  // 16904-tds amount".
  //
  // Without this row the tax was counted twice: once here inside the
  // vendor's payable, and again in TDS PAYABLE, which has posted the same
  // withholding since migration 271. For SHRI NITHYA that was Rs 1,521.14
  // of liability sitting in the books that was owed to nobody.
  //
  // Withheld on the TAXABLE value, never on the GST — bill 57 is Rs 16,099
  // of charges plus 5% GST, and the 2% comes off the 16,099, giving 321.98
  // and a net payment of Rs 16,582.02.
  //
  // The arithmetic lives in lib/tds/withholding so the ledger, the printed
  // statement, the dashboard and TDS PAYABLE cannot drift apart — which
  // they had, giving three different figures for this one mill.
  const pushTds = (
    partyId: number | null | undefined,
    taxable: number,
    o: { key: string; date: string; voucher: string },
  ): void => {
    const pct = partyId == null ? undefined : tdsPctByParty.get(Number(partyId));
    const amt = tdsOnTaxable(taxable, pct);
    if (!(amt > 0)) return;
    all.push({
      key:          o.key,
      source:       'bill',
      bill_kind:    'tds',
      stream:       'supplier',
      date:         o.date,
      voucher:      o.voucher,
      counterparty: '—',
      mode:         `TDS ${pct}% deducted`,
      reference:    null,
      inflow:       amt,   // reduces what we owe the vendor
      outflow:      0,
    });
  };

  /** Value before GST. Tax is never withheld on the tax. */
  const taxableOf = taxableFromTotal;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ((sizRes.data ?? []) as any[])) {
    const amt = Number(r.total_amount ?? 0);
    if (amt <= 0) continue;
    // sizing_job carries the pre-GST figure outright, so no back-calculation.
    pushTds(r.party_id, Number(r.charges_amount ?? 0), {
      key:     `siz-tds-${r.id}`,
      date:    r.bill_date,
      voucher: r.bill_no ?? `SZ-${r.id}`,
    });
    all.push({
      key:          `siz-${r.id}`,
      source:       'bill',
      bill_kind:    'sizing',
      stream:       'supplier',
      date:         r.bill_date,
      voucher:      r.bill_no ?? `SZ-${r.id}`,
      counterparty: '—',
      mode:         'Sizing Bill',
      reference:    null,
      inflow:       0,
      outflow:      amt,
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ((bobRes.data ?? []) as any[])) {
    const amt = Number(r.total_amount ?? 0);
    if (amt <= 0) continue;
    // bobbin_purchase has no gst_pct column, so the total IS the base we
    // have. If a bobbin vendor is ever given a TDS rate and their totals
    // are GST-inclusive, this withholds slightly too much — say so rather
    // than pretend a figure we do not hold.
    pushTds(r.vendor_id, amt, {
      key:     `bob-tds-${r.id}`,
      date:    r.purchase_date,
      voucher: r.invoice_no ?? `BB-${r.id}`,
    });
    all.push({
      key:          `bob-${r.id}`,
      source:       'bill',
      bill_kind:    'bobbin',
      stream:       'supplier',
      date:         r.purchase_date,
      voucher:      r.invoice_no ?? `BB-${r.id}`,
      counterparty: '—',
      mode:         'Bobbin Purchase',
      reference:    null,
      inflow:       0,
      outflow:      amt,
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ((yarnRes.data ?? []) as any[])) {
    const amt = Number(r.total_amount ?? 0);
    if (amt <= 0) continue;
    pushTds(r.supplier_party_id, taxableOf(amt, r.gst_pct), {
      key:     `yarn-tds-${r.id}`,
      date:    r.received_date,
      voucher: r.invoice_no ?? r.lot_code ?? `YL-${r.id}`,
    });
    all.push({
      key:          `yarn-${r.id}`,
      source:       'bill',
      bill_kind:    'yarn',
      stream:       'supplier',
      date:         r.received_date,
      voucher:      r.invoice_no ?? r.lot_code ?? `YL-${r.id}`,
      counterparty: '—',
      mode:         'Yarn Purchase',
      reference:    null,
      inflow:       0,
      outflow:      amt,
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ((fabRes.data ?? []) as any[])) {
    const amt = Number(r.total_amount ?? 0);
    if (amt <= 0) continue;
    pushTds(r.supplier_party_id, taxableOf(amt, r.gst_pct), {
      key:     `fab-tds-${r.id}`,
      date:    r.received_date,
      voucher: r.invoice_no ?? r.code ?? `FP-${r.id}`,
    });
    all.push({
      key:          `fab-${r.id}`,
      source:       'bill',
      bill_kind:    'fabric',
      stream:       'supplier',
      date:         r.received_date,
      voucher:      r.invoice_no ?? r.code ?? `FP-${r.id}`,
      counterparty: '—',
      mode:         'Fabric Purchase',
      reference:    null,
      inflow:       0,
      outflow:      amt,
    });
  }

  // Agent commission — a payable we owe the agent (a cash outflow),
  // on both sales and purchases. Recorded as Outflow, matching the
  // opening-Cr convention. Settlement payments to the agent arrive as
  // Inflow and net against it, so the running balance reads:
  // payments made − commission owed (negative = we still owe).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ((agentRes.data ?? []) as any[])) {
    const amt = Number(r.amount ?? 0);
    if (amt <= 0) continue;
    // The commission points at exactly one source document: a fabric
    // sales invoice, a yarn lot, or a fabric purchase. Pull the date
    // and voucher from whichever one is set.
    const inv  = r.invoice ?? null;
    const yarn = r.yarn_lot ?? null;
    const fab  = r.fabric_purchase ?? null;
    let date: string | null = null;
    let voucher = `AC-${r.id}`;
    if (inv) { date = inv.invoice_date ?? null; voucher = inv.invoice_no ?? voucher; }
    else if (yarn) { date = yarn.received_date ?? null; voucher = yarn.lot_code ?? voucher; }
    else if (fab)  { date = fab.received_date ?? null;  voucher = fab.code ?? voucher; }
    if (!date) continue;
    if (startDate && date < startDate) continue;
    if (endDate && date > endDate) continue;
    all.push({
      key:          `agentcomm-${r.id}`,
      source:       'bill',
      bill_kind:    'commission',
      stream:       'supplier',
      date,
      voucher,
      counterparty: '—',
      mode:         'Agent Commission',
      reference:    null,
      inflow:       0,
      outflow:      amt,
    });
  }

  // ── TDS PAYABLE ────────────────────────────────────────────────
  // This ledger is not linked to a party, so none of the sources above
  // reach it. Two things move it:
  //
  //   Outflow  tax withheld from a supplier bill  -> we now owe the
  //            government that much
  //   Inflow   a challan paid on the portal       -> the debt shrinks
  //
  // Same sign convention as agent commission above: what we owe is an
  // Outflow, settling it is an Inflow, so the running balance reads
  // "paid − owed".
  //
  // Interest is deliberately NOT posted. Until a challan is paid it is an
  // estimate that grows on the 1st of every month, and a ledger row whose
  // value silently changes with the calendar is the same trap as a salary
  // with no effective date. It appears on /app/tds as a projection, and
  // reaches the books as part of the challan that pays it.
  //
  // Matched on the ledger's own name rather than a hardcoded id, because
  // ids differ between any restored copy of this database. TDS PAYABLE is
  // a named singleton account under DUTIES & TAXES, like GST PAYABLE.
  const { data: thisLedger } = await sb
    .from('ledger')
    .select('id, name')
    .eq('id', numericId)
    .maybeSingle();
  const ledgerName = ((thisLedger as { name?: string } | null)?.name ?? '').trim().toUpperCase();

  if (ledgerName === 'TDS PAYABLE') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sbAny = sb as any;

    let billQ = sbAny
      .from('sizing_job')
      .select('id, bill_no, bill_date, charges_amount, bill_party:party_id ( name, tds_pct )')
      .not('bill_no', 'is', null)
      .not('bill_date', 'is', null)
      .order('bill_date', { ascending: true })
      .limit(1000);
    if (startDate) billQ = billQ.gte('bill_date', startDate);
    if (endDate)   billQ = billQ.lte('bill_date', endDate);
    const { data: tdsBills } = await billQ;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const b of ((tdsBills ?? []) as any[])) {
      const pct = Number(b.bill_party?.tds_pct ?? NaN);
      // On the TAXABLE value — charges before GST. See migration 271.
      // Same helper as the vendor-side deduction above, so what we owe the
      // government and what we hold back from the mill are the same number
      // by construction rather than by coincidence.
      const amt = tdsOnTaxable(Number(b.charges_amount ?? 0), pct);
      if (!(amt > 0)) continue;
      all.push({
        key:          `tdswh-${b.id}`,
        source:       'bill',
        bill_kind:    'tds',
        stream:       'supplier',
        date:         b.bill_date,
        voucher:      `Bill ${b.bill_no ?? b.id}`,
        counterparty: b.bill_party?.name ?? '—',
        mode:         `TDS ${pct}% withheld`,
        reference:    null,
        inflow:       0,
        outflow:      amt,
      });
    }

    let payQ = sbAny
      .from('tds_payment')
      .select('id, period_month, amount, interest_amount, paid_date, challan_no')
      .order('paid_date', { ascending: true })
      .limit(1000);
    if (startDate) payQ = payQ.gte('paid_date', startDate);
    if (endDate)   payQ = payQ.lte('paid_date', endDate);
    const { data: tdsPaid } = await payQ;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of ((tdsPaid ?? []) as any[])) {
      const amt = Number(r.amount ?? 0);
      if (!(amt > 0)) continue;
      const int = Number(r.interest_amount ?? 0);
      all.push({
        key:          `tdspay-${r.id}`,
        source:       'payment',
        bill_kind:    'tds',
        stream:       'supplier',
        date:         r.paid_date,
        voucher:      r.challan_no ?? `TDS-${r.id}`,
        counterparty: 'Government',
        mode:         `Challan · ${r.period_month}${int > 0 ? ` (+ ${int.toFixed(2)} interest)` : ''}`,
        reference:    r.challan_no ?? null,
        inflow:       amt,
        outflow:      0,
      });
    }
  }

  all.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.key.localeCompare(b.key);
  });

  return all;
}

/** Running balance per row + grand totals, shared by tab + print page. */
export interface LedgerEntryWithBalance extends LedgerEntry {
  balance: number;
}

export function withRunningBalance(entries: LedgerEntry[]): LedgerEntryWithBalance[] {
  let running = 0;
  return entries.map((e) => {
    running += e.inflow - e.outflow;
    return { ...e, balance: running };
  });
}

export function ledgerTotals(entries: LedgerEntry[]): { inflow: number; outflow: number; balance: number } {
  const inflow  = entries.reduce((s, r) => s + r.inflow,  0);
  const outflow = entries.reduce((s, r) => s + r.outflow, 0);
  return { inflow, outflow, balance: inflow - outflow };
}
