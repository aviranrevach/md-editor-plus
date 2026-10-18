import { shouldShowPlaceholder, PLACEHOLDER_TEXT, isPlaceholderBlockType } from '../src/webview/extensions/emptyPlaceholder';

describe('shouldShowPlaceholder', () => {
  it('shows on the focused empty block', () => {
    expect(shouldShowPlaceholder({ isEmpty: true, isFocused: true, isFirstBlock: false, docIsEmpty: false, editable: true })).toBe(true);
  });

  it('shows on the first block of a brand-new empty document even when unfocused', () => {
    expect(shouldShowPlaceholder({ isEmpty: true, isFocused: false, isFirstBlock: true, docIsEmpty: true, editable: true })).toBe(true);
  });

  it('hides on a non-empty block', () => {
    expect(shouldShowPlaceholder({ isEmpty: false, isFocused: true, isFirstBlock: true, docIsEmpty: false, editable: true })).toBe(false);
  });

  it('hides on an unfocused empty block that is not the first line of an empty doc', () => {
    expect(shouldShowPlaceholder({ isEmpty: true, isFocused: false, isFirstBlock: false, docIsEmpty: false, editable: true })).toBe(false);
  });

  it('hides in read-only docs even on a focused empty block (c51)', () => {
    expect(shouldShowPlaceholder({ isEmpty: true, isFocused: true, isFirstBlock: true, docIsEmpty: true, editable: false })).toBe(false);
  });

  it('exposes the approved copy', () => {
    expect(PLACEHOLDER_TEXT).toBe('Start writing, or press / for commands');
  });
});

describe('isPlaceholderBlockType', () => {
  it('accepts paragraph and heading', () => {
    expect(isPlaceholderBlockType('paragraph')).toBe(true);
    expect(isPlaceholderBlockType('heading')).toBe(true);
  });

  it('rejects codeBlock and other types', () => {
    expect(isPlaceholderBlockType('codeBlock')).toBe(false);
    expect(isPlaceholderBlockType('blockquote')).toBe(false);
  });
});
