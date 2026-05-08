import { calloutToMarkdown, parseCalloutLine } from '../src/webview/extensions/callout';

describe('callout serialization', () => {
  it('serializes a NOTE callout to markdown', () => {
    expect(calloutToMarkdown('note', '💡', 'This is a note')).toBe(
      '> [!NOTE] 💡\n> This is a note\n'
    );
  });

  it('serializes a WARNING callout to markdown', () => {
    expect(calloutToMarkdown('warning', '⚠️', 'Be careful')).toBe(
      '> [!WARNING] ⚠️\n> Be careful\n'
    );
  });

  it('serializes a TIP callout to markdown', () => {
    expect(calloutToMarkdown('tip', '✅', 'Pro tip')).toBe(
      '> [!TIP] ✅\n> Pro tip\n'
    );
  });
});

describe('callout parsing', () => {
  it('parses a NOTE callout header line', () => {
    expect(parseCalloutLine('> [!NOTE] 💡')).toEqual({ type: 'note', emoji: '💡' });
  });

  it('parses a WARNING callout header line', () => {
    expect(parseCalloutLine('> [!WARNING] ⚠️')).toEqual({ type: 'warning', emoji: '⚠️' });
  });

  it('returns null for a regular blockquote', () => {
    expect(parseCalloutLine('> regular blockquote')).toBeNull();
  });

  it('defaults emoji when not specified in the header', () => {
    expect(parseCalloutLine('> [!TIP]')).toEqual({ type: 'tip', emoji: '✅' });
  });
});
