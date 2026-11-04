import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { whatsappNumber } from '@forgea/types';
import type { EnvironmentVariables } from '../config/environment.js';

/** Meta's Graph API for the WhatsApp Business Cloud API. */
const GRAPH = 'https://graph.facebook.com/v21.0';

/** One update to a customer's WhatsApp: what it is about, what happened, where to see it. */
export interface WhatsAppUpdate {
  /** e.g. "Order FG-7K2Q". */
  about: string;
  /** e.g. "Ready for pickup. Come by the studio any day from 10 to 6." */
  update: string;
  /** The page on the site, e.g. https://forgea-lab.com/orders. */
  link: string;
}

/**
 * Status updates to customers on WhatsApp, through the WhatsApp Business Cloud API: one
 * approved template (WHATSAPP_TEMPLATE) with three variables, {{1}} what it is about, {{2}} what
 * happened, {{3}} the link. Without WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID, each
 * message is written as a JSON file next to the email outbox instead (development, tests).
 */
@Injectable()
export class WhatsApp {
  private readonly logger = new Logger('WhatsApp');
  private readonly token: string | undefined;
  private readonly phoneNumberId: string | undefined;
  private readonly template: string;
  private readonly language: string;
  private readonly dir: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.token = config.get('WHATSAPP_ACCESS_TOKEN', { infer: true });
    this.phoneNumberId = config.get('WHATSAPP_PHONE_NUMBER_ID', {
      infer: true,
    });
    this.template = config.get('WHATSAPP_TEMPLATE', { infer: true });
    this.language = config.get('WHATSAPP_TEMPLATE_LANGUAGE', { infer: true });
    this.dir = `${resolve(config.get('MAIL_OUTBOX_DIR', { infer: true }))}-whatsapp`;
  }

  get configured(): boolean {
    return Boolean(this.token && this.phoneNumberId);
  }

  async send(phone: string, message: WhatsAppUpdate): Promise<void> {
    const to = whatsappNumber(phone);
    const body = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: this.template,
        language: { code: this.language },
        components: [
          {
            type: 'body',
            parameters: [message.about, message.update, message.link].map(
              // WhatsApp refuses newlines and long runs of spaces in variables.
              (text) => ({
                type: 'text',
                text: text.replace(/\s+/g, ' ').trim().slice(0, 900),
              }),
            ),
          },
        ],
      },
    };
    if (!this.configured) {
      await mkdir(this.dir, { recursive: true });
      const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.json`;
      await writeFile(join(this.dir, name), JSON.stringify(body, null, 2));
      this.logger.log(`"${message.about}" to +${to} → ${name}`);
      return;
    }
    const res = await fetch(`${GRAPH}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // Meta's error says why (no such template, number not on WhatsApp…); never the token.
      throw new Error(
        `WhatsApp answered ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    }
  }
}
