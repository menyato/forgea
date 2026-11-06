import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { InvoiceCounts, InvoiceListItem, Page } from '@forgea/types';
import type {
  CreateInvoiceDto,
  InvoiceDatesDto,
  InvoiceListQuery,
  RecordPaymentDto,
} from '@forgea/validation';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  AccountType,
  EntryType,
  InvoiceKind,
  OrderStatus,
  PaymentMethod,
} from '../generated/prisma/enums.js';
import { InvoiceListRepository } from './invoice-list.repository.js';
import { paymentState, splitTaxIncluded, type Amount } from './ledger-math.js';
import { Ledger, type NewLine } from './ledger.service.js';
import { studioToday } from '../common/studio-day.js';
import { claimRequestKey } from '../common/request-key.js';

const withLines = {
  customer: { select: { id: true, email: true, name: true } },
  order: { select: { orderNumber: true } },
  // The credit note that reversed this invoice, if any.
  reversal: { select: { number: true } },
  lines: {
    include: {
      account: { select: { type: true } },
      asDebit: {
        include: {
          creditLine: { select: { entry: { select: { type: true } } } },
        },
      },
      asCredit: true,
    },
  },
} as const satisfies Prisma.JournalEntryInclude;
type EntryRow = Prisma.JournalEntryGetPayload<{ include: typeof withLines }>;

const D = (v: Amount) => new Prisma.Decimal(v);

