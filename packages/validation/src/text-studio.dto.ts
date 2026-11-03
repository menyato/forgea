import { TextDecor, TextStyle } from '@forgea/types';
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
  ValidateNested,
} from 'class-validator';
import { MONEY_PATTERN, STORAGE_KEY_PATTERN } from './constants.js';
import { Trim } from './email.js';

/** The most characters any personalised text may have (a product may allow fewer). */
export const TEXT_MAX_CHARS = 24;

/** A millimetre measure with at most one decimal, e.g. 12 or 2.5. */
const MM_PATTERN = /^\d{1,3}(\.\d)?$/;
const mm = { message: 'Enter millimetres, e.g. 12 or 2.5' };

/** One letter's own font and colour (curved initials, single letters). */
export class DesignLetterDto {
  @IsOptional()
  @IsUUID()
  fontId?: string;

  @IsOptional()
  @IsUUID()
  colour?: string;
}

/**
 * The customer's design for a personalised product. The API checks the rest against the
 * product: its length, the font having every letter, the colours being offered.
 */
export class TextDesignDto {
  @Trim()
  @IsString()
  @MinLength(1, { message: 'Type the text' })
  @MaxLength(TEXT_MAX_CHARS * 2)
  text!: string;

  @IsUUID('all', { message: 'Choose a font' })
  fontId!: string;

  @IsUUID('all', { message: 'Choose a colour' })
  textColour!: string;

  @IsOptional()
  @IsUUID()
  baseColour?: string;

  /** Big initial: the initial and decorations' colour; couple: the heart's. */
  @IsOptional()
  @IsUUID()
  accentColour?: string;

  /** Big initial: the initial's own font. */
  @IsOptional()
  @IsUUID()
  accentFontId?: string;

  /** The size: a letter height the product offers (mm). */
  @IsOptional()
  @Matches(MM_PATTERN, mm)
  heightMm?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TEXT_MAX_CHARS)
  @ValidateNested({ each: true })
  @Type(() => DesignLetterDto)
  letters?: DesignLetterDto[];
}

/** A personalised product's settings (Dashboard → product → Personalised text). */
export class ProductTextDto {
  @IsIn(Object.values(TextStyle), { message: 'Choose how the pieces are made' })
  style!: TextStyle;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TEXT_MAX_CHARS)
  maxChars!: number;

  @Matches(MM_PATTERN, mm)
  letterHeightMm!: string;

  @Matches(MM_PATTERN, mm)
  letterDepthMm!: string;

  @Matches(MM_PATTERN, mm)
  baseDepthMm!: string;

  @Matches(MM_PATTERN, mm)
  maxWidthMm!: string;

  @IsUUID('all', { message: 'Choose the colours customers pick from' })
  colourGroupId!: string;

  @Matches(MONEY_PATTERN, { message: 'Enter an amount, e.g. 1.50' })
  extraColourPrice: string = '0';

  /** More letter heights customers may choose (mm), besides letterHeightMm. */
  @IsArray()
  @ArrayMaxSize(6, { message: 'At most 6 more sizes' })
  @Matches(MM_PATTERN, {
    each: true,
    message: 'Sizes are millimetres, e.g. 15',
  })
  sizesMm: string[] = [];

  /** The colours a design starts with: option values of the colour group. */
  @IsOptional()
  @IsUUID()
  defaultColourId?: string;

  @IsOptional()
  @IsUUID()
  defaultBaseColourId?: string;

  @IsOptional()
  @IsUUID()
  defaultAccentColourId?: string;

  /** Big initial pieces: the decorations (required for them, the API checks). */
  @IsOptional()
  @IsIn(Object.values(TextDecor), { message: 'Choose the decorations' })
  decor?: TextDecor;
}

/** A new font, from an uploaded file (POST /uploads/font). */
export class SaveFontDto {
  @Matches(STORAGE_KEY_PATTERN, { message: 'Upload the font again' })
  fileKey!: string;

  /** As customers see it; empty = the font's own name. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(60)
  name?: string;
}

export class UpdateFontDto {
  @Trim()
  @IsString()
  @MinLength(1, { message: 'Enter a name' })
  @MaxLength(60)
  name!: string;

  @IsBoolean()
  active!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder!: number;
}
