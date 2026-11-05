// class-transformer reads `design:type` metadata to convert strings (e.g. PORT) to numbers.
import 'reflect-metadata';
import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

const toBoolean = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value === 'true' : value,
  );
const toList = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : value,
  );
const urlOptions = { require_tld: false, require_protocol: true };

/**
 * Every environment variable the API reads. Locally these come from api/.env;
 * on the servers they come from the deployment's env file (deploy/README.md). See api/.env.example.
 */
export class EnvironmentVariables {
  @IsIn(NODE_ENVS)
  NODE_ENV: NodeEnv = 'development';

  @IsString()
  @Matches(/^postgres(ql)?:\/\//, {
    message: 'DATABASE_URL must be a postgres:// URL',
  })
  DATABASE_URL!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  /** Where the storefront lives; OAuth sends users back here. */
  @IsUrl(urlOptions)
  PUBLIC_WEB_URL: string = 'http://localhost:5173';

  /** This API's own public URL; used to build the Google callback URL. */
  @IsUrl(urlOptions)
  PUBLIC_API_URL: string = 'http://localhost:3000';

  /** Extra CORS origins for local development. Ignored in production. */
  @toList()
  @IsUrl(urlOptions, { each: true })
  DEV_CORS_ORIGINS: string[] = ['http://localhost:5173'];

  /**
   * Leave unset (host-only cookies): the deployed API has no address of its own, its Google
   * sign-in paths are served from the website's host (deploy/edge/Caddyfile). Setting a parent
   * domain would hand production's cookies to staging.forgea-lab.com too.
   */
  @IsOptional()
  @Matches(/^\.?[a-z0-9.-]+$/)
  COOKIE_DOMAIN?: string;

  /** HMAC key for access-token JWTs. Generate with: openssl rand -base64 48 */
  @IsString()
  @MinLength(32, {
    message: 'JWT_ACCESS_SECRET must be at least 32 characters',
  })
  JWT_ACCESS_SECRET!: string;

  /** Signs the short-lived OAuth flow cookie. */
  @IsString()
  @MinLength(32, { message: 'COOKIE_SECRET must be at least 32 characters' })
  COOKIE_SECRET!: string;

  @IsInt()
  @Min(60)
  @Max(3600)
  ACCESS_TOKEN_TTL_SECONDS: number = 900;

  @IsInt()
  @Min(1)
  @Max(90)
  REFRESH_TOKEN_TTL_DAYS: number = 30;

  @IsOptional()
  @IsString()
  GOOGLE_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  GOOGLE_CLIENT_SECRET?: string;

  /** Google Workspace domain whose accounts may hold ADMIN/STAFF roles. */
  @Matches(/^[a-z0-9.-]+\.[a-z]{2,}$/)
  WORKSPACE_DOMAIN: string = 'forgea-lab.com';

  /** The first Workspace account to sign in with this email becomes ADMIN, if no admin exists. */
  @IsOptional()
  @Matches(/^[^@\s]+@[^@\s]+$/)
  BOOTSTRAP_ADMIN_EMAIL?: string;

  /**
   * Read the client IP from Cloudflare's CF-Connecting-IP header. Only safe when the API
   * is reachable exclusively through Cloudflare (Phase 13); otherwise it can be spoofed.
   */
  @toBoolean()
  @IsBoolean()
  TRUST_CLOUDFLARE: boolean = false;

  /**
   * Shared with the storefront server, which forwards each shopper's IP with it.
   * Generate with: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   */
  @IsOptional()
  @IsString()
  @MinLength(32, {
    message: 'INTERNAL_PROXY_SECRET must be at least 32 characters',
  })
  INTERNAL_PROXY_SECRET?: string;

  /** Local-disk upload storage for development; Cloud Storage replaces it in Phase 7. */
  @IsString()
  UPLOAD_DIR: string = '.uploads';

  /**
   * Phase 9: a Google Cloud service account key (the JSON file's contents) with Workspace
   * domain-wide delegation for gmail.send and calendar.events. From the server's env file in
   * production. Unset: emails go to MAIL_OUTBOX_DIR and calendar changes are only logged.
   */
  @IsOptional()
  @IsString()
  GOOGLE_SERVICE_ACCOUNT_KEY?: string;

  /** The Workspace address emails come from (and that the service account acts as). */
  @IsOptional()
  @Matches(/^[^@\s]+@[^@\s]+$/)
  MAIL_SENDER?: string;

  /**
   * The address emails show as their sender, when it isn't MAIL_SENDER itself: an alias of
   * that mailbox (e.g. hello@ on the owner's account), listed under its Gmail "Send mail as".
   */
  @IsOptional()
  @Matches(/^[^@\s]+@[^@\s]+$/)
  MAIL_FROM?: string;

  /** Where emails are written as .eml files when they aren't sent (development, tests). */
  @IsString()
  MAIL_OUTBOX_DIR: string = '.outbox';

  /** The studio calendar that scheduled print jobs appear on (e.g. its email-like id). */
  @IsOptional()
  @IsString()
  GOOGLE_CALENDAR_ID?: string;

  /**
   * The Backups page (set by deploy/app/compose.yaml on the server): the backups folder,
   * mounted read-only, and where requests for backup.sh are left. Unset: the page says
   * backups aren't set up here (development, tests).
   */
  @IsOptional()
  @IsString()
  BACKUP_DIR?: string;

  @IsOptional()
  @IsString()
  BACKUP_REQUEST_DIR?: string;

  /** Where the studio's alerts go (new orders, requests, leads); defaults to MAIL_SENDER. */
  @IsOptional()
  @Matches(/^[^@\s]+@[^@\s]+$/)
  STUDIO_NOTIFY_EMAIL?: string;

  /**
   * WhatsApp Business Cloud API (Meta): a permanent access token of the business's system
   * user, and the id of the studio's WhatsApp number there. Both unset: WhatsApp updates are
   * written next to the email outbox instead.
   */
  @IsOptional()
  @IsString()
  WHATSAPP_ACCESS_TOKEN?: string;

  @IsOptional()
  @Matches(/^\d{5,30}$/)
  WHATSAPP_PHONE_NUMBER_ID?: string;

  /** The approved message template: {{1}} what it is about, {{2}} what happened, {{3}} a link. */
  @Matches(/^[a-z0-9_]{1,512}$/)
  WHATSAPP_TEMPLATE: string = 'forgea_update';

  @Matches(/^[a-z]{2}(_[A-Z]{2})?$/)
  WHATSAPP_TEMPLATE_LANGUAGE: string = 'en';
}

