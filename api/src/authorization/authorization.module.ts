import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { EnvironmentVariables } from '../config/environment.js';
import { AccessTokenService } from './access-token.service.js';
import { AuthCookies } from './auth-cookies.js';
import { EmailVerificationTokens } from './email-verification-tokens.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RolesGuard } from './roles.guard.js';

/** Who is calling and what they may do. Global so every feature module can use the guards. */
@Global()
@Module({
  imports: [
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
    AuthCookies,
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [
    AccessTokenService,
    EmailVerificationTokens,
    AuthCookies,
    JwtAuthGuard,
    RolesGuard,
  ],
})
export class AuthorizationModule {}
