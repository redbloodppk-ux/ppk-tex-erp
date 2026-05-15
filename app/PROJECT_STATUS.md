# PPK TEX ERP — Project Scope vs Build Status

*Status report for owner review — May 2026*

---

## Executive summary

The ERP is **structurally built but functionally partial**. The database, login, role-based security and shell are 100% complete. About 8 modules have working UI; ~12 modules show "Under Construction" but their database tables exist. **Three weaving-core modules are missing from both the database and the UI** — Sizing, Pavu Assign, and Warehouse — and need to be added before this can be called a production-ready ERP for a weaving business.

This document maps every module to its build state so you can decide what gets built next.

---

## 1. The textile weaving operational flow

To frame the gaps, here is the actual ground-floor sequence at PPK Tex:

```
Yarn purchase → Yarn godown → SIZING (warp prep) → PAVU (warp beam) →
PAVU ASSIGN to a Loom → Weaving → Grey fabric → WAREHOUSE → Folding/Inspection →
Invoice → Dispatch
```

The three modules in CAPITALS are the ones currently missing entirely.
Without them, the system can record orders and yarn but cannot track what actually
happens between "yarn received" and "fabric ready to invoice".

---

## 2. Module-by-module status matrix

Legend:
- ✅ Done — works end-to-end, you can use it today
- 🟡 Partial — page exists with title + nav but body shows "Under Construction"
- ❌ Missing — not in database, not in UI, needs designing from scratch

### A. Foundation & shell

| # | Module | Database | UI Coded | Status | Notes |
|---|---|---|---|---|---|
| F1 | Auth (email OTP login) | ✅ | ✅ | **✅ Done** | Supabase email codes, no passwords |
| F2 | Role-based menu | ✅ | ✅ | **✅ Done** | 6 roles wired through sidebar |
| F3 | App shell (sidebar + topbar) | — | ✅ | **✅ Done** | Sign-out, search bar, profile |
| F4 | Audit log | ✅ | ✅ | **✅ Done** | Every change to money/orders tracked |
| F5 | PWA install | — | ✅ | **✅ Done** | Add to home screen on phone |

### B. Sales side

| # | Module | Database | UI Coded | Status | Notes |
|---|---|---|---|---|---|
| S1 | Customers | ✅ | ✅ | **✅ Done** | List + create form working |
| S2 | Customer detail / edit | ✅ | 🟡 | **🟡 Partial** | List works, detail page placeholder |
| S3 | Sales Orders — list | ✅ | ✅ | **✅ Done** | Reads from database |
| S4 | Sales Orders — create form | ✅ | 🟡 | **🟡 Partial** | Need multi-line entry UI |
| S5 | Invoices | ✅ | 🟡 | **🟡 Partial** | GST invoice generator pending |
| S6 | Customer Payments | ✅ | 🟡 | **🟡 Partial** | With FIFO invoice allocation |

### C. Production side

| # | Module | Database | UI Coded | Status | Notes |
|---|---|---|---|---|---|
| P1 | Yarn purchase + inventory | ✅ | ✅ | **✅ Done** | Days-of-cover by count |
| P2 | Mill master | ✅ | 🟡 | **🟡 Partial** | Mills exist in seed; needs editor |
| P3 | **Sizing operation** | ❌ | ❌ | **❌ Missing** | Yarn → sized warp beam workflow |
| P4 | **Pavu (warp beam) Master** | 🟡 | 🟡 | **🟡 Partial** | Bobbin table covers this partially but needs rename/expansion to track sized pavu separately |
| P5 | **Pavu Assign to loom** | ❌ | ❌ | **❌ Missing** | The bridge from a sized pavu to a loom + SO |
| P6 | Production batches (in-house) | ✅ | 🟡 | **🟡 Partial** | Daily entry by loom + shift pending |
| P7 | Outsource weaving | ✅ | 🟡 | **🟡 Partial** | Yarn issue → fabric receipt |
| P8 | Job work received | ✅ | 🟡 | **🟡 Partial** | Customer-supplied yarn |
| P9 | Fabric resale | ✅ | 🟡 | **🟡 Partial** | Buy ready / sell |
| P10 | **Warehouse / fabric stock** | 🟡 | 🟡 | **🟡 Partial** | `fabric_stock` table exists but no location-by-rack tracking, no inspection/folding workflow, no dispatch screen |
| P11 | Attendance (2 shifts) | ✅ | 🟡 | **🟡 Partial** | Schema ready; supervisor UI pending |
| P12 | Wages (weekly) | ✅ | 🟡 | **🟡 Partial** | Manual entry per employee |

