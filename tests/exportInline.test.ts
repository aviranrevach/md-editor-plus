import { inlineImagesAsDataUris, ImageBytesReader } from '../src/exportInline';

// A tiny 1x1 PNG's worth of bytes is unnecessary — any bytes prove the encoding path.
const bytesFor = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));

describe('inlineImagesAsDataUris', () => {
  it('replaces a local image src with a base64 data URI using the right mime', async () => {
    const read: ImageBytesReader = async (rel) =>
      rel === 'doc.assets/pic.png' ? bytesFor('hello') : null;
    const html = '<p><img src="doc.assets/pic.png" alt="x"></p>';

    const out = await inlineImagesAsDataUris(html, read);

    const b64 = Buffer.from('hello', 'utf8').toString('base64');
    expect(out).toContain(`src="data:image/png;base64,${b64}"`);
    expect(out).toContain('alt="x"'); // other attributes untouched
  });

  it('maps jpg extension to image/jpeg', async () => {
    const read: ImageBytesReader = async () => bytesFor('j');
    const out = await inlineImagesAsDataUris('<img src="./a/b.jpg">', read);
    expect(out).toContain('data:image/jpeg;base64,');
  });

  it('leaves remote and data URIs untouched', async () => {
    const read: ImageBytesReader = async () => bytesFor('nope');
    const html =
      '<img src="https://x.com/a.png"><img src="data:image/png;base64,AAAA"><img src="//cdn/x.gif">';
    const out = await inlineImagesAsDataUris(html, read);
    expect(out).toBe(html);
  });

  it('leaves an image untouched when the reader returns null (missing file)', async () => {
    const read: ImageBytesReader = async () => null;
    const html = '<img src="missing.png">';
    expect(await inlineImagesAsDataUris(html, read)).toBe(html);
  });

  it('leaves an image untouched when the reader throws', async () => {
    const read: ImageBytesReader = async () => {
      throw new Error('EACCES');
    };
    const html = '<img src="boom.png">';
    expect(await inlineImagesAsDataUris(html, read)).toBe(html);
  });

  it('resolves a repeated src only once but rewrites every occurrence', async () => {
    let calls = 0;
    const read: ImageBytesReader = async () => {
      calls += 1;
      return bytesFor('dup');
    };
    const html = '<img src="p.png"><img src="p.png">';
    const out = await inlineImagesAsDataUris(html, read);
    expect(calls).toBe(1);
    expect(out.match(/data:image\/png/g)?.length).toBe(2);
  });

  it('handles single-quoted src attributes', async () => {
    const read: ImageBytesReader = async () => bytesFor('q');
    const out = await inlineImagesAsDataUris("<img src='x.webp'>", read);
    expect(out).toContain("src='data:image/webp;base64,");
  });

  it('returns html unchanged when there are no img tags', async () => {
    const read: ImageBytesReader = async () => bytesFor('x');
    const html = '<p>no images here</p>';
    expect(await inlineImagesAsDataUris(html, read)).toBe(html);
  });
});
