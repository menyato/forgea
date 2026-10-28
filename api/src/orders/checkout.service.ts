import { ConflictException, Injectable } from '@nestjs/common';
import { type OrderLineInput, orderLinesFromCart } from '@forgea/pricing';
import type { CheckoutResult } from '@forgea/types';
import type { CheckoutDto } from '@forgea/validation';
import { CartService } from '../cart/cart.service.js';
import { CurrenciesService } from '../currencies/currencies.service.js';
import type { Order } from '../generated/prisma/client.js';
import { OrderStatus } from '../generated/prisma/enums.js';
import { PricingService } from '../pricing/pricing.service.js';
import { Notifications } from '../mail/notifications.service.js';
import { StoreSettingsService } from '../store-settings/store-settings.service.js';
import { UsersRepository } from '../users/users.repository.js';
import {
  type OrderLineSource,
  OrdersRepository,
  QuoteNoLongerOpenError,
} from './orders.repository.js';

/** A custom request whose quote the customer accepts. */
export interface AcceptedQuote {
  id: string;
  requestNumber: string;
  title: string;
  /** USD, for the whole request. */
  quotedPrice: string;
}

/** A quotation being confirmed; unit prices already include the line discounts. */
export interface QuotationToOrder {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  phone: string;
  paymentMethod: CheckoutDto['paymentMethod'];
  delivery: boolean;
  city: string | null;
  addressLine: string | null;
  lines: {
    id: string;
    productId: string | null;
    description: string;
    quantity: number;
    unitPrice: string;
    isCustom: boolean;
  }[];
}

/**
 * Turns the signed-in customer's cart — or a custom request's quote — into an order.
 * Everything they pay is recomputed here from the database — prices, discounts, fees,
 * deposit and currency conversion — never taken from the browser.
 */
@Injectable()
export class CheckoutService {
  constructor(
    private readonly cart: CartService,
    private readonly pricing: PricingService,
    private readonly currencies: CurrenciesService,
    private readonly orders: OrdersRepository,
    private readonly users: UsersRepository,
    private readonly notifications: Notifications,
    private readonly store: StoreSettingsService,
  ) {}

  /** `guestCartId`: a cart filled before signing in; it is merged into the account first. */
  async checkout(
    dto: CheckoutDto,
    userId: string,
    guestCartId: string | undefined,
  ): Promise<CheckoutResult> {
    const repeated = await this.repeated(dto, userId);
    if (repeated) return repeated;
    const { cartId, lines } = await this.cart.linesForCheckout({
      userId,
      guestCartId,
    });
    return this.place(dto, userId, {
      cartId,
      lines: orderLinesFromCart(lines),
      sources: lines,
      rush: dto.rush,
    });
  }

