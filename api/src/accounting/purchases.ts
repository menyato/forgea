import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { EntryType } from '../generated/prisma/enums.js';
import { Ledger } from './ledger.service.js';

const today = () => new Date(new Date().toISOString().slice(0, 10));

/**
 * Filament and materials bought and paid: an expense entry (the purchases account the owner
 * set, "Filament and materials used" to start) paid from the cash box or a money transfer.
 * Posted through the Ledger, in the caller's transaction.
 */
@Injectable()
export class Purchases {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: Ledger,
  ) {}

  /** Whether purchases can be booked: an expense account is set for them. */
  async canBook(): Promise<boolean> {
    const settings = await this.prisma.accountingSettings.findUnique({
      where: { id: 1 },
      select: { purchasesAccountId: true },
    });
    return Boolean(settings?.purchasesAccountId);
  }

  async book(
    tx: Prisma.TransactionClient,
    purchase: {
      paidFrom: 'CASH' | 'BANK';
      amount: Prisma.Decimal;
      label: string;
      actorId: string;
    },
  ): Promise<{ id: string; number: string }> {
    const settings = await tx.accountingSettings.findUniqueOrThrow({
      where: { id: 1 },
      select: {
        purchasesAccountId: true,
        cashJournal: { select: { id: true, defaultAccountId: true } },
        bankJournal: { select: { id: true, defaultAccountId: true } },
      },
    });
    if (!settings.purchasesAccountId) {
      throw new BadRequestException(
        'Purchases have no expense account yet (Accounting settings)',
      );
    }
    const journal =
      purchase.paidFrom === 'CASH'
        ? settings.cashJournal
        : settings.bankJournal;
    return this.ledger.post(
      {
        type: EntryType.ENTRY,
        journalId: journal.id,
        date: today(),
        label: purchase.label,
        lines: [
          {
            accountId: settings.purchasesAccountId,
            label: purchase.label,
            debit: purchase.amount,
          },
          {
            accountId: journal.defaultAccountId,
            label: purchase.label,
            credit: purchase.amount,
          },
        ],
      },
      purchase.actorId,
      tx,
    );
  }
}
