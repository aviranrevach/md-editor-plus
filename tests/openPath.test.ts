import {
  isMarkdownPath,
  resolveClipboardCandidates,
  MARKDOWN_EXTENSIONS,
} from '../src/openPath';
import * as path from 'path';

describe('isMarkdownPath', () => {
  it.each(MARKDOWN_EXTENSIONS)('accepts %s', (ext) => {
    expect(isMarkdownPath(`/x/y/file${ext}`)).toBe(true);
  });
  it('accepts an uppercase extension', () => {
    expect(isMarkdownPath('/x/README.MD')).toBe(true);
  });
  it('rejects a non-markdown extension', () => {
    expect(isMarkdownPath('/x/y/file.txt')).toBe(false);
  });
});

describe('resolveClipboardCandidates', () => {
  const doc = '/home/me/notes';
  const ws = '/home/me/project';

  it('returns empty for blank input', () => {
    expect(resolveClipboardCandidates('   ', doc, ws)).toEqual([]);
  });
  it('returns one normalized candidate for an absolute path', () => {
    expect(resolveClipboardCandidates('/tmp/a/../foo.md', doc, ws)).toEqual([
      '/tmp/foo.md',
    ]);
  });
  it('resolves a relative path against the doc folder first, then workspace', () => {
    expect(resolveClipboardCandidates('sub/foo.md', doc, ws)).toEqual([
      path.resolve(doc, 'sub/foo.md'),
      path.resolve(ws, 'sub/foo.md'),
    ]);
  });
  it('omits the workspace candidate when there is no workspace', () => {
    expect(resolveClipboardCandidates('foo.md', doc)).toEqual([
      path.resolve(doc, 'foo.md'),
    ]);
  });
  it('strips a file:// scheme', () => {
    expect(resolveClipboardCandidates('file:///tmp/foo.md', doc, ws)).toEqual([
      '/tmp/foo.md',
    ]);
  });
  it('deduplicates when docFolder equals workspaceRoot', () => {
    expect(resolveClipboardCandidates('foo.md', '/home/me/project', '/home/me/project')).toEqual([
      path.resolve('/home/me/project', 'foo.md'),
    ]);
  });
  it('decodes percent-encoded characters in a file:// URL', () => {
    expect(resolveClipboardCandidates('file:///tmp/my%20notes/foo.md', doc, ws)).toEqual([
      '/tmp/my notes/foo.md',
    ]);
  });
});
