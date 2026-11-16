import { OptionKind, ProfitKind } from '@forgea/types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  POSITIVE_MONEY_PATTERN,
  PRICE_PER_GRAM_PATTERN,
  PRODUCT_COLOURS_MAX,
  PRODUCT_PART_NAME_MAX_LENGTH,
  PRINT_FILE_NAME_MAX_LENGTH,
  PRODUCT_PRINT_FILES_MAX,
  PRODUCT_IMAGES_MAX,
  SLUG_PATTERN,
  STORAGE_KEY_PATTERN,
  PRODUCT_SIZES_MAX,
  SIZE_CM_PATTERN,
  STOCK_COLOUR_MAX_LENGTH,
} from './constants.js';
import { Trim } from './email.js';
import {
  DesignMeasurementDto,
  ProductTextDto,
  TextDesignDto,
} from './text-studio.dto.js';

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

  /** Typed directly only without a reel (a catalog file may carry just this). */
  @ValidateIf((o: SaveMaterialDto) => o.reelPrice === undefined)
  @Matches(PRICE_PER_GRAM_PATTERN, {
    message: 'Enter a price per gram, e.g. 0.035',
  })
  pricePerGram?: string;

  /** One reel as bought: with its weight, the price per gram is worked out from it. */
  @IsOptional()
  @Matches(MONEY_PATTERN, { message: 'Enter what a reel costs, e.g. 22.00' })
  reelPrice?: string;

  @ValidateIf((o: SaveMaterialDto) => o.reelPrice !== undefined)
  @Type(() => Number)
  @IsInt({ message: 'Enter the reel weight in grams, e.g. 1000' })
  @Min(1, { message: 'Enter the reel weight in grams, e.g. 1000' })
  @Max(100_000)
  reelGrams?: number;

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

  /** A colour printed from this filament on the shelf: orders take its grams there. */
  @IsOptional()
  @IsUUID('all', { message: 'Choose the filament again' })
  stockItemId?: string;
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

const SIZE_MESSAGE = { message: 'A size in cm, e.g. 12.5' };

/** One size a product is sold in: its measurements and what it takes to print. */
export class ProductSizeDto {
  @Trim()
  @IsString()
  @MinLength(1, { message: 'Name the size, e.g. Large' })
  @MaxLength(40)
  label!: string;

  @Matches(SIZE_CM_PATTERN, SIZE_MESSAGE)
  sizeXcm!: string;

  @Matches(SIZE_CM_PATTERN, SIZE_MESSAGE)
  sizeYcm!: string;

  @Matches(SIZE_CM_PATTERN, SIZE_MESSAGE)
  sizeZcm!: string;

  @Matches(POSITIVE_DECIMAL, { message: 'Enter the grams at this size' })
  grams!: string;

  @Matches(POSITIVE_DECIMAL, { message: 'Enter the print time at this size' })
  printHours!: string;

  @IsBoolean()
  isDefault: boolean = false;
}

/** A multi-colour product: what one colour takes for one piece at the product's own size. */
export class ProductColourDto {
  /** The colour as the shop names it: the stock line its grams come from. */
  @Trim()
  @IsString()
  @MinLength(1, { message: 'Choose the colour' })
  @MaxLength(STOCK_COLOUR_MAX_LENGTH)
  colour!: string;

  @Matches(HEX_COLOR_PATTERN, { message: 'Pick a colour' })
  hex!: string;

  @Matches(POSITIVE_DECIMAL, { message: 'Enter the grams of this colour' })
  grams!: string;

  /** The filament on the shelf it is printed from: stock and cost follow that filament. */
  @IsOptional()
  @IsUUID('all', { message: 'Choose the filament again' })
  stockItemId?: string;

  /** What customers call this part ("Body"), when they choose its colour; `colour` starts it. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(PRODUCT_PART_NAME_MAX_LENGTH, {
    message: `At most ${PRODUCT_PART_NAME_MAX_LENGTH} characters`,
  })
  part?: string;

  /** The part's starting choice on the product page (a label of the part colours); none = automatic. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(PRODUCT_PART_NAME_MAX_LENGTH, {
    message: `At most ${PRODUCT_PART_NAME_MAX_LENGTH} characters`,
  })
  startsAs?: string;
}

/** A sliced print file of a product: the upload and what the owner calls it. */
export class ProductPrintFileDto {
  @Matches(/^clean\/[0-9a-f-]{36}\.3mf$/, {
    message: 'Upload the sliced file again',
  })
  key!: string;

  @Trim()
  @IsString()
  @MinLength(1, { message: 'Name the print file' })
  @MaxLength(PRINT_FILE_NAME_MAX_LENGTH)
  name!: string;
}

/** The owner's own price, in place of the calculated one (USD, above 0). */
const PRICE_OVERRIDE_MESSAGE = { message: 'Enter your price, e.g. 25.00' };

/** Something else one piece costs to make (a key ring, a lamp's wiring), USD. */
export class ProductExtraCostDto {
  @Trim()
  @IsString()
  @MinLength(1, { message: 'Name the extra cost, e.g. Key ring' })
  @MaxLength(80)
  label!: string;

  @Matches(MONEY_PATTERN, { message: 'Enter the amount, e.g. 0.15' })
  amount!: string;
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

  /** Personalised text: how its pieces are made; none = a regular product. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ProductTextDto)
  text?: ProductTextDto;

  /** Its own profit rule; none = the shop's (Pricing page). */
  @IsOptional()
  @IsIn(Object.values(ProfitKind), {
    message: 'Choose a percentage or a fixed amount',
  })
  profitKind?: ProfitKind;

