import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { InvoiceListItem } from '@forgea/types';
import type { RecordPaymentDto } from '@forgea/validation';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  AccountType,
  EntryType,
  InvoiceKind,
  OrderStatus,
  PaymentMethod,
} from '../generated/prisma/enums.js';
import { paymentState, splitTaxIncluded, type Amount } from './ledger-math.js';
import { Ledger, type NewLine } from './ledger.service.js';

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
const today = () => new Date(new Date().toISOString().slice(0, 10));

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
  ) {}

  /** Called after an order's status changes: invoices and payments that follow from it. */
  async onOrderStatus(
    orderId: string,
    from: OrderStatus,
    to: OrderStatus,
    actorId: string,
  ): Promise<void> {
    try {
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

  async list(take = 100): Promise<InvoiceListItem[]> {
    const entries = await this.prisma.journalEntry.findMany({
      where: { type: { in: [EntryType.INVOICE, EntryType.CREDIT_NOTE] } },
      // Newest first by id (UUIDv7: creation order, already indexed).
      orderBy: { id: 'desc' },
      take,
      include: withLines,
    });
    return entries.map(toInvoiceItem);
  }

  async depositInvoice(
    orderId: string,
    actorId: string,
  ): Promise<InvoiceListItem> {
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
        dueDate: today(),
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
        this.ledger.post(
          {
            type: EntryType.INVOICE,
            invoiceKind: InvoiceKind.DEPOSIT,
            journalId: settings.saleJournalId,
            date: today(),
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
  ): Promise<InvoiceListItem> {
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

    // The deposit already invoiced comes off what the customer still owes.
    const deposit = await this.prisma.journalEntry.findFirst({
      where: {
        orderId,
        invoiceKind: InvoiceKind.DEPOSIT,
        reversal: { is: null },
      },
      include: { lines: true },
    });
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
        dueDate: today(),
      });
    }
    const { id } = await this.underOrderLock(orderId, InvoiceKind.FINAL, (tx) =>
      this.ledger.post(
        {
          type: EntryType.INVOICE,
          invoiceKind: InvoiceKind.FINAL,
          journalId: settings.saleJournalId,
          date: today(),
          label: `Invoice for ${order.orderNumber}`,
          customerId: order.userId,
          orderId,
          currencyCode: order.currencyCode,
          exchangeRate: order.exchangeRate,
          lines: [...debits, ...credits],
        },
        actorId,
        tx,
      ),
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
      const invoice = await tx.journalEntry.findUnique({
        where: { id: dto.invoiceId },
        include: withLines,
      });
      // A credit note's "payment" is the refund: the money goes back out to the customer.
      const refund = invoice?.type === EntryType.CREDIT_NOTE;
      if (!invoice || (invoice.type !== EntryType.INVOICE && !refund))
        throw new NotFoundException('Invoice not found');
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
    if (invoice.reversal)
      throw new ConflictException('This invoice already has a credit note');
    const settings = await this.prisma.accountingSettings.findUniqueOrThrow({
      where: { id: 1 },
    });
    const id = await this.prisma.$transaction(async (tx) => {
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
      throw new ConflictException(
        `This order already has its ${kind === InvoiceKind.DEPOSIT ? 'deposit' : 'final'} invoice (${existing.number})`,
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
    date: e.date.toISOString().slice(0, 10),
    customer: e.customer,
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
