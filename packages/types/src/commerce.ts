import type { OrderStatus, PaymentMethod } from './generated/prisma/enums.js';
import type { ChosenOption } from './catalog.js';
import type { DesignSummary, SlotSummary } from './text-studio.js';
import type { Money } from './lists.js';

export interface CartLine {
  /** The cart line: the same product with other options is another line. */
  id: string;
  productId: string;
  slug: string;
  name: string;
  materialCode: string;
  /** Current unit price (USD) from the pricing engine. */
  unitPrice: Money;
  quantity: number;
  /** Made to order: counts toward the 50% deposit. */
  isCustom: boolean;
  options: ChosenOption[];
  /** A personalised piece: the customer's text, fonts and colours. */
  design: DesignSummary | null;
  /** The text and logos on its model, as chosen. */
  slots: SlotSummary[];
  /** Claimed free under this offer (priced 0 while it runs; one piece). */
  freeOfferId: string | null;
}

/**
 * The cart as the storefront sees it. Totals are recalculated live in the browser with
 * OrderPricer from @forgea/pricing and the public order settings; checkout re-prices on the server.
 */
export interface CartView {
  lines: CartLine[];
  itemCount: number;
}

export interface CheckoutResult {
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  total: Money;
  depositRequired: Money;
  currencyCode: string;
  exchangeRate: string;
  totalInCurrency: string;
  depositInCurrency: string;
}

/** An accepted currency with the rate in force now (GET /currencies). */
export interface CurrencyQuote {
  code: string;
  name: string;
  decimals: number;
  roundingStep: string;
  isBase: boolean;
  /** Units per 1 base unit; "1" for the base currency. */
  rate: string;
  rateEffectiveFrom: string | null;
}

export interface OrderHistoryEntry {
  status: OrderStatus;
  changedAt: string;
  /** Customer-visible note, e.g. a courier tracking number. */
  note: string | null;
}

/** An order as its customer sees it ("My Orders" and guest lookup). No address or phone. */
export interface CustomerOrder {
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  delivery: boolean;
  total: Money;
  depositRequired: Money;
  depositPaid: boolean;
  currencyCode: string;
  totalInCurrency: string;
  /** With the options as chosen (size, colour…), so two lines of one product tell apart. */
  items: {
    name: string;
    quantity: number;
    lineTotal: Money;
    options: ChosenOption[];
    design: DesignSummary | null;
    slots: SlotSummary[];
  }[];
  /** Oldest first. */
  history: OrderHistoryEntry[];
  /** Its invoices and credit notes, with what is still owed. */
  invoices: {
    number: string;
    kind: 'deposit' | 'final' | 'credit note';
    date: string;
    total: Money;
    residual: Money;
    paid: boolean;
  }[];
  /** Still waiting for the studio (and no deposit paid): the customer may cancel it. */
  canCancel: boolean;
  createdAt: string;
}

/** POST /orders/mine/:number/reorder: what went back into the cart. */
export interface ReorderResult {
  added: number;
  /** Lines that could not be added, with why (no longer sold, a choice gone…). */
  skipped: string[];
}
