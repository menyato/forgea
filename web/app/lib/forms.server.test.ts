import { CheckoutDto, LoginDto, SaveProductDto } from '@forgea/validation';
import { describe, expect, it } from 'vitest';
import { jsonField, textFields, validateForm } from './forms.server';

describe('validateForm', () => {
  it('returns the typed DTO with shared normalization applied', () => {
    const r = validateForm(LoginDto, { email: ' A@B.co ', password: 'x' });
    expect(r).toEqual({
      ok: true,
      value: expect.objectContaining({ email: 'a@b.co' }),
    });
  });

  it('returns one readable message per field, from the shared DTO', () => {
    const r = validateForm(CheckoutDto, {
      delivery: true,
      paymentMethod: 'COD',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toMatchObject({
      name: 'Enter your name',
      phone: 'Enter a valid phone number',
      city: 'Enter your city or area',
    });
  });
});

describe('textFields', () => {
  it('keeps only listed, non-empty fields', () => {
    const form = new FormData();
    form.set('name', 'Rana');
    form.set('phone', '   ');
    form.set('role', 'ADMIN');
    expect(textFields(form, ['name', 'phone'] as const)).toEqual({
      name: 'Rana',
    });
  });
});

describe('nested rows and JSON fields', () => {
  it('reports errors in nested rows by path, e.g. a product option', () => {
    const r = validateForm(SaveProductDto, {
      slug: 'phone-stand',
      name: 'Phone stand',
      description: 'A weighted stand with a cable channel.',
      materialId: '0192f3a4-5b6c-7d8e-9f01-23456789abcd',
      grams: '60',
      printHours: '3',
      isCustom: false,
      active: true,
      options: [{ groupId: 'not-a-uuid', required: true, valueIds: [] }],
    });
    expect(r.ok).toBe(false);
    expect(r.ok ? {} : r.errors).toEqual({
      'options.0.groupId': expect.any(String),
    });
  });

  it('reads JSON fields, and treats missing or broken JSON as "not given"', () => {
    const form = new FormData();
    form.set('options', '[{"groupId":"g","valueId":"v"}]');
    form.set('broken', '[{');
    expect(jsonField(form, 'options')).toEqual([
      { groupId: 'g', valueId: 'v' },
    ]);
    expect(jsonField(form, 'broken')).toBeUndefined();
    expect(jsonField(form, 'missing')).toBeUndefined();
  });
});