  @ValidateIf((o: SaveProductDto) => o.profitKind !== undefined)
  @Matches(MONEY_PATTERN, {
    message: 'Enter the profit, e.g. 120 (%) or 4.50 (USD)',
  })
  profitValue?: string;

  /** Your own selling price in place of the calculated one; none = calculated. */
  @IsOptional()
  @Matches(POSITIVE_MONEY_PATTERN, PRICE_OVERRIDE_MESSAGE)
  priceOverride?: string;

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

  /** The printed size grams and printHours are for, in cm: all three or none. */
  @IsOptional()
  @Matches(SIZE_CM_PATTERN, SIZE_MESSAGE)
  sizeXcm?: string;

  @IsOptional()
  @Matches(SIZE_CM_PATTERN, SIZE_MESSAGE)
  sizeYcm?: string;

  @IsOptional()
  @Matches(SIZE_CM_PATTERN, SIZE_MESSAGE)
  sizeZcm?: string;

  /** The real sizes it is sold in; none: one size. */
  @IsArray()
  @ArrayMaxSize(PRODUCT_SIZES_MAX)
  @ValidateNested({ each: true })
  @Type(() => ProductSizeDto)
  sizes: ProductSizeDto[] = [];

  /** Multi-colour: the grams per colour (they add up to `grams`); none: one colour. */
  @IsArray()
  @ArrayMaxSize(PRODUCT_COLOURS_MAX)
  @ValidateNested({ each: true })
  @Type(() => ProductColourDto)
  colours: ProductColourDto[] = [];

  /** What else one piece costs (parts besides the print): pricing.manage only. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProductExtraCostDto)
  extraCosts: ProductExtraCostDto[] = [];

  /** Its sliced print files (their total is its grams, time and colours); none: its model. */
  @IsArray()
  @ArrayMaxSize(PRODUCT_PRINT_FILES_MAX)
  @ValidateNested({ each: true })
  @Type(() => ProductPrintFileDto)
  printFiles: ProductPrintFileDto[] = [];

  /** The colours customers recolour its named parts in: an option group with swatches. */
  @IsOptional()
  @IsUUID('all', { message: 'Choose the colours customers pick from' })
  partColourGroupId?: string;
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

  /** A personalised product: the customer's design. */
  @IsOptional()
  @ValidateNested()
  @Type(() => TextDesignDto)
  design?: TextDesignDto;

  /** The browser's measurement of that design (see DesignMeasurementDto). */
  @IsOptional()
  @ValidateNested()
  @Type(() => DesignMeasurementDto)
  measured?: DesignMeasurementDto;
}

/** POST /products/price-preview: the price a product would have while it is being edited. */
export class PricePreviewDto {
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

  @IsOptional()
  @IsIn(Object.values(ProfitKind), {
    message: 'Choose a percentage or a fixed amount',
  })
  profitKind?: ProfitKind;

  /** The product's extra costs (one piece), added to its cost. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProductExtraCostDto)
  extraCosts?: ProductExtraCostDto[];

  @ValidateIf((o: PricePreviewDto) => o.profitKind !== undefined)
  @Matches(MONEY_PATTERN, {
    message: 'Enter the profit, e.g. 120 (%) or 4.50 (USD)',
  })
  profitValue?: string;

  @IsOptional()
  @Matches(POSITIVE_MONEY_PATTERN, PRICE_OVERRIDE_MESSAGE)
  priceOverride?: string;

  /** The product's model: a sliced 3MF whose numbers these are adds no purge waste. */
  @IsOptional()
  @Matches(STORAGE_KEY_PATTERN, { message: 'Upload the model again' })
  modelFileKey?: string;

  /** Its colours' grams and filaments: each filament's own price then counts in the cost. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PRODUCT_COLOURS_MAX)
  @ValidateNested({ each: true })
  @Type(() => PreviewColourDto)
  colours?: PreviewColourDto[];

  /** Its sliced print files: numbers that are their total add no purge waste either. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PRODUCT_PRINT_FILES_MAX)
  @Matches(STORAGE_KEY_PATTERN, {
    each: true,
    message: 'Upload the file again',
  })
  printFileKeys?: string[];
}

/** POST /products/print-files: read these sliced files and add them up (dashboard). */
export class PrintFilesDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Add a sliced print file' })
  @ArrayMaxSize(PRODUCT_PRINT_FILES_MAX)
  @ValidateNested({ each: true })
  @Type(() => ProductPrintFileDto)
  files!: ProductPrintFileDto[];

  @IsUUID('all', { message: 'Choose a material' })
  materialId!: string;
}

/** One colour of a product being priced: its grams and the filament it is printed from. */
export class PreviewColourDto {
  @Matches(POSITIVE_DECIMAL, { message: 'Enter the grams of this colour' })
  grams!: string;

  @IsOptional()
  @IsUUID('all', { message: 'Choose the filament again' })
  stockItemId?: string;
}

/** POST /products/model-info: what a 3MF says, priced with a material (dashboard). */
export class ModelInfoDto {
  @Matches(STORAGE_KEY_PATTERN, { message: 'Upload the model again' })
  key!: string;

  @IsUUID('all', { message: 'Choose a material' })
  materialId!: string;

  /** For files never sliced: walls and infill as a share of the volume (%). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  solidityPercent: number = 40;
}
