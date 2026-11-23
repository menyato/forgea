import { TextDecor, TextStyle } from '@forgea/types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
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
import {
  KEYCHAIN_SHAPES,
  type KeychainShape,
  MAX_LOGO_INKS,
  SUBTITLE_MAX_CHARS,
} from '@forgea/text3d/design';
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
  /** May be empty only on a keychain carrying a logo (`designProblem` says so). */
  @Trim()
  @IsString()
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

  /** Big initial: the decorations chosen (none: the product's own). */
  @IsOptional()
  @IsIn(Object.values(TextDecor), { message: 'Choose the decorations' })
  decor?: TextDecor;

  /** Big initial: the decorations' own colour. */
  @IsOptional()
  @IsUUID()
  decorColour?: string;

  /** Big initial and couple: a smaller line under the name (weight, birth date, a date). */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(SUBTITLE_MAX_CHARS * 2)
  subtitle?: string;

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

  /** A name keychain's plate shape (one the product offers). */
  @IsOptional()
  @IsIn(KEYCHAIN_SHAPES, { message: 'Choose one of the shapes offered' })
  shape?: KeychainShape;

  /** A name keychain's logo beside the name: one the product offers, or the customer's own. */
  @IsOptional()
  @IsUUID('all', { message: 'Choose one of the logos offered' })
  logoId?: string;

  /** The logo in its own colours: an offered colour for each of the logo's, in its order. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LOGO_INKS)
  @IsUUID('all', { each: true, message: 'Choose one of the colours offered' })
  logoColours?: string[];
}

/** One colour's solid, as the browser measured it. */
export class MeasuredPartDto {
  @IsUUID()
  colour!: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(10_000_000)
  volumeMm3!: number;
}

/** The piece's size as the browser measured it (mm). */
export class MeasuredSizeDto {
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(2000)
  x!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(2000)
  y!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(2000)
  z!: number;
}

/**
 * The browser's measurement of the design it built for the preview: lets the live price and
 * the cart skip building it again on the server. Checkout always builds it on the server.
 */
export class DesignMeasurementDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(TEXT_MAX_CHARS + 4)
  @ValidateNested({ each: true })
  @Type(() => MeasuredPartDto)
  parts!: MeasuredPartDto[];

  @ValidateNested()
  @Type(() => MeasuredSizeDto)
  size!: MeasuredSizeDto;
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

  /** Name keychains: the plate shapes customers choose from (none: it follows the letters). */
  @IsArray()
  @ArrayMaxSize(4)
  @IsIn(KEYCHAIN_SHAPES, { each: true, message: 'Choose the shapes offered' })
  shapes: KeychainShape[] = [];

  /** Name keychains: the studio's logos customers may add beside their name. */
  @IsArray()
  @ArrayMaxSize(12, { message: 'At most 12 logos' })
  @IsUUID('all', { each: true, message: 'Choose the logos offered' })
  logoIds: string[] = [];

  /** Name keychains: customers may bring their own logo (beside their name or alone). */
  @IsOptional()
  @IsBoolean()
  ownLogo?: boolean;
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

/** A point or direction in the model file's millimetres (x, y, z). */
const COORD = { message: 'Place it on the model' };

/** Where a slot sits on the model (see @forgea/text3d SlotPlacement). */
export class SlotPlacementDto {
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @IsNumber({ allowNaN: false, allowInfinity: false }, { each: true, ...COORD })
  @Min(-5000, { each: true, ...COORD })
  @Max(5000, { each: true, ...COORD })
  origin!: [number, number, number];

  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @IsNumber({ allowNaN: false, allowInfinity: false }, { each: true, ...COORD })
  @Min(-1, { each: true, ...COORD })
  @Max(1, { each: true, ...COORD })
  normal!: [number, number, number];

  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @IsNumber({ allowNaN: false, allowInfinity: false }, { each: true, ...COORD })
  @Min(-1, { each: true, ...COORD })
  @Max(1, { each: true, ...COORD })
  up!: [number, number, number];
}

/** Text or a logo added to a product's model (see @forgea/text3d DesignSlot). */
export class DesignSlotDto {
  @Matches(/^[a-z0-9-]{1,40}$/, { message: 'Add the slot again' })
  id!: string;

  @IsIn(['TEXT', 'LOGO'])
  kind!: 'TEXT' | 'LOGO';

  @Trim()
  @IsString()
  @MinLength(1, { message: 'Name it, e.g. Name or Logo' })
  @MaxLength(40)
  label!: string;

  @IsBoolean()
  editable!: boolean;

  @ValidateNested()
  @Type(() => SlotPlacementDto)
  placement!: SlotPlacementDto;

  @Type(() => Number)
  @IsNumber({}, mm)
  @Min(3, mm)
  @Max(200, mm)
  heightMm!: number;

  @Type(() => Number)
  @IsNumber({}, mm)
  @Min(3, mm)
  @Max(400, mm)
  maxWidthMm!: number;

  @Type(() => Number)
  @IsNumber({}, mm)
  @Min(0.4, mm)
  @Max(10, mm)
  depthMm!: number;

  /** The colour it prints in: one of the product's colour choices. */
  @IsUUID('all', { message: 'Choose its colour' })
  colour!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(40)
  defaultText?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(40)
  maxChars?: number;

  @IsOptional()
  @IsUUID('all', { message: 'Choose its font' })
  defaultFontId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'Choose the logo' })
  logoId?: string;

  @IsOptional()
  @IsBoolean()
  defaultOn?: boolean;
}

/** What a customer chose for one of a product's slots. */
export class SlotChoiceDto {
  @Matches(/^[a-z0-9-]{1,40}$/)
  slotId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  text?: string;

  @IsOptional()
  @IsUUID()
  fontId?: string;

  @IsOptional()
  @IsBoolean()
  on?: boolean;

  @IsOptional()
  @IsUUID()
  colour?: string;

  /** An editable logo slot: the customer's own logo (POST /logos/yours). */
  @IsOptional()
  @IsUUID()
  logoId?: string;

  /** A logo in its own colours: an offered colour for each of the logo's. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LOGO_INKS)
  @IsUUID('all', { each: true, message: 'Choose one of the colours offered' })
  logoColours?: string[];
}

/** A logo's name and order, or switched off (a logo is never deleted once used). */
export class UpdateLogoDto {
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
  sortOrder: number = 0;
}

/** A new logo's name (its SVG file comes with it, POST /logos). */
export class NewLogoDto {
  @Trim()
  @IsString()
  @MinLength(1, { message: 'Enter a name' })
  @MaxLength(60)
  name!: string;
}
