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
  Page,
  ProductDetail,
  ProductListItem,
} from '@forgea/types';
import {
  ProductListQuery,
  ProductPriceDto,
  SaveProductDto,
  SetHomePlateDto,
} from '@forgea/validation';
import { Audit } from '../audit-log/audit.interceptor.js';
import { Public, Roles } from '../authorization/decorators.js';
import { Role } from '../generated/prisma/enums.js';
import { THROTTLE } from '../security/throttle-policies.js';
import { ProductsService } from './products.service.js';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Public()
  @Get()
  list(@Query() query: ProductListQuery): Promise<Page<ProductListItem>> {
    return this.products.list(query);
  }

  /** Dashboard: every product, hidden ones included. Declared before ":slug". */
  @Roles(Role.DESIGNER)
  @Get('manage')
  manageList(
    @Query() query: ProductListQuery,
  ): Promise<Page<AdminProductListItem>> {
    return this.products.manageList(query);
  }

  @Roles(Role.DESIGNER)
  @Get('manage/:id')
  manageOne(@Param('id', ParseUUIDPipe) id: string): Promise<AdminProduct> {
    return this.products.manageOne(id);
  }

  /** Public: what stands on the home page's print bed. Before :slug, which would match it. */
  @Public()
  @Get('plate')
  plate(): Promise<HomePlate> {
    return this.products.plate();
  }

  /** Designers and admins choose the bed's line-up (up to five, the first in the centre). */
  @Roles(Role.DESIGNER)
  @Audit({
    action: 'product.plate.set',
    targetType: 'HomePlate',
    targetId: 'home',
  })
  @Put('plate')
  setPlate(@Body() dto: SetHomePlateDto): Promise<HomePlate> {
    return this.products.setPlate(dto.productIds);
  }

  @Public()
  @Get(':slug')
  detail(@Param('slug') slug: string): Promise<ProductDetail> {
    return this.products.detail(slug);
  }

  /** The price for the shopper's current choices; the product page calls it as they choose. */
  @Public()
  @Throttle(THROTTLE.quote)
  @HttpCode(200)
  @Post(':slug/price')
  price(
    @Param('slug') slug: string,
    @Body() dto: ProductPriceDto,
  ): Promise<{ unitPrice: string }> {
    return this.products.price(slug, dto.options);
  }

  @Roles(Role.DESIGNER)
  @Audit({ action: 'product.create', targetType: 'Product' })
  @Post()
  create(@Body() dto: SaveProductDto): Promise<AdminProduct> {
    return this.products.create(dto);
  }

  @Roles(Role.DESIGNER)
  @Audit({ action: 'product.update', targetType: 'Product' })
  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveProductDto,
  ): Promise<AdminProduct> {
    return this.products.update(id, dto);
  }
}
