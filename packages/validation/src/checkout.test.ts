import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { AddCartItemDto, CheckoutDto } from './index.js';

function check<T extends object>(cls: new () => T, plain: object) {
  const dto = plainToInstance(cls, plain);
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, fields: errors.map((e) => e.property).sort() };
}

const delivery = {
  idempotencyKey: '019a2000-0000-7000-8000-000000000001',
  name: 'Rana',
  phone: '+961 70 123 456',
  paymentMethod: 'COD',
  currency: 'LBP',
  delivery: true,
  city: 'Beirut',
  addressLine: 'Hamra St, Bldg 12, 3rd floor',
};

describe('CheckoutDto', () => {
  it('accepts a delivery order', () => {
    const { dto, fields } = check(CheckoutDto, delivery);
    expect(fields).toEqual([]);
    expect(dto.rush).toBe(false);
  });

  it('requires an address for delivery but not for pickup', () => {
    const noAddress = { ...delivery, city: undefined, addressLine: undefined };
    expect(check(CheckoutDto, noAddress).fields).toEqual([
      'addressLine',
      'city',
    ]);
    expect(
      check(CheckoutDto, { ...noAddress, delivery: false }).fields,
    ).toEqual([]);
  });

  it('defaults the currency to USD', () => {
    const { currency: _c, ...usd } = delivery;
    expect(check(CheckoutDto, usd).dto.currency).toBe('USD');
  });

  it('rejects unknown payment methods, bad currencies and client-supplied totals', () => {
    expect(
      check(CheckoutDto, {
        ...delivery,
        paymentMethod: 'CRYPTO',
        currency: 'usd',
        total: '0.01',
      }).fields,
    ).toEqual(['currency', 'paymentMethod', 'total']);
  });

  it('requires an idempotency key', () => {
    const { idempotencyKey: _k, ...rest } = delivery;
    expect(check(CheckoutDto, rest).fields).toEqual(['idempotencyKey']);
  });
});

describe('AddCartItemDto', () => {
  it('defaults quantity to 1 and caps it', () => {
    const id = '019a2000-0000-7000-8000-000000000002';
    expect(check(AddCartItemDto, { productId: id }).dto.quantity).toBe(1);
    expect(
      check(AddCartItemDto, { productId: id, quantity: 1000 }).fields,
    ).toEqual(['quantity']);
    expect(check(AddCartItemDto, { productId: 'not-a-uuid' }).fields).toEqual([
      'productId',
    ]);
  });
});
