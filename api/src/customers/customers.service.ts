import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  CustomerDetail,
  CustomerList,
  CustomerListItem,
  CustomerSummary,
} from '@forgea/types';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';

const PAGE = 50;

export interface CustomerQuery {
  q?: string | undefined;
  /** account: has one; guest: known only by email (a lead, a quotation). */
  kind?: 'account' | 'guest' | undefined;
  sort?: 'lastActivity' | 'spent' | 'orders' | 'email' | undefined;
  order?: 'asc' | 'desc' | undefined;
  /** The offset of the page. */
  cursor?: string | undefined;
}

interface Row {
  email: string;
  userId: string | null;
  name: string | null;
  phone: string | null;
  hasPassword: boolean | null;
  hasGoogle: boolean | null;
  confirmed: boolean | null;
  since: Date | null;
  orders: number;
  spent: string;
  quotations: number;
  requests: number;
  leads: number;
  lastActivity: Date;
  lastSeen: Date | null;
  total: number;
}

const SORTS = {
  lastActivity: Prisma.sql`"lastActivity"`,
  spent: Prisma.sql`spent`,
  orders: Prisma.sql`orders`,
  email: Prisma.sql`email`,
} as const;

/**
 * Customers as people, by email address: every customer account, and everyone the studio
 * knows only by an address (the website form, a quotation sent to them). Each with what they
 * did: orders and what they spent, quotations, custom requests, leads.
 */
