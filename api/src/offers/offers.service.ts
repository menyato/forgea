import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CurrentFreeOffer, FreeOfferView } from '@forgea/types';
import type { SaveFreeOfferDto } from '@forgea/validation';
import { lock } from '../common/advisory-lock.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { type OfferRow, OffersRepository } from './offers.repository.js';

/**
 * Free offers: a piece given for a limited time, one per customer, up to the owner's number.
 * The shop shows the one running; a cart line claimed under it costs nothing while it runs;
 * the order checks it again, under a lock, so it is never given past its limit or twice.
 */
@Injectable()
export class OffersService {
  constructor(
    private readonly offers: OffersRepository,
    private readonly prisma: PrismaService,
  ) {}

  async list(): Promise<FreeOfferView[]> {
    const rows = await this.offers.list();
    const claimed = await this.offers.claimed(rows.map((r) => r.id));
    return rows.map((r) => toView(r, claimed.get(r.id) ?? 0));
  }

  async get(id: string): Promise<FreeOfferView> {
    const row = await this.offers.find(id);
    if (!row) throw new NotFoundException('No such offer');
    const claimed = await this.offers.claimed([id]);
    return toView(row, claimed.get(id) ?? 0);
  }

  async create(dto: SaveFreeOfferDto): Promise<FreeOfferView> {
    await this.check(dto);
    return toView(await this.offers.create(dto), 0);
  }

  async update(id: string, dto: SaveFreeOfferDto): Promise<FreeOfferView> {
    if (!(await this.offers.find(id)))
      throw new NotFoundException('No such offer');
    await this.check(dto);
    await this.offers.update(id, dto);
    return this.get(id);
  }

  /** The offer the shop shows now (the one ending first with pieces left), or null. */
  async current(now = new Date()): Promise<CurrentFreeOffer | null> {
    const rows = (await this.offers.running(now)).filter(
      (r) => r.product.active,
    );
    const claimed = await this.offers.claimed(rows.map((r) => r.id));
    for (const r of rows) {
      const left =
        r.maxClaims === null
          ? null
          : Math.max(0, r.maxClaims - (claimed.get(r.id) ?? 0));
      if (left === 0) continue;
      return {
        id: r.id,
        title: r.title,
        description: r.description,
        endsAt: r.endsAt.toISOString(),
        left,
        product: {
          id: r.productId,
          slug: r.product.slug,
          name: r.product.name,
        },
      };
    }
    return null;
  }

  /**
   * Whether `offerId` gives `productId` now: 400 with the customer's reason when not (it
   * ended, is used up, is for another piece). Used when the line goes in the cart.
   */
  async claimable(offerId: string, productId: string): Promise<void> {
    const offer = await this.offers.find(offerId);
    if (!offer || offer.productId !== productId)
      throw new BadRequestException('This offer is not for this piece');
    const reason = notRunning(offer, new Date());
    if (reason) throw new BadRequestException(reason);
    const claimed = (await this.offers.claimed([offerId])).get(offerId) ?? 0;
    if (offer.maxClaims !== null && claimed >= offer.maxClaims)
      throw new BadRequestException('All the free pieces were claimed');
  }

  /** Whether a cart line claimed under `offerId` is still free now (prices it 0 or not). */
  async running(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const now = new Date();
    const rows = await this.offers.running(now);
    return new Set(rows.filter((r) => ids.includes(r.id)).map((r) => r.id));
  }

  /**
   * Inside the order's transaction: holds the offer's lock and checks it again (running,
   * pieces left, this customer's first), so two orders at once can't take the last piece or
   * one customer two. 409 with the reason; the order is not made.
   */
  async claimIn(
    tx: Prisma.TransactionClient,
    offerId: string,
    userId: string,
  ): Promise<void> {
    await lock(tx, `offer:${offerId}`);
    const offer = await this.offers.find(offerId, tx);
    const reason = offer ? notRunning(offer, new Date()) : 'This offer ended';
    if (reason)
      throw new ConflictException(`${reason}: remove it from your cart`);
    const { total, theirs } = await this.offers.claimsIn(tx, offerId, userId);
    if (theirs > 0)
      throw new ConflictException(
        'You already claimed this free piece: remove it from your cart',
      );
    if (offer!.maxClaims !== null && total >= offer!.maxClaims)
      throw new ConflictException(
        'All the free pieces were claimed: remove it from your cart',
      );
  }

  private async check(dto: SaveFreeOfferDto): Promise<void> {
    if (dto.endsAt <= dto.startsAt)
      throw new BadRequestException('It must end after it starts');
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      select: { studioOnly: true },
    });
    if (!product) throw new BadRequestException('Choose the product');
    if (product.studioOnly)
      throw new BadRequestException('A studio-only piece is never given away');
  }
}

/** Why an offer can't be claimed now, in the customer's words; null while it runs. */
function notRunning(offer: OfferRow, now: Date): string | null {
  if (!offer.active || !offer.product.active) return 'This offer ended';
  if (now < offer.startsAt) return 'This offer has not started yet';
  if (now >= offer.endsAt) return 'This offer ended';
  return null;
}

function toView(r: OfferRow, claimed: number): FreeOfferView {
  return {
    id: r.id,
    productId: r.productId,
    productName: r.product.name,
    productSlug: r.product.slug,
    title: r.title,
    description: r.description,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    maxClaims: r.maxClaims,
    claimed,
    active: r.active,
  };
}
