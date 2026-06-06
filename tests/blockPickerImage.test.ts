/**
 * @jest-environment jsdom
 */
import { createBlockPicker } from '../src/webview/blockPicker';

interface InsertCall { pos: number; content: unknown; }

function mockEditor(calls: InsertCall[]): any {
  const chain: any = () => ({
    focus: () => chain(),
    insertContentAt: (pos: number, content: unknown) => { calls.push({ pos, content }); return chain(); },
    run: () => true,
  });
  return { commands: { focus() {}, scrollIntoView() {} }, chain };
}

function rowByText(el: Element, text: string): HTMLElement {
  return Array.from(el.querySelectorAll('.block-picker-item'))
    .find((r) => (r.textContent || '').includes(text)) as HTMLElement;
}

describe('image block-picker drill-down', () => {
  test('drilling into Image keeps the picker open and lists the four sub-actions', () => {
    const picker = createBlockPicker(mockEditor([]));
    const anchor = document.body.appendChild(document.createElement('div'));
    picker.open(anchor, 0);
    const el = Array.from(document.querySelectorAll('.block-picker')).pop() as HTMLElement;

    rowByText(el, 'Image').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    // Bug regression: a row click used to detach the clicked node, and the
    // bubble-phase outside-click handler then closed the picker.
    expect(el.classList.contains('open')).toBe(true);
    expect(rowByText(el, 'Upload from computer')).toBeTruthy();
    expect(rowByText(el, 'Browse project')).toBeTruthy();
    expect(rowByText(el, 'Embed link')).toBeTruthy();
    expect(rowByText(el, 'Embed from clipboard')).toBeTruthy();
  });

  test('Embed link shows an in-window field that inserts the typed src on Enter', () => {
    const calls: InsertCall[] = [];
    const picker = createBlockPicker(mockEditor(calls));
    const anchor = document.body.appendChild(document.createElement('div'));
    picker.open(anchor, 5);
    const el = Array.from(document.querySelectorAll('.block-picker')).pop() as HTMLElement;

    rowByText(el, 'Image').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    rowByText(el, 'Embed link').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(el.classList.contains('open')).toBe(true);
    const field = el.querySelector('.block-picker-inline-field') as HTMLInputElement;
    expect(field).toBeTruthy();
    // Filter bar is hidden so typing can't be stolen by the filter input.
    expect((el.querySelector('.block-picker-search') as HTMLElement).style.display).toBe('none');

    field.value = 'https://example.com/cat.png';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(calls).toHaveLength(1);
    expect(calls[0].pos).toBe(5);
    expect(calls[0].content).toEqual({ type: 'image', attrs: { src: 'https://example.com/cat.png', alt: '' } });
  });
});
