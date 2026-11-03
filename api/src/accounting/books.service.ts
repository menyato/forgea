import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AccountingSettingsView,
  AccountView,
  AgedReceivables,
  BalanceSheet,
  JournalEntryView,
  Page,
  ProfitAndLoss,
  ReportLine,
} from '@forgea/types';
import type {
  EntryListQuery,
  ManualEntryDto,
  SaveAccountDto,
  UpdateAccountingSettingsDto,
} from '@forgea/validation';
import { keysetPage, toPage } from '../common/pagination/keyset.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { AccountType, EntryType } from '../generated/prisma/enums.js';
import type { Amount } from './ledger-math.js';
import { Ledger } from './ledger.service.js';

const D = (v: Amount) => new Prisma.Decimal(v);
const day = (d: Date) => d.toISOString().slice(0, 10);

const ASSETS: AccountType[] = [
  AccountType.RECEIVABLE,
  AccountType.CASH,
  AccountType.BANK,
  AccountType.CURRENT_ASSET,
  AccountType.FIXED_ASSET,
];
const LIABILITIES: AccountType[] = [
  AccountType.PAYABLE,
  AccountType.CURRENT_LIABILITY,
];

/**
 * The books: the chart of accounts and its balances, the journal, manual entries, the
 * accounting settings and the reports — all from posted lines only.
 */
