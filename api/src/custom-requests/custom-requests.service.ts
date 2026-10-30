import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type CheckoutResult,
  type CustomRequestListItem,
  type CustomRequestView,
  isRequestExpired,
  type Page,
  type RequestEstimate,
  type StaffCustomRequest,
} from '@forgea/types';
import type {
  AcceptQuoteDto,
  CreateCustomRequestDto,
  CursorPageQuery,
  CustomRequestListQuery,
  EstimateRequestDto,
  QuoteCustomRequestDto,
} from '@forgea/validation';
import { toPage } from '../common/pagination/keyset.js';
import {
  CustomRequestStatus,
  UploadPurpose,
} from '../generated/prisma/enums.js';
import { LeadsService } from '../leads/leads.service.js';
import { Notifications } from '../mail/notifications.service.js';
import { CheckoutService } from '../orders/checkout.service.js';
import { StoreSettingsService } from '../store-settings/store-settings.service.js';
import { UploadsService } from '../uploads/uploads.service.js';
import {
  CustomRequestsRepository,
  type RequestRow,
} from './custom-requests.repository.js';
import { RequestEstimator } from './request-estimator.js';

const DAY_MS = 86_400_000;
const CHANGED =
  'This request changed meanwhile. Reload the page to see where it stands.';

/**
 * "Make me something": the customer describes it (optionally with a file and an instant
 * estimate), the studio quotes, and accepting the quote creates the order. Every status
 * change goes through the repository's guarded updates; the database records the history.
 */
@Injectable()
export class CustomRequestsService {
  constructor(
    private readonly requests: CustomRequestsRepository,
    private readonly uploads: UploadsService,
    private readonly estimator: RequestEstimator,
    private readonly settings: StoreSettingsService,
    private readonly checkout: CheckoutService,
    private readonly notifications: Notifications,
    private readonly leads: LeadsService,
  ) {}

  materials(): Promise<{ id: string; code: string; name: string }[]> {
    return this.requests.activeMaterials();
  }

  async estimate(
    dto: EstimateRequestDto,
    userId: string,
  ): Promise<{ estimate: RequestEstimate | null }> {
    const file = await this.ownFile(dto.fileKey, userId);
    return {
      estimate: await this.estimator.estimate(
        file,
        dto.materialId ?? null,
        dto.quantity,
      ),
    };
  }

  async create(
    dto: CreateCustomRequestDto,
    userId: string,
  ): Promise<CustomRequestView> {
    const materialId = dto.materialId ?? null;
    if (materialId && !(await this.requests.materialFor(materialId))) {
      throw new BadRequestException('That material is not available');
    }
    const file = dto.fileKey ? await this.ownFile(dto.fileKey, userId) : null;
    const estimate = file
      ? await this.estimator.estimate(file, materialId, dto.quantity)
      : null;
    const created = await this.requests.create({
      userId,
      title: dto.title,
      description: dto.description,
      quantity: dto.quantity,
      materialId,
      colour: dto.colour ?? null,
      fileKey: file?.key ?? null,
      estimate: estimate && { low: estimate.low, high: estimate.high },
    });
    // It shows in the sales pipeline too, linked to the request.
    await this.leads.fromCustomRequest({
      id: created.id,
      requestNumber: created.requestNumber,
      title: created.title,
      description: created.description,
      customer: { id: userId, ...created.user },
    });
    this.notifications.alertStudio(
      `New custom request ${created.requestNumber}: ${created.title}`,
      [
        `${created.user.name ?? created.user.email} asked for "${created.title}" (${created.quantity} piece${created.quantity === 1 ? '' : 's'}).`,
        file ? 'A file is attached.' : 'No file attached.',
      ],
      `/admin/requests/${created.id}`,
    );
    return toView(created);
  }

  async mine(
    userId: string,
    query: CursorPageQuery,
  ): Promise<Page<CustomRequestView>> {
    return toPage(await this.requests.listMine(userId, query), toView);
  }