@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: CustomerQuery): Promise<CustomerList> {
    const offset = Math.max(0, Number(query.cursor) || 0);
    const q = query.q?.trim();
    const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const where = Prisma.sql`WHERE TRUE
      ${like ? Prisma.sql`AND (p.email ILIKE ${like} OR coalesce(u.name, '') ILIKE ${like} OR coalesce(u.phone, '') ILIKE ${like})` : Prisma.empty}
      ${query.kind === 'account' ? Prisma.sql`AND u.id IS NOT NULL` : Prisma.empty}
      ${query.kind === 'guest' ? Prisma.sql`AND u.id IS NULL` : Prisma.empty}`;
    const sort = SORTS[query.sort ?? 'lastActivity'];
    const direction =
      (query.order ?? (query.sort === 'email' ? 'asc' : 'desc')) === 'asc'
        ? Prisma.sql`ASC`
        : Prisma.sql`DESC`;
    const [rows, guestCarts] = await Promise.all([
      this.prisma.$queryRaw<Row[]>`${PEOPLE}
        SELECT *, count(*) OVER ()::int AS total FROM (${SUMMARY} ${where}) s
        ORDER BY ${sort} ${direction}, email ASC
        LIMIT ${PAGE + 1} OFFSET ${offset}`,
      this.prisma.cart.count({
        where: { userId: null, items: { some: {} } },
      }),
    ]);
    const more = rows.length > PAGE;
    return {
      items: rows.slice(0, PAGE).map(toItem),
      nextCursor: more ? String(offset + PAGE) : null,
      total: rows[0]?.total ?? (offset > 0 ? offset : 0),
      guestCarts,
    };
  }

  async detail(email: string): Promise<CustomerDetail> {
    const address = email.trim().toLowerCase();
    const [row] = await this.prisma.$queryRaw<Row[]>`${PEOPLE}
      SELECT *, 1 AS total FROM (${SUMMARY} WHERE p.email = ${address}) s`;
    if (!row) throw new NotFoundException('No customer with this address');
    const [orders, quotations, requests, leads, cart] = await Promise.all([
      row.userId
        ? this.prisma.order.findMany({
            where: { userId: row.userId },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              orderNumber: true,
              status: true,
              total: true,
              createdAt: true,
            },
          })
        : [],
      this.prisma.quotation.findMany({
        where: { customerEmail: address },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          number: true,
          status: true,
          total: true,
          createdAt: true,
        },
      }),
      row.userId
        ? this.prisma.customRequest.findMany({
            where: { userId: row.userId },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              requestNumber: true,
              title: true,
              status: true,
              createdAt: true,
            },
          })
        : [],
      this.prisma.lead.findMany({
        where: {
          OR: [
            { email: address },
            ...(row.userId ? [{ customerId: row.userId }] : []),
          ],
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          closedAt: true,
          lostReasonId: true,
          createdAt: true,
          stage: { select: { name: true } },
        },
      }),
      row.userId
        ? this.prisma.cart.findUnique({
            where: { userId: row.userId },
            select: { updatedAt: true, _count: { select: { items: true } } },
          })
        : null,
    ]);
    const signIns = row.userId ? await this.signIns(row.userId) : [];
    return {
      ...toItem(row),
      history: {
        orders: orders.map((o) => ({
          id: o.id,
          number: o.orderNumber,
          status: o.status,
          total: o.total.toFixed(2),
          createdAt: o.createdAt.toISOString(),
        })),
        quotations: quotations.map((q) => ({
          id: q.id,
          number: q.number,
          status: q.status,
          total: q.total.toFixed(2),
          createdAt: q.createdAt.toISOString(),
        })),
        requests: requests.map((r) => ({
          id: r.id,
          number: r.requestNumber,
          title: r.title,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
        })),
        leads: leads.map((l) => ({
          id: l.id,
          name: l.name,
          stage: l.stage.name,
          state: !l.closedAt ? 'open' : l.lostReasonId ? 'lost' : 'won',
          createdAt: l.createdAt.toISOString(),
        })),
      },
      cart:
        cart && cart._count.items > 0
          ? {
              lines: cart._count.items,
              updatedAt: cart.updatedAt.toISOString(),
            }
          : null,
      signIns,
    };
  }

  /** The dashboard Overview's numbers: accounts, who is new, who came back, who has none. */
  async summary(now = new Date()): Promise<CustomerSummary> {
    const week = new Date(now.getTime() - 7 * 86_400_000);
    const [accounts, newThisWeek, seen, withoutAccount, guestCarts] =
      await Promise.all([
        this.prisma.user.count({ where: { role: Role.CUSTOMER } }),
        this.prisma.user.count({
          where: { role: Role.CUSTOMER, createdAt: { gte: week } },
        }),
        this.prisma.$queryRaw<{ n: number }[]>`
          SELECT count(DISTINCT s."userId")::int AS n FROM sessions s
          JOIN users u ON u.id = s."userId" AND u.role = ${Role.CUSTOMER}::"Role"
          WHERE s."createdAt" >= ${week}`,
        this.prisma.$queryRaw<{ n: number }[]>`${PEOPLE}
          SELECT count(*)::int AS n FROM people p
          WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.email = p.email AND u.role = ${Role.CUSTOMER}::"Role")`,
        this.prisma.cart.count({
          where: { userId: null, items: { some: {} } },
        }),
      ]);
    return {
      accounts,
      newThisWeek,
      seenThisWeek: seen[0]?.n ?? 0,
      withoutAccount: withoutAccount[0]?.n ?? 0,
      guestCarts,
    };
  }

  /**
   * One row per sign-in (a session keeps one family through its refreshes): when it began,
   * when it was last refreshed, the browser it came from, and whether it is still signed in.
   */
  private async signIns(userId: string): Promise<CustomerDetail['signIns']> {
    const rows = await this.prisma.$queryRaw<
      {
        startedAt: Date;
        lastSeen: Date;
        userAgent: string | null;
        ipAddress: string | null;
        active: boolean;
      }[]
    >`SELECT min(s."createdAt") AS "startedAt", max(s."createdAt") AS "lastSeen",
        (array_agg(s."userAgent" ORDER BY s."createdAt" DESC))[1] AS "userAgent",
        (array_agg(host(s."ipAddress") ORDER BY s."createdAt" DESC))[1] AS "ipAddress",
        bool_or(s."revokedAt" IS NULL AND s."expiresAt" > now()) AS active
      FROM sessions s WHERE s."userId" = ${userId}::uuid
      GROUP BY s."familyId" ORDER BY "lastSeen" DESC LIMIT 10`;
    return rows.map((r) => ({
      startedAt: r.startedAt.toISOString(),
      lastSeen: r.lastSeen.toISOString(),
      device: deviceOf(r.userAgent),
      ipAddress: r.ipAddress,
      active: r.active,
    }));
  }
}

