import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CartLine, CartView, OptionSelection } from '@forgea/types';
import { PricingService } from '../pricing/pricing.service.js';
import { ProductConfigurator } from '../products/product-configurator.js';
import { ProductsRepository } from '../products/products.repository.js';
import { CartRepository, type CartRow } from './cart.repository.js';

/** Who the cart belongs to on this request: a signed-in user, a guest cookie, or both. */
export interface CartOwner {
  userId?: string | undefined;
  guestCartId?: string | undefined;
}

export interface CartResult {
  view: CartView;
  /** Set when a new guest cart was created and the cookie must be issued. */
  newGuestCartId?: string;
  /** True when the guest cookie should be cleared (it was merged into the user's cart). */
  clearGuestCookie: boolean;
}

@Injectable()
export class CartService {
  constructor(
    private readonly carts: CartRepository,
    private readonly pricing: PricingService,
    private readonly products: ProductsRepository,
    private readonly configurator: ProductConfigurator,
  ) {}

  async view(owner: CartOwner): Promise<CartResult> {
    const { cart, clearGuestCookie } = await this.resolve(owner);
    return { view: await this.toView(cart), clearGuestCookie };
  }

  async add(
    owner: CartOwner,
    productId: string,
    quantity: number,
    selections: readonly OptionSelection[],
  ): Promise<CartResult> {
    const product = await this.products.findActive(productId);
    if (!product) throw new NotFoundException('This product is not available');
    // 400 with a message for the shopper when a choice is missing or not offered.
    const configuration = this.configurator.configure(product, selections);
    const resolved = await this.resolve(owner);
    let cart = resolved.cart;
    let newGuestCartId: string | undefined;
    if (!cart) {
      cart = owner.userId
        ? await this.carts.userCart(owner.userId)
        : await this.carts.createGuestCart();
      if (!owner.userId) newGuestCartId = cart.id;
    }
    await this.carts.addItem(
      cart.id,
      {
        productId,
        configKey: configuration.configKey,
        selections: configuration.selections,
      },
      quantity,
    );
    return {
      view: await this.reload(owner, newGuestCartId),
      clearGuestCookie: resolved.clearGuestCookie,
      ...(newGuestCartId ? { newGuestCartId } : {}),
    };
  }

  async setQuantity(
    owner: CartOwner,
    itemId: string,
    quantity: number,
  ): Promise<CartResult> {
    const { cart, clearGuestCookie } = await this.resolve(owner);
    if (!cart || !(await this.carts.setQuantity(cart.id, itemId, quantity))) {
      throw new NotFoundException('This item is not in your cart');
    }
    return { view: await this.reload(owner), clearGuestCookie };
  }

  async remove(owner: CartOwner, itemId: string): Promise<CartResult> {
    const { cart, clearGuestCookie } = await this.resolve(owner);
    if (cart) await this.carts.removeItem(cart.id, itemId);
    return { view: await this.reload(owner), clearGuestCookie };
  }

  /**
   * Priced lines for checkout. Lines whose product was hidden, or whose options are no
   * longer offered, are dropped and must be added again.
   */
  async linesForCheckout(
    owner: CartOwner,
  ): Promise<{ cartId: string; lines: CartLine[] }> {
    const { cart } = await this.resolve(owner);
    const view = await this.toView(cart);
    if (!cart || view.lines.length === 0)
      throw new BadRequestException('Your cart is empty');
    return { cartId: cart.id, lines: view.lines };
  }

  /**
   * Finds the cart for this request. A signed-in user's guest cart (from before they signed
   * in) is merged into their account here, so the cart follows them on login.
   */
  private async resolve(
    owner: CartOwner,
  ): Promise<{ cart: CartRow | null; clearGuestCookie: boolean }> {
    if (owner.userId) {
      if (owner.guestCartId) {
        await this.carts.mergeGuestIntoUser(owner.guestCartId, owner.userId);
      }
      return {
        cart: await this.carts.findUserCart(owner.userId),
        clearGuestCookie: owner.guestCartId !== undefined,
      };
    }
    return {
      cart: owner.guestCartId
        ? await this.carts.findGuestCart(owner.guestCartId)
        : null,
      clearGuestCookie: false,
    };
  }

  private async reload(
    owner: CartOwner,
    newGuestCartId?: string,
  ): Promise<CartView> {
    if (owner.userId)
      return this.toView(await this.carts.findUserCart(owner.userId));
    const id = newGuestCartId ?? owner.guestCartId;
    return this.toView(id ? await this.carts.findGuestCart(id) : null);
  }

  private async toView(cart: CartRow | null): Promise<CartView> {
    const items = cart?.items.filter((i) => i.product.active) ?? [];
    if (items.length === 0) return { lines: [], itemCount: 0 };
    const calculator = await this.pricing.costCalculator();
    const lines = items.flatMap((i): CartLine[] => {
      const configuration = this.configureSaved(i.product, i.options);
      if (!configuration) return [];
      return [
        {
          id: i.id,
          productId: i.productId,
          slug: i.product.slug,
          name: i.product.name,
          materialCode: i.product.material.code,
          unitPrice: this.configurator.unitPrice(
            calculator,
            i.product,
            configuration,
          ),
          quantity: i.quantity,
          isCustom: i.product.isCustom,
          options: configuration.chosen,
        },
      ];
    });
    return { lines, itemCount: lines.reduce((n, l) => n + l.quantity, 0) };
  }

  /** The line's saved choices, or null if the product no longer offers them. */
  private configureSaved(
    product: CartRow['items'][number]['product'],
    saved: unknown,
  ) {
    try {
      return this.configurator.configure(product, saved as OptionSelection[]);
    } catch (error) {
      if (error instanceof BadRequestException) return null;
      throw error;
    }
  }
}
