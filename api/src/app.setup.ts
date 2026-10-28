import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import cookieSession from 'cookie-session';
import helmet from 'helmet';
import {
  type EnvironmentVariables,
  isProduction,
} from './config/environment.js';
import { CSRF_HEADER } from './security/csrf.guard.js';
import { OriginPolicy } from './security/origin-policy.js';

/**
 * HTTP-level security shared by main.ts and the e2e tests, so tests exercise exactly what
 * production runs. Guards (throttling, CSRF, auth, roles) are registered in AppModule.
 */
export function configureApp(app: NestExpressApplication): void {
  const config =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  const origins = app.get(OriginPolicy);
  const prod = isProduction({
    NODE_ENV: config.get('NODE_ENV', { infer: true }),
  });

  // Caddy (deploy/edge/Caddyfile) is the one proxy hop we trust for req.ip / req.secure.
  app.set('trust proxy', prod ? 1 : false);

  app.use(
    helmet({
      // The API only returns JSON; it never needs to load or be framed by anything.
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.enableCors({
    origin: (origin, callback) => callback(null, origins.isAllowed(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', CSRF_HEADER],
    maxAge: 600,
  });

  // The secret signs the guest cart cookie (req.signedCookies); auth cookies don't need it.
  app.use(cookieParser(config.get('COOKIE_SECRET', { infer: true })));

  // Holds only Google's one-time state/nonce/PKCE values for the 10-minute sign-in round trip.
  // SameSite=Lax (not Strict) because Google's redirect back is a cross-site navigation.
  app.use(
    '/auth/google',
    cookieSession({
      name: 'forgea_oauth',
      keys: [config.get('COOKIE_SECRET', { infer: true })],
      maxAge: 10 * 60_000,
      sameSite: 'lax',
      secure: prod,
      httpOnly: true,
      path: '/auth/google',
    }),
  );

  // Every DTO: unknown fields rejected, values converted to the declared types.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: true,
    }),
  );

  // Docker sends SIGTERM before stopping a container; this closes the DB pool cleanly.
  app.enableShutdownHooks();
}
