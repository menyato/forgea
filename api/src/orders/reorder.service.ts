import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  ChosenOption,
  ReorderResult,
  TextDesignInput,
} from '@forgea/types';
import {
  type CartOwner,
  type CartResult,
  CartService,
} from '../cart/cart.service.js';
import { OrdersRepository } from './orders.repository.js';

/**
 * "Order again": the lines of a past order go back into the cart, as they are sold today.
 * The order kept its choices by name, so each is matched to the product's current options;
 * a line whose product or choice is gone is skipped and named, never guessed.
 */
@Injectable()
export class ReorderService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly cart: CartService,
  ) {}

  async reorder(
    owner: CartOwner & { userId: string },
    orderNumber: string,
  ): Promise<{ cart: CartResult | null; result: ReorderResult }> {
    const order = await this.orders.findOwn(owner.userId, orderNumber);
    if (!order) throw new NotFoundException('Order not found');
    const result: ReorderResult = { added: 0, skipped: [] };
    let cart: CartResult | null = null;
    for (const item of order.items) {
      if (!item.productId) {
        result.skipped.push(`${item.name}: made only for that order`);
        continue;
      }
      try {
        cart = await this.cart.addByNames(
          owner,
          item.productId,
          item.quantity,
          item.options as unknown as ChosenOption[],
          // A personalised piece comes back with the same text, fonts and colours.
          (item.design as { design?: TextDesignInput } | null)?.design,
        );
        result.added += 1;
      } catch (error) {
        result.skipped.push(`${item.name}: ${(error as Error).message}`);
      }
    }
    return { cart, result };
  }
}
