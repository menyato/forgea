import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CheckoutResult,
  Page,
  QuotationDetail,
  QuotationListItem,
} from '@forgea/types';
import type { QuotationListQuery, SaveQuotationDto } from '@forgea/validation';
import { toPage } from '../common/pagination/keyset.js';
import { Prisma } from '../generated/prisma/client.js';
import { QuotationStatus } from '../generated/prisma/enums.js';
import { Notifications } from '../mail/notifications.service.js';
import { CheckoutService } from '../orders/checkout.service.js';
import {
  type QuotationData,
  type QuotationRow,
  QuotationsRepository,
} from './quotations.repository.js';

/** The discounted unit price, to the cent: what the order line gets once confirmed. */
const discountedUnit = (l: { unitPrice: string; discountPercent: string }) =>
  new Prisma.Decimal(l.unitPrice)
    .times(new Prisma.Decimal(100).minus(l.discountPercent))
    .div(100)
    .toDecimalPlaces(2)
    .toFixed(2);

/**
 * The line's total exactly as the order will compute it (the rounded unit price × quantity),
 * so the quotation the customer accepts and the order they are charged always agree.
 */
const lineTotal = (l: {
  quantity: number;
  unitPrice: string;
  discountPercent: string;
}) => new Prisma.Decimal(discountedUnit(l)).times(l.quantity);

const todayUtc = () => new Date(new Date().toISOString().slice(0, 10));

/**
 * Quotations (Odoo `sale.order` before confirmation): the team writes one, sends it, and it
 * is confirmed — by staff, or by the customer accepting it online — into a normal order.
 * Every status change is recorded by the database trigger, with who made it.
 */
@Injectable()
export class QuotationsService {
  constructor(
    private readonly quotations: QuotationsRepository,
    private readonly checkout: CheckoutService,
    private readonly notifications: Notifications,
  ) {}

  async list(query: QuotationListQuery): Promise<Page<QuotationListItem>> {
    return toPage(await this.quotations.list(query), toListItem);
  }

  async detail(id: string): Promise<QuotationDetail> {
    return toDetail(await this.require(id));
  }

  async create(
    dto: SaveQuotationDto,
    actorId: string,
  ): Promise<QuotationDetail> {
    const data = await this.prepare(dto);
    return toDetail(await this.quotations.create(data, actorId));
  }

  async update(id: string, dto: SaveQuotationDto): Promise<QuotationDetail> {
    await this.require(id);
    if (!(await this.quotations.update(id, await this.prepare(dto)))) {
      throw new ConflictException(
        'A confirmed or cancelled quotation can no longer change',
      );
    }
    return this.detail(id);
  }

  /** Emails the customer a link to it; a draft becomes "sent" (a sent one is sent again). */
  async send(id: string, actorId: string): Promise<QuotationDetail> {
    const q = await this.require(id);
    if (
      q.status !== QuotationStatus.DRAFT &&
      q.status !== QuotationStatus.SENT
    ) {
      throw new ConflictException('Only a draft or sent quotation can be sent');
    }
    if (q.status === QuotationStatus.DRAFT) {
      await this.quotations.setStatus(
        id,
        [QuotationStatus.DRAFT],
        QuotationStatus.SENT,
        actorId,
        null,
      );
    }
    this.notifications.send('quotationSent', {
      to: q.customer.email,
      number: q.number,
      total: q.total.toFixed(2),
      validUntil: q.validUntil,
    });
    return this.detail(id);
  }

  /** Staff confirm it (e.g. the customer said yes on the phone). */
  async confirm(id: string, actorId: string): Promise<CheckoutResult> {
    return this.place(await this.require(id), actorId, [
      QuotationStatus.DRAFT,
      QuotationStatus.SENT,
    ]);
  }

  /**
   * The customer accepts it online. Only once it was sent to them: a draft (prices still being
   * worked out) is as invisible here as it is on their quotation page.
   */
  async accept(customerId: string, number: string): Promise<CheckoutResult> {
    const q = await this.quotations.findMine(customerId, number);
    if (!q || q.status === QuotationStatus.DRAFT) {
      throw new NotFoundException('Quotation not found');
    }
    return this.place(q, customerId, [QuotationStatus.SENT]);
  }

  async mine(customerId: string, number: string): Promise<QuotationDetail> {
    const q = await this.quotations.findMine(customerId, number);
    if (!q || q.status === QuotationStatus.DRAFT) {
      throw new NotFoundException('Quotation not found');
    }
    return toDetail(q);
  }

