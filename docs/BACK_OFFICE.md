# Back office: email, calendar, CRM, sales, accounting (Phases 9 and 11)

Functional reference: Odoo 20 (`crm`, `sale`, `sale_crm`, `account`), read 2026-10-27. The
models and flows are re-designed for one studio in this codebase; no Odoo code is copied
(Odoo is Python; Community is LGPL-3, Enterprise proprietary).

## Phase 9 — Google Workspace

**Choice:** the Gmail API and the Calendar API with a Google Cloud **service account** using
Workspace **domain-wide delegation**, scoped to `gmail.send` and `calendar.events` only, acting as
the studio's address (`MAIL_SENDER`, e.g. hello@forgea-lab.com).

Why: no mailbox password is stored anywhere (an app password or SMTP password would be), the
key is one secret in Secret Manager in production, both APIs are included with Workspace (no
paid tier), and a Workspace admin can revoke it in one place. Rejected: SMTP with an app password
(a password, needs 2-step on a user mailbox), SMTP relay (IP allow-listing on Cloud Run).

Without the key (local development, tests) emails are written as `.eml` files to `MAIL_OUTBOX_DIR`
and calendar changes are logged — nothing leaves the machine.

Sent: order placed (with the transfer details), every order status change, quote ready, request
closed, email address verification. Sending never blocks or fails the action that caused it.

Calendar: scheduled print jobs (production planner) appear on the studio calendar
(`GOOGLE_CALENDAR_ID`), updated when rescheduled, removed when cancelled.

## Phase 11 — CRM, sales, accounting

**CRM (Odoo `crm.lead`):** leads with owner-editable stages (one marks won), probability,
expected revenue, deadline, assignee, lost reason, notes and activities (call, email, meeting,
to-do with due dates). Won = moved to the won stage; lost = closed with a reason; restore
reopens. The public custom-design form and custom requests can create leads.

**Sales (Odoo `sale.order`):** quotations made by staff for a customer: lines (product or free
text, quantity, unit price, discount, tax), draft → sent → confirmed / cancelled, validity date.
Confirming creates a normal order in the orders pipeline (deposit rules apply), so every sale —
shop, custom request, quotation — is one kind of order.

**Accounting (Odoo `account`):** double-entry ledger.

- Chart of accounts with types (receivable, payable, cash, bank, current asset, liability,
  equity, income, expense…); journals: Sales, Cash, Money transfer (bank), General.
- Journal entries (moves) and lines; **every posted entry balances** (enforced by the database),
  posted entries are never edited or deleted — corrections are reversals (credit notes).
- Numbering at posting, per journal and year: `INV/2026/00001`, `RINV/…` for credit notes,
  `CSH/…` and `BNK/…` for cash and transfer payments, `MISC/…` for manual entries.
- Customer invoices from orders: a **deposit invoice** when the deposit arrives, the **final
  invoice** for the rest (the deposit deducted) — Odoo's down-payment flow. Made automatically:
  confirming an order after its deposit posts the deposit invoice and the transfer payment;
  delivering it posts the final invoice (and the cash payment for cash on delivery). The order
  page has buttons for the same steps when one was missed, and records other payments.
- The deposit is a liability (2200 Customer deposits) until the final invoice turns it into
  income: products 4000, custom work 4100, delivery 4200, rush 4300.
- Payments create their own entry (debit cash/bank, credit receivable) and are reconciled with
  invoices (partial reconciliations); an invoice is not paid / partly paid / paid / reversed.
- Taxes: shop prices **include** tax, so turning VAT on never changes a price; invoices split
  each amount into base and tax. VAT 11% is set up but **off until the owner turns it on**
  (Books → Tax and lock date), a decision for the owner and their accountant.
- Multi-currency: every entry stores its currency, rate and converted amounts; balances in USD.
  Today everything is posted in USD.
- Lock date: nothing dated on or before it can be posted or reversed into.
- Reports from posted lines only: profit and loss, balance sheet, aged receivables.

## Business page and filament stock

**Business (Dashboard → Accounting → Business, `/admin/insights`, `GET /insights?from=&to=`,
`books.view`):** one period (this month by default; presets or any dates, two years at most),
each figure next to the period of the same length just before. Days are UTC days, like the
books (an entry's date is the UTC day it was posted).

- **Revenue, expenses, net profit** are the profit and loss report itself (`Books.profitAndLoss`):
  income accounts net of credit notes, taxes excluded. **Tax** is the tax lines of final invoices
  (less their credit notes), so revenue + tax = what customers paid for what was delivered.
  **Net profit** is the books' (revenue − expense accounts): it is all revenue until expenses
  are recorded.
- **Production cost (estimated):** no cost is stored with orders, so it is worked out from the
  invoiced order lines — the lines of orders whose final invoice is dated in the period, less
  those whose final invoice was credited in it — with **today's** pricing settings and catalog:
  the chosen size's grams and hours (else the product's), each option's multipliers and material,
  then the pricing engine's cost before markup (`configuredUnitCost`: material, machine time,
  waste, failures, labour, packaging; option add-ons are margin, not cost). Lines without a
  catalog product (custom requests, free quotation lines) have no estimate: shown as "custom
  work with no estimate". **Gross profit** = revenue − that estimate.
- **Orders** (placed in the period, cancelled left out), average order (tax and delivery
  included), **cash collected** (payment entries into cash and transfer accounts), **still owed**
  (receivable balance at the end of the period).
- Best sellers and categories: invoiced products by revenue (the tax split out at today's rate),
  units and estimated margin. What customers choose: choice-group values and sizes on orders
  placed (typed texts never). Funnel: orders by status and cancellation rate; new vs returning
  customers (first order ever in the period); delivery/pickup, cash/transfer, rush; custom
  requests sent → quoted → accepted, quotations written → sent → confirmed, leads in, won and
  lost (with reasons). Everything is added up by the database (`InsightsRepository`).

**Filament stock (Dashboard → Catalog → Filament stock, `/admin/stock`, `materials.view`;
recording and limits need `stock.manage`):** stock per material **and colour** (spools are bought
that way; a colour is an option value with a swatch), kept as an append-only list of movements
(`stock_movements`; the database refuses changes, and keeps `materials.stockGrams` as the
material's total): opening stock, deliveries, orders, failed prints, other use, count
corrections. An order takes its filament **when it goes into production** (in the status
change's transaction, once per order line): cancelling before that takes nothing; cancelling
after keeps it spent (correct by hand if nothing was printed). A finished print job changes
nothing (its order took the filament); a failed one takes its grams. Restock advice per line:
available = stock − what open orders will take; daily use = the busier of the last 30 and 90
days; reorder at the owner's low level + daily use × delivery days; buy enough for the cover
days on top, in whole spools. All four limits are the owner's, per filament.

**Left out (Odoo features a one-studio shop doesn't need now):** lead scoring, teams and
assignment rules, pricelists, multi-company, fiscal positions, cash-basis taxes, bank statement
import, exchange-difference entries (rates are fixed per document), analytic accounting.
