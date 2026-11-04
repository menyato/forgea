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
import { QuotationLinkTokens } from '../authorization/quotation-link-tokens.js';
import { toPage } from '../common/pagination/keyset.js';
import { Prisma } from '../generated/prisma/client.js';
import { QuotationStatus, Role } from '../generated/prisma/enums.js';
import { Notifications } from '../mail/notifications.service.js';
import { CheckoutService } from '../orders/checkout.service.js';
import { LeadsService } from '../leads/leads.service.js';
import { StoreSettingsService } from '../store-settings/store-settings.service.js';
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

const NOT_FOUND = 'Quotation not found';

/**
 * Quotations (Odoo `sale.order` before confirmation): the team writes one for any email
 * address, sends it, and it is confirmed — by staff, or by the customer accepting it online —
 * into a normal order. The email carries a link that opens the quotation without an account;
 * accepting it needs one with that address (ordering always does). Every status change is
 * recorded by the database trigger, with who made it.
 */
@Injectable()
export class QuotationsService {
  constructor(
    private readonly quotations: QuotationsRepository,
    private readonly checkout: CheckoutService,
    private readonly notifications: Notifications,
    private readonly links: QuotationLinkTokens,
    private readonly store: StoreSettingsService,
    private readonly leads: LeadsService,
  ) {}

  counts(): Promise<Partial<Record<QuotationStatus, number>>> {
    return this.quotations.countByStatus();
  }

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

  /**
   * Emails it, in full, to the address it was written for, with a link that needs no account;
   * a draft becomes "sent" (a sent one is sent again, e.g. after a change).
   */
  async send(id: string, actorId: string): Promise<QuotationDetail> {
    const q = await this.require(id);
    if (
      q.status !== QuotationStatus.DRAFT &&
      q.status !== QuotationStatus.SENT &&
      q.status !== QuotationStatus.DECLINED
    ) {
      throw new ConflictException(
        'Only a draft, sent or declined quotation can be sent',
      );
    }
    // A declined one goes out again (changed, usually): it is open to them once more.
    if (q.status !== QuotationStatus.SENT) {
      await this.quotations.setStatus(
        id,
        [QuotationStatus.DRAFT, QuotationStatus.DECLINED],
        QuotationStatus.SENT,
        actorId,
        null,
      );
    }
    const [token, wording, store] = await Promise.all([
      this.links.issue(q.id, q.customerEmail, q.validUntil),
      this.store.quotationEmail(),
      this.store.get(),
    ]);
    const detail = toDetail(q);
    this.notifications.send('quotationSent', {
      to: q.customerEmail,
      name: q.customerName,
      number: q.number,
      total: detail.total,
      validUntil: q.validUntil,
      lines: detail.lines,
      note: q.note,
      delivery: q.delivery,
      token,
      wording,
      whatsappPhone: store.whatsappPhone,
    });
    if (q.leadId)
      await this.leads.quotationChanged(
        q.leadId,
        { kind: 'sent', number: q.number, total: detail.total },
        actorId,
      );
    return this.detail(id);
  }

  /** Staff confirm it (e.g. the customer said yes on the phone). */
  async confirm(id: string, actorId: string): Promise<CheckoutResult> {
    const q = await this.require(id);
    return this.place(await this.withAccount(q), actorId, [
      QuotationStatus.DRAFT,
      QuotationStatus.SENT,
      QuotationStatus.DECLINED,
    ]);
  }

  /**
   * The customer accepts it online. Only once it was sent to them: a draft (prices still being
   * worked out) is as invisible here as it is on their quotation page.
   */
  async accept(customerId: string, number: string): Promise<CheckoutResult> {
    const q = await this.quotations.findMine(customerId, number);
    if (!q || q.status === QuotationStatus.DRAFT) {
      throw new NotFoundException(NOT_FOUND);
    }
    return this.place({ ...q, customerId }, customerId, [QuotationStatus.SENT]);
  }

  /** The customer says no, from their account: the studio is told, the lead waits on the team. */
  async declineMine(
    customerId: string,
    number: string,
    reason: string | null,
  ): Promise<QuotationDetail> {
    const q = await this.quotations.findMine(customerId, number);
    if (!q || q.status === QuotationStatus.DRAFT) {
      throw new NotFoundException(NOT_FOUND);
    }
    return this.decline(q, customerId, reason);
  }