  async mineOne(userId: string, number: string): Promise<CustomRequestView> {
    return toView(await this.findMine(userId, number));
  }

  /** The customer turns the quote down. */
  async decline(
    userId: string,
    number: string,
    note: string | undefined,
  ): Promise<CustomRequestView> {
    const r = await this.findMine(userId, number);
    if (r.status !== CustomRequestStatus.QUOTED) {
      throw new BadRequestException('Only a quote can be declined');
    }
    return this.closed(
      r.id,
      [CustomRequestStatus.QUOTED],
      CustomRequestStatus.DECLINED,
      userId,
      note,
    );
  }

  /** The customer withdraws a request the studio hasn't quoted yet. */
  async cancelMine(
    userId: string,
    number: string,
    note: string | undefined,
  ): Promise<CustomRequestView> {
    const r = await this.findMine(userId, number);
    if (r.status !== CustomRequestStatus.SUBMITTED) {
      throw new BadRequestException('Once quoted, decline the quote instead');
    }
    return this.closed(
      r.id,
      [CustomRequestStatus.SUBMITTED],
      CustomRequestStatus.CANCELLED,
      userId,
      note,
    );
  }

  /** Accepting creates the order (awaiting the deposit) and closes the request, together. */
  async accept(
    userId: string,
    number: string,
    dto: AcceptQuoteDto,
  ): Promise<CheckoutResult> {
    const r = await this.findMine(userId, number);
    if (isRequestExpired(r.status, r.quoteExpiresAt)) {
      throw new ConflictException(
        'This quote has expired. Ask us on WhatsApp for a new one.',
      );
    }
    // An accepted request still goes through checkout: a repeated submit (same key) gets
    // its order back, and any other is refused there, inside the order's transaction.
    const answerable =
      r.status === CustomRequestStatus.QUOTED ||
      r.status === CustomRequestStatus.ACCEPTED;
    if (!answerable || !r.quotedPrice) {
      throw new ConflictException('This request has no quote to accept');
    }
    // The price the customer saw must still be the quote (the studio may have re-quoted).
    if (!r.quotedPrice.equals(dto.quotedPrice)) {
      throw new ConflictException(
        'The studio updated this quote. Check the new price, then accept again.',
      );
    }
    return this.checkout.acceptQuote(dto, userId, {
      id: r.id,
      requestNumber: r.requestNumber,
      title: r.title,
      quotedPrice: r.quotedPrice.toFixed(2),
    });
  }

  counts(): Promise<Partial<Record<CustomRequestStatus, number>>> {
    return this.requests.countByStatus();
  }

