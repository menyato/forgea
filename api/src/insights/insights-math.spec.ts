import { Prisma } from '../generated/prisma/client.js';
import { lineFigures, percent } from './insights-math.js';

const D = (v: string) => new Prisma.Decimal(v);

describe('lineFigures', () => {
  it('adds costs per bar and product, and takes the tax out of each product’s sales', () => {
    const f = lineFigures(
      [
        {
          bucket: '2026-10-01',
          productId: 'a',
          units: 2,
          gross: D('52.00'),
          unitCost: D('13.00'),
        },
        {
          bucket: '2026-10-02',
          productId: 'a',
          units: 1,
          gross: D('26.00'),
          unitCost: D('13.00'),
        },
        // A credit note on the 2nd takes one unit back.
        {
          bucket: '2026-10-02',
          productId: 'a',
          units: -1,
          gross: D('-26.00'),
          unitCost: D('13.00'),
        },
        {
          bucket: '2026-10-02',
          productId: null,
          units: 1,
          gross: D('111.00'),
          unitCost: null,
        },
      ],
      D('11'),
    );
    expect(f.cost.toFixed(2)).toBe('26.00');
    expect(f.costByBucket.get('2026-10-01')!.toFixed(2)).toBe('26.00');
    expect(f.costByBucket.get('2026-10-02')!.toFixed(2)).toBe('0.00');
    const a = f.byProduct.get('a')!;
    expect(a.units).toBe(2);
    // 52 → 46.85; 26 → 23.42 and back.
    expect(a.revenue.toFixed(2)).toBe('46.85');
    expect(a.cost!.toFixed(2)).toBe('26.00');
    expect(f.custom.units).toBe(1);
    expect(f.custom.revenue.toFixed(2)).toBe('100.00');
    expect(f.uncosted.toFixed(2)).toBe('100.00');
  });

  it('has no product cost when part of it can’t be estimated', () => {
    const f = lineFigures(
      [
        {
          bucket: 'd',
          productId: 'a',
          units: 1,
          gross: D('10'),
          unitCost: D('4'),
        },
        {
          bucket: 'd',
          productId: 'a',
          units: 1,
          gross: D('10'),
          unitCost: null,
        },
      ],
      null,
    );
    expect(f.byProduct.get('a')!.cost).toBeNull();
    expect(f.uncosted.toFixed(2)).toBe('10.00');
  });
});

describe('percent', () => {
  it('rounds to one decimal and has none without a whole', () => {
    expect(percent('40.77', '89.37')).toBe('45.6');
    expect(percent('1', '0')).toBeNull();
  });
});