@Injectable()
export class Books {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: Ledger,
  ) {}

  async accounts(): Promise<AccountView[]> {
    const [accounts, sums] = await Promise.all([
      this.prisma.account.findMany({ orderBy: { code: 'asc' } }),
      this.prisma.journalLine.groupBy({
        by: ['accountId'],
        where: { entry: { state: 'POSTED' } },
        _sum: { debit: true, credit: true },
      }),
    ]);
    const balance = new Map(
      sums.map((s) => [
        s.accountId,
        D(s._sum.debit ?? 0).minus(s._sum.credit ?? 0),
      ]),
    );
    return accounts.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      active: a.active,
      balance: (balance.get(a.id) ?? D(0)).toFixed(2),
    }));
  }

  async saveAccount(
    id: string | null,
    dto: SaveAccountDto,
  ): Promise<AccountView[]> {
    if (id) {
      const account = await this.prisma.account.findUnique({ where: { id } });
      if (!account) throw new NotFoundException('Account not found');
      // Its type decides where it shows in the reports: fixed once it has entries.
      const used = await this.prisma.journalLine.count({
        where: { accountId: id },
      });
      if (used > 0 && dto.type !== account.type) {
        throw new BadRequestException('An account with entries keeps its type');
      }
      await this.prisma.account.update({ where: { id }, data: dto });
    } else {
      await this.prisma.account.create({ data: dto });
    }
    return this.accounts();
  }

  async settings(): Promise<AccountingSettingsView> {
    const [s, taxes] = await Promise.all([
      this.prisma.accountingSettings.findUniqueOrThrow({
        where: { id: 1 },
        include: { salesTax: true },
      }),
      this.prisma.tax.findMany({ orderBy: { name: 'asc' } }),
    ]);
    const tax = (t: {
      id: string;
      name: string;
      ratePercent: Prisma.Decimal;
    }) => ({
      id: t.id,
      name: t.name,
      ratePercent: t.ratePercent.toString(),
    });
    return {
      salesTax: s.salesTax ? tax(s.salesTax) : null,
      taxes: taxes.map(tax),
      lockDate: s.lockDate ? day(s.lockDate) : null,
    };
  }

  async updateSettings(
    dto: UpdateAccountingSettingsDto,
  ): Promise<AccountingSettingsView> {
    if (
      dto.salesTaxId &&
      !(await this.prisma.tax.findUnique({ where: { id: dto.salesTaxId } }))
    ) {
      throw new BadRequestException('Unknown tax');
    }
    const current = await this.prisma.accountingSettings.findUniqueOrThrow({
      where: { id: 1 },
    });
    const lock = dto.lockDate ? new Date(dto.lockDate) : null;
    // A lock date only moves forward: opening a closed period again would change filed books.
    if (current.lockDate && (!lock || lock < current.lockDate)) {
      throw new BadRequestException('The lock date can only move forward');
    }
    await this.prisma.accountingSettings.update({
      where: { id: 1 },
      data: { salesTaxId: dto.salesTaxId, lockDate: lock },
    });
    return this.settings();
  }

  /** A manual entry in the general journal (opening balances, an expense, a correction). */
  async manualEntry(
    dto: ManualEntryDto,
    actorId: string,
  ): Promise<JournalEntryView> {
    const settings = await this.prisma.accountingSettings.findUniqueOrThrow({
      where: { id: 1 },
    });
    const ids = [...new Set(dto.lines.map((l) => l.accountId))];
    if (
      (await this.prisma.account.count({
        where: { id: { in: ids }, active: true },
      })) !== ids.length
    ) {
      throw new BadRequestException('Use active accounts only');
    }
    const { id } = await this.ledger.post(
      {
        type: EntryType.ENTRY,
        journalId: settings.generalJournalId,
        date: new Date(dto.date),
        label: dto.label,
        lines: dto.lines.map((l) => ({
          accountId: l.accountId,
          label: l.label || dto.label,
          debit: l.debit,
          credit: l.credit,
        })),
      },
      actorId,
    );
    return this.entry(id);
  }

  /** Posted entries, newest date first by default, searchable and paged. */
  async entries(query: EntryListQuery): Promise<Page<JournalEntryView>> {
    const has = { contains: query.q ?? '', mode: 'insensitive' } as const;
    const where: Prisma.JournalEntryWhereInput = {
      state: 'POSTED',
      ...(query.type ? { type: query.type } : {}),
      ...(query.orderId ? { orderId: query.orderId } : {}),
      ...(query.q
        ? {
            OR: [
              { number: has },
              { label: has },
              { order: { orderNumber: has } },
              { customer: { email: has } },
              { journal: { name: has } },
            ],
          }
        : {}),
    };
    const page = await keysetPage<EntryRow>(
      {
        sortField: query.sort,
        kind: query.sort === 'date' ? 'date' : 'string',
        order: query.order,
        limit: query.limit,
        cursor: query.cursor,
        valueOf: (e) => (query.sort === 'date' ? e.date : (e.number ?? '')),
      },
      ({ after, orderBy, take }) =>
        this.prisma.journalEntry.findMany({
          where: { AND: [where, after as Prisma.JournalEntryWhereInput] },
          orderBy: orderBy as Prisma.JournalEntryOrderByWithRelationInput[],
          take,
          include: entryInclude,
        }),
    );
    return toPage(page, toEntryView);
  }

  async entry(id: string): Promise<JournalEntryView> {
    const row = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: entryInclude,
    });
    if (!row) throw new NotFoundException('Entry not found');
    return toEntryView(row);
  }

  async profitAndLoss(from: Date, to: Date): Promise<ProfitAndLoss> {
    const lines = await this.totals({ date: { gte: from, lte: to } }, [
      AccountType.INCOME,
      AccountType.EXPENSE,
    ]);
    const income = lines
      .filter((l) => l.type === AccountType.INCOME)
      .map((l) => line(l, l.credit.minus(l.debit)));
    const expenses = lines
      .filter((l) => l.type === AccountType.EXPENSE)
      .map((l) => line(l, l.debit.minus(l.credit)));
    const totalIncome = sum(income);
    const totalExpenses = sum(expenses);
    return {
      from: day(from),
      to: day(to),
      income,
      expenses,
      totalIncome: totalIncome.toFixed(2),
      totalExpenses: totalExpenses.toFixed(2),
      netProfit: totalIncome.minus(totalExpenses).toFixed(2),
    };
  }

  /** Everything up to `asOf`; the result so far (income − expenses) shows under equity. */
  async balanceSheet(asOf: Date): Promise<BalanceSheet> {
    const lines = await this.totals(
      { date: { lte: asOf } },
      Object.values(AccountType),
    );
    const assets = lines
      .filter((l) => ASSETS.includes(l.type))
      .map((l) => line(l, l.debit.minus(l.credit)));
    const liabilities = lines
      .filter((l) => LIABILITIES.includes(l.type))
      .map((l) => line(l, l.credit.minus(l.debit)));
    const equity = lines
      .filter((l) => l.type === AccountType.EQUITY)
      .map((l) => line(l, l.credit.minus(l.debit)));
    const result = lines
      .filter(
        (l) => l.type === AccountType.INCOME || l.type === AccountType.EXPENSE,
      )
      .reduce((s, l) => s.plus(l.credit).minus(l.debit), D(0));
    equity.push({
      code: '',
      name: 'Result so far (not yet closed)',
      amount: result.toFixed(2),
    });
    return {
      asOf: day(asOf),
      assets,
      liabilities,
      equity,
      totalAssets: sum(assets).toFixed(2),
      totalLiabilitiesAndEquity: sum(liabilities).plus(sum(equity)).toFixed(2),
    };
  }

  /**
   * What each customer still owes, by how late it is, in one query: the database adds up only
   * receivable lines with something left after their matches (not every line ever written in
   * the application), and a match counts only if it was made by the report's date, so a past
   * date shows what was owed then. Owed amounts are positive (an invoice), unmatched payments
   * negative (a credit). Buckets are days past due: none, 1–30, 31–60, 61–90, older.
   */
  async agedReceivables(asOf: Date): Promise<AgedReceivables> {
    const asOfDay = day(asOf);
    // Matches made before the end of that day.
    const until = new Date(new Date(asOfDay).getTime() + 86_400_000);
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        email: string;
        name: string | null;
        notDue: Prisma.Decimal;
        days1to30: Prisma.Decimal;
        days31to60: Prisma.Decimal;
        days61to90: Prisma.Decimal;
        older: Prisma.Decimal;
        total: Prisma.Decimal;
      }[]
    >`
      WITH matched AS (
        SELECT line_id, sum(amount) AS amount FROM (
          SELECT "debitLineId" AS line_id, amount FROM reconciliations
          WHERE "createdAt" < ${until}
          UNION ALL
          SELECT "creditLineId", amount FROM reconciliations
          WHERE "createdAt" < ${until}
        ) m
        GROUP BY line_id
      ),
      open AS (
        SELECT l."customerId" AS customer_id,
               (l.debit - l.credit)
                 - CASE WHEN l.debit > 0 THEN coalesce(m.amount, 0)
                        ELSE -coalesce(m.amount, 0) END AS owed,
               (${asOfDay}::date - coalesce(l."dueDate", e.date)) AS days
        FROM journal_lines l
        JOIN journal_entries e
          ON e.id = l."entryId" AND e.state = 'POSTED' AND e.date <= ${asOfDay}::date
        JOIN accounts a ON a.id = l."accountId" AND a.type = 'RECEIVABLE'
        LEFT JOIN matched m ON m.line_id = l.id
        WHERE l."customerId" IS NOT NULL
      )
      SELECT u.id, u.email, u.name,
             coalesce(sum(owed) FILTER (WHERE days <= 0), 0) AS "notDue",
             coalesce(sum(owed) FILTER (WHERE days BETWEEN 1 AND 30), 0) AS "days1to30",
             coalesce(sum(owed) FILTER (WHERE days BETWEEN 31 AND 60), 0) AS "days31to60",
             coalesce(sum(owed) FILTER (WHERE days BETWEEN 61 AND 90), 0) AS "days61to90",
             coalesce(sum(owed) FILTER (WHERE days > 90), 0) AS older,
             sum(owed) AS total
      FROM open o
      JOIN users u ON u.id = o.customer_id
      WHERE owed <> 0
      GROUP BY u.id, u.email, u.name
      HAVING sum(owed) <> 0
      ORDER BY total DESC
    `;
    const money = (v: Prisma.Decimal) => D(v).toFixed(2);
    return {
      asOf: asOfDay,
      rows: rows.map((r) => ({
        customer: { id: r.id, email: r.email, name: r.name },
        notDue: money(r.notDue),
        days1to30: money(r.days1to30),
        days31to60: money(r.days31to60),
        days61to90: money(r.days61to90),
        older: money(r.older),
        total: money(r.total),
      })),
    };
  }

  private async totals(
    entryWhere: Prisma.JournalEntryWhereInput,
    types: AccountType[],
  ) {
    const [accounts, sums] = await Promise.all([
      this.prisma.account.findMany({
        where: { type: { in: types } },
        orderBy: { code: 'asc' },
      }),
      this.prisma.journalLine.groupBy({
        by: ['accountId'],
        where: { entry: { state: 'POSTED', ...entryWhere } },
        _sum: { debit: true, credit: true },
      }),
    ]);
    const byId = new Map(sums.map((s) => [s.accountId, s._sum]));
    return accounts
      .map((a) => ({
        code: a.code,
        name: a.name,
        type: a.type,
        debit: D(byId.get(a.id)?.debit ?? 0),
        credit: D(byId.get(a.id)?.credit ?? 0),
      }))
      .filter((a) => !a.debit.isZero() || !a.credit.isZero());
  }
}

