import { Injectable, Logger } from '@nestjs/common';
import type { Email } from './mailer.js';
import { Mailer } from './mailer.js';
import { MailTemplates } from './mail-templates.js';

type Templates = MailTemplates;

/**
 * Sends the site's emails. Each is sent after the change it reports has been saved, without
 * holding up that request, and a failed send is logged — never turned into an error for the
 * person who placed the order or changed the status.
 */
@Injectable()
export class Notifications {
  private readonly logger = new Logger(Notifications.name);
  /** The sends in flight, so tests (and shutdown) can wait for them. */
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly mailer: Mailer,
    readonly templates: MailTemplates,
  ) {}

  /** Build the email with one of the templates, then send it in the background. */
  send<K extends keyof Templates>(
    template: K,
    data: Templates[K] extends (d: infer D) => Email ? D : never,
  ): void {
    const build = this.templates[template] as (d: typeof data) => Email;
    const email = build.call(this.templates, data);
    const sending = this.mailer
      .send(email)
      .catch((error: unknown) => {
        this.logger.warn(
          `Could not send "${email.subject}" to ${email.to}: ${String(error)}`,
        );
      })
      .finally(() => this.pending.delete(sending));
    this.pending.add(sending);
  }

  /** Resolves once every email started so far has been sent (or has failed). */
  async settled(): Promise<void> {
    await Promise.all(this.pending);
  }
}
