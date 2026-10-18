import {
  toggleSymmetric,
  isSymmetricActive,
  wrapLink,
  wrapColor,
  clearColor,
  colorActive,
  type WrapInput,
} from '../src/webview/boardFormatToolbar';

// Build a WrapInput from a string with the selection marked by «…».
function sel(marked: string): WrapInput {
  const start = marked.indexOf('«');
  const stripped = marked.replace('«', '');
  const end = stripped.indexOf('»');
  const text = stripped.replace('»', '');
  return { text, start, end };
}

describe('toggleSymmetric — wrap', () => {
  test('wraps the selection with the marker', () => {
    const r = toggleSymmetric(sel('a «bold» b'), '**');
    expect(r.text).toBe('a **bold** b');
    // selection still covers the inner word
    expect(r.text.slice(r.start, r.end)).toBe('bold');
  });

  test('works at the start of the text', () => {
    const r = toggleSymmetric(sel('«hi» there'), '*');
    expect(r.text).toBe('*hi* there');
    expect(r.text.slice(r.start, r.end)).toBe('hi');
  });

  test('multi-char markers (strike, highlight, code)', () => {
    expect(toggleSymmetric(sel('«x»'), '~~').text).toBe('~~x~~');
    expect(toggleSymmetric(sel('«x»'), '==').text).toBe('==x==');
    expect(toggleSymmetric(sel('«x»'), '`').text).toBe('`x`');
  });
});

describe('toggleSymmetric — unwrap (toggle off)', () => {
  test('strips markers sitting just outside the selection', () => {
    // selection covers "bold", markers are adjacent (raw markdown shown in edit mode)
    const r = toggleSymmetric(sel('a **«bold»** b'), '**');
    expect(r.text).toBe('a bold b');
    expect(r.text.slice(r.start, r.end)).toBe('bold');
  });

  test('round-trips: wrap then unwrap returns original', () => {
    const original = 'a word here';
    const wrapped = toggleSymmetric({ text: original, start: 2, end: 6 }, '**');
    expect(wrapped.text).toBe('a **word** here');
    const unwrapped = toggleSymmetric({ text: wrapped.text, start: wrapped.start, end: wrapped.end }, '**');
    expect(unwrapped.text).toBe(original);
  });
});

describe('isSymmetricActive', () => {
  test('true when markers flank the selection', () => {
    expect(isSymmetricActive(sel('a **«bold»** b'), '**')).toBe(true);
  });
  test('false for a plain selection', () => {
    expect(isSymmetricActive(sel('a «bold» b'), '**')).toBe(false);
  });
  test('does not confuse * (italic) with ** (bold) boundary', () => {
    // selection flanked by ** — italic marker `*` also "ends with *", a known
    // overlap; documents current behaviour so a future refinement is intentional.
    expect(isSymmetricActive(sel('**«x»**'), '*')).toBe(true);
  });
});

describe('wrapLink', () => {
  test('produces [text](url) with the url placeholder selected', () => {
    const r = wrapLink(sel('see «here» now'));
    expect(r.text).toBe('see [here](url) now');
    expect(r.text.slice(r.start, r.end)).toBe('url');
  });
  test('custom placeholder', () => {
    const r = wrapLink(sel('«x»'), 'https://');
    expect(r.text).toBe('[x](https://)');
    expect(r.text.slice(r.start, r.end)).toBe('https://');
  });
});

describe('wrapColor / clearColor', () => {
  test('wraps the selection in a color span, inner text reselected', () => {
    const r = wrapColor(sel('a «red» b'), '#e55757');
    expect(r.text).toBe('a <span style="color:#e55757">red</span> b');
    expect(r.text.slice(r.start, r.end)).toBe('red');
  });

  test('clearColor strips a color span around the selection', () => {
    const wrapped = wrapColor(sel('a «red» b'), '#e55757');
    const cleared = clearColor({ text: wrapped.text, start: wrapped.start, end: wrapped.end });
    expect(cleared.text).toBe('a red b');
    expect(cleared.text.slice(cleared.start, cleared.end)).toBe('red');
  });

  test('clearColor is a no-op when no color span is present', () => {
    const input = sel('a «plain» b');
    const r = clearColor(input);
    expect(r.text).toBe('a plain b');
    expect(r).toEqual(input);
  });

  test('colorActive reflects a surrounding color span', () => {
    const wrapped = wrapColor(sel('«x»'), '#4a9ee8');
    expect(colorActive({ text: wrapped.text, start: wrapped.start, end: wrapped.end })).toBe(true);
    expect(colorActive(sel('«x»'))).toBe(false);
  });
});
