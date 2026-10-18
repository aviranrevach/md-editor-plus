/**
 * @jest-environment jsdom
 */
// Tests for naturalSvgScale — the helper that translates between
// SVG user units and on-screen pixels for dot-grid sizing.

import { naturalSvgScale } from '../../src/webview/mermaidVisualEditDom';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Builds the same DOM shape installDotGrid sees in production:
// outer .mb-preview > .mb-svg-host > <svg>.
function makePreviewWithSvg(opts: {
  viewBox?: string;
  hostWidth?: number;
} = {}): HTMLElement {
  const preview = document.createElement('div');
  preview.className = 'mb-preview';
  if (opts.viewBox !== undefined) {
    const svgHost = document.createElement('div');
    svgHost.className = 'mb-svg-host';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', opts.viewBox);
    if (opts.hostWidth !== undefined) {
      // jsdom returns zero from getBoundingClientRect by default. Override
      // so the helper can read a non-zero host width.
      Object.defineProperty(svg, 'getBoundingClientRect', {
        value: () => ({
          width: opts.hostWidth, height: 0,
          x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0,
          toJSON: () => ({}),
        }),
      });
    }
    svgHost.appendChild(svg);
    preview.appendChild(svgHost);
  }
  return preview;
}

describe('naturalSvgScale', () => {
  it('returns 1 when no SVG is present in the host', () => {
    const host = document.createElement('div');
    expect(naturalSvgScale(host)).toBe(1);
  });

  it('returns 1 when the SVG has zero-width viewBox', () => {
    const host = makePreviewWithSvg({ viewBox: '0 0 0 100', hostWidth: 400 });
    expect(naturalSvgScale(host)).toBe(1);
  });

  it('returns hostWidth / vbWidth for a wide viewBox (host=400, vb=100 → 4)', () => {
    const host = makePreviewWithSvg({ viewBox: '0 0 100 100', hostWidth: 400 });
    expect(naturalSvgScale(host)).toBe(4);
  });

  it('returns hostWidth / vbWidth for a narrow viewBox (host=100, vb=400 → 0.25)', () => {
    const host = makePreviewWithSvg({ viewBox: '0 0 400 100', hostWidth: 100 });
    expect(naturalSvgScale(host)).toBe(0.25);
  });
});