  /** The customer says no from the emailed link (no account needed: it commits them to nothing). */
  async declineByLink(
    token: string,
    reason: string | null,
  ): Promise<QuotationDetail> {
    const q = await this.fromLink(token);
    return this.decline(q, q.customerId, reason);
  }

  async mine(customerId: string, number: string): Promise<QuotationDetail> {
    const q = await this.quotations.findMine(customerId, number);
    if (!q || q.status === QuotationStatus.DRAFT) {
      throw new NotFoundException(NOT_FOUND);
    }
    return toDetail(q);
  }

  /** The emailed link: the quotation, for anyone holding the link. */
  async byLink(token: string): Promise<QuotationDetail> {
    return toDetail(await this.fromLink(token));
  }

  /**
   * Accepting from the emailed link. The signed-in account must have the address it was sent
   * to (the link alone proves nothing about who holds it); the quotation is then theirs.
   */
  async acceptByLink(token: string, userId: string): Promise<CheckoutResult> {
    const q = await this.fromLink(token);
    const user = await this.quotations.account(userId);
    if (
      !user ||
      user.disabledAt ||
      user.role !== Role.CUSTOMER ||
      user.email !== q.customerEmail
    ) {
      throw new ConflictException(
        `This quotation was sent to ${q.customerEmail}: sign in with that address to accept it`,
      );
    }
    if (q.customerId === null) {
      // Someone else may have linked it a moment ago; only then is it not ours to take.
      await this.quotations.linkCustomer(q.id, user.id);
    }
    const now = await this.require(q.id);
    if (now.customerId !== user.id) throw new NotFoundException(NOT_FOUND);
    return this.place({ ...now, customerId: user.id }, user.id, [
      QuotationStatus.SENT,
    ]);
  }

  async cancel(
    id: string,
    actorId: string,
    note: string | null,
  ): Promise<QuotationDetail> {
    const q = await this.require(id);
    const done = await this.quotations.setStatus(
      id,
      [QuotationStatus.DRAFT, QuotationStatus.SENT, QuotationStatus.DECLINED],
      QuotationStatus.CANCELLED,
      actorId,
      note,
    );
    if (!done)
      throw new ConflictException(
        'Only a draft, sent or declined quotation can be cancelled',
      );
    if (q.leadId)
      await this.leads.quotationChanged(
        q.leadId,
        { kind: 'cancelled', number: q.number },
        actorId,
      );
    return this.detail(id);
  }

  private async decline(
    q: QuotationRow,
    actorId: string | null,
    reason: string | null,
  ): Promise<QuotationDetail> {
    const done = await this.quotations.setStatus(
      q.id,
      [QuotationStatus.SENT],
      QuotationStatus.DECLINED,
      actorId,
      reason,
    );
    if (!done)
      throw new ConflictException(
        q.status === QuotationStatus.DECLINED
          ? 'You already declined this quotation'
          : 'This quotation can no longer be declined',
      );
    this.notifications.alertStudio(
      `Quotation ${q.number} declined`,
      [
        `${q.customerName} (${q.customerEmail}) declined quotation ${q.number}.`,
        reason ? `Their reason: ${reason}` : 'They gave no reason.',
        q.leadId
          ? 'Its lead is waiting for you: mark it as lost, or keep it open.'
          : 'You can change it and send it again.',
      ],
      q.leadId ? `/admin/leads/${q.leadId}` : `/admin/quotations/${q.id}`,
    );
    if (q.leadId)
      await this.leads.quotationChanged(
        q.leadId,
        { kind: 'declined', number: q.number, reason },
        actorId,
      );
    return this.detail(q.id);
  }

  /** A valid link to a quotation that was sent, still for the address in the link. */
  private async fromLink(token: string): Promise<QuotationRow> {
    const claims = await this.links.verify(token);
    const q = claims && (await this.quotations.findById(claims.quotationId));
    if (
      !claims ||
      !q ||
      q.status === QuotationStatus.DRAFT ||
      q.customerEmail !== claims.email
    ) {
      throw new NotFoundException(
        'This link is not valid any more. Ask the studio to send the quotation again.',
      );
    }
    return q;
  }