const entryInclude = {
  journal: { select: { code: true, name: true } },
  customer: { select: { id: true, email: true } },
  order: { select: { orderNumber: true } },
  reversedEntry: { select: { number: true } },
  lines: { include: { account: { select: { code: true, name: true } } } },
} as const satisfies Prisma.JournalEntryInclude;
type EntryRow = Prisma.JournalEntryGetPayload<{ include: typeof entryInclude }>;

function toEntryView(e: EntryRow): JournalEntryView {
  return {
    id: e.id,
    number: e.number ?? '',
    type: e.type,
    journal: e.journal,
    date: day(e.date),
    label: e.label,
    customer: e.customer,
    orderNumber: e.order?.orderNumber ?? null,
    currencyCode: e.currencyCode,
    exchangeRate: e.exchangeRate.toString(),
    reversedEntryNumber: e.reversedEntry?.number ?? null,
    lines: e.lines.map((l) => ({
      account: l.account,
      label: l.label,
      debit: l.debit.toFixed(2),
      credit: l.credit.toFixed(2),
    })),
  };
}

const line = (
  a: { code: string; name: string },
  amount: Prisma.Decimal,
): ReportLine => ({
  code: a.code,
  name: a.name,
  amount: amount.toFixed(2),
});
const sum = (lines: ReportLine[]) =>
  lines.reduce((s, l) => s.plus(l.amount), D(0));