### D. Costing & masters

| # | Module | Database | UI Coded | Status | Notes |
|---|---|---|---|---|---|
| C1 | Fabric Costing — Quick Calc | — | ✅ | **✅ Done** | Live two-cost calculator with Porvai |
| C2 | Fabric Costing — saved master | ✅ | ✅ | **✅ Done** | List view from `v_costing_two_cost` |
| C3 | Fabric Costing — create/edit form | ✅ | 🟡 | **🟡 Partial** | Need draft → approval flow UI |
| C4 | Customer price history | ✅ | 🟡 | **🟡 Partial** | Schema ready, UI pending |
| C5 | Fabric / quality master | ✅ | 🟡 | **🟡 Partial** | 10 qualities seeded |
| C6 | Count master | ✅ | 🟡 | **🟡 Partial** | 14 counts seeded |
| C7 | Vendor master | ✅ | 🟡 | **🟡 Partial** | 5 vendors seeded |
| C8 | Loom master | ✅ | 🟡 | **🟡 Partial** | 10 looms seeded |
| C9 | Employee master | ✅ | 🟡 | **🟡 Partial** | 20 employees seeded |

### E. Finance & reports

| # | Module | Database | UI Coded | Status | Notes |
|---|---|---|---|---|---|
| R1 | Purchase Payments | ✅ | 🟡 | **🟡 Partial** | To mills / vendors |
| R2 | Reports — Sales register | 🟡 | 🟡 | **🟡 Partial** | Data exists, screen pending |
| R3 | Reports — Ageing | 🟡 | 🟡 | **🟡 Partial** | Customer outstanding view exists |
| R4 | Reports — Profit by quality | 🟡 | 🟡 | **🟡 Partial** | Needs Cost vs Selling roll-up |
| R5 | Reports — Yarn consumption | 🟡 | 🟡 | **🟡 Partial** | Days-of-cover live |
| R6 | Notifications | ✅ | 🟡 | **🟡 Partial** | Schema ready |
| R7 | Stale alerts | — | 🟡 | **🟡 Partial** | Rules need defining |

### F. Admin

| # | Module | Database | UI Coded | Status | Notes |
|---|---|---|---|---|---|
| A1 | Company profile | ✅ | ✅ | **✅ Done** | PPK Tex details seeded |
| A2 | Users & roles | ✅ | ✅ | **✅ Done** | Visible in Settings |
| A3 | System config (constants) | ✅ | 🟡 | **🟡 Partial** | 1848 / 1690 / 5315 frozen |
| A4 | Document sequences | ✅ | 🟡 | **🟡 Partial** | SO/INV numbering active |

---

## 3. Tally

- **✅ Done:** 12 areas
- **🟡 Partial (placeholder UI, real database):** 22 areas
- **❌ Missing (no DB, no UI):** 3 areas — **Sizing, Pavu Assign, Warehouse location & dispatch**

---

## 4. What the three missing modules actually do

### 4a. Sizing
**What happens on the floor:** Warp yarn is unwound, run through a starch bath, dried, and wound back onto a beam (pavu). This makes the yarn strong enough to handle 60+ picks per inch on the loom.

**Why it must be tracked:**
- Sizing has wastage (3–7% typical) — without recording it, yarn inventory drifts
- Sizing chemicals are a real cost line that should hit costing
- A single sizing batch produces multiple pavus that all share the same quality