/** A lock held until the transaction ends, on one order or invoice (by name). */
async function lock(tx: Prisma.TransactionClient, name: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${name}, 0))`;
}
const today = () => studioToday();
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** An invoice's dates, checked: dated today or earlier, due on or after its date. */
function invoiceDates(dto: CreateInvoiceDto | InvoiceDatesDto = {}): {
  date: Date;
  dueDate: Date;
} {
  const date = dto.date ? new Date(dto.date) : today();
  const dueDate = dto.dueDate ? new Date(dto.dueDate) : date;
  if (Number.isNaN(date.getTime()) || Number.isNaN(dueDate.getTime()))
    throw new BadRequestException('Enter real dates');
  if (date > today())
    throw new BadRequestException('An invoice cannot be dated in the future');
  if (dueDate < date)
    throw new BadRequestException(
      'The due date cannot be before the invoice date',
    );
  return { date, dueDate };
}

/**
 * Invoices and payments for orders (Odoo's invoicing from sales orders, simplified):
 *
 * - A **deposit invoice** when the deposit arrives: owed to the customer until delivery
 *   (Customer deposits, a liability), with its share of tax.
 * - The **final invoice** on delivery: every line at its price (tax split out when a sales
 *   tax is set), minus the deposit already invoiced.
 * - **Payments** settle invoices (matched on the receivable account); **credit notes**
 *   reverse them.
 *
 * Shop prices include the sales tax, so totals never change when the owner turns a tax on.
 */
@Injectable()
export class Invoicing {
  private readonly logger = new Logger(Invoicing.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: Ledger,
    private readonly listing: InvoiceListRepository,
  ) {}

  /** Called after an order's status changes: invoices and payments that follow from it. */
  async onOrderStatus(
    orderId: string,
    from: OrderStatus,
    to: OrderStatus,
    actorId: string,
  ): Promise<void> {
    try {
      // A cancelled order is not invoiced: drafts made for it go.
      if (to === OrderStatus.CANCELLED) {
        await this.prisma.journalEntry.deleteMany({
          where: { orderId, state: 'DRAFT' },
        });
        return;
      }
      if (
        from === OrderStatus.AWAITING_DEPOSIT &&
        to === OrderStatus.CONFIRMED
      ) {
        const invoice = await this.depositInvoice(orderId, actorId);
        // Deposits are paid by money transfer (see checkout).
        await this.recordPayment(
          {
            invoiceId: invoice.id,
            amount: invoice.residual,
            method: 'BANK',
            date: today().toISOString().slice(0, 10),
          },
          actorId,
        );
      }
      if (to === OrderStatus.DELIVERED) {
        const invoice = await this.finalInvoice(orderId, actorId);
        const order = await this.prisma.order.findUniqueOrThrow({
          where: { id: orderId },
        });
        // Cash on delivery: the courier collected the rest.
        if (
          order.paymentMethod === PaymentMethod.COD &&
          D(invoice.residual).gt(0)
        ) {
          await this.recordPayment(
            {
              invoiceId: invoice.id,
              amount: invoice.residual,
              method: 'CASH',
              date: today().toISOString().slice(0, 10),
            },
            actorId,
          );
        }
      }
    } catch (error) {
      // The order's change stands; the team sees the missing invoice on the order and can
      // create it by hand (e.g. after moving the lock date).
      this.logger.warn(
        `Invoicing for order ${orderId} after ${to}: ${String(error)}`,
      );
    }
  }

  async forOrder(orderId: string): Promise<InvoiceListItem[]> {
    const entries = await this.prisma.journalEntry.findMany({
      where: {
        orderId,
        type: { in: [EntryType.INVOICE, EntryType.CREDIT_NOTE] },
      },
      orderBy: { createdAt: 'asc' },
      include: withLines,
    });
    return entries.map(toInvoiceItem);
  }

  /** Several orders' invoices in one query, by order id (oldest first in each). */
  async forOrders(
    orderIds: readonly string[],
  ): Promise<Map<string, InvoiceListItem[]>> {
    const byOrder = new Map<string, InvoiceListItem[]>();
    if (orderIds.length === 0) return byOrder;
    const entries = await this.prisma.journalEntry.findMany({
      where: {
        orderId: { in: [...orderIds] },
        type: { in: [EntryType.INVOICE, EntryType.CREDIT_NOTE] },
      },
      orderBy: { createdAt: 'asc' },
      include: withLines,
    });
    for (const e of entries) {
      if (!e.orderId) continue;
      const list = byOrder.get(e.orderId) ?? [];
      list.push(toInvoiceItem(e));
      byOrder.set(e.orderId, list);
    }
    return byOrder;
  }

  /** A page of the invoice list: the database picks and orders the ids, then each is read whole. */
  async list(query: InvoiceListQuery): Promise<Page<InvoiceListItem>> {
    const { ids, nextCursor, hasMore } = await this.listing.page(query);
    const entries = await this.prisma.journalEntry.findMany({
      where: { id: { in: ids } },
      include: withLines,
    });
    const byId = new Map(entries.map((e) => [e.id, toInvoiceItem(e)]));
    return {
      items: ids.flatMap((id) => byId.get(id) ?? []),
      nextCursor,
      hasMore,
    };
  }

  counts(): Promise<InvoiceCounts> {
    return this.listing.counts();
  }

  /** One invoice or credit note (its page in the dashboard). */
  async one(id: string): Promise<InvoiceListItem> {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, type: { in: [EntryType.INVOICE, EntryType.CREDIT_NOTE] } },
      include: withLines,
    });
    if (!entry) throw new NotFoundException('Invoice not found');
    return toInvoiceItem(entry);
  }

  async depositInvoice(
    orderId: string,
    actorId: string,
    options: CreateInvoiceDto = {},
  ): Promise<InvoiceListItem> {
    const posted = await this.postWaitingDraft(
      orderId,
      InvoiceKind.DEPOSIT,
      actorId,
      options,
    );
    if (posted) return posted;
    const { date, dueDate } = invoiceDates(options);
    const { order, settings, rate } = await this.context(orderId);
    if (D(order.depositRequired).lte(0)) {
      throw new BadRequestException('This order has no deposit');
    }
    const { base, tax } = splitTaxIncluded(order.depositRequired, rate);
    const lines: NewLine[] = [
      {
        accountId: settings.receivableAccountId,
        label: `Deposit for ${order.orderNumber}`,
        debit: order.depositRequired,
        customerId: order.userId,
        dueDate,
      },
      {
        accountId: settings.depositAccountId,
        label: 'Deposit received in advance',
        credit: base,
      },
      ...(settings.salesTax && tax.gt(0)
        ? [
            {
              accountId: settings.salesTax.accountId,
              label: settings.salesTax.name,
              credit: tax,
              taxId: settings.salesTax.id,
            },
          ]
        : []),
    ];
    const { id } = await this.underOrderLock(
      orderId,
      InvoiceKind.DEPOSIT,
      (tx) =>
        this.write(
          options.draft === true,
          {
            type: EntryType.INVOICE,
            invoiceKind: InvoiceKind.DEPOSIT,
            journalId: settings.saleJournalId,
            date,
            label: `Deposit invoice for ${order.orderNumber}`,
            customerId: order.userId,
            orderId,
            currencyCode: order.currencyCode,
            exchangeRate: order.exchangeRate,
            lines,
          },
          actorId,
          tx,
        ),
    );
    return this.invoice(id);
  }

  /** Every line of the order (rush and delivery included), less the deposit already invoiced. */
  async finalInvoice(
    orderId: string,
    actorId: string,
    options: CreateInvoiceDto = {},
  ): Promise<InvoiceListItem> {
    const posted = await this.postWaitingDraft(
      orderId,
      InvoiceKind.FINAL,
      actorId,
      options,
    );
    if (posted) return posted;
    const { date, dueDate } = invoiceDates(options);
    const { order, settings, rate } = await this.context(orderId);
    const credits: NewLine[] = [];
    let taxTotal = D(0);
    const add = (accountId: string, label: string, gross: Amount) => {
      const { base, tax } = splitTaxIncluded(gross, rate);
      credits.push({ accountId, label, credit: base });
      taxTotal = taxTotal.plus(tax);
    };
    for (const item of order.items) {
      add(
        item.isCustom
          ? settings.customIncomeAccountId
          : settings.productIncomeAccountId,
        `${item.quantity} × ${item.name}`,
        item.lineTotal,
      );
    }
    for (const line of order.priceBreakdown as unknown as {
      kind: string;
      label: string;
      amount: string;
    }[]) {
      if (line.kind === 'rush-fee')
        add(settings.rushAccountId, line.label, line.amount);
      if (line.kind === 'delivery-fee')
        add(settings.deliveryAccountId, line.label, line.amount);
    }
    if (settings.salesTax && taxTotal.gt(0)) {
      credits.push({
        accountId: settings.salesTax.accountId,
        label: settings.salesTax.name,
        credit: taxTotal,
        taxId: settings.salesTax.id,
      });
    }

    // Read with the order locked: a credit note on the deposit at this moment either comes
    // first (then no deposit comes off) or waits for this invoice (then it is refused).
    const { id } = await this.underOrderLock(
      orderId,
      InvoiceKind.FINAL,
      async (tx) => {
        // The deposit already invoiced comes off what the customer still owes.
        const deposit = await tx.journalEntry.findFirst({
          where: {
            orderId,
            type: EntryType.INVOICE,
            invoiceKind: InvoiceKind.DEPOSIT,
            reversal: { is: null },
          },
          include: { lines: true },
        });
        if (deposit?.state === 'DRAFT')
          throw new ConflictException(
            'Post or discard the draft deposit invoice first',
          );
        const debits: NewLine[] = [];
        let owed = D(order.total);
        if (deposit) {
          for (const l of deposit.lines) {
            if (l.accountId === settings.receivableAccountId) continue;
            // Undo the deposit's liability (and its tax, which the full invoice now carries).
            debits.push({
              accountId: l.accountId,
              label: `Deposit ${deposit.number}`,
              debit: l.credit,
              taxId: l.taxId,
            });
            owed = owed.minus(l.credit);
          }
        }
        if (owed.gt(0)) {
          debits.unshift({
            accountId: settings.receivableAccountId,
            label: `Order ${order.orderNumber}`,
            debit: owed,
            customerId: order.userId,
            dueDate,
          });
        }
        return this.write(
          options.draft === true,
          {
            type: EntryType.INVOICE,
            invoiceKind: InvoiceKind.FINAL,
            journalId: settings.saleJournalId,
            date,
            label: `Invoice for ${order.orderNumber}`,
            customerId: order.userId,
            orderId,
            currencyCode: order.currencyCode,
            exchangeRate: order.exchangeRate,
            lines: [...debits, ...credits],
          },
          actorId,
          tx,
        );
      },
    );
    return this.invoice(id);
  }

  /** A payment for an invoice, in cash or by transfer, matched against what it still owes. */
  async recordPayment(
    dto: RecordPaymentDto,
    actorId: string,
  ): Promise<InvoiceListItem> {
    if (new Date(dto.date) > today()) {
      throw new BadRequestException('A payment cannot be dated in the future');
    }
    const settings = await this.prisma.accountingSettings.findUniqueOrThrow({
      where: { id: 1 },
    });
    const journalId =
      dto.method === 'CASH' ? settings.cashJournalId : settings.bankJournalId;
    const journal = await this.prisma.journal.findUniqueOrThrow({
      where: { id: journalId },
    });
    await this.prisma.$transaction(async (tx) => {
      // One payment per invoice at a time: two clicks (or the automatic cash payment and a
      // manual one) can never both match the same amount.
      await lock(tx, `invoice:${dto.invoiceId}`);
      // The same form sent twice (a double click, a retry) is one payment.
      if (!(await claimRequestKey(tx, dto.requestKey, 'payment'))) return;
      const invoice = await tx.journalEntry.findUnique({
        where: { id: dto.invoiceId },
        include: withLines,
      });
      // A credit note's "payment" is the refund: the money goes back out to the customer.
      const refund = invoice?.type === EntryType.CREDIT_NOTE;
      if (!invoice || (invoice.type !== EntryType.INVOICE && !refund))
        throw new NotFoundException('Invoice not found');
      if (invoice.state !== 'POSTED')
        throw new ConflictException('Post the invoice before it is paid');
      const open = toInvoiceItem(invoice);
      if (D(dto.amount).gt(open.residual)) {
        throw new BadRequestException(
          refund
            ? `Only ${open.residual} is still to refund on ${invoice.number}`
            : `Only ${open.residual} is still owed on ${invoice.number}`,
        );
      }
      const money = {
        accountId: journal.defaultAccountId,
        label: `${refund ? 'To' : 'From'} ${invoice.customer?.email ?? 'customer'}`,
      };
      const receivable = {
        accountId: settings.receivableAccountId,
        label: `For ${invoice.number}`,
        customerId: invoice.customerId,
      };
      const payment = await this.ledger.post(
        {
          type: EntryType.PAYMENT,
          journalId,
          date: new Date(dto.date),
          label: `${refund ? 'Refund' : 'Payment'} for ${invoice.number}`,
          customerId: invoice.customerId,
          orderId: invoice.orderId,
          currencyCode: invoice.currencyCode,
          exchangeRate: invoice.exchangeRate,
          lines: refund
            ? [
                { ...receivable, debit: dto.amount },
                { ...money, credit: dto.amount },
              ]
            : [
                { ...money, debit: dto.amount },
                { ...receivable, credit: dto.amount },
              ],
        },
        actorId,
        tx,
      );
      if (refund) {
        await this.matchRefund(
          invoice,
          payment.id,
          settings.receivableAccountId,
          tx,
        );
      } else {
        await this.match(invoice, payment.id, settings.receivableAccountId, tx);
      }
    });
    return this.invoice(dto.invoiceId);
  }

  /** Reverses an invoice: the same lines the other way round, matched against it. */
  async creditNote(
    invoiceId: string,
    actorId: string,
  ): Promise<InvoiceListItem> {
    const invoice = await this.prisma.journalEntry.findUnique({
      where: { id: invoiceId },
      include: withLines,
    });
    if (!invoice || invoice.type !== EntryType.INVOICE)
      throw new NotFoundException('Invoice not found');
    if (invoice.state !== 'POSTED')
      throw new ConflictException(
        'A draft has no credit note: discard it instead',
      );
    if (invoice.reversal)
      throw new ConflictException('This invoice already has a credit note');
    const settings = await this.prisma.accountingSettings.findUniqueOrThrow({
      where: { id: 1 },
    });
    const id = await this.prisma.$transaction(async (tx) => {
      // The order's invoices one at a time: a final invoice being made now waits (or this).
      if (invoice.orderId) await lock(tx, `order:${invoice.orderId}`);
      // The final invoice already took the deposit off what is owed: crediting the deposit
      // as well would take it off twice. Credit the final invoice first.
      if (invoice.invoiceKind === InvoiceKind.DEPOSIT && invoice.orderId) {
        const final = await tx.journalEntry.count({
          where: {
            orderId: invoice.orderId,
            type: EntryType.INVOICE,
            invoiceKind: InvoiceKind.FINAL,
            state: 'POSTED',
            reversal: null,
          },
        });
        if (final > 0)
          throw new ConflictException(
            'The final invoice already counts this deposit: give the final invoice a credit note first',
          );
      }
      const note = await this.ledger.post(
        {
          type: EntryType.CREDIT_NOTE,
          invoiceKind: invoice.invoiceKind,
          journalId: invoice.journalId,
          date: today(),
          label: `Credit note for ${invoice.number}`,
          customerId: invoice.customerId,
          orderId: invoice.orderId,
          currencyCode: invoice.currencyCode,
          exchangeRate: invoice.exchangeRate,
          reversedEntryId: invoice.id,
          lines: invoice.lines.map((l) => ({
            accountId: l.accountId,
            label: l.label,
            debit: l.credit,
            credit: l.debit,
            customerId: l.customerId,
            taxId: l.taxId,
            dueDate: l.dueDate,
          })),
        },
        actorId,
        tx,
      );
      await this.match(invoice, note.id, settings.receivableAccountId, tx);
      return note.id;
    });
    return this.invoice(id);
  }

  /** Posts a draft invoice: it gets its number and enters the books. */
  async post(id: string, actorId: string): Promise<InvoiceListItem> {
    const draft = await this.requireDraft(id);
    await this.prisma.$transaction(async (tx) => {
      if (draft.orderId) {
        await lock(tx, `order:${draft.orderId}`);
        const [order] = await tx.$queryRaw<{ status: OrderStatus }[]>`
          SELECT status FROM orders WHERE id = ${draft.orderId}::uuid FOR UPDATE`;
        if (order?.status === OrderStatus.CANCELLED)
          throw new ConflictException('A cancelled order is not invoiced');
        // The deposit is taken off the final invoice: it must be in the books first.
        if (draft.invoiceKind === InvoiceKind.FINAL) {
          const deposit = await tx.journalEntry.findFirst({
            where: {
              orderId: draft.orderId,
              type: EntryType.INVOICE,
              invoiceKind: InvoiceKind.DEPOSIT,
              state: 'DRAFT',
            },
            select: { id: true },
          });
          if (deposit)
            throw new ConflictException(
              'Post or discard the draft deposit invoice first',
            );
        }
      }
      await this.ledger.postDraft(id, actorId, tx);
    });
    return this.invoice(id);
  }

  /** Changes a draft's invoice and due dates. */
  async redate(id: string, dto: InvoiceDatesDto): Promise<InvoiceListItem> {
    await this.requireDraft(id);
    const { date, dueDate } = invoiceDates(dto);
    const settings = await this.prisma.accountingSettings.findUniqueOrThrow({
      where: { id: 1 },
    });
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.journalEntry.updateMany({
        where: { id, state: 'DRAFT' },
        data: { date },
      });
      if (count !== 1)
        throw new ConflictException('Only a draft invoice can change');
      await tx.journalLine.updateMany({
        where: { entryId: id, accountId: settings.receivableAccountId },
        data: { dueDate },
      });
    });
    return this.invoice(id);
  }

  /** Deletes a draft invoice (posted ones are reversed with a credit note instead). */
  async discard(id: string): Promise<void> {
    await this.requireDraft(id);
    const { count } = await this.prisma.journalEntry.deleteMany({
      where: { id, state: 'DRAFT' },
    });
    if (count !== 1)
      throw new ConflictException('Only a draft invoice can be discarded');
  }

  private async requireDraft(id: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, type: EntryType.INVOICE },
      select: { id: true, state: true, orderId: true, invoiceKind: true },
    });
    if (!entry) throw new NotFoundException('Invoice not found');
    if (entry.state !== 'DRAFT')
      throw new ConflictException(
        'This invoice is posted: it can only be reversed with a credit note',
      );
    return entry;
  }

  /**
   * Posting asked for an order whose invoice of this kind is waiting as a draft: that draft is
   * posted (with the dates given, if any) instead of a second one being made.
   */
  private async postWaitingDraft(
    orderId: string,
    kind: InvoiceKind,
    actorId: string,
    options: CreateInvoiceDto,
  ): Promise<InvoiceListItem | null> {
    if (options.draft) return null;
    const draft = await this.prisma.journalEntry.findFirst({
      where: {
        orderId,
        type: EntryType.INVOICE,
        invoiceKind: kind,
        state: 'DRAFT',
      },
      select: { id: true },
    });
    if (!draft) return null;
    if (options.date || options.dueDate) {
      const current = await this.invoice(draft.id);
      await this.redate(draft.id, {
        date: options.date ?? current.date,
        dueDate:
          options.dueDate ?? options.date ?? current.dueDate ?? current.date,
      });
    }
    return this.post(draft.id, actorId);
  }

  /** Writes the invoice as a draft, or posts it. */
  private async write(
    draft: boolean,
    entry: Parameters<Ledger['post']>[0],
    actorId: string,
    tx: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    if (draft) return { id: await this.ledger.draft(entry, tx) };
    return this.ledger.post(entry, actorId, tx);
  }

  private async invoice(id: string): Promise<InvoiceListItem> {
    return toInvoiceItem(
      await this.prisma.journalEntry.findUniqueOrThrow({
        where: { id },
        include: withLines,
      }),
    );
  }

  /** Matches the invoice's open receivable with the new entry's receivable credit. */
  private async match(
    invoice: EntryRow,
    entryId: string,
    receivableAccountId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const credit = await tx.journalLine.findFirstOrThrow({
      where: { entryId, accountId: receivableAccountId, credit: { gt: 0 } },
    });
    for (const debit of invoice.lines.filter(
      (l) => l.accountId === receivableAccountId && l.debit.gt(0),
    )) {
      await this.ledger.reconcile(debit.id, credit.id, tx);
    }
  }

  /** Matches a credit note's open receivable credit with the refund's receivable debit. */
  private async matchRefund(
    note: EntryRow,
    refundId: string,
    receivableAccountId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const debit = await tx.journalLine.findFirstOrThrow({
      where: {
        entryId: refundId,
        accountId: receivableAccountId,
        debit: { gt: 0 },
      },
    });
    for (const credit of note.lines.filter(
      (l) => l.accountId === receivableAccountId && l.credit.gt(0),
    )) {
      await this.ledger.reconcile(debit.id, credit.id, tx);
    }
  }

  /**
   * Checks the order has no invoice of this kind yet and posts one, holding the order's lock
   * for the whole transaction: two requests at once (a double click, or the automatic invoice
   * and the button) can never both post.
   */
  private underOrderLock<T>(
    orderId: string,
    kind: InvoiceKind,
    post: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await lock(tx, `order:${orderId}`);
      // Checked again with the order's row locked: a cancellation a moment ago wins over the
      // invoice, and one arriving now waits until the invoice is posted.
      const [order] = await tx.$queryRaw<{ status: OrderStatus }[]>`
        SELECT status FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      if (order?.status === OrderStatus.CANCELLED) {
        throw new ConflictException('A cancelled order is not invoiced');
      }
      await this.refuseIfInvoiced(orderId, kind, tx);
      return post(tx);
    });
  }

  private async refuseIfInvoiced(
    orderId: string,
    kind: InvoiceKind,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const existing = await tx.journalEntry.findFirst({
      where: {
        orderId,
        type: EntryType.INVOICE,
        invoiceKind: kind,
        reversal: { is: null },
      },
      select: { number: true },
    });
    if (existing) {
      const which = kind === InvoiceKind.DEPOSIT ? 'deposit' : 'final';
      throw new ConflictException(
        existing.number
          ? `This order already has its ${which} invoice (${existing.number})`
          : `This order already has a draft ${which} invoice: post or discard it`,
      );
    }
  }

  private async context(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === OrderStatus.CANCELLED) {
      throw new ConflictException('A cancelled order is not invoiced');
    }
    const settings = await this.prisma.accountingSettings.findUniqueOrThrow({
      where: { id: 1 },
      include: { salesTax: true },
    });
    return { order, settings, rate: settings.salesTax?.ratePercent ?? null };
  }
}

