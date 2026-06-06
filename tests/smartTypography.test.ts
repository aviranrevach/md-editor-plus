import { findSmartTypographyMatch } from '../src/webview/extensions/smartTypography';

describe('findSmartTypographyMatch — single mappings', () => {
  const cases: Array<[string, string]> = [
    ['->', '→'],
    ['<-', '←'],
    ['=>', '⇒'],
    ['--', '—'],
    ['...', '…'],
    ['(c)', '©'],
    ['(r)', '®'],
    ['(tm)', '™'],
  ];
  it.each(cases)('replaces %s with %s', (typed, expected) => {
    const m = findSmartTypographyMatch(typed);
    expect(m).not.toBeNull();
    expect(m!.replacement).toBe(expected);
    expect(m!.matchLength).toBe(typed.length);
  });

  it('matches symbol triggers case-insensitively', () => {
    expect(findSmartTypographyMatch('(C)')!.replacement).toBe('©');
    expect(findSmartTypographyMatch('(TM)')!.replacement).toBe('™');
  });

  it('only considers the end of the buffer (prose before the trigger is ignored)', () => {
    const m = findSmartTypographyMatch('see this ->');
    expect(m!.replacement).toBe('→');
    expect(m!.matchLength).toBe(2);
  });
});

describe('findSmartTypographyMatch — ordering & double arrows', () => {
  it('prefers <=> (⇔) over => when both could match', () => {
    expect(findSmartTypographyMatch('<=>')!.replacement).toBe('⇔');
  });

  it('prefers literal <-> (↔) over -> when both could match', () => {
    expect(findSmartTypographyMatch('<->')!.replacement).toBe('↔');
  });

  it('completes ↔ from the post-conversion ←> buffer', () => {
    // After <- auto-converts to ←, typing > leaves "←>" before the cursor
    expect(findSmartTypographyMatch('←>')!.replacement).toBe('↔');
  });
});

describe('findSmartTypographyMatch — excluded sequences', () => {
  it('leaves <= untouched (means less-than-or-equal, not ⇐)', () => {
    expect(findSmartTypographyMatch('<=')).toBeNull();
  });
  it('leaves >= untouched', () => {
    expect(findSmartTypographyMatch('>=')).toBeNull();
  });
  it('returns null when nothing matches', () => {
    expect(findSmartTypographyMatch('hello')).toBeNull();
    expect(findSmartTypographyMatch('-')).toBeNull();
  });
});
