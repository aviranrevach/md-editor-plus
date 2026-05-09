import {
  splitFrontmatter,
  countFrontmatterLines,
  frontmatterInfo,
} from '../src/webview/frontmatter';

describe('splitFrontmatter', () => {
  it('returns kind=none for plain markdown', () => {
    const r = splitFrontmatter('# Hello\n\nNo frontmatter here.');
    expect(r.kind).toBe('none');
    expect(r.frontmatter).toBe('');
    expect(r.body).toBe('# Hello\n\nNo frontmatter here.');
  });

  it('returns kind=yaml and strips a leading YAML block', () => {
    const md = '---\ntitle: A\ntags: [x]\n---\n\n# Body\n';
    const r = splitFrontmatter(md);
    expect(r.kind).toBe('yaml');
    expect(r.frontmatter).toBe('---\ntitle: A\ntags: [x]\n---\n');
    expect(r.body).toBe('\n# Body\n');
  });

  it('returns kind=toml and strips a leading TOML block', () => {
    const md = '+++\ntitle = "A"\n+++\n# Body\n';
    const r = splitFrontmatter(md);
    expect(r.kind).toBe('toml');
    expect(r.frontmatter).toBe('+++\ntitle = "A"\n+++\n');
    expect(r.body).toBe('# Body\n');
  });
});

describe('countFrontmatterLines', () => {
  it('returns 0 for empty input', () => {
    expect(countFrontmatterLines('')).toBe(0);
  });

  it('counts the inner lines of a YAML block', () => {
    expect(countFrontmatterLines('---\ntitle: A\ntags: [x]\n---\n')).toBe(2);
  });

  it('counts a single-line YAML block as 1', () => {
    expect(countFrontmatterLines('---\ntitle: A\n---\n')).toBe(1);
  });

  it('counts the inner lines of a TOML block', () => {
    expect(countFrontmatterLines('+++\ntitle = "A"\nauthor = "B"\n+++\n')).toBe(2);
  });
});

describe('frontmatterInfo', () => {
  it('reports kind=none and lines=0 for plain markdown', () => {
    expect(frontmatterInfo('# Hello\n')).toEqual({ kind: 'none', lines: 0 });
  });

  it('reports kind=yaml and the inner line count', () => {
    const md = '---\ntitle: A\ntags: [x]\ndate: 2026-05-09\n---\n\n# Body';
    expect(frontmatterInfo(md)).toEqual({ kind: 'yaml', lines: 3 });
  });

  it('reports kind=toml and the inner line count', () => {
    const md = '+++\ntitle = "A"\n+++\n# Body';
    expect(frontmatterInfo(md)).toEqual({ kind: 'toml', lines: 1 });
  });
});
