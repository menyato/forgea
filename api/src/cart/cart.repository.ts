import { Injectable } from '@nestjs/common';
import type { OptionSelection } from '@forgea/types';
import { CART_QUANTITY_MAX } from '@forgea/validation';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { withConfiguration } from '../products/product-configurator.js';

const withItems = {
  items: {
    orderBy: { createdAt: 'asc' },
    include: { product: { include: withConfiguration } },
  },
} as const satisfies Prisma.CartInclude;

export type CartRow = Prisma.CartGetPayload<{ include: typeof withItems }>;

/** One product configuration: the same product with other options is another line. */
export interface LineKey {
  productId: string;
  configKey: string;
  selections: readonly OptionSelection[];
}

@Injectable()
export class CartRepository {
  constructor(private readonly prisma: PrismaService) {}

  findGuestCart(id: string): Promise<CartRow | null> {
    return this.prisma.cart.findFirst({
      where: { id, userId: null },
      include: withItems,
    });
  }

  findUserCart(userId: string): Promise<CartRow | null> {
    return this.prisma.cart.findUnique({
      where: { userId },
      include: withItems,
    });
  }

  createGuestCart(): Promise<CartRow> {
    return this.prisma.cart.create({ data: {}, include: withItems });
  }

  /** The user's cart, created on first use (one per user, enforced by a unique index). */
  userCart(userId: string): Promise<CartRow> {
    return this.prisma.cart.upsert({
      where: { userId },
      create: { userId },
      update: {},
      include: withItems,
    });
  }

  /** Adds to the line's quantity, capped at CART_QUANTITY_MAX. */
  async addItem(
    cartId: string,
    line: LineKey,
    quantity: number,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await addTo(tx, cartId, line, quantity);
      await tx.cart.update({
        where: { id: cartId },
        data: { updatedAt: new Date() },
      });
    });
  }

  /** Returns false when the line isn't in this cart. */
  async setQuantity(
    cartId: string,
    itemId: string,
    quantity: number,
  ): Promise<boolean> {
    const { count } = await this.prisma.cartItem.updateMany({
      where: { id: itemId, cartId },
      data: { quantity },
    });
    return count === 1;
  }

  async removeItem(cartId: string, itemId: string): Promise<void> {
    await this.prisma.cartItem.deleteMany({ where: { id: itemId, cartId } });
  }

  /**
   * Moves a guest cart into the user's cart. With no user cart yet, the guest cart is simply
   * handed over; otherwise quantities are added line by line and the guest cart is deleted.
   */
  async mergeGuestIntoUser(guestCartId: string, userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // A page's loaders read the cart in parallel right after sign-in. Locking the guest
      // cart makes the second request wait, then find it already handed over; without it,
      // that request saw the handed-over cart as the user's, merged it into itself, then
      // deleted it.
      await tx.$executeRaw`SELECT 1 FROM carts WHERE id = ${guestCartId}::uuid FOR UPDATE`;
      const guest = await tx.cart.findFirst({
        where: { id: guestCartId, userId: null },
        include: { items: true },
      });
      if (!guest) return;
      const target = await tx.cart.findUnique({ where: { userId } });
      if (!target) {
        await tx.cart.update({ where: { id: guest.id }, data: { userId } });
        return;
      }
      for (const item of guest.items) {
        await addTo(
          tx,
          target.id,
          {
            productId: item.productId,
            configKey: item.configKey,
            selections: item.options as unknown as OptionSelection[],
          },
          item.quantity,
        );
      }
      await tx.cart.delete({ where: { id: guest.id } });
    });
  }
}

async function addTo(
  tx: Prisma.TransactionClient,
  cartId: string,
  line: LineKey,
  quantity: number,
): Promise<void> {
  const where = {
    cartId_productId_configKey: {
      cartId,
      productId: line.productId,
      configKey: line.configKey,
    },
  };
  const existing = await tx.cartItem.findUnique({ where });
  const total = Math.min(
    (existing?.quantity ?? 0) + quantity,
    CART_QUANTITY_MAX,
  );
  await tx.cartItem.upsert({
    where,
    create: {
      cartId,
      productId: line.productId,
      configKey: line.configKey,
      options: line.selections as unknown as Prisma.InputJsonValue,
      quantity: total,
    },
    update: { quantity: total },
  });
}
