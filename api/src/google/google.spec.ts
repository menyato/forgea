import { generateKeyPairSync, createVerify } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import { GmailMailer } from '../mail/mailer.js';
import { GoogleCalendar } from './google-calendar.js';
import { GoogleServiceAccount } from './google-service-account.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const KEY = JSON.stringify({
  client_email: 'forgea@project.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
});

const config = (extra: Partial<EnvironmentVariables> = {}) =>
  new ConfigService<EnvironmentVariables, true>({
    GOOGLE_SERVICE_ACCOUNT_KEY: KEY,
    MAIL_SENDER: 'hello@forgea-lab.com',
    GOOGLE_CALENDAR_ID: 'studio@group.calendar.google.com',
    ...extra,
  });

interface Call {
  url: string;
  init: RequestInit;
}

/** Records calls and answers like Google would. */
function fakeGoogle(answer: (url: string, init: RequestInit) => Response) {
  const calls: Call[] = [];
  const fetchImpl = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({ url, init: init ?? {} });
    return answer(url, init ?? {});
  };
  return { calls, fetchImpl: fetchImpl as typeof fetch };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const tokenAnswer = () =>
  json({ access_token: 'ya29.token', expires_in: 3600 });

function account(fetchImpl: typeof fetch, cfg = config()) {
  const a = new GoogleServiceAccount(cfg);
  (a as unknown as { fetchImpl: typeof fetch }).fetchImpl = fetchImpl;
  return a;
}

describe('GoogleServiceAccount', () => {
  it('signs a request as the studio address, for one scope, verifiable with the key', async () => {
    const google = fakeGoogle(tokenAnswer);
    const token = await account(google.fetchImpl).accessToken('scope-a');
    expect(token).toBe('ya29.token');
    const body = new URLSearchParams(google.calls[0]!.init.body as string);
    expect(body.get('grant_type')).toBe(
      'urn:ietf:params:oauth:grant-type:jwt-bearer',
    );
    const [header, claims, signature] = body.get('assertion')!.split('.');
    const decoded = JSON.parse(Buffer.from(claims!, 'base64url').toString());
    expect(decoded).toMatchObject({
      iss: 'forgea@project.iam.gserviceaccount.com',
      sub: 'hello@forgea-lab.com',
      scope: 'scope-a',
      aud: 'https://oauth2.googleapis.com/token',
    });
    expect(
      createVerify('RSA-SHA256')
        .update(`${header}.${claims}`)
        .verify(publicKey, signature!, 'base64url'),
    ).toBe(true);
  });

  it('reuses a token until shortly before it expires', async () => {
    const google = fakeGoogle(tokenAnswer);
    const a = account(google.fetchImpl);
    await a.accessToken('s', 0);
    await a.accessToken('s', 3_000_000);
    expect(google.calls).toHaveLength(1);
    await a.accessToken('s', 3_560_000);
    expect(google.calls).toHaveLength(2);
  });

  it('is off without a key, and says so instead of calling Google', async () => {
    const a = account(fakeGoogle(tokenAnswer).fetchImpl, new ConfigService({}));
    expect(a.configured).toBe(false);
    await expect(a.accessToken('s')).rejects.toThrow(/not configured/);
  });
});

describe('GmailMailer', () => {
  it('sends the message as the studio through the Gmail API', async () => {
    const google = fakeGoogle((url) =>
      url.includes('oauth2') ? tokenAnswer() : json({ id: 'm1' }),
    );
    const mailer = new GmailMailer(account(google.fetchImpl), config());
    (mailer as unknown as { fetchImpl: typeof fetch }).fetchImpl =
      google.fetchImpl;
    await mailer.send({
      to: 'r@example.com',
      subject: 'Hi',
      text: 'x',
      html: '<p>x</p>',
    });
    const send = google.calls[1]!;
    expect(send.url).toBe(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    );
    expect((send.init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer ya29.token',
    );
    const raw = Buffer.from(
      JSON.parse(send.init.body as string).raw,
      'base64url',
    ).toString();
    expect(raw).toContain('To: r@example.com');
  });

  it('reports a refusal as an error (logged by Notifications)', async () => {
    const google = fakeGoogle((url) =>
      url.includes('oauth2') ? tokenAnswer() : json({}, 403),
    );
    const mailer = new GmailMailer(account(google.fetchImpl), config());
    (mailer as unknown as { fetchImpl: typeof fetch }).fetchImpl =
      google.fetchImpl;
    await expect(
      mailer.send({ to: 'r@example.com', subject: 'Hi', text: 'x', html: 'x' }),
    ).rejects.toThrow(/403/);
  });
});

describe('GoogleCalendar', () => {
  const event = {
    summary: 'Print FG-1',
    description: '60 g PLA',
    start: new Date('2026-11-02T08:00:00Z'),
    end: new Date('2026-11-02T11:00:00Z'),
  };
  const calendarFor = (
    answer: (url: string, init: RequestInit) => Response,
  ) => {
    const google = fakeGoogle((url, init) =>
      url.includes('oauth2') ? tokenAnswer() : answer(url, init),
    );
    const calendar = new GoogleCalendar(account(google.fetchImpl), config());
    (calendar as unknown as { fetchImpl: typeof fetch }).fetchImpl =
      google.fetchImpl;
    return { calendar, calls: google.calls };
  };

  it('adds an event, then updates the same one', async () => {
    const { calendar, calls } = calendarFor(() => json({ id: 'evt-1' }));
    expect(await calendar.upsert(null, event)).toBe('evt-1');
    expect(calls[1]).toMatchObject({
      url: 'https://www.googleapis.com/calendar/v3/calendars/studio%40group.calendar.google.com/events',
      init: { method: 'POST' },
    });
    await calendar.upsert('evt-1', event);
    expect(calls[2]).toMatchObject({
      url: expect.stringMatching(/\/events\/evt-1$/),
      init: { method: 'PUT' },
    });
  });

  it('forgets an event someone already deleted in Google Calendar', async () => {
    const { calendar } = calendarFor(() => new Response(null, { status: 410 }));
    await expect(calendar.remove('gone')).resolves.toBeUndefined();
  });

  it('only logs while the calendar is not configured', async () => {
    const google = fakeGoogle(tokenAnswer);
    const calendar = new GoogleCalendar(
      account(google.fetchImpl),
      config({ GOOGLE_CALENDAR_ID: undefined }),
    );
    expect(await calendar.upsert(null, event)).toBeNull();
    expect(google.calls).toHaveLength(0);
  });
});