/** The invoice as listed: its total, what is still owed and its payment state. */
function toInvoiceItem(e: EntryRow): InvoiceListItem {
  const receivable = e.lines.filter(
    (l) => l.account.type === AccountType.RECEIVABLE,
  );
  const isInvoice = e.type === EntryType.INVOICE;
  const total = receivable.reduce(
    (s, l) => s.plus(isInvoice ? l.debit : l.credit),
    D(0),
  );
  const matched = receivable.reduce(
    (s, l) =>
      s.plus(
        (isInvoice ? l.asDebit : l.asCredit).reduce(
          (m, r) => m.plus(r.amount),
          D(0),
        ),
      ),
    D(0),
  );
  const residual = total.minus(matched);
  const counterparts = receivable.flatMap((l) =>
    l.asDebit.map((r) => r.creditLine.entry.type),
  );
  const byCreditNoteOnly =
    counterparts.length > 0 &&
    counterparts.every((t) => t === EntryType.CREDIT_NOTE);
  return {
    id: e.id,
    number: e.number ?? '',
    type: e.type,
    invoiceKind: e.invoiceKind,
    state: e.state,
    date: isoDay(e.date),
    dueDate: (() => {
      const due = receivable
        .map((l) => l.dueDate)
        .filter((d): d is Date => d !== null)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      return due ? isoDay(due) : null;
    })(),
    customer: e.customer,
    orderId: e.orderId,
    orderNumber: e.order?.orderNumber ?? null,
    total: total.toFixed(2),
    residual: residual.toFixed(2),
    creditedBy: e.reversal?.number ?? null,
    paymentState: isInvoice
      ? paymentState(total, residual, byCreditNoteOnly)
      : residual.gt(0)
        ? 'partial'
        : 'paid',
    currencyCode: e.currencyCode,
  };
}
