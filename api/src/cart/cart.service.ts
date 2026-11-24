import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CartLine,
  CartView,
  ChosenOption,
  OptionSelection,
  DesignMeasurement,
  TextDesignInput,
} from '@forgea/types';
import { OffersService } from '../offers/offers.service.js';
import { PricingService } from '../pricing/pricing.service.js';
import { ProductConfigurator } from '../products/product-configurator.js';
import { ProductsRepository } from '../products/products.repository.js';
import {
  type Measurement,
  TextStudio,
} from '../text-studio/text-studio.service.js';
import {
  DesignSlots,
  type MeasuredSlotsResult,
  type OrderedSlot,
  orderedSlots,
} from '../text-studio/design-slots.js';
import type { SlotChoiceDto } from '@forgea/validation';
import { CartRepository, type CartRow } from './cart.repository.js';

/** Who the cart belongs to on this request: a signed-in user, a guest cookie, or both. */
export interface CartOwner {
  userId?: string | undefined;
  guestCartId?: string | undefined;
}

/** A line ready for checkout: with a personalised piece's design as just measured. */
export type CheckoutLine = CartLine & {
  measurement: Measurement | null;
  /** Its text and logo slots as just measured (none without). */
  slotsMeasured: MeasuredSlotsResult | null;
  /** The same, as the order keeps them (filled in at checkout). */
  slotsOrdered?: OrderedSlot[] | null;
};

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
    private readonly studio: TextStudio,
    private readonly slots: DesignSlots,
    private readonly offers: OffersService,
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
    design?: TextDesignInput,
    measured?: DesignMeasurement,
    slotChoices: readonly SlotChoiceDto[] = [],
    /** Claiming the free offer running for this product (one piece, priced 0). */
    freeOfferId?: string,
  ): Promise<CartResult> {
    const product = await this.products.findActive(productId);
    if (!product) throw new NotFoundException('This product is not available');
    // 400 with the reason when the offer isn't running for this piece now.
    if (freeOfferId) await this.offers.claimable(freeOfferId, productId);
    // 400 with a message for the shopper when a choice is missing or not offered.
    const configuration = this.configurator.configure(product, selections);
    // A personalised piece is checked before it goes in (400 if it can't be made), priced from
    // the browser's measurement when it sent one; checkout measures it again on the server.
    let measurement: Measurement | null = null;
    if (product.textStyle) {
      if (!design) throw new BadRequestException('Type your text first');
      measurement = await this.studio.measure(product, design, measured);
    } else if (design) {
      throw new BadRequestException('This product has no text to design');
    }
    // Its text and logos, checked and measured (400 if they can't be made).
    const slots = await this.slots.measure(product, slotChoices);
    const resolved = await this.which(owner);
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
        // Another text, font or colour is another line.
        configKey: [
          configuration.configKey,
          ...(measurement ? [designKey(measurement.design)] : []),
          // Another name or logo on it is another line too.
          ...(slots && Object.keys(slots.choices).length
            ? [`slots:${designKey(slots.choices)}`]
            : []),
          // The free piece is its own line, whatever else is in the cart.
          ...(freeOfferId ? [`free:${freeOfferId}`] : []),
        ].join('|'),
        selections: configuration.selections,
        design: measurement,
        slots,
        freeOfferId: freeOfferId ?? null,
      },
      freeOfferId ? 1 : quantity,
    );
    return {
      view: await this.reload(owner, newGuestCartId),
      clearGuestCookie: resolved.clearGuestCookie,
      ...(newGuestCartId ? { newGuestCartId } : {}),
    };
  }

  /**
   * Adds a product with choices given by name ({ group: "Colour", value: "Black" }), as an
   * order recorded them. Refuses (400) if the product or one of the choices is no longer sold.
   */
  async addByNames(
    owner: CartOwner,
    productId: string,
    quantity: number,
    chosen: readonly ChosenOption[],
    /** A personalised piece's design, as the order recorded it. */
    design?: TextDesignInput,
  ): Promise<CartResult> {
    const product = await this.products.findActive(productId);
    if (!product) throw new NotFoundException('no longer sold');
    const offered = this.configurator.offered(product);
    const selections: OptionSelection[] = [];
    for (const c of Array.isArray(chosen) ? chosen : []) {
      const option = offered.find((o) => o.name === c.group);
      if (!option)
        throw new BadRequestException(`${c.group} is no longer offered`);
      if (option.kind === 'TEXT') {
        selections.push({ groupId: option.groupId, text: c.value });
        continue;
      }
      // Sizes are recorded by their measurements ("18 × 12 × 9 cm"); orders from before
      // that wrote "Large (18 × 12 × 9 cm)", so the part in brackets counts too.
      const recorded = /\(([^()]+)\)$/.exec(c.value)?.[1];
      const choice = option.choices.find(
        (ch) =>
          ch.label === c.value ||
          (option.kind === 'SIZE' && ch.label === recorded),
      );
      if (!choice)
        throw new BadRequestException(
          `${c.group} ${c.value} is no longer offered`,
        );
      selections.push({ groupId: option.groupId, valueId: choice.id });
    }
    return this.add(owner, productId, quantity, selections, design);
  }

  async setQuantity(
    owner: CartOwner,
    itemId: string,
    quantity: number,
  ): Promise<CartResult> {
    const { cart, clearGuestCookie } = await this.which(owner);
    if (!cart || !(await this.carts.setQuantity(cart.id, itemId, quantity))) {
      throw new NotFoundException('This item is not in your cart');
    }
    return { view: await this.reload(owner), clearGuestCookie };
  }

  async remove(owner: CartOwner, itemId: string): Promise<CartResult> {
    const { cart, clearGuestCookie } = await this.which(owner);
    if (cart) await this.carts.removeItem(cart.id, itemId);
    return { view: await this.reload(owner), clearGuestCookie };
  }

  /**
   * Priced lines for checkout. Lines whose product was hidden, or whose options are no
   * longer offered, are dropped and must be added again.
   */
  async linesForCheckout(
    owner: CartOwner,
  ): Promise<{ cartId: string; lines: CheckoutLine[] }> {
    const { cart } = await this.resolve(owner);
    // One reading of today's costs for the whole checkout.
    const calculator = await this.pricing.costCalculator();
    const lines = await this.priced(cart, calculator);
    if (!cart || lines.length === 0)
      throw new BadRequestException('Your cart is empty');
    // Personalised pieces are made again, so the order has today's grams and price.
    for (const line of lines) {
      if (!line.measurement) continue;
      const product = cart.items.find((i) => i.id === line.id)!.product;
      try {
        line.measurement = await this.studio.measure(
          product,
          line.measurement.design,
        );
      } catch (error) {
        if (error instanceof BadRequestException)
          throw new BadRequestException(`${line.name}: ${error.message}`);
        throw error;
      }
      line.unitPrice = this.studio.price(calculator, product, line.measurement);
      line.design = line.measurement.summary;
    }
    // Text and logos are made again too: today's fonts, logos and price.
    for (const line of lines) {
      const item = cart.items.find((i) => i.id === line.id)!;
      if (this.slots.of(item.product).length === 0) continue;
      const choices = Object.entries(line.slotsMeasured?.choices ?? {}).map(
        ([slotId, c]) => ({ slotId, ...c }),
      );
      try {
        line.slotsMeasured = await this.slots.measure(item.product, choices);
      } catch (error) {
        if (error instanceof BadRequestException)
          throw new BadRequestException(`${line.name}: ${error.message}`);
        throw error;
      }
      if (!line.measurement) {
        const configuration = this.configureSaved(item.product, item.options);
        if (configuration)
          line.unitPrice = this.configurator.unitPrice(
            calculator,
            item.product,
            {
              ...configuration,
              ...(line.slotsMeasured
                ? {
                    extra: {
                      grams: line.slotsMeasured.grams,
                      printHours: line.slotsMeasured.printHours,
                    },
                  }
                : {}),
            },
          );
      }
      line.slots = line.slotsMeasured?.summary ?? [];
      line.slotsOrdered = orderedSlots(item.product, line.slotsMeasured);
    }
    // A free piece stays free while its offer runs (checkout checks the offer again).
    const free = await this.offers.running(
      lines.flatMap((l) => (l.freeOfferId ? [l.freeOfferId] : [])),
    );
    for (const line of lines)
      if (line.freeOfferId && free.has(line.freeOfferId))
        line.unitPrice = '0.00';
    return { cartId: cart.id, lines };
  }

  /**
   * Finds the cart for this request, with everything in it. A signed-in user's guest cart
   * (from before they signed in) is merged into their account here, so the cart follows them
   * on login.
   */
  private async resolve(
    owner: CartOwner,
  ): Promise<{ cart: CartRow | null; clearGuestCookie: boolean }> {
    const clearGuestCookie = await this.merge(owner);
    return {
      cart: owner.userId
        ? await this.carts.findUserCart(owner.userId)
        : owner.guestCartId
          ? await this.carts.findGuestCart(owner.guestCartId)
          : null,
      clearGuestCookie,
    };
  }

  /** As `resolve`, only which cart it is: a change reads the whole cart once, afterwards. */
  private async which(
    owner: CartOwner,
  ): Promise<{ cart: { id: string } | null; clearGuestCookie: boolean }> {
    const clearGuestCookie = await this.merge(owner);
    return {
      cart: owner.userId
        ? await this.carts.findUserCartId(owner.userId)
        : owner.guestCartId
          ? await this.carts.findGuestCartId(owner.guestCartId)
          : null,
      clearGuestCookie,
    };
  }

  /** A signed-in user's guest cart joins theirs; true when the guest cookie should go. */
  private async merge(owner: CartOwner): Promise<boolean> {
    if (!owner.userId || owner.guestCartId === undefined) return false;
    await this.carts.mergeGuestIntoUser(owner.guestCartId, owner.userId);
    return true;
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
    // The browser sees how a design reads, never what it takes to print.
    const lines = (await this.priced(cart)).map((l) => {
      const {
        measurement: _,
        slotsMeasured: __,
        slotsOrdered: ___,
        ...line
      } = l;
      return line;
    });
    return { lines, itemCount: lines.reduce((n, l) => n + l.quantity, 0) };
  }

  private async priced(
    cart: CartRow | null,
    /** Today's costs, when the caller has already read them. */
    known?: Awaited<ReturnType<PricingService['costCalculator']>>,
  ): Promise<CheckoutLine[]> {
    const items = cart?.items.filter((i) => i.product.active) ?? [];
    if (items.length === 0) return [];
    const calculator = known ?? (await this.pricing.costCalculator());
    // Lines claimed under an offer cost nothing while it runs; after, their usual price.
    const free = await this.offers.running(
      items.flatMap((i) => (i.freeOfferId ? [i.freeOfferId] : [])),
    );
    return items.flatMap((i): CheckoutLine[] => {
      const configuration = this.configureSaved(i.product, i.options);
      if (!configuration) return [];
      // A personalised piece keeps its measurement; a product no longer personalised (or a
      // line from before it was) can't be bought as it is.
      const measurement = (i.design as Measurement | null) ?? null;
      if (!!i.product.textStyle !== !!measurement) return [];
      const slotsMeasured =
        (i.slotChoices as MeasuredSlotsResult | null) ?? null;
      const priced = slotsMeasured
        ? {
            ...configuration,
            extra: {
              grams: slotsMeasured.grams,
              printHours: slotsMeasured.printHours,
            },
          }
        : configuration;
      return [
        {
          id: i.id,
          productId: i.productId,
          slug: i.product.slug,
          name: i.product.name,
          materialCode: i.product.material.code,
          unitPrice:
            i.freeOfferId && free.has(i.freeOfferId)
              ? '0.00'
              : measurement
                ? this.studio.price(calculator, i.product, measurement)
                : this.configurator.unitPrice(calculator, i.product, priced),
          quantity: i.quantity,
          isCustom: i.product.isCustom,
          options: configuration.chosen,
          design: measurement?.summary ?? null,
          slots: slotsMeasured?.summary ?? [],
          freeOfferId: i.freeOfferId,
          measurement,
          slotsMeasured,
        },
      ];
    });
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

/** A design's identity: the same text, fonts and colours make the same line. */
function designKey(design: object): string {
  return createHash('sha256')
    .update(JSON.stringify(design))
    .digest('hex')
    .slice(0, 24);
}
