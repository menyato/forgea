import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../database/database.module.js';
import type { EnvironmentVariables } from '../config/environment.js';
import { AccessTokenService } from './access-token.service.js';
import { AuthCookies } from './auth-cookies.js';
import { EmailVerificationTokens } from './email-verification-tokens.js';
import { PasswordResetTokens } from './password-reset-tokens.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { PermissionsGuard } from './permissions.guard.js';
import { QuotationLinkTokens } from './quotation-link-tokens.js';
import { TeamPermissions } from './team-permissions.js';

/** Who is calling and what they may do. Global so every feature module can use the guards. */
@Global()
@Module({
  imports: [
    DatabaseModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
      }),
    }),
  ],
  providers: [
    AccessTokenService,
    EmailVerificationTokens,
    PasswordResetTokens,
    QuotationLinkTokens,
    AuthCookies,
    JwtAuthGuard,
    PermissionsGuard,
    TeamPermissions,
  ],
  exports: [
    AccessTokenService,
    EmailVerificationTokens,
    PasswordResetTokens,
    QuotationLinkTokens,
    AuthCookies,
    JwtAuthGuard,
    PermissionsGuard,
    TeamPermissions,
  ],
})
export class AuthorizationModule {}
