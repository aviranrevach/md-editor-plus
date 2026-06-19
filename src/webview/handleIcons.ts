const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(viewBox: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('fill', 'none');
  return svg;
}

/** Crisp plus glyph, 16×16 viewbox. */
export function createPlusIcon(): SVGSVGElement {
  const svg = svgEl('0 0 16 16');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M8 3v10M3 8h10');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-linecap', 'round');
  svg.appendChild(path);
  return svg;
}

/** 2×3 dot grid in a taller-than-wide viewbox so the grip reads vertical. */
export function createGripIcon(): SVGSVGElement {
  const svg = svgEl('0 0 12 18');
  svg.setAttribute('fill', 'currentColor');
  const cols = [3.5, 8.5];
  const rows = [4, 9, 14];
  for (const cy of rows) {
    for (const cx of cols) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', String(cx));
      c.setAttribute('cy', String(cy));
      c.setAttribute('r', '1.5');
      svg.appendChild(c);
    }
  }
  return svg;
}