  async cancel(
    id: string,
    actorId: string,
    note: string | null,
  ): Promise<QuotationDetail> {
    await this.require(id);
    const done = await this.quotations.setStatus(
      id,
      [QuotationStatus.DRAFT, QuotationStatus.SENT],
      QuotationStatus.CANCELLED,
      actorId,
      note,
    );
    if (!done)
      throw new ConflictException(
        'Only a draft or sent quotation can be cancelled',
      );
    return this.detail(id);
  }

  private place(
    q: QuotationRow,
    actorId: string,
    openStatuses: QuotationStatus[],
  ): Promise<CheckoutResult> {
    if (q.status === QuotationStatus.CANCELLED) {
      throw new ConflictException('This quotation was cancelled');
    }
    if (q.status !== QuotationStatus.CONFIRMED && q.validUntil < todayUtc()) {
      throw new ConflictException(
        'This quotation has expired; ask the studio for a new date',
      );
    }
    return this.checkout.placeQuotation(
      {
        id: q.id,
        number: q.number,
        customerId: q.customerId,
        customerName: q.customerName,
        phone: q.phone,
        paymentMethod: q.paymentMethod,
        delivery: q.delivery,
        city: q.city,
        addressLine: q.addressLine,
        lines: q.lines.map((l) => ({
          id: l.id,
          productId: l.productId,
          description: l.description,
          quantity: l.quantity,
          unitPrice: discountedUnit({
            unitPrice: l.unitPrice.toFixed(2),
            discountPercent: l.discountPercent.toString(),
          }),
          isCustom: l.isCustom,
        })),
      },
      actorId,
      openStatuses,
    );
  }

  /** Checks the customer account, products and lead, and computes the total. */
  private async prepare(dto: SaveQuotationDto): Promise<QuotationData> {
    const customer = await this.quotations.customerByEmail(dto.customerEmail);
    if (!customer || customer.disabledAt) {
      throw new BadRequestException(
        'No account with this email: ask the customer to create one on the site first',
      );
    }
    const productIds = [
      ...new Set(dto.lines.flatMap((l) => (l.productId ? [l.productId] : []))),
    ];
    if (
      (await this.quotations.productsExist(productIds)) !== productIds.length
    ) {
      throw new BadRequestException('One of the products does not exist');
    }
    if (dto.leadId && !(await this.quotations.leadExists(dto.leadId))) {
      throw new BadRequestException('Lead not found');
    }
    const total = dto.lines.reduce(
      (sum, l) => sum.plus(lineTotal(l)),
      new Prisma.Decimal(0),
    );
    return {
      customerId: customer.id,
      leadId: dto.leadId ?? null,
      validUntil: new Date(dto.validUntil),
      note: dto.note ?? null,
      customerName: dto.customerName,
      phone: dto.phone,
      paymentMethod: dto.paymentMethod,
      delivery: dto.delivery,
      city: dto.delivery ? (dto.city ?? null) : null,
      addressLine: dto.delivery ? (dto.addressLine ?? null) : null,
      total: total.toFixed(2),
      lines: dto.lines.map((l) => ({
        productId: l.productId ?? null,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent,
        isCustom: l.isCustom,
      })),
    };
  }

  private async require(id: string): Promise<QuotationRow> {
    const q = await this.quotations.findById(id);
    if (!q) throw new NotFoundException('Quotation not found');
    return q;
  }
}

function toListItem(q: QuotationRow): QuotationListItem {
  return {
    id: q.id,
    number: q.number,
    status: q.status,
    customer: q.customer,
    total: q.total.toFixed(2),
    validUntil: q.validUntil.toISOString().slice(0, 10),
    expired:
      (q.status === QuotationStatus.DRAFT ||
        q.status === QuotationStatus.SENT) &&
      q.validUntil < todayUtc(),
    orderNumber: q.order?.orderNumber ?? null,
    createdAt: q.createdAt.toISOString(),
  };
}

function toDetail(q: QuotationRow): QuotationDetail {
  return {
    ...toListItem(q),
    leadId: q.leadId,
    note: q.note,
    customerName: q.customerName,
    phone: q.phone,
    paymentMethod: q.paymentMethod,
    delivery: q.delivery,
    city: q.city,
    addressLine: q.addressLine,
    lines: q.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice.toFixed(2),
      discountPercent: l.discountPercent.toString(),
      lineTotal: lineTotal({
        quantity: l.quantity,
        unitPrice: l.unitPrice.toFixed(2),
        discountPercent: l.discountPercent.toString(),
      }).toFixed(2),
      isCustom: l.isCustom,
    })),
    history: q.statusHistory.map((h) => ({
      status: h.status,
      changedAt: h.changedAt.toISOString(),
      note: h.note,
    })),
  };
}
