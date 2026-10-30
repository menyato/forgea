import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { DatabaseModule } from '../database/database.module.js';
import { MailModule } from '../mail/mail.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { ExpiredSessionsCleaner } from './expired-sessions-cleaner.js';
import { LoginAttempts } from './login-attempts.js';
import { GoogleAuthGuard, GoogleOidc } from './google-oidc.js';
import { PasswordHasher } from './password-hasher.js';
import { SessionService } from './session.service.js';
import { SessionsRepository } from './sessions.repository.js';

/** Signing in and out: email + password, Google, refresh-token sessions. */
@Module({
  imports: [
    DatabaseModule,
    UsersModule,
    MailModule,
    PassportModule.register({ session: false }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    ExpiredSessionsCleaner,
    LoginAttempts,
    PasswordHasher,
    SessionService,
    SessionsRepository,
    GoogleOidc,
    GoogleAuthGuard,
  ],
})
export class AuthModule {}
