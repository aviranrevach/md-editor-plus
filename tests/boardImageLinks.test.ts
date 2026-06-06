import { parseImageLinks, firstImageSrc, appendImageLink, removeImageLinkAt } from '../src/webview/boardImageLinks';

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
  it('keeps balanced parens inside the path instead of truncating', () => {
    expect(parseImageLinks('![](./a_(1).png)')).toEqual([{ alt: '', src: './a_(1).png' }]);
    expect(parseImageLinks('![](./a_(1).png) ![](./b.png)')).toEqual([
      { alt: '', src: './a_(1).png' },
      { alt: '', src: './b.png' },
    ]);
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

describe('removeImageLinkAt', () => {
  it('removes the link at the given index', () => {
    expect(removeImageLinkAt('![](./a.png) ![](./b.png)', 0)).toBe('![](./b.png)');
    expect(removeImageLinkAt('![](./a.png) ![](./b.png)', 1)).toBe('![](./a.png)');
  });
  it('returns empty string when removing the only link', () => {
    expect(removeImageLinkAt('![](./a.png)', 0)).toBe('');
  });
  it('preserves alt text on the kept links', () => {
    expect(removeImageLinkAt('![x](./a.png) ![y](./b.png)', 0)).toBe('![y](./b.png)');
  });
  it('returns input unchanged for out-of-range index', () => {
    expect(removeImageLinkAt('![](./a.png)', 5)).toBe('![](./a.png)');
  });
});
