import { resolveClientIp } from './client-ip.js';

const SECRET = 'p'.repeat(40);
const req = (headers: Record<string, string>) => ({ ip: '10.0.0.1', headers });

describe('resolveClientIp', () => {
  it('uses the socket address by default', () => {
    expect(
      resolveClientIp(req({ 'cf-connecting-ip': '1.2.3.4' }), {
        trustCloudflare: false,
      }),
    ).toBe('10.0.0.1');
  });

  it('uses CF-Connecting-IP when Cloudflare is trusted', () => {
    expect(
      resolveClientIp(req({ 'cf-connecting-ip': '1.2.3.4' }), {
        trustCloudflare: true,
      }),
    ).toBe('1.2.3.4');
    expect(
      resolveClientIp(req({ 'cf-connecting-ip': '2001:db8::1' }), {
        trustCloudflare: true,
      }),
    ).toBe('2001:db8::1');
  });

  it('ignores a malformed Cloudflare header', () => {
    expect(
      resolveClientIp(req({ 'cf-connecting-ip': '1.2.3.4, 5.6.7.8' }), {
        trustCloudflare: true,
      }),
    ).toBe('10.0.0.1');
  });

  describe('storefront proxy', () => {
    const trust = { trustCloudflare: false, proxySecret: SECRET };

    it('uses the forwarded shopper IP when the proxy secret matches', () => {
      expect(
        resolveClientIp(
          req({
            'x-forgea-proxy-secret': SECRET,
            'x-forgea-client-ip': '203.0.113.7',
          }),
          trust,
        ),
      ).toBe('203.0.113.7');
    });

    it('ignores a forwarded IP with a wrong or missing secret (anyone could send the header)', () => {
      expect(
        resolveClientIp(
          req({
            'x-forgea-proxy-secret': 'guess',
            'x-forgea-client-ip': '203.0.113.7',
          }),
          trust,
        ),
      ).toBe('10.0.0.1');
      expect(
        resolveClientIp(req({ 'x-forgea-client-ip': '203.0.113.7' }), trust),
      ).toBe('10.0.0.1');
    });

    it('ignores a forwarded value that is not an IP', () => {
      expect(
        resolveClientIp(
          req({
            'x-forgea-proxy-secret': SECRET,
            'x-forgea-client-ip': 'unknown',
          }),
          trust,
        ),
      ).toBe('10.0.0.1');
    });

    it('is off when no secret is configured', () => {
      expect(
        resolveClientIp(
          req({
            'x-forgea-proxy-secret': SECRET,
            'x-forgea-client-ip': '203.0.113.7',
          }),
          { trustCloudflare: false },
        ),
      ).toBe('10.0.0.1');
    });
  });
});
