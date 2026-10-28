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

**Left out (Odoo features a one-studio shop doesn't need now):** lead scoring, teams and
assignment rules, pricelists, multi-company, fiscal positions, cash-basis taxes, bank statement
import, exchange-difference entries (rates are fixed per document), analytic accounting.
