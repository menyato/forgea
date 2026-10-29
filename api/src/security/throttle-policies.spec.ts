import { describe, expect, it } from 'vitest';
import { LoginAttempts } from '../auth/login-attempts.js';
import { throttleKey } from './throttle-policies.js';

describe('throttleKey', () => {
  it('counts IPv4 per address', () => {
    expect(throttleKey('203.0.113.7')).toBe('203.0.113.7');
    expect(throttleKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('counts IPv6 per /64, however the address is written', () => {
    const one = throttleKey('2001:db8:aa:1::1');
    expect(one).toBe('2001:db8:aa:1::/64');
    // Another address in the same /64: the same bucket (no rotating around the limit).
    expect(throttleKey('2001:0db8:00aa:0001:ffff:1:2:3')).toBe(one);
    expect(throttleKey('2001:db8:aa:2::1')).not.toBe(one);
    expect(throttleKey('::1')).toBe('0:0:0:0::/64');
  });
});

describe('LoginAttempts', () => {
  const owner = '198.51.100.20';
  const stranger = '203.0.113.7';

  it('stops guessing from one address after 10 wrong passwords, without locking out the owner', () => {
    const attempts = new LoginAttempts();
    for (let i = 0; i < 10; i++) {
      expect(() => attempts.check('sara@example.com', stranger)).not.toThrow();
      attempts.failed('sara@example.com', stranger);
    }
    expect(() => attempts.check('sara@example.com', stranger)).toThrow(
      /Too many/,
    );
    // The owner, from their own connection, still signs in.
    expect(() => attempts.check('sara@example.com', owner)).not.toThrow();
    // Neighbouring IPv6 addresses count as one sender.
    for (let i = 0; i < 10; i++) {
      attempts.failed('omar@example.com', `2001:db8::${i}`);
    }
    expect(() => attempts.check('omar@example.com', '2001:db8::ff')).toThrow(
      /Too many/,
    );
  });

  it('stops a large campaign from many addresses at 200 an hour', () => {
    const attempts = new LoginAttempts();
    for (let i = 0; i < 200; i++) {
      attempts.failed('sara@example.com', `198.51.100.${i % 250}`);
    }
    expect(() => attempts.check('sara@example.com', owner)).toThrow(/Too many/);
  });

  it('starts over after a successful sign-in from that address', () => {
    const attempts = new LoginAttempts();
    for (let i = 0; i < 9; i++) attempts.failed('sara@example.com', owner);
    attempts.succeeded('sara@example.com', owner);
    attempts.failed('sara@example.com', owner);
    expect(() => attempts.check('sara@example.com', owner)).not.toThrow();
  });
});
