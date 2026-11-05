import { describe, expect, it } from 'vitest';
import { emailTypo } from './email.js';
import { isPhone } from './phone.js';

describe('isPhone', () => {
  it.each([
    '70 123 456',
    '03 456 789',
    '71555444',
    '+961 76 123 456',
    '00961 81 123 456',
    '01 234 567',
    '+33 6 12 34 56 78',
    '+1 (415) 555-0132',
  ])('takes a real number: %s', (n) => expect(isPhone(n)).toBe(true));

  it.each([
    '1111111',
    '-------',
    '70 12',
    '123',
    '70 123 456 789 000',
    'call me',
    'tel:70123456',
    '+961 99 999 999',
    '',
  ])('refuses %j', (n) => expect(isPhone(n)).toBe(false));
});

describe('emailTypo', () => {
  it.each([
    ['sara@gmial.com', 'sara@gmail.com'],
    ['sara@gmai.com', 'sara@gmail.com'],
    ['ali@hotmial.com', 'ali@hotmail.com'],
    ['ali@yaho.com', 'ali@yahoo.com'],
    ['ali@outlok.com', 'ali@outlook.com'],
    ['nour@gmail.con', 'nour@gmail.com'],
    ['nour@company.cmo', 'nour@company.com'],
  ])('catches %s → %s', (typed, meant) => expect(emailTypo(typed)).toBe(meant));

  it.each([
    'sara@gmail.com',
    'a@mail.com',
    'a@ymail.com',
    'a@outlook.de',
    'a@yahoo.co.uk',
    'a@me.com',
    'a@forgea-lab.com',
    'a@example.com',
    'a@live.com',
  ])('leaves a real address alone: %s', (e) => expect(emailTypo(e)).toBeNull());
});
