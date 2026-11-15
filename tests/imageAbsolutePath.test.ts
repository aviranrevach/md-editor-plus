import { absoluteImagePath } from '../src/webview/imageNodeView';

describe('absoluteImagePath', () => {
  it('resolves ./ and ../ against the doc dir', () => {
    expect(absoluteImagePath('./Note.assets/a.png', '/Users/me/docs')).toBe('/Users/me/docs/Note.assets/a.png');
    expect(absoluteImagePath('../img/a.png', '/Users/me/docs')).toBe('/Users/me/img/a.png');
  });
  it('decodes percent-encoding', () => {
    expect(absoluteImagePath('a%20b.png', '/d')).toBe('/d/a b.png');
  });
  it('returns null for remote/data images or missing dir', () => {
    expect(absoluteImagePath('https://x.com/a.png', '/d')).toBeNull();
    expect(absoluteImagePath('data:image/png;base64,AAA', '/d')).toBeNull();
    expect(absoluteImagePath('a.png', '')).toBeNull();
  });
  it('handles windows dirs', () => {
    expect(absoluteImagePath('./a.png', 'C:\\Users\\me')).toBe('C:\\Users\\me\\a.png');
  });
});
