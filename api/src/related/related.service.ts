import { Injectable, NotFoundException } from '@nestjs/common';
import type { RelatedRecord } from '@forgea/types';
import { PrismaService } from '../database/prisma.service.js';

const person = { select: { email: true, name: true } } as const;

/**
 * What a lead, quotation, order or custom request is connected to, in one read each: the
 * dashboard shows them as links, so every record leads to the others and to its customer.
 */
@Injectable()
export class RelatedRecords {
  constructor(private readonly prisma: PrismaService) {}

  async order(id: string): Promise<RelatedRecord[]> {
    const o = await this.prisma.order.findUnique({
      where: { id },
      select: {
        user: person,
        customRequest: {
          select: {
            id: true,
            requestNumber: true,
            lead: { select: { id: true, name: true } },
          },
        },
        quotation: {
          select: {
            id: true,
            number: true,
            lead: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!o) throw new NotFoundException('Order not found');
    return list([
      lead(o.quotation?.lead ?? o.customRequest?.lead),
      o.quotation && quotation(o.quotation),
      o.customRequest && request(o.customRequest),
      customer(o.user.email),
    ]);
  }

  async quotation(id: string): Promise<RelatedRecord[]> {
    const q = await this.prisma.quotation.findUnique({
      where: { id },
      select: {
        customerEmail: true,
        lead: {
          select: {
            id: true,
            name: true,
            customRequest: { select: { id: true, requestNumber: true } },
          },
        },
        order: { select: { id: true, orderNumber: true } },
      },
    });
    if (!q) throw new NotFoundException('Quotation not found');
    return list([
      lead(q.lead),
      q.lead?.customRequest && request(q.lead.customRequest),
      q.order && order(q.order),
      customer(q.customerEmail),
    ]);
  }

  async lead(id: string): Promise<RelatedRecord[]> {
    const l = await this.prisma.lead.findUnique({
      where: { id },
      select: {
        email: true,
        customer: person,
        customRequest: {
          select: {
            id: true,
            requestNumber: true,
            order: { select: { id: true, orderNumber: true } },
          },
        },
        quotations: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            number: true,
            order: { select: { id: true, orderNumber: true } },
          },
        },
      },
    });
    if (!l) throw new NotFoundException('Lead not found');
    return list([
      l.customRequest && request(l.customRequest),
      l.customRequest?.order && order(l.customRequest.order),
      ...l.quotations.flatMap((q) => [quotation(q), q.order && order(q.order)]),
      customer(l.customer?.email ?? l.email),
    ]);
  }

  async request(id: string): Promise<RelatedRecord[]> {
    const r = await this.prisma.customRequest.findUnique({
      where: { id },
      select: {
        user: person,
        order: { select: { id: true, orderNumber: true } },
        lead: {
          select: {
            id: true,
            name: true,
            quotations: {
              orderBy: { createdAt: 'asc' },
              select: { id: true, number: true },
            },
          },
        },
      },
    });
    if (!r) throw new NotFoundException('Request not found');
    return list([
      lead(r.lead),
      ...(r.lead?.quotations ?? []).map(quotation),
      r.order && order(r.order),
      customer(r.user.email),
    ]);
  }
}

const lead = (l: { id: string; name: string } | null | undefined) =>
  l ? { kind: 'lead' as const, id: l.id, label: `Lead: ${l.name}` } : null;
const quotation = (q: { id: string; number: string }) => ({
  kind: 'quotation' as const,
  id: q.id,
  label: `Quotation ${q.number}`,
});
const order = (o: { id: string; orderNumber: string }) => ({
  kind: 'order' as const,
  id: o.id,
  label: `Order ${o.orderNumber}`,
});
const request = (r: { id: string; requestNumber: string }) => ({
  kind: 'request' as const,
  id: r.id,
  label: `Request ${r.requestNumber}`,
});
const customer = (email: string) => ({
  kind: 'customer' as const,
  id: email,
  label: `Customer: ${email}`,
});

/** Without the gaps, each record once. */
function list(
  items: (RelatedRecord | null | undefined | false)[],
): RelatedRecord[] {
  const seen = new Set<string>();
  return items.filter((r): r is RelatedRecord => {
    if (!r) return false;
    const key = `${r.kind}:${r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
