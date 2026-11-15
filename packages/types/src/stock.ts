import type { DateRange } from './insights.js';
import type { ShownColour } from './parts.js';
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
  USED: 'Printed for the studio',
  CORRECTION: 'Count correction',
  PRINTED: 'Print finished (actual use)',
  RETURNED: 'Back from a cancelled order',
};

/** One material in one colour (GET /stock): what is left, how fast it goes, what to buy. */
export interface StockItemView {
  id: string;
  material: { id: string; code: string; name: string };
  /** "" when no colour was chosen. */
  colour: string;
  /** How the colour looks: the one picked for this line, else the shop's swatch of its name. */
  swatchHex: string | null;
  /** The colour picked for this line itself (#rrggbb); null = none picked. */
  hex: string | null;
  /** What a gram of this filament costs: its own spools' price, else its material's. USD. */
  costPerGram: string;
  active: boolean;
  /** On the shelf: the sum of every movement. */
  stockGrams: number;
  /** What orders not yet in production will take (estimated from their products). */
  committedGrams: number;
  /** stockGrams âˆ’ committedGrams. */
  availableGrams: number;
  used30Grams: number;
  used90Grams: number;
  /** When filament last came in or went out. */
  lastMovedAt: string | null;
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
  /** The stock line it moved (its page). */
  stockItemId: string;
  /** + in, âˆ’ out. */
  grams: number;
  materialCode: string;
  colour: string;
  note: string | null;
  orderNumber: string | null;
  /** Printed for the studio or failed: the product and how many. */
  product: string | null;
  quantity: number | null;
  /** What it cost (a delivery: the price paid), USD; null when not known. */
  cost: string | null;
  /** A delivery booked in the accounts: its entry number. */
  entryNumber: string | null;
  by: string | null;
}

/** Grams and their cost, USD. */
export interface GramsCost {
  grams: number;
  cost: string;
}

/**
 * Filament in and out over a period, with its cost: bought, used by orders, printed for the
 * studio, lost to failed prints. Orders' filament is at the cost per gram when it went out
 * (today's for older movements); studio and failed prints include machine time.
 */
export interface StockCosts {
  bought: GramsCost;
  orders: GramsCost;
  studio: GramsCost;
  failed: GramsCost;
}

/** A product the studio can print for itself or record a failure of (GET /stock/printables). */
export interface StockPrintable {
  id: string;
  name: string;
  materialCode: string;
  /** Its sizes by measurements ("18 Ã— 12 Ã— 9 cm"); empty when it has one size. */
  sizes: string[];
  /** The colours it is offered in (labels), with swatches. */
  colours: { label: string; swatchHex: string | null }[];
  /**
   * Parts customers recolour (empty when none): each is printed in one of `colours`, starting in
   * the colour the shop starts it in.
   */
  parts: { name: string; startsAs: string }[];
  /** Its 3D model and the colours it starts in, to show which product it is. */
  modelKey: string | null;
  shown: ShownColour[];
  /** Grams and cost of one, default size and colour: the form's preview. */
  gramsPerUnit: string;
  unitCost: string;
}

/** Grams each product took out of stock (orders in production) in a period. */
export interface ProductFilamentUse {
  productId: string;
  product: string;
  materialCode: string;
  colour: string;
  grams: number;
}

/** Movements of each kind (the movements list's filters). */
export type StockMovementCounts = Partial<Record<StockMovementKind, number>>;

export interface StockOverview {
  items: StockItemView[];
  usage: { range: DateRange; rows: ProductFilamentUse[] };
  costs: StockCosts;
  /** Purchases can be booked as paid (an expense account is set in the accounts). */
  canBookPurchases: boolean;
}

export type ReadyPieceMovementKind =
  'PRINTED' | 'LEFT_OVER' | 'ADDED' | 'SOLD' | 'USED' | 'SCRAPPED' | 'COUNTED';

export const READY_PIECE_MOVEMENT_LABELS: Readonly<
  Record<ReadyPieceMovementKind, string>
> = {
  PRINTED: 'Printed for the shelf',
  LEFT_OVER: 'Left over from a cancelled order',
  ADDED: 'Added by hand',
  SOLD: 'Sold',
  USED: 'Given away, sample or display',
  SCRAPPED: 'Scrapped',
  COUNTED: 'Counted',
};

/** How pieces leave the shelf, chosen by the team. */
export const READY_PIECE_TAKE_KINDS = ['SOLD', 'USED', 'SCRAPPED'] as const;

/** Pieces printed and not sold yet, of one kind. */
export interface ReadyPieceView {
  id: string;
  product: { id: string; name: string } | null;
  name: string;
  details: string;
  onHand: number;
  /** Average cost of one piece, USD. */
  unitCost: string;
  /** onHand × unitCost. */
  value: string;
  updatedAt: string;
}

export interface ReadyPieceMovementView {
  id: string;
  kind: ReadyPieceMovementKind;
  quantity: number;
  unitCost: string;
  printJobId: string | null;
  order: { id: string; number: string } | null;
  note: string | null;
  by: string | null;
  createdAt: string;
}

export interface ReadyPieceDetail extends ReadyPieceView {
  movements: ReadyPieceMovementView[];
}

/** What production made and lost over a period, and what waits on the shelf. */
export interface ProductionResults {
  range: { from: string; to: string };
  runs: { done: number; failed: number; cancelled: number };
  pieces: { good: number; spare: number; lost: number };
  grams: { used: string; lost: string };
  hours: { printing: string; lost: string };
  electricityKwh: string;
  /** USD: what the good pieces cost to print, and what failures and bad pieces wasted. */
  cost: { good: string; lost: string };
  /** Studio prints that failed (recorded from the stock page, not a print job). */
  studioFailures: { grams: number; cost: string };
  printers: {
    id: string;
    name: string;
    runs: number;
    failed: number;
    hours: string;
    kwh: string;
    lostCost: string;
  }[];
  shelf: {
    /** Now. */
    pieces: number;
    value: string;
    /** Over the period. */
    added: number;
    sold: number;
    usedOrScrapped: number;
    scrappedCost: string;
  };
}
