import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HTTP } from '@forgea/types';
import type { CookieOptions, Request, Response } from 'express';
import type { EnvironmentVariables } from '../config/environment.js';

export const ACCESS_COOKIE = HTTP.ACCESS_COOKIE;
export const REFRESH_COOKIE = HTTP.REFRESH_COOKIE;

/**
 * Session cookies for every sign-in method: httpOnly (scripts can't read them),
 * Secure, SameSite=Strict (never sent on cross-site requests).
 */
@Injectable()
export class AuthCookies {
  private readonly base: CookieOptions;
  private readonly refreshMaxAgeMs: number;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const domain = config.get('COOKIE_DOMAIN', { infer: true });
    this.base = {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      ...(domain ? { domain } : {}),
    };
    this.refreshMaxAgeMs =
      config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 86_400_000;
  }

  set(
    res: Response,
    tokens: { access: string; accessMaxAgeMs: number; refresh: string },
  ): void {
    res.cookie(ACCESS_COOKIE, tokens.access, {
      ...this.base,
      maxAge: tokens.accessMaxAgeMs,
    });
    res.cookie(REFRESH_COOKIE, tokens.refresh, {
      ...this.base,
      maxAge: this.refreshMaxAgeMs,
    });
  }

  clear(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, this.base);
    res.clearCookie(REFRESH_COOKIE, this.base);
  }

  access(req: Request): string | undefined {
    return readCookie(req, ACCESS_COOKIE);
  }

  refresh(req: Request): string | undefined {
    return readCookie(req, REFRESH_COOKIE);
  }
}

function readCookie(req: Request, name: string): string | undefined {
  const cookies: unknown = req.cookies;
  if (typeof cookies !== 'object' || cookies === null) return undefined;
  const value = (cookies as Record<string, unknown>)[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
