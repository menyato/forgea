import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EnvironmentVariables } from '../config/environment.js';
import { WhatsApp } from './whatsapp.js';

const update = {
  about: 'Order FG-7K2Q',
  update: 'Ready for pickup.\nCome by any day.',
  link: 'https://forgea-lab.com/orders',
};

const configured = (extra: Record<string, string>, dir: string) =>
  new ConfigService<EnvironmentVariables, true>({
    MAIL_OUTBOX_DIR: dir,
    WHATSAPP_TEMPLATE: 'forgea_update',
    WHATSAPP_TEMPLATE_LANGUAGE: 'en',
    ...extra,
  });

describe('WhatsApp', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('without the API set up, writes the message next to the email outbox', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wa-'));
    const whatsApp = new WhatsApp(configured({}, join(root, 'outbox')));
    expect(whatsApp.configured).toBe(false);
    await whatsApp.send('70 123 456', update);
    const dir = join(root, 'outbox-whatsapp');
    const [file] = await readdir(dir);
    const body = JSON.parse(await readFile(join(dir, file!), 'utf8'));
    // A local number is Lebanese; newlines are not allowed in variables.
    expect(body).toMatchObject({
      to: '96170123456',
      template: { name: 'forgea_update', language: { code: 'en' } },
    });
    expect(
      body.template.components[0].parameters.map(
        (p: { text: string }) => p.text,
      ),
    ).toEqual([
      'Order FG-7K2Q',
      'Ready for pickup. Come by any day.',
      'https://forgea-lab.com/orders',
    ]);
    await rm(root, { recursive: true, force: true });
  });

  it('with the API set up, sends the template through Meta, and reports a refusal', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{"error":{"message":"Template not found"}}', {
        status: calls.length === 1 ? 200 : 404,
      });
    });
    const whatsApp = new WhatsApp(
      configured(
        {
          WHATSAPP_ACCESS_TOKEN: 'test-token',
          WHATSAPP_PHONE_NUMBER_ID: '1234567890',
        },
        'unused',
      ),
    );
    await whatsApp.send('+33 6 12 34 56 78', update);
    expect(calls[0]!.url).toBe(
      'https://graph.facebook.com/v21.0/1234567890/messages',
    );
    expect(JSON.parse(calls[0]!.init.body as string).to).toBe('33612345678');
    expect(
      (calls[0]!.init.headers as Record<string, string>)['Authorization'],
    ).toBe('Bearer test-token');
    await expect(whatsApp.send('70 123 456', update)).rejects.toThrow(
      /WhatsApp answered 404: .*Template not found/,
    );
  });
});
