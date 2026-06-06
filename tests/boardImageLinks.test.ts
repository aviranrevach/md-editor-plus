import { parseImageLinks, firstImageSrc, appendImageLink } from '../src/webview/boardImageLinks';

describe('parseImageLinks', () => {
  it('returns [] for a string with no images', () => {
    expect(parseImageLinks('just text')).toEqual([]);
  });
  it('parses a single image link', () => {
    expect(parseImageLinks('![cat](./a.png)')).toEqual([{ alt: 'cat', src: './a.png' }]);
  });
  it('parses multiple image links in order', () => {
    expect(parseImageLinks('![](./a.png) ![b](./b.jpg)')).toEqual([
      { alt: '', src: './a.png' },
      { alt: 'b', src: './b.jpg' },
    ]);
  });
  it('parses images embedded mid-text', () => {
    expect(parseImageLinks('see ![x](./x.png) here')).toEqual([{ alt: 'x', src: './x.png' }]);
  });
});

describe('firstImageSrc', () => {
  it('returns the first image src', () => {
    expect(firstImageSrc('text ![a](./a.png) ![b](./b.png)')).toBe('./a.png');
  });
  it('returns null when there is no image', () => {
    expect(firstImageSrc('no images here')).toBeNull();
  });
});

describe('appendImageLink', () => {
  it('creates a link when the value is empty', () => {
    expect(appendImageLink('', './a.png')).toBe('![](./a.png)');
  });
  it('appends with a separating space when the value already has one', () => {
    expect(appendImageLink('![](./a.png)', './b.png')).toBe('![](./a.png) ![](./b.png)');
  });
});
