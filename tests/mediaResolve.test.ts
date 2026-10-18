import { setMediaBaseUri, resolveImageSrc, unresolveImageSrc } from '../src/webview/mediaResolve';

const BASE = 'https://file+.vscode-resource.vscode-cdn.net/Users/me/proj/output/article/';

describe('unresolveImageSrc', () => {
  beforeEach(() => setMediaBaseUri(BASE));

  it('returns the relative path for images under the document folder', () => {
    expect(unresolveImageSrc(resolveImageSrc('img/a.png'))).toBe('img/a.png');
  });

  it('rebuilds ../ paths for images outside the document folder', () => {
    expect(unresolveImageSrc(resolveImageSrc('../images/he/a.png'))).toBe('../images/he/a.png');
    expect(unresolveImageSrc(resolveImageSrc('../../x/b.png'))).toBe('../../x/b.png');
  });

  it('leaves remote and data URIs alone', () => {
    expect(unresolveImageSrc('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(unresolveImageSrc('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
  });
});
