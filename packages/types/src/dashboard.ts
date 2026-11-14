import type { ChosenOption } from './catalog.js';
import type {
  CustomRequestStatus,
  OrderStatus,
  PaymentMethod,
  QuotationStatus,
  Role,
} from './generated/prisma/enums.js';
import type { Money } from './lists.js';
import type { DesignSummary } from './text-studio.js';

/** GET /orders/:id — everything staff need to prepare, deliver and get paid for an order. */
export interface StaffOrder {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  /** The steps staff may take from here (the shared status flow). */
  nextStatuses: OrderStatus[];
  paymentMethod: PaymentMethod;
  customer: { name: string; email: string; phone: string };
  delivery: boolean;
  rush: boolean;
  city: string | null;
  addressLine: string | null;
  deliveryNotes: string | null;
  items: {
    id: string;
    name: string;
    quantity: number;
    unitPrice: Money;
    lineTotal: Money;
    isCustom: boolean;
    options: ChosenOption[];
    /** The product's page, when it was bought from the catalog. */
    productSlug: string | null;
    /** A personalised piece: what to print, with its print files (one STL per colour). */
    design:
      (DesignSummary & { itemId: string; files: { colour: string }[] }) | null;
    /** The product's 3MF print project can be downloaded (a catalog product with one). */
    printProject: boolean;
    /** Its product's sliced print files, each downloadable from the order. */
    printFiles: { id: string; name: string }[];
  }[];
  /** The labelled lines the customer saw (subtotal, rush fee, discounts, delivery…). */
  priceBreakdown: { label: string; amount: Money }[];
  total: Money;
  depositRequired: Money;
  depositPaid: boolean;
  currencyCode: string;
  exchangeRate: string;
  totalInCurrency: string;
  depositInCurrency: string;
  /** Oldest first, with who made each change. */
  history: {
    status: OrderStatus;
    changedAt: string;
    note: string | null;
    changedBy: string | null;
  }[];
  /**
   * Its invoices and credit notes (deposit, final), with what is still owed. Null for someone
   * without permission to see invoices: the API leaves them out.
   */
  invoices: import('./crm.js').InvoiceListItem[] | null;
  /** When the order came from accepting a custom request's quote. */
  customRequestNumber: string | null;
  createdAt: string;
}

/** One admin-set exchange rate in a currency's history (newest first). */
export interface ExchangeRateEntry {
  rate: string;
  effectiveFrom: string;
  setBy: string | null;
}

/** GET /users — accounts, for the team page. */
export interface UserListItem {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  role: Role;
  /** How they sign in. Team accounts only ever have "google". */
  signIn: ('google' | 'password')[];
  /** A team member whose access was switched off. */
  disabled: boolean;
  createdAt: string;
}

/** A custom request as its customer sees it ("My requests"). */
export interface CustomRequestView {
  requestNumber: string;
  status: CustomRequestStatus;
  /** A quote nobody answered in time: it can't be accepted any more. */
  expired: boolean;
  title: string;
  description: string;
  quantity: number;
  material: { id: string; code: string; name: string } | null;
  colour: string | null;
  /** The attached file's object key, and whether it is a 3D model or a photo. */
  file: { key: string; kind: 'model' | 'image' } | null;
  /** The studio's design for it (3D model or image), once a designer has added one. */
  design: { key: string; kind: 'model' | 'image' } | null;
  /** The instant range (USD, all units) computed from an attached STL. */
  estimate: { low: Money; high: Money } | null;
  quote: {
    price: Money;
    note: string | null;
    quotedAt: string;
    expiresAt: string;
  } | null;
  /** The order made by accepting the quote. */
  orderNumber: string | null;
  history: {
    status: CustomRequestStatus;
    changedAt: string;
    note: string | null;
  }[];
  createdAt: string;
}

/** The same request in the dashboard, with who asked. */
export interface StaffCustomRequest extends CustomRequestView {
  id: string;
  customer: { name: string | null; email: string; phone: string | null };
}

export interface CustomRequestListItem {
  id: string;
  requestNumber: string;
  status: CustomRequestStatus;
  expired: boolean;
  title: string;
  customerEmail: string;
  quotedPrice: Money | null;
  hasFile: boolean;
  createdAt: string;
}

/** POST /custom-requests/estimate — the instant range shown before a request is sent. */
export interface RequestEstimate {
  /** The range shown to the customer, around `price`. */
  low: Money;
  high: Money;
  /**
   * The price the shop's own calculation gives (the same as a product with these grams, time and
   * filaments): the middle of the range, and the quote when sliced files are quoted at once.
   */
  price: Money;
  /** A sliced 3MF: the slicer's own grams and time (not estimated from the volume). */
  exact: boolean;
  grams: string;
  printHours: string;
  material: { code: string; name: string };
}

/**
 * A record connected to the one on screen (its lead, quotation, order, custom request, or the
 * customer), for the dashboard's "Related" links. A customer is named by email: people without
 * an account (leads, quotations sent to an address) are customers too.
 */
/**
 * GET /orders/:id/production: what an order takes to make. Filament and time are estimated
 * from its products (their sliced files, sizes and the options bought), as stock is; `taken`
 * is what stock really gave it. `money` (estimated with today's pricing) only for those who
 * see the books, and only when every line can be costed.
 */
