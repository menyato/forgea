import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { CartView } from '@forgea/types';
import { AddCartItemDto, UpdateCartItemDto } from '@forgea/validation';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import { OptionalUser, Public } from '../authorization/decorators.js';
import { THROTTLE } from '../security/throttle-policies.js';
import { CartCookie } from './cart-cookie.js';
import {
  type CartOwner,
  type CartResult,
  CartService,
} from './cart.service.js';

/** Guests and signed-in customers alike; the cart is found by account or by signed cookie. */
@Public()
@Throttle(THROTTLE.cart)
@Controller('cart')
export class CartController {
  constructor(
    private readonly cart: CartService,
    private readonly cookie: CartCookie,
  ) {}

  @Get()
  async view(
    @OptionalUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CartView> {
    return this.respond(res, await this.cart.view(this.owner(user, req)));
  }

  @Post('items')
  async add(
    @Body() dto: AddCartItemDto,
    @OptionalUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CartView> {
    return this.respond(
      res,
      await this.cart.add(
        this.owner(user, req),
        dto.productId,
        dto.quantity,
        dto.options,
        dto.design,
        dto.measured,
        dto.slots,
        dto.freeOfferId,
      ),
    );
  }

  @Patch('items/:itemId')
  async update(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateCartItemDto,
    @OptionalUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CartView> {
    return this.respond(
      res,
      await this.cart.setQuantity(this.owner(user, req), itemId, dto.quantity),
    );
  }

  @Delete('items/:itemId')
  async remove(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @OptionalUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CartView> {
    return this.respond(
      res,
      await this.cart.remove(this.owner(user, req), itemId),
    );
  }

  private owner(user: AuthenticatedUser | undefined, req: Request): CartOwner {
    return { userId: user?.id, guestCartId: this.cookie.read(req) };
  }

  /** Applies the cookie changes the service asked for, then returns the cart. */
  private respond(res: Response, result: CartResult): CartView {
    if (result.newGuestCartId) this.cookie.set(res, result.newGuestCartId);
    if (result.clearGuestCookie) this.cookie.clear(res);
    return result.view;
  }
}
