import { decideBelowClickAction, shouldShowBelowHint } from '../src/webview/extensions/clickBelowContent';

const base = {
  editable: true,
  button: 0,
  belowContent: true,
  lastIsEmptyParagraph: false,
};

describe('decideBelowClickAction (c51)', () => {
  it('appends a paragraph when clicking below a non-empty / non-paragraph last block', () => {
    expect(decideBelowClickAction(base)).toEqual({ kind: 'append-paragraph' });
  });

  it('just focuses the trailing empty paragraph instead of stacking another', () => {
    expect(decideBelowClickAction({ ...base, lastIsEmptyParagraph: true })).toEqual({
      kind: 'focus-empty-last',
    });
  });

  it('does nothing when the click is not below the content', () => {
    expect(decideBelowClickAction({ ...base, belowContent: false })).toEqual({ kind: 'none' });
  });

  it('does nothing in read-only documents', () => {
    expect(decideBelowClickAction({ ...base, editable: false })).toEqual({ kind: 'none' });
  });

  it('ignores non-left clicks (e.g. right-click for context menu)', () => {
    expect(decideBelowClickAction({ ...base, button: 2 })).toEqual({ kind: 'none' });
  });

  it('read-only wins even over an empty trailing paragraph', () => {
    expect(
      decideBelowClickAction({ ...base, editable: false, lastIsEmptyParagraph: true }),
    ).toEqual({ kind: 'none' });
  });
});

describe('shouldShowBelowHint (c51)', () => {
  const hintBase = { editable: true, belowContent: true, lastIsEmptyParagraph: false };

  it('shows the ghost hint when hovering below a doc that ends in a non-text block', () => {
    expect(shouldShowBelowHint(hintBase)).toBe(true);
  });

  it('hides when the pointer is not below the content', () => {
    expect(shouldShowBelowHint({ ...hintBase, belowContent: false })).toBe(false);
  });

  it('hides in read-only docs (no affordance to write)', () => {
    expect(shouldShowBelowHint({ ...hintBase, editable: false })).toBe(false);
  });

  it('hides when the doc already ends in an empty paragraph (no double empty state)', () => {
    expect(shouldShowBelowHint({ ...hintBase, lastIsEmptyParagraph: true })).toBe(false);
  });
});
