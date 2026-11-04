import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import {
  ChangePasswordDto,
  ConfirmEmailDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResendEmailCodeDto,
  ResetPasswordDto,
  UpdateProfileDto,
} from '@forgea/validation';
import type { Request, Response } from 'express';
import { AuthCookies } from '../authorization/auth-cookies.js';
import type { AuthenticatedUser } from '../authorization/authenticated-user.js';
import { CurrentUser, Public } from '../authorization/decorators.js';
import type { EnvironmentVariables } from '../config/environment.js';
import { THROTTLE } from '../security/throttle-policies.js';
import { AuthService, type IssuedSession } from './auth.service.js';
import type { PendingConfirmation, Profile } from '@forgea/types';
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

  /** 202: not signed in yet; the code emailed to the address finishes it (email-code). */
  @Public()
  @Throttle(THROTTLE.auth)
  @HttpCode(202)
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<PendingConfirmation> {
    return this.auth.register(dto);
  }

  /** The emailed code and the browser's ticket: confirms the address and signs in. */
  @Public()
  @Throttle(THROTTLE.auth)
  @HttpCode(200)
  @Post('email-code')
  async confirmEmail(
    @Body() dto: ConfirmEmailDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Profile> {
    return this.signIn(
      res,
      await this.auth.confirmEmail(dto, requestContext(req)),
    );
  }

  /** A new code (throttled, and at most one a minute per account: it sends an email). */
  @Public()
  @Throttle(THROTTLE.auth)
  @HttpCode(200)
  @Post('email-code/resend')
  resendEmailCode(@Body() dto: ResendEmailCodeDto): Promise<{ sent: boolean }> {
    return this.auth.resendEmailCode(dto.ticket);
  }

  /** "Forgot your password?": always 204, whether or not the address has an account. */
  @Public()
  @Throttle(THROTTLE.auth)
  @HttpCode(204)
  @Post('password/forgot')
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.auth.requestPasswordReset(dto.email);
  }

  /** The new password, with the token from the emailed link. */
  @Public()
  @Throttle(THROTTLE.auth)
  @HttpCode(204)
  @Post('password/reset')
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.auth.resetPassword(dto.token, dto.password);
  }

  /** A signed-in customer's new password; this browser stays signed in, all others end. */
  @Throttle(THROTTLE.auth)
  @HttpCode(200)
  @Post('password/change')
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Profile> {
    return this.signIn(
      res,
      await this.auth.changePassword(
        user.id,
        dto.currentPassword,
        dto.newPassword,
        requestContext(req),
      ),
    );
  }

  /** The account page: name and phone. */
  @Patch('me')
  updateProfile(
    @Body() dto: UpdateProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Profile> {
    return this.auth.updateProfile(user.id, dto);
  }

  /** 200 and signed in; or 202 with a ticket when the address still needs its emailed code. */
  @Public()
  @Throttle(THROTTLE.auth)
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Profile | PendingConfirmation> {
    const result = await this.auth.loginWithPassword(dto, requestContext(req));
    if ('ticket' in result) {
      res.status(202);
      return result;
    }
    return this.signIn(res, result);
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
