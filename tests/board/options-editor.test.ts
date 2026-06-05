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

describe('buildOptionsEditor — rename', () => {
  const opts = () => [{ name: 'Low', color: 'gray' }, { name: 'High', color: 'red' }] as any;

  it('blurring a changed name calls onRename(old, new)', () => {
    const calls: any[] = [];
    const host = render(opts(), { onRename: (o: string, n: string) => calls.push([o, n]) });
    const input = host.querySelectorAll('.bd-opt-name')[0] as HTMLInputElement;
    input.focus(); input.value = 'Minor'; input.dispatchEvent(new Event('blur'));
    expect(calls).toEqual([['Low', 'Minor']]);
  });

  it('blurring an unchanged name does not call onRename', () => {
    const calls: any[] = [];
    const host = render(opts(), { onRename: (o: string, n: string) => calls.push([o, n]) });
    const input = host.querySelectorAll('.bd-opt-name')[0] as HTMLInputElement;
    input.focus(); input.dispatchEvent(new Event('blur'));
    expect(calls).toEqual([]);
  });

  it('emptying a name does not call onRename', () => {
    const calls: any[] = [];
    const host = render(opts(), { onRename: (o: string, n: string) => calls.push([o, n]) });
    const input = host.querySelectorAll('.bd-opt-name')[0] as HTMLInputElement;
    input.focus(); input.value = '   '; input.dispatchEvent(new Event('blur'));
    expect(calls).toEqual([]);
  });

  it("typing a new name then clicking another row's delete flushes the rename first (no loss)", () => {
    const renamed: any[] = []; const deleted: string[] = [];
    const host = render(opts(), {
      onRename: (o: string, n: string) => renamed.push([o, n]),
      onDelete: (n: string) => deleted.push(n),
    });
    const input0 = host.querySelectorAll('.bd-opt-name')[0] as HTMLInputElement;
    input0.focus(); input0.value = 'Minor';
    (host.querySelectorAll('.bd-opt-delete')[1] as HTMLElement).click();
    expect(renamed).toEqual([['Low', 'Minor']]);
    expect(deleted).toEqual(['High']);
  });
});
