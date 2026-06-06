/**
 * @jest-environment jsdom
 */
import {
  attachSmartTypography,
  setSmartTypographyEnabled,
} from '../src/webview/extensions/smartTypography';

// Simulates a user having just typed into an <input>: set the value, place the
// caret, and fire the same 'input' event the browser would.
function typeInInput(input: HTMLInputElement, value: string, caret = value.length): void {
  input.value = value;
  input.setSelectionRange(caret, caret);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('attachSmartTypography — <input> surfaces', () => {
  let input: HTMLInputElement;

  beforeEach(() => {
    setSmartTypographyEnabled(true);
    input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
  });

  afterEach(() => {
    input.remove();
    setSmartTypographyEnabled(true);
  });

  it('converts -> to → and moves the caret after the arrow', () => {
    attachSmartTypography(input);
    typeInInput(input, '->');
    expect(input.value).toBe('→');
    expect(input.selectionStart).toBe(1);
  });

  it('converts <- to ←', () => {
    attachSmartTypography(input);
    typeInInput(input, '<-');
    expect(input.value).toBe('←');
  });

  it('converts a trigger in the middle of text without disturbing the rest', () => {
    attachSmartTypography(input);
    // "to-> here", caret right after the trigger (position 4)
    typeInInput(input, 'to-> here', 4);
    expect(input.value).toBe('to→ here');
    expect(input.selectionStart).toBe(3);
  });

  it('leaves non-matching input untouched', () => {
    attachSmartTypography(input);
    typeInInput(input, 'hello');
    expect(input.value).toBe('hello');
  });

  it('does nothing when smart typography is disabled', () => {
    setSmartTypographyEnabled(false);
    attachSmartTypography(input);
    typeInInput(input, '->');
    expect(input.value).toBe('->');
  });

  it('stops converting after the returned cleanup detaches it', () => {
    const detach = attachSmartTypography(input);
    detach();
    typeInInput(input, '->');
    expect(input.value).toBe('->');
  });
});

describe('attachSmartTypography — contenteditable surfaces', () => {
  let div: HTMLElement;

  function typeInContentEditable(text: string, caret = text.length): void {
    div.textContent = text;
    const node = div.firstChild!;
    const range = document.createRange();
    range.setStart(node, caret);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    div.dispatchEvent(new Event('input', { bubbles: true }));
  }

  beforeEach(() => {
    setSmartTypographyEnabled(true);
    div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    document.body.appendChild(div);
  });

  afterEach(() => {
    div.remove();
    setSmartTypographyEnabled(true);
  });

  it('converts -> to → inside a contenteditable element', () => {
    attachSmartTypography(div);
    typeInContentEditable('a->');
    expect(div.textContent).toBe('a→');
  });
});
