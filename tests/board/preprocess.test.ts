import { preprocessMarkdownBoards } from '../../src/webview/extensions/board';

describe('preprocessMarkdownBoards', () => {
  it('wraps each board region in a single <div data-board>', () => {
    const md = [
      `# Hello`,
      ``,
      `<!-- board:start id="b1" -->`,
      ``,
      `| Title | Status |`,
      `|---|---|`,
      `| c1 | Todo |`,
      ``,
      `<!-- board:end -->`,
      ``,
      `Goodbye`,
    ].join('\n');

    const html = preprocessMarkdownBoards(md);
    const matches = html.match(/<div data-board source="[^"]*"><\/div>/g);
    expect(matches).toHaveLength(1);
    expect(html.startsWith('# Hello')).toBe(true);
    expect(html.trim().endsWith('Goodbye')).toBe(true);
  });

  it('encodes quotes inside source so the attribute parses', () => {
    const md = [
      `<!-- board:start id="b1" name="quoted" -->`,
      ``,
      `<!-- board:end -->`,
    ].join('\n');
    const html = preprocessMarkdownBoards(md);
    expect(html).toContain('source="&lt;!-- board:start');
    expect(html).toMatch(/source="[^"]+"/);
  });

  it('passes through markdown without boards unchanged', () => {
    const md = '# Hello\n\nNo boards here.';
    expect(preprocessMarkdownBoards(md)).toBe(md);
  });
});