  /** The order needs an account: the existing one for the address, or a new one. */
  private async withAccount(
    q: QuotationRow,
  ): Promise<QuotationRow & { customerId: string }> {
    if (q.customerId !== null) return { ...q, customerId: q.customerId };
    const existing = await this.quotations.customerByEmail(q.customerEmail);
    if (existing && existing.role !== Role.CUSTOMER) {
      throw new BadRequestException(
        'This address belongs to a team account, not a customer',
      );
    }
    const customerId =
      existing?.id ??
      (
        await this.quotations.createCustomer(
          q.customerEmail,
          q.customerName,
          q.phone,
        )
      ).id;
    await this.quotations.linkCustomer(q.id, customerId);
    return { ...q, customerId };
  }

  private async place(
    q: QuotationRow & { customerId: string },
    actorId: string,
    openStatuses: QuotationStatus[],
  ): Promise<CheckoutResult> {
    const result = await this.placeOrder(q, actorId, openStatuses);
    if (q.leadId && q.status !== QuotationStatus.CONFIRMED)
      await this.leads.quotationChanged(
        q.leadId,
        { kind: 'accepted', number: q.number, orderNumber: result.orderNumber },
        actorId,
      );
    return result;
  }

  private placeOrder(
    q: QuotationRow & { customerId: string },
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
          description: withSize(l),
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

  /** Checks the address, products, sizes and lead, and computes the total. */
  private async prepare(dto: SaveQuotationDto): Promise<QuotationData> {
    const customer = await this.quotations.customerByEmail(dto.customerEmail);
    if (customer && customer.role !== Role.CUSTOMER) {
      throw new BadRequestException(
        'This address belongs to a team account, not a customer',
      );
    }
    if (customer?.disabledAt) {
      throw new BadRequestException('This customer account is switched off');
    }
    const productIds = [
      ...new Set(dto.lines.flatMap((l) => (l.productId ? [l.productId] : []))),
    ];
    if (
      (await this.quotations.productsExist(productIds)) !== productIds.length
    ) {
      throw new BadRequestException('One of the products does not exist');
    }
    const halfSized = dto.lines.findIndex(
      (l) => [l.sizeXcm, l.sizeYcm, l.sizeZcm].filter(Boolean).length % 3 !== 0,
    );
    if (halfSized >= 0) {
      throw new BadRequestException(
        `Line ${halfSized + 1}: give all three sizes (width, depth, height) or none`,
      );
    }
    if (dto.leadId && !(await this.quotations.leadExists(dto.leadId))) {
      throw new BadRequestException('Lead not found');
    }
    const total = dto.lines.reduce(
      (sum, l) => sum.plus(lineTotal(l)),
      new Prisma.Decimal(0),
    );
    return {
      customerId: customer?.id ?? null,
      customerEmail: dto.customerEmail,
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
        sizeXcm: l.sizeXcm ?? null,
        sizeYcm: l.sizeYcm ?? null,
        sizeZcm: l.sizeZcm ?? null,
      })),
    };
  }

  private async require(id: string): Promise<QuotationRow> {
    const q = await this.quotations.findById(id);
    if (!q) throw new NotFoundException(NOT_FOUND);
    return q;
  }
}

type LineRow = QuotationRow['lines'][number];

const sizeOf = (l: LineRow) =>
  l.sizeXcm && l.sizeYcm && l.sizeZcm
    ? {
        x: l.sizeXcm.toString(),
        y: l.sizeYcm.toString(),
        z: l.sizeZcm.toString(),
      }
    : null;

/** The order line keeps the size the customer agreed to, in its description. */
function withSize(l: LineRow): string {
  const size = sizeOf(l);
  return size
    ? `${l.description} (${size.x} × ${size.y} × ${size.z} cm)`
    : l.description;
}

function toListItem(q: QuotationRow): QuotationListItem {
  return {
    id: q.id,
    number: q.number,
    status: q.status,
    customer: {
      id: q.customer?.id ?? null,
      email: q.customerEmail,
      name: q.customer?.name ?? q.customerName,
    },
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
      size: sizeOf(l),
    })),
    history: q.statusHistory.map((h) => ({
      status: h.status,
      changedAt: h.changedAt.toISOString(),
      note: h.note,
    })),
  };
}