  async list(
    query: CustomRequestListQuery,
  ): Promise<Page<CustomRequestListItem>> {
    return toPage(await this.requests.list(query), (r) => ({
      id: r.id,
      requestNumber: r.requestNumber,
      status: r.status,
      expired: isRequestExpired(r.status, r.quoteExpiresAt),
      title: r.title,
      customerEmail: r.user.email,
      quotedPrice: r.quotedPrice?.toFixed(2) ?? null,
      hasFile: r.fileKey !== null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async detail(id: string): Promise<StaffCustomRequest> {
    const r = await this.requests.findById(id);
    if (!r) throw new NotFoundException('Request not found');
    return toStaffView(r);
  }

  /** Sends or replaces the quote; it stays open for the owner's number of days. */
  async quote(
    id: string,
    dto: QuoteCustomRequestDto,
    actorId: string,
  ): Promise<StaffCustomRequest> {
    const { requests: rules } = await this.settings.get();
    const quoted = await this.requests.quote(id, actorId, {
      price: dto.price,
      note: dto.note ?? null,
      expiresAt: new Date(Date.now() + rules.quoteValidityDays * DAY_MS),
    });
    if (!quoted) await this.explainRefusal(id, 'quoted');
    const r = await this.detail(id);
    this.notifications.send('quoteReady', {
      to: r.customer.email,
      requestNumber: r.requestNumber,
      title: r.title,
      price: dto.price,
      note: dto.note ?? null,
      expiresAt: new Date(r.quote!.expiresAt),
    });
    return r;
  }

  /** The designer's preview, while the request is open (waiting for a quote or quoted). */
  async attachDesign(id: string, key: string): Promise<StaffCustomRequest> {
    if (!(await this.requests.setDesignPreview(id, key))) {
      await this.explainRefusal(id, 'given a design');
    }
    return this.detail(id);
  }

  /** The studio closes a request it can't make (the note tells the customer why). */
  async cancel(
    id: string,
    note: string | undefined,
    actorId: string,
  ): Promise<StaffCustomRequest> {
    const done = await this.requests.close(
      id,
      [CustomRequestStatus.SUBMITTED, CustomRequestStatus.QUOTED],
      CustomRequestStatus.CANCELLED,
      actorId,
      note ?? null,
    );
    if (!done) await this.explainRefusal(id, 'cancelled');
    const r = await this.detail(id);
    this.notifications.send('requestStatus', {
      to: r.customer.email,
      requestNumber: r.requestNumber,
      title: r.title,
      status: r.status,
      note: note ?? null,
    });
    return r;
  }

  private async closed(
    id: string,
    from: CustomRequestStatus[],
    to: CustomRequestStatus,
    actorId: string,
    note: string | undefined,
  ): Promise<CustomRequestView> {
    if (!(await this.requests.close(id, from, to, actorId, note ?? null))) {
      throw new ConflictException(CHANGED);
    }
    const r = await this.requests.findById(id);
    if (!r) throw new NotFoundException('Request not found');
    return toView(r);
  }

  private async explainRefusal(id: string, verb: string): Promise<never> {
    const r = await this.requests.findById(id);
    if (!r) throw new NotFoundException('Request not found');
    throw new ConflictException(
      `A request that is ${r.status.toLowerCase()} can't be ${verb}`,
    );
  }

  private async findMine(userId: string, number: string): Promise<RequestRow> {
    const r = await this.requests.findMine(userId, number);
    if (!r) throw new NotFoundException('Request not found');
    return r;
  }

  private async ownFile(key: string, userId: string) {
    const { mimeType } = await this.uploads.requireOwn(
      key,
      UploadPurpose.CUSTOM_REQUEST_FILE,
      userId,
    );
    return { key, mimeType };
  }
}

const MODEL_FILE = /\.(stl|glb)$/;

const fileView = (key: string | null): CustomRequestView['file'] =>
  key ? { key, kind: MODEL_FILE.test(key) ? 'model' : 'image' } : null;

function toView(r: RequestRow): CustomRequestView {
  return {
    requestNumber: r.requestNumber,
    status: r.status,
    expired: isRequestExpired(r.status, r.quoteExpiresAt),
    title: r.title,
    description: r.description,
    quantity: r.quantity,
    material: r.material,
    colour: r.colour,
    file: fileView(r.fileKey),
    design: fileView(r.designPreviewKey),
    estimate:
      r.estimateLow && r.estimateHigh
        ? { low: r.estimateLow.toFixed(2), high: r.estimateHigh.toFixed(2) }
        : null,
    quote:
      r.quotedPrice && r.quotedAt && r.quoteExpiresAt
        ? {
            price: r.quotedPrice.toFixed(2),
            note: r.quoteNote,
            quotedAt: r.quotedAt.toISOString(),
            expiresAt: r.quoteExpiresAt.toISOString(),
          }
        : null,
    orderNumber: r.order?.orderNumber ?? null,
    history: r.statusHistory.map((h) => ({
      status: h.status,
      changedAt: h.changedAt.toISOString(),
      note: h.note,
    })),
    createdAt: r.createdAt.toISOString(),
  };
}

function toStaffView(r: RequestRow): StaffCustomRequest {
  return { ...toView(r), id: r.id, customer: r.user };
}
