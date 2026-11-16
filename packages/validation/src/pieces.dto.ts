import { PieceStage } from '@forgea/types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PIECE_SORTS } from './constants.js';
import { CommaList, Trim } from './email.js';
import { CursorPageQuery } from './pagination.dto.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const day = { message: 'Enter a date' };
const STAGES = Object.values(PieceStage);

/** GET /pieces: the "Where it is" board and list. */
export class PieceListQuery extends CursorPageQuery {
  @IsOptional()
  @IsIn(PIECE_SORTS)
  sort: (typeof PIECE_SORTS)[number] = 'printedAt';

  /** Several stages, comma-separated (the board's filters). */
  @IsOptional()
  @CommaList()
  @IsArray()
  @ArrayMaxSize(STAGES.length)
  @IsIn(STAGES, { each: true })
  stages?: PieceStage[];

  /** Printed from this studio day on… */
  @IsOptional()
  @Matches(DATE_ONLY, day)
  from?: string;

  /** …to this one, included. */
  @IsOptional()
  @Matches(DATE_ONLY, day)
  to?: string;

  /** The pieces someone's account holds. */
  @IsOptional()
  @IsUUID()
  holderId?: string;

  /** Only one order's pieces (the order's page). */
  @IsOptional()
  @IsUUID()
  orderId?: string;

  /** Name, product, who has it, the note or the order number. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;
}

/** Where a piece is, who has it, when it was printed. */
export class UpdatePieceDto {
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(1, { message: 'Name the piece' })
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Enter how many' })
  @Min(1, { message: 'Enter how many' })
  @Max(500)
  quantity?: number;

  /** Not PRINTING: a print on the printer is finished (or failed) from its own page. */
  @IsOptional()
  @IsIn(STAGES.filter((s) => s !== PieceStage.PRINTING))
  stage?: PieceStage;

  /** Who has it, by name; null: nobody. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Trim()
  @IsString()
  @MaxLength(120)
  holder?: string | null;

  /** Their account (a customer, or someone of the team); null: none. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID('all', { message: 'Choose someone from the list' })
  holderId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Trim()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  /** The studio day it was printed. */
  @IsOptional()
  @Matches(DATE_ONLY, day)
  printedOn?: string;
}

/** A print on the printer is done (its filament comes off the shelf) or failed. */
export class FinishPieceDto {
  @IsOptional()
  @IsBoolean()
  failed?: boolean;

  /** Failed: how far it got. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Enter a percentage, e.g. 40' })
  @Min(1, { message: 'Enter a percentage, e.g. 40' })
  @Max(100, { message: 'Enter a percentage, e.g. 40' })
  progressPercent?: number;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  note?: string;
}