/** Every address the studio knows a customer by (emails are stored lowercased). */
const PEOPLE = Prisma.sql`WITH people AS (
  SELECT email FROM users WHERE role = ${Role.CUSTOMER}::"Role"
  UNION SELECT email FROM leads
  UNION SELECT "customerEmail" FROM quotations
)`;

/** One row per address: the account (if any), what they did, and when they last did something. */
const SUMMARY = Prisma.sql`
  SELECT p.email,
    u.id AS "userId",
    coalesce(u.name,
      (SELECT l.name FROM leads l WHERE l.email = p.email ORDER BY l."createdAt" DESC LIMIT 1),
      (SELECT q."customerName" FROM quotations q WHERE q."customerEmail" = p.email ORDER BY q."createdAt" DESC LIMIT 1)
    ) AS name,
    coalesce(u.phone,
      (SELECT l.phone FROM leads l WHERE l.email = p.email AND l.phone IS NOT NULL ORDER BY l."createdAt" DESC LIMIT 1),
      (SELECT q.phone FROM quotations q WHERE q."customerEmail" = p.email ORDER BY q."createdAt" DESC LIMIT 1)
    ) AS phone,
    u."passwordHash" IS NOT NULL AS "hasPassword",
    u."googleId" IS NOT NULL AS "hasGoogle",
    u."emailVerifiedAt" IS NOT NULL AS confirmed,
    u."createdAt" AS since,
    (SELECT count(*) FROM orders o WHERE o."userId" = u.id)::int AS orders,
    (SELECT coalesce(sum(o.total), 0) FROM orders o WHERE o."userId" = u.id AND o.status <> 'CANCELLED') AS spent,
    (SELECT count(*) FROM quotations q WHERE q."customerEmail" = p.email)::int AS quotations,
    (SELECT count(*) FROM custom_requests r WHERE r."userId" = u.id)::int AS requests,
    (SELECT count(*) FROM leads l WHERE l.email = p.email OR l."customerId" = u.id)::int AS leads,
    (SELECT max(s."createdAt") FROM sessions s WHERE s."userId" = u.id) AS "lastSeen",
    GREATEST(
      u."createdAt",
      (SELECT max(o."createdAt") FROM orders o WHERE o."userId" = u.id),
      (SELECT max(r."createdAt") FROM custom_requests r WHERE r."userId" = u.id),
      (SELECT max(l."createdAt") FROM leads l WHERE l.email = p.email),
      (SELECT max(q."createdAt") FROM quotations q WHERE q."customerEmail" = p.email)
    ) AS "lastActivity"
  FROM people p
  LEFT JOIN users u ON u.email = p.email AND u.role = ${Role.CUSTOMER}::"Role"`;

/** "Chrome on Windows", "Safari on iPhone"…: enough to recognise a device, from its User-Agent. */
export function deviceOf(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const ua = userAgent;
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /Firefox\/|FxiOS/.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS/.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : null;
  if (!os && !browser) return 'Unknown device';
  return [browser ?? 'A browser', os && `on ${os}`].filter(Boolean).join(' ');
}

function toItem(r: Row): CustomerListItem {
  return {
    id: r.email,
    email: r.email,
    name: r.name,
    phone: r.phone,
    account: r.userId
      ? {
          id: r.userId,
          signIn: [
            ...(r.hasPassword ? (['password'] as const) : []),
            ...(r.hasGoogle ? (['Google'] as const) : []),
          ],
          confirmed: r.confirmed ?? false,
          since: r.since!.toISOString(),
        }
      : null,
    orders: r.orders,
    spent: new Prisma.Decimal(r.spent).toFixed(2),
    quotations: r.quotations,
    requests: r.requests,
    leads: r.leads,
    lastActivity: r.lastActivity.toISOString(),
    lastSeen: r.lastSeen?.toISOString() ?? null,
  };
}
