import {
  ageBucket,
  entryNumber,
  isBalanced,
  paymentState,
  splitTaxIncluded,
} from './ledger-math.js';

describe('splitTaxIncluded', () => {
  it('takes an 11% VAT out of a tax-included price, to the cent, adding back up', () => {
    const { base, tax } = splitTaxIncluded('111.00', '11');
    expect(base.toFixed(2)).toBe('100.00');
    expect(tax.toFixed(2)).toBe('11.00');
    const odd = splitTaxIncluded('13.91', '11');
    expect(odd.base.plus(odd.tax).toFixed(2)).toBe('13.91');
    expect(odd.base.toFixed(2)).toBe('12.53');
  });

  it('is the whole amount when there is no tax', () => {
    expect(splitTaxIncluded('20', null)).toEqual({
      base: expect.objectContaining({}),
      tax: expect.objectContaining({}),
    });
    expect(splitTaxIncluded('20', null).tax.toFixed(2)).toBe('0.00');
    expect(splitTaxIncluded('20', '0').base.toFixed(2)).toBe('20.00');
  });
});

describe('isBalanced', () => {
  it('needs equal debits and credits, and something booked', () => {
    expect(
      isBalanced([
        { debit: '10', credit: '0' },
        { debit: '0', credit: '10' },
      ]),
    ).toBe(true);
    expect(
      isBalanced([
        { debit: '10', credit: '0' },
        { debit: '0', credit: '9.99' },
      ]),
    ).toBe(false);
    expect(isBalanced([{ debit: '0', credit: '0' }])).toBe(false);
  });
});

describe('paymentState', () => {
  it('follows what is still owed', () => {
    expect(paymentState('30', '30', false)).toBe('not_paid');
    expect(paymentState('30', '12.5', false)).toBe('partial');
    expect(paymentState('30', '0', false)).toBe('paid');
    expect(paymentState('30', '0', true)).toBe('reversed');
  });
});

describe('ageBucket', () => {
  const asOf = new Date('2026-10-27T00:00:00Z');
  it.each([
    ['2026-10-30', 'notDue'],
    ['2026-10-27', 'notDue'],
    ['2026-10-26', 'days1to30'],
    ['2026-09-27', 'days1to30'],
    ['2026-09-26', 'days31to60'],
    ['2026-08-01', 'days61to90'],
    ['2026-01-01', 'older'],
  ])('due %s is %s', (due, bucket) => {
    expect(ageBucket(new Date(`${due}T00:00:00Z`), asOf)).toBe(bucket);
  });
});

it('numbers entries per journal and year', () => {
  expect(entryNumber('INV', 2026, 1)).toBe('INV/2026/00001');
  expect(entryNumber('RINV', 2026, 123)).toBe('RINV/2026/00123');
});
