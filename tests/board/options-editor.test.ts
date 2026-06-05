/**
 * @jest-environment jsdom
 */
import { buildOptionsEditor } from '../../src/webview/boardStatusOptions';
import type { ColumnDef } from '../../src/webview/boardModel';

function render(options: ColumnDef[], cb: any) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  buildOptionsEditor(host, {
    getOptions: () => options,
    onAdd: cb.onAdd ?? (() => {}),
    onRename: cb.onRename ?? (() => {}),
    onRecolor: cb.onRecolor ?? (() => {}),
    onDelete: cb.onDelete ?? (() => {}),
  });
  return host;
}

describe('buildOptionsEditor', () => {
  const opts: ColumnDef[] = [{ name: 'Low', color: 'gray' }, { name: 'High', color: 'red' }];

  it('renders one row per option plus an add control', () => {
    const host = render(opts, {});
    expect(host.querySelectorAll('.bd-opt-row')).toHaveLength(2);
    expect(host.querySelector('.bd-opt-add')).not.toBeNull();
  });

  it('clicking × calls onDelete with the option name', () => {
    const deleted: string[] = [];
    const host = render(opts, { onDelete: (n: string) => deleted.push(n) });
    (host.querySelectorAll('.bd-opt-delete')[1] as HTMLElement).click();
    expect(deleted).toEqual(['High']);
  });

  it('clicking + add calls onAdd', () => {
    let added = 0;
    const host = render(opts, { onAdd: () => { added++; } });
    (host.querySelector('.bd-opt-add') as HTMLElement).click();
    expect(added).toBe(1);
  });

  it('picking a palette swatch calls onRecolor with (name, token)', () => {
    const calls: any[] = [];
    const host = render(opts, { onRecolor: (n: string, c: string) => calls.push([n, c]) });
    (host.querySelectorAll('.bd-opt-swatch')[0] as HTMLElement).click();
    const tealSwatch = host.querySelector('.bd-opt-palette .color-teal') as HTMLElement;
    tealSwatch.click();
    expect(calls).toEqual([['Low', 'teal']]);
  });
});
