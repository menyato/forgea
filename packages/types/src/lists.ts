import type { OrderStatus, PrintJobStatus } from './generated/prisma/enums.js';

/** Every list endpoint returns this shape. Pass `nextCursor` back as `?cursor=` for the next page. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Money as a decimal string, always in the base currency (USD) unless a field says otherwise. */
export type Money = string;

export interface ProductListItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  material: { code: string; name: string };
  category: { slug: string; name: string } | null;
  /** Current unit price from the pricing engine, with the default options. */
  price: Money;
  /** Options to choose on the product page before adding to the cart. */
  hasOptions: boolean;
  /** Personalised: designed on its page (text, fonts, colours) before it can go in the cart. */
  personalised: boolean;
  /** The 3D model shown on the card and the product page (an object key), if any. */
  modelKey: string | null;
  /** Colour to show the model in: the default (or first) colour option's swatch. */
  previewColor: string | null;
  createdAt: string;
}

/** GET /products/plate — the home page's print bed. */
export interface HomePlate {
  /** In bed order: the first stands in the centre. */
  products: ProductListItem[];
  /** False when nothing was chosen in the dashboard and the newest models stand in. */
  chosen: boolean;
}

export interface OrderListItem {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  customerEmail: string;
  total: Money;
  currencyCode: string;
  totalInCurrency: string;
  depositRequired: Money;
  depositPaid: boolean;
  createdAt: string;
}

/** One print run: an order's line, on a printer, from a reel, with what it took and cost. */
export interface PrintJobListItem {
  id: string;
  orderId: string;
  orderNumber: string;
  /** The order line it prints; null for work added by hand that isn't one line. */
  item: { id: string; name: string } | null;
  /** Null until chosen: a job can't be scheduled or started without one. */
  printer: { id: string; name: string } | null;
  /** The reel (material and colour from stock); null until chosen, like the printer. */
  reel: { id: string; material: string; colour: string } | null;
  quantity: number;
  /** The estimate. */
  grams: string;
  hours: string;
  /** What it really took (done), or the grams lost (failed). */
  actualGrams: string | null;
  actualHours: string | null;
  /** Its real cost once done, USD, with that day's prices. */
  cost: {
    material: string;
    electricityKwh: string;
    electricity: string;
    wear: string;
    total: string;
  } | null;
  scheduledDate: string | null;
  status: PrintJobStatus;
  createdAt: string;
  finishedAt: string | null;
  /** Done: pieces that came out right, and good ones beyond what it was for. */
  goodPieces: number | null;
  sparePieces: number;
  note: string | null;
  /** The job this one reprints, and the reprints made of this one. */
  replaces: string | null;
  reprints: string[];
}

/** How many print jobs are in each status and on each printer (the production filters). */
export interface PrintJobCounts {
  statuses: Partial<Record<PrintJobStatus, number>>;
  /** By printer id; jobs with no printer yet under "none". */
  printers: Record<string, number>;
}

/** A printer of the studio (Production → Printers). */
export interface PrinterView {
  id: string;
  name: string;
  watts: number;
  priceUsd: string | null;
  lifeHours: number | null;
  /** priceUsd ÷ lifeHours, USD per print hour; null when either is missing. */
  wearPerHour: string | null;
  active: boolean;
  notes: string | null;
  jobs: number;
}

/** A JSON value as stored (an audit entry's details). */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface AuditLogListItem {
  id: string;
  actor: { id: string; email: string } | null;
  action: string;
  targetType: string;
  targetId: string;
  ipAddress: string | null;
  timestamp: string;
}

/** One audit entry with what it recorded: what was asked, or how it ended. */
export interface AuditLogEntry extends AuditLogListItem {
  metadata: JsonValue | null;
}

/**
 * What one piece of a product really took and cost, from its finished print runs (failed
 * reprints count in the cost, not in the pieces). Never shown to customers.
 */
export interface ProductRealCost {
  /** Print runs done and failed. */
  done: number;
  failed: number;
  /** Pieces printed. */
  pieces: number;
  /** Per piece; null before the first finished run. */
  perPiece: {
    grams: string;
    hours: string;
    material: string;
    electricity: string;
    wear: string;
    total: string;
    /** What customers paid for one, on average. */
    soldAt: string;
    /** soldAt − total. */
    margin: string;
  } | null;
}
