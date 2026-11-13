import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';

/** What moved from one customer to the other. */
export interface CustomerMergeResult {
  into: string;
  moved: {
    orders: number;
    quotations: number;
    requests: number;
    leads: number;
    entries: number;
  };
}

/**
 * Merges a customer into another (as Odoo merges contacts): their orders, custom requests,
 * quotations, leads, invoices and payments, uploads and what they did become the other's, in
 * one transaction, then the first account is removed (its sessions and cart go with it).
 * History says the same things as before: the database lets a posted entry, its lines and a
 * status history row change only who they point at (migration customer_merge). Customer
 * accounts only: team accounts are never merged.
 */
@Injectable()
export class CustomerMergeService {
  constructor(private readonly prisma: PrismaService) {}

  /** A customer account's name and phone, as the studio corrects them (never a team account). */
  async details(email: string, name: string, phone: string): Promise<void> {
    const r = await this.prisma.user.updateMany({
      where: { email, role: Role.CUSTOMER },
      data: { name, phone },
    });
    if (r.count === 0)
      throw new NotFoundException(`No customer account for ${email}`);
  }

  async merge(from: string, into: string): Promise<CustomerMergeResult> {
    if (from === into)
      throw new BadRequestException('Choose another customer to keep');
    const [a, b] = await Promise.all(
      [from, into].map((email) =>
        this.prisma.user.findUnique({
          where: { email },
          select: { id: true, email: true, role: true },
        }),
      ),
    );
    if (!a) throw new NotFoundException(`No customer account for ${from}`);
    if (!b) throw new NotFoundException(`No customer account for ${into}`);
    if (a.role !== Role.CUSTOMER || b.role !== Role.CUSTOMER)
      throw new BadRequestException(
        'Only customer accounts are merged, never team accounts',
      );
    const old = a.id;
    const keep = b.id;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const orders = await tx.order.updateMany({
          where: { userId: old },
          data: { userId: keep },
        });
        const requests = await tx.customRequest.updateMany({
          where: { userId: old },
          data: { userId: keep },
        });
        const quotations = await tx.quotation.updateMany({
          where: { OR: [{ customerId: old }, { customerEmail: a.email }] },
          data: { customerId: keep, customerEmail: b.email },
        });
        const leads = await tx.lead.updateMany({
          where: { OR: [{ customerId: old }, { email: a.email }] },
          data: { customerId: keep, email: b.email },
        });
        // Raw SQL: these change only who the row points at (no updatedAt), which is all the
        // database lets a posted entry or a history row change.
        const entries = await tx.$executeRaw`
          UPDATE "journal_entries" SET "customerId" = ${keep}::uuid WHERE "customerId" = ${old}::uuid`;
        await tx.$executeRaw`
          UPDATE "journal_lines" SET "customerId" = ${keep}::uuid WHERE "customerId" = ${old}::uuid`;
        for (const table of [
          'order_status_history',
          'custom_request_status_history',
          'quotation_status_history',
        ])
          await tx.$executeRawUnsafe(
            `UPDATE "${table}" SET "changedByUserId" = $1::uuid WHERE "changedByUserId" = $2::uuid`,
            keep,
            old,
          );
        await tx.upload.updateMany({
          where: { uploadedById: old },
          data: { uploadedById: keep },
        });
        await tx.auditLog.updateMany({
          where: { actorUserId: old },
          data: { actorUserId: keep },
        });
        await tx.user.delete({ where: { id: old } });
        return {
          into: b.email,
          moved: {
            orders: orders.count,
            quotations: quotations.count,
            requests: requests.count,
            leads: leads.count,
            entries,
          },
        };
      });
    } catch (error) {
      // Something this merge doesn't move still points at the account.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2003' || error.code === 'P2014')
      )
        throw new ConflictException(
          'Other records still point at this customer, so nothing was merged.',
        );
      throw error;
    }
  }
}