export interface OrderProduction {
  lines: {
    itemId: string;
    name: string;
    quantity: number;
    /** For the whole line; null when it can't be estimated. */
    grams: string | null;
    printHours: string | null;
    colours: { colour: string; grams: string }[];
    cost: Money | null;
    /**
     * True: no product estimates it, so these are what its finished print runs really took
     * (grams by reel, hours, recorded cost). False: estimated from its product.
     */
    measured: boolean;
  }[];
  grams: string;
  printHours: string;
  /** Filament taken from stock for it (less what was returned), per reel. */
  taken: { material: string; colour: string; grams: number }[];
  money: {
    /** The lines' total without tax. */
    revenue: Money;
    cost: Money;
    profit: Money;
    marginPercent: string | null;
  } | null;
}

export interface RelatedRecord {
  kind: 'lead' | 'quotation' | 'order' | 'request' | 'customer';
  /** The record's id; for a customer, their email address. */
  id: string;
  label: string;
}

/**
 * A customer as the dashboard lists them: a person known by their email address, with an
 * account or without one (someone who sent the website form, or was sent a quotation).
 */
export interface CustomerListItem {
  /** Their email address (a customer without an account has no other id). */
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  /** Null: no account (yet). */
  account: {
    id: string;
    /** How they sign in; empty for an account the studio made (a quotation confirmed for them). */
    signIn: ('password' | 'Google')[];
    confirmed: boolean;
    since: string;
  } | null;
  orders: number;
  /** USD, orders not cancelled. */
  spent: Money;
  quotations: number;
  requests: number;
  leads: number;
  lastActivity: string;
  /** When they last used the site signed in (null: never, or no account). */
  lastSeen: string | null;
}

export interface CustomerList {
  items: CustomerListItem[];
  nextCursor: string | null;
  /** Everyone matching the search and filter. */
  total: number;
  /** Carts of visitors who never signed in (no address to know them by), with something in them. */
  guestCarts: number;
}

/** One customer: everything they did with the studio, newest first. */
export interface CustomerDetail extends CustomerListItem {
  history: {
    orders: {
      id: string;
      number: string;
      status: OrderStatus;
      total: Money;
      createdAt: string;
    }[];
    quotations: {
      id: string;
      number: string;
      status: QuotationStatus;
      total: Money;
      createdAt: string;
    }[];
    requests: {
      id: string;
      number: string;
      title: string;
      status: CustomRequestStatus;
      createdAt: string;
    }[];
    leads: {
      id: string;
      name: string;
      stage: string;
      state: 'open' | 'won' | 'lost';
      createdAt: string;
    }[];
  };
  /** What is in their cart now (signed in), if anything. */
  cart: { lines: number; updatedAt: string } | null;
  /** Their sign-ins, newest first (the last 10): when, on what, and whether still signed in. */
  signIns: {
    startedAt: string;
    lastSeen: string;
    /** e.g. "Chrome on Windows", "Safari on iPhone". */
    device: string;
    ipAddress: string | null;
    active: boolean;
  }[];
}

/** The dashboard Overview's customer numbers. */
export interface CustomerSummary {
  accounts: number;
  newThisWeek: number;
  seenThisWeek: number;
  /** People known only by email (the website form, a quotation sent to them). */
  withoutAccount: number;
  /** Visitors with something in a cart who never signed in. */
  guestCarts: number;
}

/** One backup on the server: the database and every uploaded file, encrypted, in one file. */
export interface BackupItem {
  file: string;
  createdAt: string;
  sizeBytes: number;
  /** The nightly one, one made with "Back up now", or the one made just before a restore. */
  kind: 'nightly' | 'manual' | 'before-restore';
}

/** Something the server did with backups, and how it went. */
export interface BackupEvent {
  action: 'backup' | 'restore' | 'delete';
  file: string;
  ok: boolean;
  message: string;
  /** Who asked (their email), "nightly", or "server" (by hand on the server). */
  by: string;
  at: string;
}

export interface BackupRunning {
  action: BackupEvent['action'];
  file: string;
  since: string;
}

/** The dashboard's Backups page. */
export type BackupsView =
  | { configured: false }
  | {
      configured: true;
      /** The server's disk (shared by both environments and their backups). */
      disk: { totalBytes: number; freeBytes: number; backupsBytes: number };
      /** How many backups are kept; older ones are deleted after each new one. */
      keep: number;
      /** Newest first. */
      items: BackupItem[];
      running: BackupRunning | null;
      /** The latest results, newest first. */
      last: BackupEvent[];
      /** Requests waiting for the server (it picks them up within seconds). */
      pending: number;
    };

/** What deleting one record does, shown before it is deleted. */
export interface DeletionImpact {
  id: string;
  /** The record as its list names it ("PLA Red", "Twist lamp"). */
  name: string;
  /** History that keeps it: while any is here it can't be deleted. */
  blockedBy: DeletionUse[];
  /** What goes with it (its sizes, colours, cart lines…). */
  removes: DeletionUse[];
  /** What stays but stops pointing at it (a colour no longer "printed from" this reel). */
  unlinks: DeletionUse[];
  /** What to do instead when it can't be deleted. */
  instead: string | null;
  deletable: boolean;
}

export interface DeletionUse {
  count: number;
  /** "order lines", "products". */
  what: string;
}
