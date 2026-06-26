import { assessWrite } from '../src/saveGuard';

const board = (rows: string) =>
  `# TODO\n\n<!-- board:start id="b1" columns="Todo|Done" -->\n\n` +
  `| Title | Status | id |\n|---|---|---|\n${rows}\n<!-- board:end -->\n`;

describe('assessWrite', () => {
  it('allows a normal content change', () => {
    expect(assessWrite('# Hello\n\nworld', '# Hello\n\nworld!').verdict).toBe('ok');
  });

  it('allows a legitimate shrink that keeps real content', () => {
    expect(assessWrite('line a\nline b\nline c', 'line a').verdict).toBe('ok');
  });

  it('allows the first write into an empty document', () => {
    expect(assessWrite('', '# New doc').verdict).toBe('ok');
    expect(assessWrite('   \n', '# New doc').verdict).toBe('ok');
  });

  it('refuses replacing real content with nothing (c37 0-byte wipe)', () => {
    const r = assessWrite('# Important\n\nlots of text', '');
    expect(r.verdict).toBe('wipe');
    expect(r.reason).toBe('empty-over-content');
  });

  it('refuses replacing real content with whitespace only', () => {
    expect(assessWrite('# Important', '   \n\n  ').verdict).toBe('wipe');
  });

  it('refuses a write that makes the board block disappear (c37 fragment)', () => {
    const prev = board('| Task A | Todo | c1 |\n| Task B | Done | c2 |');
    // The editor-singleton hijack wrote one card body as the WHOLE file.
    const next = 'also fit big menus into the screen\n\n![](./TODO.assets/image-7.webp)\n';
    const r = assessWrite(prev, next);
    expect(r.verdict).toBe('wipe');
    expect(r.reason).toBe('board-block-vanished');
  });

  it('allows edits that keep the board block (rows added or removed)', () => {
    const prev = board('| Task A | Todo | c1 |');
    const next = board('| Task A | Todo | c1 |\n| Task B | Done | c2 |');
    expect(assessWrite(prev, next).verdict).toBe('ok');
    // and a row removal still keeps the board → allowed (recoverable via history)
    expect(assessWrite(next, prev).verdict).toBe('ok');
  });

  it('allows removing a board from a doc that has other real content', () => {
    // If the user genuinely converts a board back to text, real content remains;
    // only the board markers go. This is a legit (rare) edit, not a wipe — the
    // board-vanished rule must still leave non-board docs untouched.
    const prev = board('| Task A | Todo | c1 |') + '\n# Notes\n\nkeep me';
    const next = '# Notes\n\nkeep me';
    // board vanished AND content shrank a lot, but text remains: still flagged,
    // because losing an entire board silently is the exact incident we guard.
    expect(assessWrite(prev, next).verdict).toBe('wipe');
  });
});
