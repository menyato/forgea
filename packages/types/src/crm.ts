import type {
  ActivityKind,
  EntryType,
  InvoiceKind,
  LeadSource,
  PaymentMethod,
  QuotationStatus,
} from './generated/prisma/enums.js';
import type { Money } from './lists.js';

// CRM (Phase 11) ------------------------------------------------------------

export interface LeadStageView {
  id: string;
  name: string;
  sortOrder: number;
  isWon: boolean;
  defaultProbability: number;
  active: boolean;
}

export interface LostReasonView {
  id: string;
  name: string;
  active: boolean;
}

/** Open, won (in the won stage, closed) or lost (closed with a reason). */
export type LeadState = 'open' | 'won' | 'lost';

export interface LeadListItem {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  /** First 200 characters; the full message is on the lead's page. */
  messagePreview: string;
  source: LeadSource;
  stage: { id: string; name: string; isWon: boolean };
  state: LeadState;
  probability: number;
  expectedRevenue: Money | null;
  /** Expected revenue × probability. */
  proratedRevenue: Money | null;
  deadline: string | null;
  assignedTo: { id: string; email: string; name: string | null } | null;
  /** The earliest follow-up not done yet. */
  nextActivity: { kind: ActivityKind; summary: string; dueAt: string } | null;
  createdAt: string;
}

export interface LeadDetail extends LeadListItem {
  message: string;
  budgetRange: string | null;
  hasReferenceImage: boolean;
  customer: { id: string; email: string; name: string | null } | null;
  customRequestNumber: string | null;
  lostReason: string | null;
  closedAt: string | null;
  activities: {
    id: string;
    kind: ActivityKind;
    summary: string;
    dueAt: string;
    doneAt: string | null;
    assignedTo: string | null;
  }[];
  /** The lead's log, oldest first: notes and what happened. */
  notes: {
    id: string;
    body: string;
    author: string | null;
    createdAt: string;
  }[];
  quotations: {
    id: string;
    number: string;
    status: QuotationStatus;
    total: Money;
  }[];
}

// Sales -------------------------------------------------------------------

export interface QuotationLineView {
  id: string;
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: Money;
  discountPercent: string;
  /** quantity × unit price, less the discount. */
  lineTotal: Money;
  isCustom: boolean;
}

export interface QuotationListItem {
  id: string;
  number: string;
  status: QuotationStatus;
  customer: { id: string; email: string; name: string | null };
  total: Money;
  validUntil: string;
  expired: boolean;
  orderNumber: string | null;
  createdAt: string;
}

export interface QuotationDetail extends QuotationListItem {
  leadId: string | null;
  note: string | null;
  customerName: string;
  phone: string;
  paymentMethod: PaymentMethod;
  delivery: boolean;
  city: string | null;
  addressLine: string | null;
  lines: QuotationLineView[];
  history: {
    status: QuotationStatus;
    changedAt: string;
    note: string | null;
  }[];
}

// Accounting --------------------------------------------------------------

export type PaymentState = 'not_paid' | 'partial' | 'paid' | 'reversed';

export interface InvoiceListItem {
  id: string;
  number: string;
  type: EntryType;
  invoiceKind: InvoiceKind | null;
  date: string;
  customer: { id: string; email: string; name: string | null } | null;
  orderNumber: string | null;
  total: Money;
  /** What is still owed on it. */
  residual: Money;
  paymentState: PaymentState;
  currencyCode: string;
}

export interface JournalEntryView {
  id: string;
  number: string;
  type: EntryType;
  journal: { code: string; name: string };
  date: string;
  label: string;
  customer: { id: string; email: string } | null;
  orderNumber: string | null;
  currencyCode: string;
  exchangeRate: string;
  reversedEntryNumber: string | null;
  lines: {
    account: { code: string; name: string };
    label: string;
    debit: Money;
    credit: Money;
  }[];
}

export interface AccountView {
  id: string;
  code: string;
  name: string;
  type: string;
  active: boolean;
  /** Debit − credit of posted lines. */
  balance: Money;
}

export interface ReportLine {
  code: string;
  name: string;
  amount: Money;
}

export interface ProfitAndLoss {
  from: string;
  to: string;
  income: ReportLine[];
  expenses: ReportLine[];
  totalIncome: Money;
  totalExpenses: Money;
  netProfit: Money;
}

export interface BalanceSheet {
  asOf: string;
  assets: ReportLine[];
  liabilities: ReportLine[];
  equity: ReportLine[];
  totalAssets: Money;
  totalLiabilitiesAndEquity: Money;
}

export interface AgedReceivables {
  asOf: string;
  rows: {
    customer: { id: string; email: string; name: string | null };
    notDue: Money;
    days1to30: Money;
    days31to60: Money;
    days61to90: Money;
    older: Money;
    total: Money;
  }[];
}

export interface AccountingSettingsView {
  salesTax: { id: string; name: string; ratePercent: string } | null;
  taxes: { id: string; name: string; ratePercent: string }[];
  lockDate: string | null;
}
