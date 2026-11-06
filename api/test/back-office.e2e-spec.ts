import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { Role } from '../src/generated/prisma/enums.js';
import {
  CSRF,
  createProduct,
  signedInAs,
  signedInCustomer,
} from './commerce-helpers.js';
import { createApp } from './create-app.js';

/** Phase 11: the CRM pipeline, quotations into orders, and the books that follow. */
describe('Back office (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    post: (url: string, body: object = {}) =>
      http().post(url).set(CSRF).set('Cookie', cookie).send(body),
    put: (url: string, body: object) =>
      http().put(url).set(CSRF).set('Cookie', cookie).send(body),
    patch: (url: string, body: object) =>
      http().patch(url).set(CSRF).set('Cookie', cookie).send(body),
  });

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await prisma.accountingSettings.update({
      where: { id: 1 },
      data: { salesTaxId: null },
    });
    await app.close();
  });
  const today = () => new Date().toISOString().slice(0, 10);
  /** The settings as they are, with a change: the lock date never moves back. */
  const settingsWith = async (cookie: string, change: object) => {
    const current = (await as(cookie).get('/accounting/settings').expect(200))
      .body;
    return {
      salesTaxId: current.salesTax?.id ?? null,
      lockDate: current.lockDate,
      ...change,
    };
  };

  it('a lead moves through the pipeline; every move is logged; lost and reopened', async () => {
    const staff = await signedInAs(app, Role.STAFF);
    const s = as(staff.cookie);
    await as((await signedInCustomer(app)).cookie)
      .get('/leads')
      .expect(403);
    const created = await s
      .post('/leads/manual', {
        name: 'Hotel Phoenicia',
        email: `buyer-${randomUUID().slice(0, 6)}@example.com`,
        message: '200 branded key holders for the rooms.',
        expectedRevenue: '1200.00',
      })
      .expect(201);
    const id = created.body.id as string;
    expect(created.body).toMatchObject({
      state: 'open',
      probability: 10,
      proratedRevenue: '120.00',
    });

    const stages = (await s.get('/lead-stages').expect(200)).body as {
      id: string;
      name: string;
      isWon: boolean;
    }[];
    const quoted = stages.find((x) => x.name === 'Quoted')!;
    const won = stages.find((x) => x.isWon)!;
    const moved = await s
      .post(`/leads/${id}/stage`, { stageId: quoted.id })
      .expect(200);
    expect(moved.body).toMatchObject({
      probability: 60,
      stage: { name: 'Quoted' },
    });

    await s
      .post(`/leads/${id}/activities`, {
        kind: 'CALL',
        summary: 'Call about the logo files',
        dueAt: '2026-11-03T09:00:00.000Z',
      })
      .expect(201);
    const withActivity = (await s.get(`/leads/${id}`)).body;
    expect(withActivity.nextActivity).toMatchObject({ kind: 'CALL' });
    await s
      .post(`/leads/${id}/activities/${withActivity.activities[0].id}/done`)
      .expect(200);

    const reasons = (await s.get('/lost-reasons')).body as {
      id: string;
      name: string;
    }[];
    const lost = await s
      .post(`/leads/${id}/lose`, {
        lostReasonId: reasons[0]!.id,
        note: 'Chose a cheaper quote',
      })
      .expect(200);
    expect(lost.body).toMatchObject({
      state: 'lost',
      probability: 0,
      lostReason: reasons[0]!.name,
    });
    await s.post(`/leads/${id}/stage`, { stageId: won.id }).expect(400);
    await s.post(`/leads/${id}/restore`).expect(200);
    const wonLead = await s
      .post(`/leads/${id}/stage`, { stageId: won.id })
      .expect(200);
    expect(wonLead.body).toMatchObject({ state: 'won', probability: 100 });
    expect(wonLead.body.notes.map((n: { body: string }) => n.body)).toEqual([
      'Added by the team.',
      'Lead created.',
      'Moved to Quoted.',
      'Done: call — Call about the logo files',
      `Lost: ${reasons[0]!.name}. Chose a cheaper quote`,
      'Reopened in New.',
      `Won (moved to ${won.name}).`,
    ]);
  });

  it('a custom request opens a lead linked to it', async () => {
    const customer = await signedInCustomer(app);
    const { body } = await as(customer.cookie)
      .post('/custom-requests', {
        title: 'Drone frame',
        description: 'A frame for a 5-inch drone.',
      })
      .expect(201);
    const lead = await prisma.lead.findFirstOrThrow({
      where: { customRequest: { requestNumber: body.requestNumber } },
    });
    expect(lead).toMatchObject({
      source: 'CUSTOM_REQUEST',
      customerId: customer.user.id,
    });
  });

  it('a quotation is sent, accepted online, and becomes an order without bulk discounts', async () => {
    const staff = await signedInAs(app, Role.STAFF);
    const customer = await signedInCustomer(app);
    const s = as(staff.cookie);
    const form = {
      customerEmail: customer.user.email,
      validUntil: '2099-12-31',
      customerName: 'Karim Haddad',
      phone: '70 111 222',
      paymentMethod: 'TRANSFER',
      delivery: false,
      lines: [
        {
          description: 'Design work (3 h)',
          quantity: 1,
          unitPrice: '45.00',
          isCustom: true,
        },
        {
          description: 'Printed brackets',
          quantity: 20,
          unitPrice: '4.00',
          discountPercent: '10',
        },
      ],
    };
    // Anyone can get a quotation by email, but never a team account.
    await s
      .post('/quotations', { ...form, customerEmail: staff.user.email })
      .expect(400);
    const created = await s.post('/quotations', form).expect(201);
    // The next quotation for them fills itself from what they gave.
    const known = await s
      .get(
        `/quotations/contact?email=${encodeURIComponent(customer.user.email)}`,
      )
      .expect(200);
    expect(known.body).toMatchObject({
      name: 'Karim Haddad',
      phone: '70 111 222',
    });
    await as(customer.cookie)
      .get(
        `/quotations/contact?email=${encodeURIComponent(customer.user.email)}`,
      )
      .expect(403);
    expect(created.body).toMatchObject({
      status: 'DRAFT',
      number: expect.stringMatching(/^Q-\d{4}-\d{4}$/),
      total: '117.00',
    });
    const id = created.body.id as string;

    // A draft isn't visible to the customer until it is sent, nor can they accept it (its
    // prices may still be placeholders).
    await as(customer.cookie)
      .get(`/quotations/mine/${created.body.number}`)
      .expect(404);
    await as(customer.cookie)
      .post(`/quotations/mine/${created.body.number}/accept`)
      .expect(404);
    await s.post(`/quotations/${id}/send`).expect(200);
    const seen = await as(customer.cookie)
      .get(`/quotations/mine/${created.body.number}`)
      .expect(200);
    expect(seen.body.lines[1]).toMatchObject({ lineTotal: '72.00' });

    const order = await as(customer.cookie)
      .post(`/quotations/mine/${created.body.number}/accept`)
      .expect(200);
    // 45 + 20 × 3.60 = 117, no bulk discount on top; the design line needs the deposit.
    expect(order.body).toMatchObject({
      total: '117.00',
      status: 'AWAITING_DEPOSIT',
      depositRequired: '22.50',
    });
    await as(customer.cookie)
      .post(`/quotations/mine/${created.body.number}/accept`)
      .expect(200, order.body);
    const after = (await s.get(`/quotations/${id}`)).body;
    expect(after).toMatchObject({
      status: 'CONFIRMED',
      orderNumber: order.body.orderNumber,
    });
    expect(after.history.map((h: { status: string }) => h.status)).toEqual([
      'DRAFT',
      'SENT',
      'CONFIRMED',
    ]);
    // Its free-text lines (design work) are invoiced like any other.
    const sale = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: order.body.orderNumber },
    });
    const deposit = await s
      .post(`/accounting/orders/${sale.id}/deposit-invoice`)
      .expect(201);
    expect(deposit.body.total).toBe('22.50');
    // A confirmed quotation is a sales order: cancelling it cancels the order too, and
    // the quotation keeps its link.
    await s
      .post(`/quotations/${id}/cancel`, { body: 'Changed their mind' })
      .expect(200);
    expect((await s.get(`/quotations/${id}`)).body).toMatchObject({
      status: 'CANCELLED',
      orderNumber: order.body.orderNumber,
    });
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: sale.id } })).status,
    ).toBe('CANCELLED');
    await s.post(`/quotations/${id}/cancel`, { body: 'again' }).expect(409);
  });

  it('the order pipeline invoices itself: deposit, final invoice less deposit, payment, credit note', async () => {
    const admin = await signedInAs(app, Role.ADMIN);
    const staff = await signedInAs(app, Role.STAFF);
    const customer = await signedInCustomer(app);
    // VAT 11% included in prices, for this test.
    const vat = await prisma.tax.findFirstOrThrow({
      where: { name: 'VAT 11%' },
    });
    await as(admin.cookie)
      .put(
        '/accounting/settings',
        await settingsWith(admin.cookie, { salesTaxId: vat.id }),
      )
      .expect(200);

    const product = await createProduct(app, { isCustom: true });
    await as(customer.cookie)
      .post('/cart/items', { productId: product.id, quantity: 1 })
      .expect(201);
    const placed = await as(customer.cookie)
      .post('/orders/checkout', {
        idempotencyKey: randomUUID(),
        name: 'Rana Khoury',
        phone: '70 123 456',
        paymentMethod: 'TRANSFER',
        delivery: true,
        city: 'Beirut',
        addressLine: 'Hamra St, Bldg 12',
      })
      .expect(201);
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: placed.body.orderNumber },
    });
    const s = as(staff.cookie);
    const step = (status: string) =>
      s.patch(`/orders/${order.id}/status`, { status }).expect(200);

    await step('CONFIRMED'); // deposit received
    let invoices = (
      await s.get(`/accounting/orders/${order.id}/invoices`).expect(200)
    ).body;
    expect(invoices).toEqual([
      expect.objectContaining({
        invoiceKind: 'DEPOSIT',
        number: expect.stringMatching(/^INV\/\d{4}\/\d{5}$/),
        total: order.depositRequired.toFixed(2),
        residual: '0.00',
        paymentState: 'paid',
      }),
    ]);
    await s.post(`/accounting/orders/${order.id}/deposit-invoice`).expect(409);

    for (const status of [
      'IN_PRODUCTION',
      'READY',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
    ])
      await step(status);
    invoices = (await s.get(`/accounting/orders/${order.id}/invoices`)).body;
    const final = invoices.find(
      (i: { invoiceKind: string }) => i.invoiceKind === 'FINAL',
    );
    const rest = order.total.minus(order.depositRequired).toFixed(2);
    expect(final).toMatchObject({
      total: rest,
      residual: rest,
      paymentState: 'not_paid',
    });

    // The final invoice carries the full VAT; with the deposit's VAT undone, VAT owed is
    // exactly the tax included in the order total.
    const entry = (
      await as(admin.cookie).get(`/accounting/entries/${final.id}`)
    ).body;
    const vatLines = entry.lines.filter(
      (l: { account: { code: string } }) => l.account.code === '2100',
    );
    const vatNet = vatLines.reduce(
      (sum: number, l: { debit: string; credit: string }) =>
        sum + Number(l.credit) - Number(l.debit),
      0,
    );
    const depositEntry = (
      await as(admin.cookie).get(`/accounting/entries/${invoices[0].id}`)
    ).body;
    const depositVat = depositEntry.lines.find(
      (l: { account: { code: string } }) => l.account.code === '2100',
    );
    const expectedVat = Number(order.total) - (Number(order.total) * 100) / 111;
    expect(vatNet + Number(depositVat.credit)).toBeCloseTo(expectedVat, 1);

    await s
      .post('/accounting/payments', {
        invoiceId: final.id,
        amount: '1000.00',
        method: 'BANK',
        date: new Date().toISOString().slice(0, 10),
      })
      .expect(400);
    const half = (Number(rest) / 2).toFixed(2);
    const partial = await s
      .post('/accounting/payments', {
        invoiceId: final.id,
        amount: half,
        method: 'CASH',
        date: new Date().toISOString().slice(0, 10),
      })
      .expect(201);
    expect(partial.body.paymentState).toBe('partial');

    // The rest is credited instead: the invoice is settled by the credit note.
    await as(staff.cookie)
      .post(`/accounting/invoices/${final.id}/credit-note`)
      .expect(403);
    const note = await as(admin.cookie)
      .post(`/accounting/invoices/${final.id}/credit-note`)
      .expect(201);
    expect(note.body).toMatchObject({
      type: 'CREDIT_NOTE',
      number: expect.stringMatching(/^RINV\//),
    });
    await as(admin.cookie)
      .post(`/accounting/invoices/${final.id}/credit-note`)
      .expect(409);
    const listed = (await s.get(`/accounting/orders/${order.id}/invoices`))
      .body as { id: string; residual: string; creditedBy: string | null }[];
    const settled = listed.find((i) => i.id === final.id)!;
    expect(settled.residual).toBe('0.00');
    expect(settled.creditedBy).toBe(note.body.number);

    // The half already paid goes back to the customer: the refund is the credit note's payment.
    const credit = listed.find((i) => i.id === note.body.id)!;
    expect(credit.residual).toBe(half);
    const refund = {
      invoiceId: note.body.id,
      method: 'CASH',
      date: new Date().toISOString().slice(0, 10),
    };
    await s
      .post('/accounting/payments', { ...refund, amount: '9999.00' })
      .expect(400);
    const refunded = await s
      .post('/accounting/payments', { ...refund, amount: half })
      .expect(201);
    expect(refunded.body.residual).toBe('0.00');
    // Money out of the cash journal: the customer's balance is back to zero.
    const refundEntry = await prisma.journalEntry.findFirstOrThrow({
      where: { label: `Refund for ${note.body.number}` },
      include: { lines: true },
    });
    expect(refundEntry.state).toBe('POSTED');
    expect(
      refundEntry.lines.map((l) => [l.debit.toFixed(2), l.credit.toFixed(2)]),
    ).toEqual(
      expect.arrayContaining([
        [half, '0.00'],
        ['0.00', half],
      ]),
    );

    // The invoice list finds them by order number, with the same sums as the order's panel,
    // filters by what is owed, and pages through in any sort without losing one.
    type Listed = { id: string; type: string; residual: string; total: string };
    const page = async (query: string) =>
      (await s.get(`/accounting/invoices?${query}`).expect(200)).body as {
        items: Listed[];
        nextCursor: string | null;
      };
    const panel = (
      (await s.get(`/accounting/orders/${order.id}/invoices`)).body as Listed[]
    ).map(({ id, residual, total }) => ({ id, residual, total }));
    const found = await page(`q=${order.orderNumber}&limit=100`);
    expect(
      found.items.map(({ id, residual, total }) => ({ id, residual, total })),
    ).toEqual(expect.arrayContaining(panel));
    expect(found.items).toHaveLength(panel.length);
    const credits = await page(`q=${order.orderNumber}&filters=credit`);
    expect(credits.items.map((i) => i.id)).toEqual([note.body.id]);
    const unpaid = await page(`q=${order.orderNumber}&filters=unpaid`);
    expect(unpaid.items).toEqual([]);
    for (const sort of ['date', 'number', 'total', 'residual']) {
      const seen: string[] = [];
      let cursor = '';
      do {
        const p = await page(
          `q=${order.orderNumber}&sort=${sort}&order=asc&limit=1${cursor ? `&cursor=${cursor}` : ''}`,
        );
        seen.push(...p.items.map((i) => i.id));
        cursor = p.nextCursor ?? '';
      } while (cursor);
      expect(seen.sort(), sort).toEqual(panel.map((i) => i.id).sort());
    }
    const counts = (await s.get('/accounting/invoices/counts').expect(200))
      .body as { unpaid: number; paid: number; credit: number; owed: string };
    expect(counts.credit).toBeGreaterThanOrEqual(1);
    expect(counts.owed).toMatch(/^\d+\.\d{2}$/);
  });

  it('an invoice can wait as a draft with its dates, then be posted (or discarded)', async () => {
    const staff = await signedInAs(app, Role.STAFF);
    const customer = await signedInCustomer(app);
    const product = await createProduct(app, { isCustom: true });
    await as(customer.cookie)
      .post('/cart/items', { productId: product.id, quantity: 1 })
      .expect(201);
    const placed = await as(customer.cookie)
      .post('/orders/checkout', {
        idempotencyKey: randomUUID(),
        name: 'Rana Khoury',
        phone: '70 123 456',
        paymentMethod: 'TRANSFER',
        delivery: false,
      })
      .expect(201);
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: placed.body.orderNumber },
    });
    const s = as(staff.cookie);
    const yesterday = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const in14 = new Date(Date.now() + 14 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    // Dates are checked: not in the future, due on or after the invoice date.
    await s
      .post(`/accounting/orders/${order.id}/deposit-invoice`, {
        draft: true,
        date: tomorrow,
      })
      .expect(400);
    await s
      .post(`/accounting/orders/${order.id}/deposit-invoice`, {
        draft: true,
        date: today(),
        dueDate: yesterday,
      })
      .expect(400);

    // A draft: no number, outside the books, can't be paid or credited.
    const draft = (
      await s
        .post(`/accounting/orders/${order.id}/deposit-invoice`, {
          draft: true,
          date: yesterday,
          dueDate: in14,
        })
        .expect(201)
    ).body;
    expect(draft).toMatchObject({
      state: 'DRAFT',
      number: '',
      date: yesterday,
      dueDate: in14,
    });
    await s
      .post(`/accounting/orders/${order.id}/deposit-invoice`, { draft: true })
      .expect(409);
    await s
      .post('/accounting/payments', {
        invoiceId: draft.id,
        amount: draft.total,
        method: 'BANK',
        date: today(),
      })
      .expect(409);
    const admin = await signedInAs(app, Role.ADMIN);
    await as(admin.cookie)
      .post(`/accounting/invoices/${draft.id}/credit-note`)
      .expect(409);
    const drafts = (await s.get('/accounting/invoices?filters=draft')).body;
    expect(drafts.items.map((i: { id: string }) => i.id)).toContain(draft.id);

    // Its dates still change; then it is posted and gets its number.
    const redated = (
      await s
        .put(`/accounting/invoices/${draft.id}/dates`, {
          date: today(),
          dueDate: in14,
        })
        .expect(200)
    ).body;
    expect(redated).toMatchObject({ date: today(), dueDate: in14 });
    const posted = (
      await s.post(`/accounting/invoices/${draft.id}/post`).expect(200)
    ).body;
    expect(posted).toMatchObject({
      state: 'POSTED',
      number: expect.stringMatching(/^INV\/\d{4}\/\d{5}$/),
      dueDate: in14,
    });
    // Posted is final.
    await s.post(`/accounting/invoices/${draft.id}/post`).expect(409);
    await http()
      .delete(`/accounting/invoices/${draft.id}`)
      .set(CSRF)
      .set('Cookie', staff.cookie)
      .expect(409);
    await s
      .put(`/accounting/invoices/${draft.id}/dates`, {
        date: yesterday,
        dueDate: in14,
      })
      .expect(409);

    // A final invoice drafted, then discarded; the deposit arriving confirms the order.
    const finalDraft = (
      await s
        .post(`/accounting/orders/${order.id}/final-invoice`, { draft: true })
        .expect(201)
    ).body;
    await http()
      .delete(`/accounting/invoices/${finalDraft.id}`)
      .set(CSRF)
      .set('Cookie', staff.cookie)
      .expect(204);
    // Drafted again, then delivered: the pipeline posts the waiting draft, not a second one.
    await s
      .post(`/accounting/orders/${order.id}/final-invoice`, { draft: true })
      .expect(201);
    for (const status of ['CONFIRMED', 'IN_PRODUCTION', 'READY', 'DELIVERED'])
      await s.patch(`/orders/${order.id}/status`, { status }).expect(200);
    const finals = (
      await s.get(`/accounting/orders/${order.id}/invoices`)
    ).body.filter(
      (i: { invoiceKind: string; type: string }) =>
        i.invoiceKind === 'FINAL' && i.type === 'INVOICE',
    );
    expect(finals).toEqual([expect.objectContaining({ state: 'POSTED' })]);
  });

  it('a double click never invoices or collects twice; the database refuses over-matching', async () => {
    const staff = await signedInAs(app, Role.STAFF);
    const customer = await signedInCustomer(app);
    const product = await createProduct(app);
    await as(customer.cookie)
      .post('/cart/items', { productId: product.id, quantity: 1 })
      .expect(201);
    const placed = await as(customer.cookie)
      .post('/orders/checkout', {
        idempotencyKey: randomUUID(),
        name: 'Rana Khoury',
        phone: '70 123 456',
        paymentMethod: 'TRANSFER',
        delivery: false,
      })
      .expect(201);
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: placed.body.orderNumber },
    });
    const s = as(staff.cookie);
    await s
      .patch(`/orders/${order.id}/status`, { status: 'CONFIRMED' })
      .expect(200);

    // Two "Invoice the order" clicks at once: one invoice.
    const clicks = await Promise.all([
      s.post(`/accounting/orders/${order.id}/final-invoice`),
      s.post(`/accounting/orders/${order.id}/final-invoice`),
    ]);
    expect(clicks.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    const invoice = clicks.find((r) => r.status === 201)!.body;

    // Two payments of the whole amount at once: one is recorded, the other refused.
    const today = new Date().toISOString().slice(0, 10);
    const pay = () =>
      s.post('/accounting/payments', {
        invoiceId: invoice.id,
        amount: invoice.residual,
        method: 'BANK',
        date: today,
      });
    const payments = await Promise.all([pay(), pay()]);
    expect(payments.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 400,
    ]);
    const after = (
      await s.get(`/accounting/orders/${order.id}/invoices`)
    ).body.find((i: { id: string }) => i.id === invoice.id);
    expect(after).toMatchObject({ residual: '0.00', paymentState: 'paid' });

    // No payment dated in the future.
    const tomorrow = new Date(Date.now() + 86_400_000)
      .toISOString()
      .slice(0, 10);
    await s
      .post('/accounting/payments', {
        invoiceId: invoice.id,
        amount: '1.00',
        method: 'CASH',
        date: tomorrow,
      })
      .expect(400);

    // Even straight in the database, a line can't be matched beyond its amount.
    const match = await prisma.reconciliation.findFirstOrThrow({
      where: { debitLine: { entryId: invoice.id } },
    });
    await expect(
      prisma.reconciliation.create({
        data: {
          debitLineId: match.debitLineId,
          creditLineId: match.creditLineId,
          amount: '0.01',
        },
      }),
    ).rejects.toThrow(/match more than/);
    await expect(
      prisma.reconciliation.delete({ where: { id: match.id } }),
    ).rejects.toThrow(/cannot be changed or removed/);
  });

  it('the books balance, posted entries are final, and the lock date holds', async () => {
    const admin = await signedInAs(app, Role.ADMIN);
    const a = as(admin.cookie);
    const accounts = (await a.get('/accounting/accounts').expect(200)).body as {
      id: string;
      code: string;
      balance: string;
    }[];
    // Debits = credits across the whole ledger.
    expect(accounts.reduce((s, x) => s + Number(x.balance), 0)).toBeCloseTo(
      0,
      2,
    );
    const cash = accounts.find((x) => x.code === '1000')!;
    const equity = accounts.find((x) => x.code === '3000')!;
    const rent = accounts.find((x) => x.code === '6000')!;

    await a
      .post('/accounting/entries', {
        date: today(),
        label: 'Unbalanced',
        lines: [
          { accountId: cash.id, debit: '100' },
          { accountId: equity.id, credit: '90' },
        ],
      })
      .expect(400);
    const opening = await a
      .post('/accounting/entries', {
        date: today(),
        label: 'Owner puts in cash',
        lines: [
          { accountId: cash.id, debit: '500' },
          { accountId: equity.id, credit: '500' },
        ],
      })
      .expect(201);
    expect(opening.body.number).toMatch(/^MISC\/\d{4}\//);
    await a
      .post('/accounting/entries', {
        date: today(),
        label: 'Rent',
        lines: [
          { accountId: rent.id, debit: '200' },
          { accountId: cash.id, credit: '200' },
        ],
      })
      .expect(201);

    // The database itself refuses to change or delete a posted entry.
    await expect(
      prisma.journalLine.updateMany({
        where: { entryId: opening.body.id },
        data: { label: 'changed' },
      }),
    ).rejects.toThrow(/posted/);
    await expect(
      prisma.journalEntry.delete({ where: { id: opening.body.id } }),
    ).rejects.toThrow(/posted/);

    const pnl = (
      await a
        .get(
          `/accounting/reports/profit-and-loss?from=2000-01-01&to=${today()}`,
        )
        .expect(200)
    ).body;
    expect(
      pnl.expenses.find((l: { code: string }) => l.code === '6000').amount,
    ).toMatch(/^\d+\.\d{2}$/);
    expect(Number(pnl.netProfit)).toBeCloseTo(
      Number(pnl.totalIncome) - Number(pnl.totalExpenses),
      2,
    );
    const bs = (
      await a.get('/accounting/reports/balance-sheet?to=2099-12-31').expect(200)
    ).body;
    expect(Number(bs.totalAssets)).toBeCloseTo(
      Number(bs.totalLiabilitiesAndEquity),
      2,
    );
    await a.get('/accounting/reports/aged-receivables').expect(200);

    // Lock up to yesterday: nothing more can be posted there, and the lock never moves back.
    const yesterday = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const current = (await a.get('/accounting/settings')).body;
    if (!current.lockDate || current.lockDate < yesterday) {
      await a
        .put(
          '/accounting/settings',
          await settingsWith(admin.cookie, { lockDate: yesterday }),
        )
        .expect(200);
    }
    await a
      .post('/accounting/entries', {
        date: yesterday,
        label: 'Late',
        lines: [
          { accountId: rent.id, debit: '1' },
          { accountId: cash.id, credit: '1' },
        ],
      })
      .expect(400);
    await a
      .put(
        '/accounting/settings',
        await settingsWith(admin.cookie, { lockDate: '2000-01-01' }),
      )
      .expect(400);
    await as((await signedInAs(app, Role.STAFF)).cookie)
      .get('/accounting/reports/balance-sheet')
      .expect(403);
  });
});
