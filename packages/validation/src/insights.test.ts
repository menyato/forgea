import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  PeriodQuery,
  RecordStockMovementDto,
  SaveStockItemDto,
} from './index.js';

function check<T extends object>(cls: new () => T, plain: object) {
  const dto = plainToInstance(cls, plain);
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return {
    dto,
    messages: errors.flatMap((e) => Object.values(e.constraints ?? {})),
  };
}

describe('PeriodQuery', () => {
  it('accepts no dates or a real period', () => {
    expect(check(PeriodQuery, {}).messages).toEqual([]);
    expect(
      check(PeriodQuery, { from: '2026-10-01', to: '2026-10-31' }).messages,
    ).toEqual([]);
  });

  it('says what is wrong in words', () => {
    expect(check(PeriodQuery, { from: '2026-10-01' }).messages).toContain(
      'Choose an end date',
    );
    expect(
      check(PeriodQuery, { from: '2026-10-31', to: '2026-10-01' }).messages,
    ).toEqual(['The start date must be before the end date']);
    expect(
      check(PeriodQuery, { from: '2020-01-01', to: '2026-10-01' }).messages,
    ).toEqual(['Choose a period of two years at most']);
  });
});

describe('RecordStockMovementDto', () => {
  const delivery = {
    materialId: '0190f000-0000-7000-8000-000000000001',
    colour: ' Copper ',
    kind: 'RECEIVED',
    grams: '1000',
  };

  it('takes a delivery in whole grams and trims the colour', () => {
    const { dto, messages } = check(RecordStockMovementDto, delivery);
    expect(messages).toEqual([]);
    expect(dto).toMatchObject({ colour: 'Copper', grams: 1000 });
  });

  it('wants a positive amount for a delivery or a use, any sign for a correction', () => {
    expect(
      check(RecordStockMovementDto, { ...delivery, grams: '-5' }).messages,
    ).toContain('Enter how many grams came in or went out');
    expect(
      check(RecordStockMovementDto, {
        ...delivery,
        kind: 'CORRECTION',
        grams: '-5',
      }).messages,
    ).toEqual([]);
    expect(
      check(RecordStockMovementDto, { ...delivery, kind: 'ORDER' }).messages,
    ).not.toEqual([]);
  });
});

describe('SaveStockItemDto', () => {
  it('needs a spool of at least a gram', () => {
    const base = {
      lowStockGrams: '500',
      spoolGrams: '1000',
      leadTimeDays: '7',
      coverDays: '30',
      active: true,
    };
    expect(check(SaveStockItemDto, base).messages).toEqual([]);
    expect(
      check(SaveStockItemDto, { ...base, spoolGrams: '0' }).messages,
    ).not.toEqual([]);
  });
});
