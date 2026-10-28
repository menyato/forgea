import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { LoginDto, RegisterDto, VerifyEmailDto } from '@forgea/validation';
import type { Request, Response } from 'express';
import { AuthCookies } from '../authorization/auth-cookies.js';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import { CurrentUser, Public } from '../authorization/decorators.js';
import type { EnvironmentVariables } from '../config/environment.js';
import { THROTTLE } from '../security/throttle-policies.js';
import { AuthService, type IssuedSession } from './auth.service.js';
import type { Profile } from '@forgea/types';
import {
  GoogleAuthGuard,
  googleReturnPath,
  parseGoogleClaims,
} from './google-oidc.js';
import { requestContext } from './request-context.js';

@Controller('auth')
export class AuthController {
  private readonly webUrl: string;

  constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookies,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.webUrl = config.get('PUBLIC_WEB_URL', { infer: true });
  }

  @Public()
  @Throttle(THROTTLE.auth)
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Profile> {
    return this.signIn(res, await this.auth.register(dto, requestContext(req)));
  }

  /** The link from the "confirm your email address" message. */
  @Public()
  @Throttle(THROTTLE.auth)
  @HttpCode(200)
  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<Profile> {
    return this.auth.verifyEmail(dto.token);
  }

  /** A new link for the signed-in customer (throttled: it sends an email). */
  @Throttle(THROTTLE.auth)
  @HttpCode(204)
  @Post('verify-email/resend')
  async resendVerification(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.auth.resendVerification(user.id);
  }

  @Public()
  @Throttle(THROTTLE.auth)
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Profile> {
    return this.signIn(
      res,
      await this.auth.loginWithPassword(dto, requestContext(req)),
    );
  }

  @Public()
  @Throttle(THROTTLE.auth)
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Profile> {
    const token = this.cookies.refresh(req);
    if (!token) throw new UnauthorizedException('Please sign in again');
    try {
      return this.signIn(
        res,
        await this.auth.refresh(token, requestContext(req)),
      );
    } catch (error) {
      this.cookies.clear(res);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = this.cookies.refresh(req);
    if (token) await this.auth.logout(token);
    this.cookies.clear(res);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<Profile> {
    return this.auth.profile(user.id);
  }

  /** Redirects to Google (handled entirely by GoogleAuthGuard). `?next=` is where shoppers return. */
  @Public()
  @Throttle(THROTTLE.auth)
  @UseGuards(GoogleAuthGuard)
  @Get('google')
  startGoogle(): void {}

  @Public()
  @Throttle(THROTTLE.auth)
  @UseGuards(GoogleAuthGuard)
  @Get('google/callback')
  async googleCallback(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const claims = parseGoogleClaims(req.googleClaims);
    try {
      if (!claims) throw new UnauthorizedException('Google sign-in failed');
      const session = await this.auth.loginWithGoogle(
        claims,
        requestContext(req),
      );
      this.signIn(res, session);
      // Staff always land in the dashboard; customers go back to where they started.
      const landing =
        session.landingPath === 'customer'
          ? googleReturnPath(req)
          : session.landingPath;
      res.redirect(303, new URL(landing, this.webUrl).href);
    } catch (error) {
      // Back to the storefront with a reason it can show, never a raw error page.
      const reason =
        error instanceof HttpException
          ? error.message
          : 'Google sign-in failed';
      const target = new URL('/sign-in', this.webUrl);
      target.searchParams.set('error', reason);
      res.redirect(303, target.href);
    }
  }

  private signIn(res: Response, session: IssuedSession): Profile {
    this.cookies.set(res, {
      access: session.accessToken,
      accessMaxAgeMs: session.accessMaxAgeMs,
      refresh: session.refreshToken,
    });
    return session.profile;
  }
}
