# Mermaid visual edit — Phase 5 design

Replace the minimal context tip with a rich style bar (font size, bold,
text color, fill color, border color, duplicate, lock, more) and a
`%% mb-styles` sidecar to persist per-node style overrides.

## Sidecar

```
flowchart TB
    %% mb-positions: {…}
    %% mb-locks: ["n1"]
    %% mb-styles: {"n1":{"fill":"#fef3c7","border":"#b45309","text":"#451a03","fontSize":14,"bold":true}}
    ...
```

Parser additions:
- `'styles'` line kind: `{ raw, map: StyleMap }`
- `tryParseStylesLine(trimmed)` reading the JSON.
- `getStyles(ast)`, `setNodeStyle(ast, id, partial)`, `clearNodeStyle(ast, id)`.

## Apply

`applyStylesOverlay(ast, host)` runs after `applyPositionsOverlay` in
`applyOverlaysAndStyles(ast, host)`. For each entry:

- Override the inner `<rect>` / `<circle>` / `<path>` `fill` and
  `stroke` (border).
- Override the label's `fill` color via inline style on
  `foreignObject div` (or `<text>` element).
- Set `font-size` and `font-weight` inline on the label.

Mermaid v11 nests labels in `<foreignObject>` with a `<div class="nodeLabel">`. Style accordingly.

## Bar

The existing single-node context tip becomes a wider chrome:

`[Font 14 ▾] · [B] · [≡ ▾] · [A] · [○ border] · [● fill] · [⧉ Duplicate] · [🔒 Lock] · [×]`

- Font size: small input with up/down spinners (default 14).
- Bold: toggle.
- Text alignment ≡: left / center / right (popover).
- Text color A: 6-swatch popover + custom hex input.
- Border / fill: same 6-swatch popover.
- Duplicate: clones the node (creates `id-copy` with same style, near
  the original).
- Lock: existing.
- ×: existing.

Multi-select: bar still appears but only color / lock / delete are
exposed (font/bold/align are per-node).

## Files changed

- `mermaidVisualEdit.ts` — styles sidecar + helpers.
- `mermaidVisualEditDom.ts` — context tip becomes the style bar;
  applyStylesOverlay called from mermaidBlock alongside positions.
- `extensions/mermaidBlock.ts` — call applyStylesOverlay after positions.
- `editor.css` — bar layout, swatch popovers, custom hex input.

## Limitations

- Mermaid's own theme variables still apply; our overrides win because
  we set inline attributes on the rendered SVG elements.
- Bold and font-size apply only to the node label, not edges.
- Border-style (dash/dotted) and text alignment are stubbed in the bar
  but the visual application is "best effort"; some shapes won't
  reflect them.