  /**
   * Accepting a custom request's quote: one made-to-order line at the quoted price, so the
   * deposit applies. Delivery and payment are chosen as at checkout; rush doesn't apply (the
   * quote already covers timing).
   */
  async acceptQuote(
    dto: CheckoutDto,
    userId: string,
    request: AcceptedQuote,
  ): Promise<CheckoutResult> {
    const repeated = await this.repeated(dto, userId);
    if (repeated) return repeated;
    try {
      return await this.place(dto, userId, {
        cartId: null,
        lines: [
          {
            id: request.id,
            name: `Custom: ${request.title}`,
            unitPrice: request.quotedPrice,
            quantity: 1,
            isCustom: true,
          },
        ],
        sources: [
          {
            id: request.id,
            productId: null,
            options: [{ group: 'Request', value: request.requestNumber }],
          },
        ],
        rush: false,
        source: { customRequestId: request.id },
      });
    } catch (error) {
      if (error instanceof QuoteNoLongerOpenError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  /**
   * Confirming a quotation (by staff, or the customer accepting it online): its lines at
   * their discounted prices, delivered and paid as it says. The quotation's id is the
   * idempotency key, so confirming twice returns the same order.
   */
  async placeQuotation(
    q: QuotationToOrder,
    actorId: string,
  ): Promise<CheckoutResult> {
    const dto: CheckoutDto = {
      idempotencyKey: q.id,
      name: q.customerName,
      phone: q.phone,
      paymentMethod: q.paymentMethod,
      currency: 'USD',
      delivery: q.delivery,
      rush: false,
      ...(q.city ? { city: q.city } : {}),
      ...(q.addressLine ? { addressLine: q.addressLine } : {}),
    };
    const repeated = await this.repeated(dto, q.customerId);
    if (repeated) return repeated;
    try {
      return await this.place(dto, q.customerId, {
        cartId: null,
        lines: q.lines.map((l) => ({
          id: l.id,
          name: l.description,
          unitPrice: l.unitPrice,
          quantity: l.quantity,
          isCustom: l.isCustom,
        })),
        sources: q.lines.map((l) => ({
          id: l.id,
          productId: l.productId,
          options: [{ group: 'Quotation', value: q.number }],
        })),
        rush: false,
        bulkDiscounts: false,
        source: { quotationId: q.id },
        actorId,
      });
    } catch (error) {
      if (error instanceof QuoteNoLongerOpenError) {
        throw new ConflictException(
          'This quotation can no longer be confirmed (it expired, or was confirmed or cancelled)',
        );
      }
      throw error;
    }
  }

  /** A repeated submit (double click, retry after a timeout) returns the order it created. */
  private async repeated(
    dto: CheckoutDto,
    userId: string,
  ): Promise<CheckoutResult | null> {
    const existing = await this.orders.findByIdempotencyKey(dto.idempotencyKey);
    if (!existing) return null;
    if (existing.userId !== userId)
      throw new ConflictException('This checkout was already used');
    return toResult(existing);
  }

  private async place(
    dto: CheckoutDto,
    userId: string,
    o: {
      cartId: string | null;
      lines: OrderLineInput[];
      sources: readonly OrderLineSource[];
      rush: boolean;
      source?: { customRequestId: string } | { quotationId: string };
      /** Quotations carry their own negotiated discounts: no automatic bulk discount. */
      bulkDiscounts?: boolean;
      actorId?: string;
    },
  ): Promise<CheckoutResult> {
    const quote = await this.pricing.quoteOrder(
      o.lines,
      { rush: o.rush, delivery: dto.delivery },
      { bulkDiscounts: o.bulkDiscounts ?? true },
    );
    const converter = await this.currencies.converterFor(dto.currency);
    const depositDue = Number(quote.depositRequired) > 0;

    const order = await this.orders.createFromCheckout({
      cartId: o.cartId,
      userId,
      status: depositDue ? OrderStatus.AWAITING_DEPOSIT : OrderStatus.PENDING,
      dto,
      rush: o.rush,
      quote,
      lines: o.sources,
      currency: {
        code: converter.code,
        rate: converter.exchangeRate,
        total: converter.convert(quote.total),
        deposit: converter.convert(quote.depositRequired),
      },
      ...(o.source ? { source: o.source } : {}),
      ...(o.actorId ? { actorId: o.actorId } : {}),
    });
    // Remembered so the next checkout is pre-filled and staff can call before delivering.
    const user = await this.users.updateContact(userId, {
      name: dto.name,
      phone: dto.phone,
    });
    this.notifications.send('orderPlaced', {
      to: user.email,
      name: dto.name,
      orderNumber: order.orderNumber,
      total: order.total.toFixed(2),
      paymentMethod: order.paymentMethod,
      depositRequired: order.depositRequired.toFixed(2),
      transferPhone: (await this.store.get()).transferPhone,
    });
    return toResult(order);
  }
}

function toResult(o: Order): CheckoutResult {
  return {
    orderNumber: o.orderNumber,
    status: o.status,
    paymentMethod: o.paymentMethod,
    total: o.total.toFixed(2),
    depositRequired: o.depositRequired.toFixed(2),
    currencyCode: o.currencyCode,
    exchangeRate: o.exchangeRate.toString(),
    totalInCurrency: o.totalInCurrency.toString(),
    depositInCurrency: o.depositInCurrency.toString(),
  };
}
