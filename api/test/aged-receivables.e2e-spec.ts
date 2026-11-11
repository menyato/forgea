import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { Ledger } from '../src/accounting/ledger.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AccountType, EntryType, Role } from '../src/generated/prisma/enums.js';
import { signedInAs } from './commerce-helpers.js';
import { studioDay } from '../src/common/studio-day.js';
import { createApp } from './create-app.js';

const DAY = 86_400_000;
const dayOffset = (days: number) =>
  new Date(studioDay()).getTime() + days * DAY;
const isoDay = (days: number) =>
  new Date(dayOffset(days)).toISOString().slice(0, 10);

/** The report's numbers, from one SQL query: buckets, matches, and "as of" a date. */
describe('Aged receivables (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });
  afterAll(() => app.close());

  it('ages what each customer owes by due date, and counts a payment only from the day it was matched', async () => {
    const admin = await signedInAs(app, Role.ADMIN);
    const customer = await signedInAs(app, Role.CUSTOMER);
    const receivable = await prisma.account.findFirstOrThrow({
      where: { type: AccountType.RECEIVABLE },
    });
    const income = await prisma.account.findFirstOrThrow({
      where: { type: AccountType.INCOME },
    });
    const bank = await prisma.account.findFirstOrThrow({
      where: { type: { in: [AccountType.BANK, AccountType.CASH] } },
    });
    const journal = await prisma.journal.findFirstOrThrow();
    const ledger = app.get(Ledger);

    // Five invoices, all dated today, due at different times (the lock date keeps the past shut).
    const invoice = async (amount: string, dueInDays: number) => {
      const { id } = await ledger.post(
        {
          type: EntryType.ENTRY,
          journalId: journal.id,
          date: new Date(dayOffset(0)),
          label: `Aged test ${amount}`,
          customerId: customer.user.id,
          lines: [
            {
              accountId: receivable.id,
              label: 'Owed',
              debit: amount,
              customerId: customer.user.id,
              dueDate: new Date(dayOffset(dueInDays)),
            },
            { accountId: income.id, label: 'Sale', credit: amount },
          ],
        },
        admin.user.id,
      );
      return prisma.journalLine.findFirstOrThrow({
        where: { entryId: id, accountId: receivable.id },
      });
    };
    await invoice('10.00', 5); // not due yet
    const lateTen = await invoice('20.00', -10); // 1–30 days late
    await invoice('30.00', -45); // 31–60
    await invoice('40.00', -75); // 61–90
    await invoice('50.00', -120); // older

    // A 20.00 payment, matched to the 20.00 invoice only tomorrow.
    const { id: paymentId } = await ledger.post(
      {
        type: EntryType.ENTRY,
        journalId: journal.id,
        date: new Date(dayOffset(0)),
        label: 'Aged test payment',
        customerId: customer.user.id,
        lines: [
          { accountId: bank.id, label: 'Paid', debit: '20.00' },
          {
            accountId: receivable.id,
            label: 'Paid',
            credit: '20.00',
            customerId: customer.user.id,
          },
        ],
      },
      admin.user.id,
    );
    const paymentLine = await prisma.journalLine.findFirstOrThrow({
      where: { entryId: paymentId, accountId: receivable.id },
    });
    await prisma.reconciliation.create({
      data: {
        debitLineId: lateTen.id,
        creditLineId: paymentLine.id,
        amount: '20.00',
        createdAt: new Date(dayOffset(1) + 3_600_000),
      },
    });

    const report = async (to: string) => {
      const res = await request(app.getHttpServer())
        .get(`/accounting/reports/aged-receivables?to=${to}`)
        .set('Cookie', admin.cookie)
        .expect(200);
      return (res.body.rows as { customer: { id: string } }[]).find(
        (r) => r.customer.id === customer.user.id,
      );
    };

    // Today the match hasn't happened: the payment is an open credit (not due), the
    // invoice it will pay is still 1–30 days late.
    expect(await report(isoDay(0))).toMatchObject({
      notDue: '-10.00',
      days1to30: '20.00',
      days31to60: '30.00',
      days61to90: '40.00',
      older: '50.00',
      total: '130.00',
    });
    // Tomorrow it is matched: both the invoice and the payment are settled.
    expect(await report(isoDay(1))).toMatchObject({
      notDue: '10.00',
      days1to30: '0.00',
      days31to60: '30.00',
      days61to90: '40.00',
      older: '50.00',
      total: '130.00',
    });
    // Before the invoices existed, nothing was owed.
    expect(await report(isoDay(-1))).toBeUndefined();
  });
});