**Database tables to add:**
- `sizing_batch` (date, input yarn lot, input kg, output pavu count, output metres, wastage kg, chemicals cost)
- `sizing_chemical` (master of chemicals used)

**UI screens to add:**
- Sizing batch entry form
- Sizing register / list

---

### 4b. Pavu Assign
**What happens on the floor:** A sized pavu sits in the godown. The mill manager picks one and assigns it to Loom L-04 to weave 800 m of fabric for SO-2026-039. From this point, that loom is "loaded" until the pavu runs out.

**Why it must be tracked:**
- Without this, you can't answer "which loom is making which order"
- Without this, daily production entry can't auto-fill quality / customer
- Pavu utilisation (how much fabric one pavu actually wove vs theoretical) is a key efficiency metric

**Database tables to add:**
- `pavu` (master: code, sized from which sizing_batch, count, reed, ends, total metres, status)
- `pavu_assignment` (pavu_id, loom_id, sales_order_line_id, assigned_on, removed_on, metres_woven)

**UI screens to add:**
- Pavu inventory (available / on loom / exhausted)
- Pavu assign form
- Loom schedule view (which pavu is on each loom today)

---

### 4c. Warehouse
**What happens on the floor:** Grey fabric comes off the loom in rolls. They're stacked in the warehouse on numbered racks. Before dispatch, each roll is unfolded, inspected for defects, re-folded, packed in a bale, and loaded on a truck against an invoice.

**Why it must be tracked:**
- Current `fabric_stock` table holds totals but not rack locations — you can't tell a floor worker "fetch SO-039 from Rack B-3"
- Inspection results (A-grade / B-grade / reject) affect what price you can charge
- Dispatch confirmation should auto-update invoice status

**Database tables to add:**
- `warehouse_location` (rack code, capacity, current occupancy)
- `fabric_roll` (roll_no, quality, metres, grade, current_location, sales_order_line_id)
- `dispatch` (date, vehicle no, driver, invoice_id, total bales, total metres)

**UI screens to add:**
- Warehouse map / rack-by-rack stock
- Inspection screen (mark each roll's grade)
- Dispatch form

---

## 5. Recommended build order

If you want a production-ready ERP, the next 3 sprints should be:

**Sprint 1 — Close the production gap (2–3 weeks)**
1. Sizing module (DB + UI)
2. Pavu Master + Pavu Assign (DB + UI)
3. Production batch daily entry UI (links pavu → daily metres)

**Sprint 2 — Close the dispatch gap (1–2 weeks)**
4. Warehouse rack management (DB + UI)
5. Inspection screen
6. Dispatch + invoice generation

**Sprint 3 — Polish the placeholders (2 weeks)**
7. Sales Order multi-line create form
8. Customer & Purchase Payment forms with FIFO allocation
9. Attendance 2-shift marking UI for supervisors
10. Reports (sales register, ageing, profit-by-quality)

After Sprint 3, ✅ Done count goes from 12 → 38, and every menu item works.

---

## 6. Decision points for you

Before I write more code, I need you to confirm:

1. **Pavu vs Bobbin** — In the current schema I built a `bobbin` table treating a bobbin as "a small warp beam". Is a *bobbin* in your factory the same as a *pavu*, or are they different physical things (e.g. pavu = main warp beam, bobbin = small auxiliary beam)? If different, I'll add a separate `pavu` table.

2. **Sizing — in-house or outsourced?** Do you size in your own factory or send yarn to a sizing vendor? Answer changes the table design.

3. **Warehouse — how granular?** Are you OK tracking each grey-fabric roll individually (roll number, grade), or is bulk metres per quality enough for v1?

4. **Inspection grades — what are yours?** A/B/Reject? 1st/2nd? Confirm so I model it right.

5. **Dispatch — single invoice per dispatch or multiple?** Some mills load 3 customers on one truck.

Answer those five and I'll start Sprint 1 immediately, beginning with Sizing.

---

*Generated 11 May 2026 · PPK TEX ERP v0.1 status snapshot*
