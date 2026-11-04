import type { NestExpressApplication } from '@nestjs/platform-express';
import type { LeadDetail, QuotationDetail } from '@forgea/types';
import request from 'supertest';
import { Role } from '../src/generated/prisma/enums.js';
import { CSRF, signedInAs } from './commerce-helpers.js';
import { createApp, uniqueEmail } from './create-app.js';
import { inbox, registerCustomer } from './mail-helpers.js';

const PASSWORD = 'correct-horse-battery-9';

/**
 * A lead's quotations move the lead: sent → the "quoted" stage, accepted → won. A customer
 * who declines leaves the lead open, waiting for the team to say whether it is lost.
 */
describe('Leads and their quotations (e2e)', () => {
  let app: NestExpressApplication;
  let admin: Awaited<ReturnType<typeof signedInAs>>;
  const http = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    post: (url: string, body: object = {}) =>
      http().post(url).set(CSRF).set('Cookie', cookie).send(body),
    put: (url: string, body: object) =>
      http().put(url).set(CSRF).set('Cookie', cookie).send(body),
  });

  beforeAll(async () => {
    app = await createApp();
    admin = await signedInAs(app, Role.ADMIN);
  });
  afterAll(() => app.close());

  const lead = async (id: string) =>
    (await as(admin.cookie).get(`/leads/${id}`).expect(200)).body as LeadDetail;

  /** A lead for this address, with a quotation written from it and sent. */
  async function quotedLead(email: string) {
    const created = await as(admin.cookie)
      .post('/leads/manual', {
        name: 'Nour Saleh',
        email,
        message: 'Twelve display stands for the shop window.',
      })
      .expect(201);
    const leadId = created.body.id as string;
    const quotation = (
      await as(admin.cookie)
        .post('/quotations', {
          customerEmail: email,
          leadId,
          validUntil: '2099-12-31',
          customerName: 'Nour Saleh',
          phone: '70 555 666',
          paymentMethod: 'TRANSFER',
          delivery: false,
          lines: [
            { description: 'Display stand', quantity: 12, unitPrice: '20.00' },
          ],
        })
        .expect(201)
    ).body as QuotationDetail;
    await as(admin.cookie).post(`/quotations/${quotation.id}/send`).expect(200);
    const mail = (await inbox(app, email)).at(-1)!;
    const token = decodeURIComponent(/\/q\/([\w.-]+)/.exec(mail.text)![1]!);
    return { leadId, quotation, token };
  }

  it('sending moves the lead to Quoted; a decline waits for the team; accepting wins it', async () => {
    const email = uniqueEmail('lead-quote');
    const { leadId, quotation, token } = await quotedLead(email);

    const quoted = await lead(leadId);
    expect(quoted.stage.name).toBe('Quoted');
    expect(quoted.quotations).toEqual([
      expect.objectContaining({ number: quotation.number, status: 'SENT' }),
    ]);
    expect(quoted.notes.at(-1)!.body).toBe(
      `Quotation ${quotation.number} sent ($240.00): moved to Quoted.`,
    );

    // The customer says no from the email, no account needed; only once.
    const declined = await http()
      .post(`/quotations/link/${token}/decline`)
      .set(CSRF)
      .send({ reason: 'Too expensive for us right now' })
      .expect(200);
    expect(declined.body.status).toBe('DECLINED');
    expect(declined.body.history.at(-1)).toMatchObject({
      status: 'DECLINED',
      note: 'Too expensive for us right now',
    });
    await http()
      .post(`/quotations/link/${token}/decline`)
      .set(CSRF)
      .send({})
      .expect(409);
    // A declined quotation can't be accepted until the studio sends it again.
    const owner = await registerCustomer(app, { email, password: PASSWORD });
    await http()
      .post(`/quotations/link/${token}/accept`)
      .set(CSRF)
      .set('Cookie', owner)
      .expect(409);

    // The lead is still open: whether it is lost is the team's call.
    const waiting = await lead(leadId);
    expect(waiting.state).toBe('open');
    expect(waiting.decisionNeeded).toContain(
      `The customer declined quotation ${quotation.number}`,
    );
    expect(waiting.decisionNeeded).toContain('Too expensive for us right now');
    expect(waiting.notes.at(-1)).toMatchObject({ author: null });

    // The team keeps it open, changes the quotation and sends it again.
    const kept = (
      await as(admin.cookie).post(`/leads/${leadId}/keep-open`).expect(200)
    ).body as LeadDetail;
    expect(kept.decisionNeeded).toBeNull();
    expect(kept.notes.at(-1)!.body).toBe('Kept open.');
    await as(admin.cookie).post(`/leads/${leadId}/keep-open`).expect(400);
    await as(admin.cookie)
      .put(`/quotations/${quotation.id}`, {
        customerEmail: email,
        leadId,
        validUntil: '2099-12-31',
        customerName: 'Nour Saleh',
        phone: '70 555 666',
        paymentMethod: 'TRANSFER',
        delivery: false,
        lines: [
          { description: 'Display stand', quantity: 12, unitPrice: '17.50' },
        ],
      })
      .expect(200);
    const resent = await as(admin.cookie)
      .post(`/quotations/${quotation.id}/send`)
      .expect(200);
    expect(resent.body.status).toBe('SENT');

    // Accepted: the lead is won, and its log says by which order.
    const placed = await as(owner)
      .post(`/quotations/mine/${quotation.number}/accept`)
      .expect(200);
    const won = await lead(leadId);
    expect(won.state).toBe('won');
    expect(won.stage.isWon).toBe(true);
    expect(won.notes.at(-1)!.body).toBe(
      `Quotation ${quotation.number} accepted: order ${placed.body.orderNumber as string}. Won (moved to Won).`,
    );
  });

  it('declined from the account: the studio is told, and marking the lead lost settles it', async () => {
    const email = uniqueEmail('lead-lost');
    const owner = await registerCustomer(app, { email, password: PASSWORD });
    const { leadId, quotation } = await quotedLead(email);
    await as(owner)
      .post(`/quotations/mine/${quotation.number}/decline`, {})
      .expect(200);
    expect((await lead(leadId)).decisionNeeded).toMatch(
      /Mark the lead as lost/,
    );

    const reasons = (await as(admin.cookie).get('/lost-reasons').expect(200))
      .body as { id: string; name: string }[];
    const lost = (
      await as(admin.cookie)
        .post(`/leads/${leadId}/lose`, {
          lostReasonId: reasons.find((r) => r.name === 'Too expensive')!.id,
        })
        .expect(200)
    ).body as LeadDetail;
    expect(lost.state).toBe('lost');
    expect(lost.decisionNeeded).toBeNull();
  });
});
