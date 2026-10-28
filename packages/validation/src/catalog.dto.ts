import { OptionKind } from '@forgea/types';
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
  ValidateNested,
} from 'class-validator';
import {
  DECIMAL_PATTERN,
  HEX_COLOR_PATTERN,
  MATERIAL_CODE_PATTERN,
  MONEY_PATTERN,
  OPTION_TEXT_MAX_LENGTH,
  POSITIVE_DECIMAL,
  PRICE_PER_GRAM_PATTERN,
  PRODUCT_IMAGES_MAX,
  SLUG_PATTERN,
  STORAGE_KEY_PATTERN,
} from './constants.js';
import { Trim } from './email.js';

// Every rule for the catalog is configured in the dashboard; these DTOs only keep the data
// well-formed. One "Save…" DTO serves both create (POST) and edit (PUT): the form always sends
// the whole record.

const SLUG_MESSAGE =
  'Use lowercase letters, numbers and dashes, e.g. phone-stand';

class SortedActive {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder: number = 0;

  @IsBoolean()
  active: boolean = true;
}

export class SaveCategoryDto extends SortedActive {
  @Trim()
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  @MaxLength(60)
  slug!: string;

  @Trim()
  @IsString()
  @MinLength(2, { message: 'Enter a name' })
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class SaveMaterialDto {
  @Trim()
  @Matches(MATERIAL_CODE_PATTERN, {
    message: 'Use capitals, numbers and dashes, e.g. PETG-CF',
  })
  @MaxLength(20)
  code!: string;

  @Trim()
  @IsString()
  @MinLength(2, { message: 'Enter a name' })
  @MaxLength(80)
  name!: string;

  @Matches(PRICE_PER_GRAM_PATTERN, {
    message: 'Enter a price per gram, e.g. 0.035',
  })
  pricePerGram!: string;

  @Matches(POSITIVE_DECIMAL, {
    message: 'Enter the density in g/cm³, e.g. 1.24',
  })
  densityGPerCm3!: string;

  @Matches(POSITIVE_DECIMAL, { message: 'Enter grams per hour, e.g. 12' })
  gramsPerHour!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockGrams!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  lowStockThresholdGrams!: number;

  @IsBoolean()
  active: boolean = true;
}

export class SaveOptionGroupDto extends SortedActive {
  @Trim()
  @IsString()
  @MinLength(2, { message: 'Enter a name' })
  @MaxLength(60)
  name!: string;

  @IsIn(Object.values(OptionKind))
  kind!: OptionKind;

  /** Text options only: the longest text a customer may type. */
  @ValidateIf((o: SaveOptionGroupDto) => o.kind === OptionKind.TEXT)
  @Type(() => Number)
  @IsInt({ message: 'Enter the longest text allowed' })
  @Min(1)
  @Max(OPTION_TEXT_MAX_LENGTH)
  maxLength?: number;

  /** Text options only: added to the unit price when text is given. */
  @Matches(MONEY_PATTERN, { message: 'Enter an amount, e.g. 1.50' })
  textExtraPrice: string = '0';
}

export class SaveOptionValueDto extends SortedActive {
  @Trim()
  @IsString()
  @MinLength(1, { message: 'Enter a label' })
  @MaxLength(60)
  label!: string;

  @IsOptional()
  @Matches(HEX_COLOR_PATTERN, { message: 'Pick a colour' })
  swatchHex?: string;

  @Matches(POSITIVE_DECIMAL, {
    message: 'Enter a multiplier greater than 0, e.g. 1.5',
  })
  gramsMultiplier: string = '1';

  @Matches(POSITIVE_DECIMAL, {
    message: 'Enter a multiplier greater than 0, e.g. 1.5',
  })
  hoursMultiplier: string = '1';

  @Matches(MONEY_PATTERN, { message: 'Enter an amount, e.g. 2.00' })
  extraPrice: string = '0';

  @IsOptional()
  @IsUUID()
  materialId?: string;
}

/** How a product offers one option group. */
export class ProductOptionConfigDto {
  @IsUUID()
  groupId!: string;

  @IsBoolean()
  required!: boolean;

  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  valueIds!: string[];

  @IsOptional()
  @IsUUID()
  defaultValueId?: string;
}

export class SaveProductDto {
  @Trim()
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  @MaxLength(80)
  slug!: string;

  @Trim()
  @IsString()
  @MinLength(2, { message: 'Enter a name' })
  @MaxLength(120)
  name!: string;

  @Trim()
  @IsString()
  @MinLength(10, { message: 'Describe the product in a sentence or two' })
  @MaxLength(4000)
  description!: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /** The default material; a material option may switch it. */
  @IsUUID('all', { message: 'Choose a material' })
  materialId!: string;

  @Matches(POSITIVE_DECIMAL, {
    message: 'Enter the grams of material, e.g. 60',
  })
  grams!: string;

  @Matches(DECIMAL_PATTERN, {
    message: 'Enter the print time in hours, e.g. 3.5',
  })
  printHours!: string;

  /** Made to order: needs the deposit at checkout. */
  @IsBoolean()
  isCustom!: boolean;

  /** "Designed by …": a studio or guest designer's name. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  designer?: string;

  @IsBoolean()
  active!: boolean;

  @IsOptional()
  @Matches(STORAGE_KEY_PATTERN, { message: 'Upload the model again' })
  modelFileKey?: string;

  @IsArray()
  @ArrayMaxSize(PRODUCT_IMAGES_MAX)
  @Matches(STORAGE_KEY_PATTERN, {
    each: true,
    message: 'Upload the images again',
  })
  imageKeys: string[] = [];

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProductOptionConfigDto)
  options: ProductOptionConfigDto[] = [];
}

/** A customer's choice for one option. */
export class OptionSelectionDto {
  @IsUUID()
  groupId!: string;

  @IsOptional()
  @IsUUID()
  valueId?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(OPTION_TEXT_MAX_LENGTH)
  text?: string;
}

/** POST /products/:slug/price — the price of a product with these choices. */
export class ProductPriceDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OptionSelectionDto)
  options: OptionSelectionDto[] = [];
}
