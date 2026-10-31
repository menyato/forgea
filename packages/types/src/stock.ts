import type { DateRange } from './insights.js';
import type { StockMovementKind } from './generated/prisma/enums.js';

/** The kinds the team records by hand; the others come from orders, prints and the start. */
export const MANUAL_STOCK_MOVEMENTS = [
  'RECEIVED',
  'USED',
  'CORRECTION',
] as const;
export type ManualStockMovement = (typeof MANUAL_STOCK_MOVEMENTS)[number];

export const STOCK_MOVEMENT_LABELS: Readonly<
  Record<StockMovementKind, string>
> = {
  OPENING: 'Opening stock',
  RECEIVED: 'Delivery received',
  ORDER: 'Order in production',
  FAILED_PRINT: 'Failed print',
  USED: 'Used (other)',
  CORRECTION: 'Count correction',
};

/** One material in one colour (GET /stock): what is left, how fast it goes, what to buy. */
export interface StockItemView {
  id: string;
  material: { id: string; code: string; name: string };
  /** "" when no colour was chosen. */
  colour: string;
  active: boolean;
  /** On the shelf: the sum of every movement. */
  stockGrams: number;
  /** What orders not yet in production will take (estimated from their products). */
  committedGrams: number;
  /** stockGrams − committedGrams. */
  availableGrams: number;
  used30Grams: number;
  used90Grams: number;
  /** Average grams a day (the busier of the last 30 and 90 days), one decimal. */
  dailyUseGrams: string;
  /** How long what is available lasts at that pace; null without recent use. */
  daysLeft: number | null;
  /** Order more at or below this: the low-stock level + what is used while a delivery comes. */
  reorderPointGrams: number;
  needsRestock: boolean;
  /** What to buy to cover the lead time and the cover days, in whole spools. */
  suggestSpools: number;
  suggestGrams: number;
  // The owner's settings for this filament.
  lowStockGrams: number;
  spoolGrams: number;
  leadTimeDays: number;
  coverDays: number;
}

export interface StockMovementView {
  id: string;
  createdAt: string;
  kind: StockMovementKind;
  /** + in, − out. */
  grams: number;
  materialCode: string;
  colour: string;
  note: string | null;
  orderNumber: string | null;
  by: string | null;
}

/** Grams each product took out of stock (orders in production) in a period. */
export interface ProductFilamentUse {
  productId: string;
  product: string;
  materialCode: string;
  colour: string;
  grams: number;
}

export interface StockOverview {
  items: StockItemView[];
  /** The latest movements, newest first. */
  movements: StockMovementView[];
  usage: { range: DateRange; rows: ProductFilamentUse[] };
}
