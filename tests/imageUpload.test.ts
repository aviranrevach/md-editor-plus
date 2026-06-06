/**
 * @jest-environment jsdom
 */
import { arrayBufferToBase64 } from '../src/webview/imageUpload';

describe('arrayBufferToBase64', () => {
  it('encodes bytes to standard base64', () => {
    // "Man" -> "TWFu"
    const bytes = new Uint8Array([0x4d, 0x61, 0x6e]);
    expect(arrayBufferToBase64(bytes.buffer)).toBe('TWFu');
  });
  it('handles an empty buffer', () => {
    expect(arrayBufferToBase64(new Uint8Array([]).buffer)).toBe('');
  });
  it('pads correctly for non-multiple-of-3 lengths', () => {
    // "M" -> "TQ=="
    expect(arrayBufferToBase64(new Uint8Array([0x4d]).buffer)).toBe('TQ==');
  });
});

import { revealImage } from '../src/webview/imageUpload';

describe('revealImage transport', () => {
  it('posts a revealImage message and resolves when the extension replies', async () => {
    const posted: any[] = [];
    (window as any).__mdViewerVscode = { postMessage: (m: any) => posted.push(m) };
    const p = revealImage('./Note.assets/x.png');
    const req = posted.find((m) => m.type === 'revealImage');
    expect(req).toBeTruthy();
    expect(req.relPath).toBe('./Note.assets/x.png');
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'imageRevealed', requestId: req.requestId, ok: true },
    }));
    await expect(p).resolves.toBeUndefined();
  });
});
