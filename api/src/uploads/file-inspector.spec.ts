import { FileInspector, isStl } from './file-inspector.js';
import { sanitizeName } from './uploads.service.js';
import { UPLOAD_POLICIES } from './upload-policies.js';

const inspector = new FileInspector();
const images = UPLOAD_POLICIES.LEAD_REFERENCE;
const models = UPLOAD_POLICIES.PRODUCT_MODEL;

// Smallest valid headers for each format.
const png = Uint8Array.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0,
  0,
  0,
  13,
  0x49,
  0x48,
  0x44,
  0x52,
  ...Array.from({ length: 17 }, () => 0),
]);
const jpeg = Uint8Array.from([
  0xff,
  0xd8,
  0xff,
  0xe0,
  0,
  0x10,
  0x4a,
  0x46,
  0x49,
  0x46,
  0,
  1,
  ...Array.from({ length: 20 }, () => 0),
]);
const svg = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);
const html = new TextEncoder().encode(
  '<!doctype html><html><body>hi</body></html>',
);

function binaryStl(triangles: number): Uint8Array {
  const data = new Uint8Array(84 + triangles * 50);
  new DataView(data.buffer).setUint32(80, triangles, true);
  return data;
}
const asciiStl = new TextEncoder().encode(
  'solid cube\n  facet normal 0 0 1\n    outer loop\n',
);

describe('FileInspector', () => {
  it('identifies a PNG by its bytes', async () => {
    await expect(inspector.inspect(png, images)).resolves.toEqual({
      ok: true,
      mimeType: 'image/png',
      extension: 'png',
    });
  });

  it('identifies a JPEG by its bytes', async () => {
    await expect(inspector.inspect(jpeg, images)).resolves.toMatchObject({
      ok: true,
      extension: 'jpg',
    });
  });

  it.each([
    ['SVG (can carry scripts)', svg],
    ['HTML', html],
    ['random bytes', Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])],
  ])('rejects %s as an image', async (_name, data) => {
    await expect(inspector.inspect(data, images)).resolves.toEqual({
      ok: false,
      reason: 'This file type is not accepted',
    });
  });

  it('rejects a model where an image is expected, whatever it is called', async () => {
    await expect(
      inspector.inspect(binaryStl(2), images),
    ).resolves.toMatchObject({ ok: false });
  });

  it('accepts binary and ASCII STL models', async () => {
    await expect(inspector.inspect(binaryStl(12), models)).resolves.toEqual({
      ok: true,
      mimeType: 'model/stl',
      extension: 'stl',
    });
    await expect(inspector.inspect(asciiStl, models)).resolves.toMatchObject({
      ok: true,
      extension: 'stl',
    });
  });

  it('rejects empty and oversized files', async () => {
    await expect(inspector.inspect(new Uint8Array(0), images)).resolves.toEqual(
      { ok: false, reason: 'The file is empty' },
    );
    const big = new Uint8Array(images.maxBytes + 1);
    big.set(png);
    await expect(inspector.inspect(big, images)).resolves.toEqual({
      ok: false,
      reason: 'The file is larger than 10 MB',
    });
  });
});

describe('isStl', () => {
  it('rejects a binary file whose size does not match its triangle count', () => {
    const data = binaryStl(3);
    new DataView(data.buffer).setUint32(80, 4, true);
    expect(isStl(data)).toBe(false);
  });
});

describe('sanitizeName', () => {
  it.each([
    ['../../etc/passwd', 'passwd'],
    ['C:\\Users\\x\\photo.png', 'photo.png'],
    ['bad\u0000name\u001f.jpg', 'badname.jpg'],
    ['', 'upload'],
  ])('%j → %j', (input, expected) => {
    expect(sanitizeName(input)).toBe(expected);
  });
});
