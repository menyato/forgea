import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { EntryType, type InvoiceKind } from '../generated/prisma/enums.js';
import { entryNumber, isBalanced, type Amount } from './ledger-math.js';

export interface NewLine {
  accountId: string;
  label: string;
  debit?: Amount;
  credit?: Amount;
  customerId?: string | null;
  taxId?: string | null;
  dueDate?: Date | null;
}

export interface NewEntry {
  type: EntryType;
  journalId: string;
  date: Date;
  label: string;
  customerId?: string | null;
  orderId?: string | null;
  invoiceKind?: InvoiceKind | null;
  currencyCode?: string;
  /** Units of the currency per 1 USD; amounts on lines are USD. */
  exchangeRate?: Amount;
  reversedEntryId?: string | null;
  lines: NewLine[];
}

const D = (v: Amount | undefined) => new Prisma.Decimal(v ?? 0);

/**
 * The only code that writes journal entries. An entry is checked (it balances; its date is
 * after the lock date), numbered from its journal's sequence and posted in one transaction —
 * and the database checks the balance again and refuses any later change. An invoice may
 * first be saved as a draft (no number, outside the books, still editable), then posted.
 */
@Injectable()
export class Ledger {
  constructor(private readonly prisma: PrismaService) {}

  /** Writes the entry and posts it at once. */
  async post(
    entry: NewEntry,
    actorId: string | null,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; number: string }> {
    const run = async (t: Prisma.TransactionClient) => {
      const id = await this.draft(entry, t);
      return { id, number: await this.postDraft(id, actorId, t) };
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  /** Writes the entry as a draft: no number, not in the books. Returns its id. */
  async draft(entry: NewEntry, tx: Prisma.TransactionClient): Promise<string> {
    const lines = entry.lines
      .map((l) => ({
        ...l,
        debit: D(l.debit).toDecimalPlaces(2),
        credit: D(l.credit).toDecimalPlaces(2),
      }))
      .filter((l) => !l.debit.isZero() || !l.credit.isZero());
    if (!isBalanced(lines)) {
      throw new BadRequestException(
        'The entry does not balance: debits must equal credits',
      );
    }
    const rate = D(entry.exchangeRate ?? 1);
    const draft = await tx.journalEntry.create({
      data: {
        type: entry.type,
        journalId: entry.journalId,
        date: entry.date,
        label: entry.label,
        customerId: entry.customerId ?? null,
        orderId: entry.orderId ?? null,
        invoiceKind: entry.invoiceKind ?? null,
        currencyCode: entry.currencyCode ?? 'USD',
        exchangeRate: rate,
        reversedEntryId: entry.reversedEntryId ?? null,
        lines: {
          create: lines.map((l) => ({
            accountId: l.accountId,
            label: l.label,
            debit: l.debit,
            credit: l.credit,
            // The document's currency, signed (+ debit, − credit).
            amountCurrency: l.debit
              .minus(l.credit)
              .times(rate)
              .toDecimalPlaces(4),
            customerId: l.customerId ?? null,
            taxId: l.taxId ?? null,
            dueDate: l.dueDate ?? null,
          })),
        },
      },
      select: { id: true },
    });
    return draft.id;
  }

  /**
   * Posts a draft: checks its date against the lock date, gives it the next number of its
   * journal and year, and makes it final. Returns the number.
   */
  async postDraft(
    id: string,
    actorId: string | null,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const entry = await tx.journalEntry.findUniqueOrThrow({
      where: { id },
      include: { journal: true },
    });
    if (entry.state !== 'DRAFT')
      throw new BadRequestException('This entry is already posted');
    // Read under a share lock: a lock date being moved past this entry waits for it, or it
    // for the move (then refused), never both at once.
    const [settings] = await tx.$queryRaw<{ lockDate: Date | null }[]>`
      SELECT "lockDate" FROM "accounting_settings" WHERE "id" = 1 FOR SHARE`;
    if (!settings) throw new Error('Accounting settings are missing');
    if (settings.lockDate && entry.date <= settings.lockDate) {
      throw new BadRequestException(
        `The books are locked up to ${settings.lockDate.toISOString().slice(0, 10)}`,
      );
    }
    const series = entry.type === EntryType.CREDIT_NOTE ? 'R' : '';
    const year = entry.date.getUTCFullYear();
    const [counter] = await tx.$queryRaw<{ last: number }[]>`
      INSERT INTO "entry_sequences" ("journalId", "year", "series", "last")
      VALUES (${entry.journalId}::uuid, ${year}, ${series}, 1)
      ON CONFLICT ("journalId", "year", "series")
      DO UPDATE SET "last" = "entry_sequences"."last" + 1
      RETURNING "last"`;
    const number = entryNumber(
      `${series}${entry.journal.code}`,
      year,
      Number(counter!.last),
    );
    // Only a draft moves: two posts at once can't both number it.
    const { count } = await tx.journalEntry.updateMany({
      where: { id, state: 'DRAFT' },
      data: {
        state: 'POSTED',
        number,
        postedAt: new Date(),
        postedById: actorId,
      },
    });
    if (count !== 1)
      throw new BadRequestException('This entry is already posted');
    return number;
  }

  /**
   * Matches a receivable debit (an invoice) with a receivable credit (a payment, a credit note)
   * for as much as both still have open. Returns the amount matched.
   */
  async reconcile(
    debitLineId: string,
    creditLineId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Prisma.Decimal> {
    // One after the other: a transaction is one connection, which runs one query at a time.
    const debit = await this.openAmount(debitLineId, 'debit', tx);
    const credit = await this.openAmount(creditLineId, 'credit', tx);
    const amount = Prisma.Decimal.min(debit, credit);
    if (amount.lte(0)) return new Prisma.Decimal(0);
    await tx.reconciliation.create({
      data: { debitLineId, creditLineId, amount },
    });
    return amount;
  }

  /** What is still open on a line: its amount less what is already matched with it. */
  async openAmount(
    lineId: string,
    side: 'debit' | 'credit',
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Prisma.Decimal> {
    const line = await tx.journalLine.findUniqueOrThrow({
      where: { id: lineId },
      include: { asDebit: true, asCredit: true },
    });
    const matched = (side === 'debit' ? line.asDebit : line.asCredit).reduce(
      (s, r) => s.plus(r.amount),
      new Prisma.Decimal(0),
    );
    return (side === 'debit' ? line.debit : line.credit).minus(matched);
  }
}