/** Rules that only make sense together, or only in production. */
function crossFieldErrors(env: EnvironmentVariables): string[] {
  const errors: string[] = [];
  if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
    errors.push(
      'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together',
    );
  }
  if (
    Boolean(env.WHATSAPP_ACCESS_TOKEN) !== Boolean(env.WHATSAPP_PHONE_NUMBER_ID)
  ) {
    errors.push(
      'WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID must be set together',
    );
  }
  if (env.GOOGLE_SERVICE_ACCOUNT_KEY && !env.MAIL_SENDER) {
    errors.push('MAIL_SENDER is needed with GOOGLE_SERVICE_ACCOUNT_KEY');
  }
  if (env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    try {
      const key = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY) as Record<
        string,
        unknown
      >;
      if (
        typeof key['client_email'] !== 'string' ||
        typeof key['private_key'] !== 'string'
      ) {
        errors.push(
          'GOOGLE_SERVICE_ACCOUNT_KEY needs client_email and private_key',
        );
      }
    } catch {
      errors.push(
        'GOOGLE_SERVICE_ACCOUNT_KEY must be the JSON of the key file',
      );
    }
  }
  if (env.NODE_ENV === 'production') {
    if (!env.GOOGLE_CLIENT_ID)
      errors.push('Google sign-in is required in production');
    if (!env.INTERNAL_PROXY_SECRET)
      errors.push('INTERNAL_PROXY_SECRET is required in production');
    for (const [name, url] of [
      ['PUBLIC_WEB_URL', env.PUBLIC_WEB_URL],
      ['PUBLIC_API_URL', env.PUBLIC_API_URL],
    ] as const) {
      if (!url.startsWith('https://'))
        errors.push(`${name} must use https in production`);
    }
    if (env.JWT_ACCESS_SECRET === env.COOKIE_SECRET) {
      errors.push('JWT_ACCESS_SECRET and COOKIE_SECRET must differ');
    }
  }
  return errors;
}

/** Fails fast at boot, listing every invalid variable, instead of failing on first use. */
export function validateEnvironment(
  raw: Record<string, unknown>,
): EnvironmentVariables {
  // "NAME=" in an env file (as the deploy templates leave optional settings) means not set:
  // @IsOptional() only skips undefined, so an empty string would fail e.g. MAIL_SENDER's pattern.
  const set = Object.fromEntries(
    Object.entries(raw).filter(([, value]) => value !== ''),
  );
  const env = plainToInstance(EnvironmentVariables, set, {
    enableImplicitConversion: true,
  });
  const errors = [
    ...validateSync(env, { skipMissingProperties: false }).flatMap((e) =>
      Object.values(e.constraints ?? {}),
    ),
    ...crossFieldErrors(env),
  ];
  if (errors.length > 0) {
    throw new Error(`Invalid environment: ${errors.join('; ')}`);
  }
  return env;
}

export const isProduction = (env: Pick<EnvironmentVariables, 'NODE_ENV'>) =>
  env.NODE_ENV === 'production';
