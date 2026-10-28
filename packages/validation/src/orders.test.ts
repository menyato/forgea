import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ChangeOrderStatusDto, UpdateStoreSettingsDto } from './index.js';

const check = <T extends object>(cls: new () => T, plain: object) => {
  const dto = plainToInstance(cls, plain);
  return {
    dto,
    fields: validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })
      .map((e) => e.property)
      .sort(),
  };
};

describe('ChangeOrderStatusDto', () => {
  it('accepts a status with an optional note', () => {
    expect(
      check(ChangeOrderStatusDto, {
        status: 'OUT_FOR_DELIVERY',
        note: 'Courier: Wakilni #4411',
      }).fields,
    ).toEqual([]);
  });

  it('rejects unknown statuses and long notes', () => {
    expect(
      check(ChangeOrderStatusDto, { status: 'LOST', note: 'x'.repeat(501) })
        .fields,
    ).toEqual(['note', 'status']);
  });
});

describe('UpdateStoreSettingsDto', () => {
  it('accepts Lebanese numbers written the usual ways', () => {
    for (const phone of [
      '70904044',
      '70 904 044',
      '+961 70 904 044',
      '+961-70-904044',
    ]) {
      expect(
        check(UpdateStoreSettingsDto, {
          transferPhone: phone,
          whatsappPhone: phone,
        }).fields,
      ).toEqual([]);
    }
  });

  it('rejects anything that is not a phone number', () => {
    expect(
      check(UpdateStoreSettingsDto, {
        transferPhone: 'call me',
        whatsappPhone: '123',
        transferInstructions: 'x'.repeat(301),
      }).fields,
    ).toEqual(['transferInstructions', 'transferPhone', 'whatsappPhone']);
  });
});
