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

export interface PrintJobListItem {
  id: string;
  orderId: string;
  orderNumber: string;
  material: string;
  color: string;
  grams: string;
  hours: string;
  machine: string;
  scheduledDate: string | null;
  status: PrintJobStatus;
  createdAt: string;
}

export interface AuditLogListItem {
  id: string;
  actor: { id: string; email: string } | null;
  action: string;
  targetType: string;
  targetId: string;
  ipAddress: string | null;
  timestamp: string;
}
