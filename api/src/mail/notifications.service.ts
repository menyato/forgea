import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import type { Email } from './mailer.js';
import { Mailer } from './mailer.js';
import { MailTemplates } from './mail-templates.js';

type Templates = MailTemplates;

const HOUR_MS = 60 * 60 * 1000;
const STUDIO_ALERTS_PER_HOUR = 60;

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

  /** Where the studio's own alerts go; none configured: no alerts. */
  private readonly studioEmail: string | undefined;

  constructor(
    private readonly mailer: Mailer,
    readonly templates: MailTemplates,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.studioEmail =
      config.get('STUDIO_NOTIFY_EMAIL', { infer: true }) ??
      config.get('MAIL_SENDER', { infer: true });
  }

  /**
   * Tells the studio something new needs the team (a new order, request or lead). At most 60
   * an hour: a flood of fake ideas can't fill the inbox or use up the daily sending quota
   * (everything still shows in the dashboard).
   */
  alertStudio(subject: string, lines: string[], path: string): void {
    if (!this.studioEmail) return;
    if (!this.allow('studio-alerts', STUDIO_ALERTS_PER_HOUR)) {
      this.logger.warn(`Studio alert not sent (hourly limit): ${subject}`);
      return;
    }
    this.send('studioAlert', { to: this.studioEmail, subject, lines, path });
  }

  /**
   * Like `send`, but at most `max` emails of this kind an hour for this key (e.g. password
   * reset links per address, so nobody can flood someone's inbox). Returns whether it sent.
   */
  sendAtMost<K extends keyof Templates>(
    key: string,
    max: number,
    template: K,
    data: Templates[K] extends (d: infer D) => Email ? D : never,
  ): boolean {
    if (!this.allow(key, max)) return false;
    this.send(template, data);
    return true;
  }

  /** When each limited email went out, per key, over the last hour (bounded). */
  private readonly recent = new Map<string, number[]>();

  private allow(key: string, max: number): boolean {
    const now = Date.now();
    const times = (this.recent.get(key) ?? []).filter((t) => now - t < HOUR_MS);
    if (times.length >= max) return false;
    this.recent.delete(key);
    if (this.recent.size >= 10_000) {
      this.recent.delete(this.recent.keys().next().value!);
    }
    this.recent.set(key, [...times, now]);
    return true;
  }

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
