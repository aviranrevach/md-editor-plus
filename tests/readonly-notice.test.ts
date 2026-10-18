/**
 * @jest-environment jsdom
 */
import { createReadOnlyNotice } from '../src/webview/readonlyNotice';

describe('readonlyNotice', () => {
  test('show() renders exactly one notice', () => {
    const container = document.createElement('div');
    createReadOnlyNotice({ container, onEnableEditing: () => {} }).show();
    expect(container.querySelectorAll('.readonly-notice').length).toBe(1);
  });

  test('second show() re-arms, does not stack', () => {
    const container = document.createElement('div');
    const n = createReadOnlyNotice({ container, onEnableEditing: () => {} });
    n.show();
    n.show();
    expect(container.querySelectorAll('.readonly-notice').length).toBe(1);
  });

  test('Enable editing button invokes the callback and hides the notice', () => {
    const container = document.createElement('div');
    let enabled = false;
    const n = createReadOnlyNotice({ container, onEnableEditing: () => { enabled = true; } });
    n.show();
    container.querySelector<HTMLElement>('.readonly-notice-enable')!.click();
    expect(enabled).toBe(true);
    expect(container.querySelectorAll('.readonly-notice').length).toBe(0);
  });

  test('auto-dismiss removes the notice after the timeout', () => {
    jest.useFakeTimers();
    const container = document.createElement('div');
    createReadOnlyNotice({ container, onEnableEditing: () => {}, autoDismissMs: 1000 }).show();
    expect(container.querySelectorAll('.readonly-notice').length).toBe(1);
    jest.advanceTimersByTime(1000);
    expect(container.querySelectorAll('.readonly-notice').length).toBe(0);
    jest.useRealTimers();
  });
});
