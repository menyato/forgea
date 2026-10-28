import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

const minutes = (n: number) => n * 60_000;
const hours = (n: number) => n * 3_600_000;

/** Global limits per client IP, applied to every route. */
export const DEFAULT_THROTTLERS = [
  { name: 'default', ttl: minutes(1), limit: 120 },
  { name: 'hourly', ttl: hours(1), limit: 3000 },
];

/**
 * Stricter per-route limits, used as `@Throttle(THROTTLE.auth)`.
 * Each overrides both windows: a short burst limit and an hourly ceiling.
 */
export const THROTTLE = {
  /** Login, register, refresh: slows password guessing. */
  auth: {
    default: { limit: 5, ttl: minutes(1) },
    hourly: { limit: 30, ttl: hours(1) },
  },
  /** Custom-design inquiries: stops form spam. */
  lead: {
    default: { limit: 3, ttl: minutes(10) },
    hourly: { limit: 10, ttl: hours(1) },
  },
  /** Price quotes (Phase 5): each one costs a database read and pricing work. */
  quote: {
    default: { limit: 30, ttl: minutes(1) },
    hourly: { limit: 300, ttl: hours(1) },
  },
  /** Placing an order: a person checks out a few times at most. */
  checkout: {
    default: { limit: 5, ttl: minutes(1) },
    hourly: { limit: 20, ttl: hours(1) },
  },
  /** New custom requests from signed-in customers: a person sends a few at most. */
  customRequest: {
    default: { limit: 10, ttl: minutes(10) },
    hourly: { limit: 30, ttl: hours(1) },
  },
  /** Customers' files for custom requests: large, so few per person. */
  upload: {
    default: { limit: 10, ttl: minutes(10) },
    hourly: { limit: 40, ttl: hours(1) },
  },
  /** Cart changes (Phase 5): generous for shoppers, bounded for scripts. */
  cart: {
    default: { limit: 60, ttl: minutes(1) },
    hourly: { limit: 600, ttl: hours(1) },
  },
} as const;

/** Tracks clients by the Cloudflare-aware IP resolved in ClientIpMiddleware. */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const ip = req['clientIp'];
    return Promise.resolve(typeof ip === 'string' ? ip : 'unknown');
  }
}
