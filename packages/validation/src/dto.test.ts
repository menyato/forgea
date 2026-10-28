import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  CreateLeadDto,
  LoginDto,
  normalizeEmail,
  RegisterDto,
  SetExchangeRateDto,
} from './index.js';

/** Same options the API's global ValidationPipe uses. */
function check<T extends object>(cls: new () => T, plain: object) {
  const dto = plainToInstance(cls, plain);
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, fields: errors.map((e) => e.property) };
}

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Ali@Forgea-Lab.COM ')).toBe('ali@forgea-lab.com');
  });
});

describe('RegisterDto', () => {
  it('accepts a valid registration and normalizes the email', () => {
    const { dto, fields } = check(RegisterDto, {
      email: ' Sara@Example.com',
      password: 'correct horse battery',
      name: '  Sara  ',
    });
    expect(fields).toEqual([]);
    expect(dto.email).toBe('sara@example.com');
    expect(dto.name).toBe('Sara');
  });

  it('rejects short passwords, bad emails and unknown fields', () => {
    const { fields } = check(RegisterDto, {
      email: 'not-an-email',
      password: 'short',
      role: 'ADMIN',
    });
    expect(fields.sort()).toEqual(['email', 'password', 'role']);
  });

  it('rejects passwords longer than 128 characters', () => {
    const { fields } = check(RegisterDto, {
      email: 'a@b.co',
      password: 'x'.repeat(129),
    });
    expect(fields).toEqual(['password']);
  });
});

describe('LoginDto', () => {
  it('does not apply the password policy', () => {
    expect(check(LoginDto, { email: 'a@b.co', password: 'x' }).fields).toEqual(
      [],
    );
  });

  it('rejects non-string input', () => {
    expect(
      check(LoginDto, {
        email: ['a@b.co'],
        password: { $ne: '' },
      }).fields.sort(),
    ).toEqual(['email', 'password']);
  });
});

describe('CreateLeadDto', () => {
  const valid = {
    name: 'Hamad',
    email: 'hamad@example.qa',
    phone: '+974 5555 1234',
    message: 'I need a custom enclosure for a sensor board.',
    budgetRange: '100-500',
  };

  it('accepts a valid inquiry', () => {
    expect(check(CreateLeadDto, valid).fields).toEqual([]);
  });

  it('rejects an unknown budget, a bad phone and a too-short message', () => {
    const { fields } = check(CreateLeadDto, {
      ...valid,
      budgetRange: 'a lot',
      phone: 'call me',
      message: 'hi',
    });
    expect(fields.sort()).toEqual(['budgetRange', 'message', 'phone']);
  });

  it('rejects fields that are not part of the form', () => {
    expect(check(CreateLeadDto, { ...valid, status: 'WON' }).fields).toEqual([
      'status',
    ]);
  });
});

describe('SetExchangeRateDto', () => {
  it.each(['89500', '0.92', '1', '89500.12345678'])('accepts %s', (rate) => {
    expect(check(SetExchangeRateDto, { rate }).fields).toEqual([]);
  });

  it.each(['0', '0.000', '-1', '1e5', 'abc', '1.123456789', ''])(
    'rejects %j',
    (rate) => {
      expect(check(SetExchangeRateDto, { rate }).fields).toEqual(['rate']);
    },
  );

  it('rejects a numeric (non-string) rate so precision is never lost', () => {
    expect(check(SetExchangeRateDto, { rate: 89500 }).fields).toEqual(['rate']);
  });
});
