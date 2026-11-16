import { PieceStage } from './generated/prisma/enums.js';
import type { Money } from './lists.js';

/** The board's columns, in the order a piece goes through them. */
export const PIECE_STAGES = [
  PieceStage.PRINTING,
  PieceStage.IN_LAB,
  PieceStage.IN_SHOP,
  PieceStage.WITH_SOMEONE,
  PieceStage.GIVEN,
  PieceStage.SOLD,
  PieceStage.FAILED,
] as const;

export const PIECE_STAGE_LABELS: Record<PieceStage, string> = {
  PRINTING: 'Printing',
  IN_LAB: 'In the lab',
  IN_SHOP: 'In the shop',
  WITH_SOMEONE: 'With someone',
  GIVEN: 'Given',
  SOLD: 'Sold',
  FAILED: 'Failed',
};

/** Stages that say who has the piece. */
export const PIECE_HELD_STAGES: readonly PieceStage[] = [
  PieceStage.WITH_SOMEONE,
  PieceStage.GIVEN,
  PieceStage.SOLD,
];

/** Someone's account a piece is linked to (a customer, or someone of the team). */
export interface PieceHolderAccount {
  id: string;
  name: string | null;
  email: string;
}

/** GET /pieces: one print on the "Where it is" board. */
export interface PieceView {
  id: string;
  name: string;
  productId: string | null;
  /** Its product's 3D model (the board's cards show it). */
  modelKey: string | null;
  orderNumber: string | null;
  quantity: number;
  stage: PieceStage;
  holder: string | null;
  holderAccount: PieceHolderAccount | null;
  note: string | null;
  /** When it was printed (ISO); the dashboard shows the studio's day. */
  printedAt: string;
  grams: number | null;
  cost: Money | null;
}

export interface PieceMoveView {
  stage: PieceStage;
  holder: string | null;
  holderAccount: PieceHolderAccount | null;
  note: string | null;
  by: string | null;
  at: string;
}

/** GET /pieces/:id: a piece and every move it made. */
export interface PieceDetail extends PieceView {
  moves: PieceMoveView[];
  /** Printing: what was started (shown, and recorded when it is done). */
  plan: { productId: string; quantity: number; parts: string } | null;
}

/** Pieces per stage, and the period's totals (the board's filters and its summary). */
export interface PieceCounts {
  stages: Partial<Record<PieceStage, number>>;
  pieces: number;
  grams: number;
  cost: Money;
}
