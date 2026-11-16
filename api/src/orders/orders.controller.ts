import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type {
  CheckoutResult,
  CustomerOrder,
  ReorderResult,
  OrderListItem,
  OrderRemovalPreview,
  Page,
  Permission,
  StaffOrder,
} from '@forgea/types';
import {
  ChangeOrderStatusDto,
  CheckoutDto,
  MyOrdersQuery,
  OrderListQuery,
  RemoveTestOrderDto,
} from '@forgea/validation';
import type { Request, Response } from 'express';
import type { OrderStatus } from '../generated/prisma/enums.js';
import { Audit } from '../audit-log/audit.interceptor.js';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import {
  AdminOnly,
  CallerPermissions,
  CurrentUser,
  RequirePermission,
} from '../authorization/decorators.js';
import { OrderRemoval } from './order-removal.service.js';
import { CartCookie } from '../cart/cart-cookie.js';
import { THROTTLE } from '../security/throttle-policies.js';
import { CheckoutService } from './checkout.service.js';
import { CustomerOrdersService } from './customer-orders.service.js';
import {
  OrderStatusService,
  type StatusChange,
} from './order-status.service.js';
import { OrdersService } from './orders.service.js';
import { ReorderService } from './reorder.service.js';
import { ParsePatternPipe } from '../custom-requests/parse-pattern.pipe.js';
import { ORDER_NUMBER_PATTERN } from './order-number.js';

/** An order number as customers see it: "FG-2026-0001" (or an older random one). */
const OrderNumber = new ParsePatternPipe(
  ORDER_NUMBER_PATTERN,
  'Order not found',
);

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly checkoutService: CheckoutService,
    private readonly customerOrders: CustomerOrdersService,
    private readonly statuses: OrderStatusService,
    private readonly cartCookie: CartCookie,
    private readonly reorders: ReorderService,
    private readonly removal: OrderRemoval,
  ) {}

  /** The order pipeline for staff and admins. */
  @RequirePermission('orders.view')
  @Get()
  list(@Query() query: OrderListQuery): Promise<Page<OrderListItem>> {
    return this.orders.list(query);
  }

  /** "My Orders": the signed-in customer's own orders, each with its full status history. */
  @Get('mine')
  mine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MyOrdersQuery,
  ): Promise<Page<CustomerOrder>> {
    return this.customerOrders.mine(user.id, query);
  }

  /** The customer cancels their own order, before the studio has started on it. */
  @Throttle(THROTTLE.checkout)
  @HttpCode(200)
  @Post('mine/:number/cancel')
  async cancelMine(
    @Param('number', OrderNumber) number: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ cancelled: true }> {
    await this.customerOrders.cancel(user.id, number);
    return { cancelled: true };
  }

  /** "Order again": the order's lines back into the customer's cart, as sold today. */
  @Throttle(THROTTLE.cart)
  @HttpCode(200)
  @Post('mine/:number/reorder')
  async reorder(
    @Param('number', OrderNumber) number: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReorderResult> {
    return (await this.reorders.reorder({ userId: user.id }, number)).result;
  }

  /** How many in each status, for the dashboard's tabs. */
  @RequirePermission('orders.view')
  @Get('counts')
  counts(): Promise<Partial<Record<OrderStatus, number>>> {
    return this.orders.counts();
  }

  /** What removing a test order takes away (admins only; real orders are cancelled). */
  @AdminOnly()
  @Get(':id/removal')
  removalPreview(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderRemovalPreview> {
    return this.removal.preview(id);
  }

  /** Removes a test order entirely, with its documents and stock records. Audit-logged. */
  @AdminOnly()
  @Audit({ action: 'order.remove-test', targetType: 'Order' })
  @Post(':id/remove')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RemoveTestOrderDto,
  ): Promise<OrderRemovalPreview> {
    return this.removal.remove(id, dto.confirm);
  }

  @RequirePermission('orders.view')
  @Get(':id')
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CallerPermissions() permissions: Permission[],
  ): Promise<StaffOrder> {
    return this.orders.detail(id, permissions.includes('invoices.view'));
  }

  /** Staff move an order along its status flow. Audit-logged; history written by the database. */
  @RequirePermission('orders.manage')
  @Audit({ action: 'order.status.change', targetType: 'Order' })
  @Patch(':id/status')
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeOrderStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StatusChange> {
    return this.statuses.change(id, dto.status, user.id, dto.note, {
      expected: dto.expectedStatus,
    });
  }

  /** Places an order from the cart. Browsing needs no account; ordering does (owner decision). */
  @Throttle(THROTTLE.checkout)
  @Post('checkout')
  async checkout(
    @Body() dto: CheckoutDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CheckoutResult> {
    const result = await this.checkoutService.checkout(
      dto,
      user.id,
      this.cartCookie.read(req),
    );
    this.cartCookie.clear(res);
    return result;
  }
}
