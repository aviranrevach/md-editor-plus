import { normalizeWidth, clampWidth, imageNodeToMarkdown } from '../src/webview/imageMarkdown';

describe('normalizeWidth', () => {
  it('returns a positive integer for numbers and numeric strings', () => {
    expect(normalizeWidth(420)).toBe(420);
    expect(normalizeWidth('420')).toBe(420);
    expect(normalizeWidth('420px')).toBe(420);
    expect(normalizeWidth(419.6)).toBe(420);
  });
  it('returns null for missing / zero / negative / non-numeric', () => {
    expect(normalizeWidth(null)).toBeNull();
    expect(normalizeWidth('')).toBeNull();
    expect(normalizeWidth(0)).toBeNull();
    expect(normalizeWidth(-5)).toBeNull();
    expect(normalizeWidth('abc')).toBeNull();
  });
});

describe('clampWidth', () => {
  it('bounds a value into [min, max] and rounds', () => {
    expect(clampWidth(50, 80, 700)).toBe(80);
    expect(clampWidth(999, 80, 700)).toBe(700);
    expect(clampWidth(420.4, 80, 700)).toBe(420);
  });
  it('tolerates swapped min/max', () => {
    expect(clampWidth(420, 700, 80)).toBe(420);
  });
});

describe('imageNodeToMarkdown', () => {
  it('emits clean ![]() when no width', () => {
    expect(imageNodeToMarkdown({ src: './a.png', alt: '' })).toBe('![](./a.png)');
    expect(imageNodeToMarkdown({ src: './a.png', alt: 'cat' })).toBe('![cat](./a.png)');
  });
  it('escapes parens in the src for the ![]() form', () => {
    expect(imageNodeToMarkdown({ src: './a(1).png', alt: '' })).toBe('![](./a\\(1\\).png)');
  });
  it('emits an HTML <img> with width when width is set', () => {
    expect(imageNodeToMarkdown({ src: './a.png', alt: '', width: 420 }))
      .toBe('<img src="./a.png" width="420" />');
  });
  it('includes alt in the <img> when present', () => {
    expect(imageNodeToMarkdown({ src: './a.png', alt: 'cat', width: 420 }))
      .toBe('<img src="./a.png" alt="cat" width="420" />');
  });
  it('escapes double quotes and angle brackets in <img> attributes', () => {
    expect(imageNodeToMarkdown({ src: './a"b.png', alt: '<x>', width: 100 }))
      .toBe('<img src="./a&quot;b.png" alt="&lt;x&gt;" width="100" />');
  });
  it('treats zero / negative width as unsized', () => {
    expect(imageNodeToMarkdown({ src: './a.png', alt: '', width: 0 })).toBe('![](./a.png)');
  });
});
