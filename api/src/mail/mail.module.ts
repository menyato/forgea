import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import { GoogleModule } from '../google/google.module.js';
import { GoogleServiceAccount } from '../google/google-service-account.js';
import { MailTemplates } from './mail-templates.js';
import { GmailMailer, Mailer, OutboxMailer } from './mailer.js';
import { Notifications } from './notifications.service.js';

/**
 * Email (Phase 9). Gmail API when the Workspace service account is configured; otherwise the
 * local outbox folder — and in production that is logged loudly, because nobody gets emails.
 */
@Module({
  imports: [GoogleModule],
  providers: [
    MailTemplates,
    Notifications,
    GmailMailer,
    OutboxMailer,
    {
      provide: Mailer,
      inject: [GoogleServiceAccount, GmailMailer, OutboxMailer, ConfigService],
      useFactory: (
        google: GoogleServiceAccount,
        gmail: GmailMailer,
        outbox: OutboxMailer,
        config: ConfigService<EnvironmentVariables, true>,
      ): Mailer => {
        if (google.configured) return gmail;
        if (config.get('NODE_ENV', { infer: true }) === 'production') {
          new Logger('Mail').error(
            'GOOGLE_SERVICE_ACCOUNT_KEY / MAIL_SENDER are not set: emails go to the outbox folder, not to customers',
          );
        }
        return outbox;
      },
    },
  ],
  exports: [Notifications],
})
export class MailModule {}
