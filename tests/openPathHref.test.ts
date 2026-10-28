import { localPathFromHref } from '../src/openPath';

describe('localPathFromHref', () => {
  it('returns relative paths without fragment or query', () => {
    expect(localPathFromHref('./docs/todo/T02-alignment-audit.md')).toBe('./docs/todo/T02-alignment-audit.md');
    expect(localPathFromHref('docs/a%20b.md#section')).toBe('docs/a b.md');
  });
  it('ignores external, anchor and empty hrefs', () => {
    expect(localPathFromHref('https://example.com/a.md')).toBeNull();
    expect(localPathFromHref('mailto:a@b.c')).toBeNull();
    expect(localPathFromHref('#top')).toBeNull();
    expect(localPathFromHref('')).toBeNull();
  });
  it('handles file:// urls', () => {
    expect(localPathFromHref('file:///tmp/a.md')).toBe('/tmp/a.md');
  });
});
