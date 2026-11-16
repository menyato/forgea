import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type {
  AdminProduct,
  AdminProductListItem,
  HomePlate,
  ModelFileInfo,
  Page,
  Permission,
  PricePreview,
  PrintFilesTotal,
  ProductDetail,
  ProductListItem,
  QuotableProduct,
  QuotableSize,
} from '@forgea/types';
import {
  ModelInfoDto,
  PricePreviewDto,
  PrintFilesDto,
  ProductListQuery,
  ProductPriceDto,
  SaveProductDto,
  SetHomePlateDto,
} from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import {
  CallerPermissions,
  Public,
  RequirePermission,
} from '../authorization/decorators.js';
import { THROTTLE } from '../security/throttle-policies.js';
import { ModelFileInfoService } from './model-file-info.js';
import { ProductsService } from './products.service.js';

@Controller('products')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly modelFiles: ModelFileInfoService,
  ) {}

  @Public()
  @Get()
  list(@Query() query: ProductListQuery): Promise<Page<ProductListItem>> {
    return this.products.list(query);
  }

  /** The Overview's numbers (the list's "In the shop" + "Without 3D" filters count the same). */
  @RequirePermission('catalog.view')
  @Get('manage/counts')
  manageCounts(): Promise<{ shownWithoutModel: number }> {
    return this.products.manageCounts();
  }

  /** Dashboard: every product, hidden ones included. Declared before ":slug". */
  @RequirePermission('catalog.view')
  @Get('manage')
  manageList(
    @Query() query: ProductListQuery,
  ): Promise<Page<AdminProductListItem>> {
    return this.products.manageList(query);
  }

  @RequirePermission('catalog.view')
  @Get('manage/:id')
  manageOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CallerPermissions() permissions: Permission[],
  ): Promise<AdminProduct> {
    return this.products.manageOne(id, permissions.includes('pricing.manage'));
  }

  /** Public: what stands on the home page's print bed. Before :slug, which would match it. */
  @Public()
  @Get('plate')
  plate(): Promise<HomePlate> {
    return this.products.plate();
  }

  /** Designers and admins choose the bed's line-up (up to five, the first in the centre). */
  @RequirePermission('homebed.manage')
  @Audit({
    action: 'product.plate.set',
    targetType: 'HomePlate',
    targetId: 'home',
  })
  @Put('plate')
  setPlate(@Body() dto: SetHomePlateDto): Promise<HomePlate> {
    return this.products.setPlate(dto.productIds);
  }

  /** Products for a quotation line, hidden ones too (Dashboard → Quotations). */
  @RequirePermission('quotations.view')
  @Get('quotable')
  quotable(): Promise<QuotableProduct[]> {
    return this.products.quotable();
  }

  @RequirePermission('quotations.view')
  @Get('quotable/:slug/sizes')
  quotableSizes(@Param('slug') slug: string): Promise<QuotableSize[]> {
    return this.products.quotableSizes(slug);
  }

  @Public()
  @Get(':slug')
  detail(@Param('slug') slug: string): Promise<ProductDetail> {
    return this.products.detail(slug);
  }

  /** The price for the shopper's current choices; the product page calls it as they choose. */
  @Public()
  @Throttle(THROTTLE.livePrice)
  @HttpCode(200)
  @Post(':slug/price')
  price(
    @Param('slug') slug: string,
    @Body() dto: ProductPriceDto,
  ): Promise<{ unitPrice: string }> {
    return this.products.price(slug, dto.options, dto.design, dto.measured);
  }

  @RequirePermission('catalog.manage')
  @Audit({ action: 'product.create', targetType: 'Product' })
  @Post()
  create(
    @Body() dto: SaveProductDto,
    @CallerPermissions() permissions: Permission[],
  ): Promise<AdminProduct> {
    return this.products.create(dto, permissions.includes('pricing.manage'));
  }

  /** The price of a product being edited; its costs only for whoever manages pricing. */
  @RequirePermission('catalog.manage')
  @HttpCode(200)
  @Post('price-preview')
  pricePreview(
    @Body() dto: PricePreviewDto,
    @CallerPermissions() permissions: Permission[],
  ): Promise<PricePreview> {
    return this.products.pricePreview(
      dto,
      permissions.includes('pricing.manage'),
    );
  }

  /** What an uploaded 3MF says: size, grams per colour and time, in a material. */
  @RequirePermission('catalog.manage')
  @HttpCode(200)
  @Post('model-info')
  modelInfo(@Body() dto: ModelInfoDto): Promise<ModelFileInfo> {
    return this.modelFiles.info(dto);
  }

  /** A product's sliced print files, read and added up: grams per colour, time, set-up. */
  @RequirePermission('catalog.manage')
  @HttpCode(200)
  @Post('print-files')
  printFiles(@Body() dto: PrintFilesDto): Promise<PrintFilesTotal> {
    return this.products.printFilesInfo(dto);
  }

  @RequirePermission('catalog.manage')
  @Audit({ action: 'product.update', targetType: 'Product' })
  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveProductDto,
    @CallerPermissions() permissions: Permission[],
  ): Promise<AdminProduct> {
    return this.products.update(
      id,
      dto,
      permissions.includes('pricing.manage'),
    );
  }
}
