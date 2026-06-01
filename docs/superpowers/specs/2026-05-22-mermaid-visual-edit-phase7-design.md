# Mermaid visual edit — Phase 7 design

Viewport: zoom (Cmd/Ctrl+= / Cmd+- / Cmd+wheel / zoom controls) and pan
(Pan tool, Space + drag, middle-button-equivalent).

## What ships

- Viewport state `{ scale, tx, ty }` applied via CSS transform to the
  `.mb-svg-host` wrapper.
- Pan tool (H hotkey) — hand icon in the toolbar. Activates a grab
  cursor; click-drag pans the SVG.
- Space + drag → temporary pan even while Select tool is active
  (matches Figma).
- Cmd/Ctrl + wheel → zoom around the cursor (anchor-preserving).
- Cmd/Ctrl + `=` / `+` / `-` → ±0.1 zoom.
- Cmd/Ctrl + `0` → reset viewport (scale 1, no offset).
- Zoom controls cluster in the bottom-right: `−   100%   +   ⌂`.

## Viewport state is ephemeral

The viewport does NOT persist to the source. Reload → fresh 100%, no
offset. This is matching Miro / Figma — zoom is a viewing mode,
not document content.

## Overlays stay in sync

Selection rings, context tip, marquee, etc. read DOM
`getBoundingClientRect`, which already accounts for CSS transforms,
so they follow nodes through zoom and pan automatically.

## Files changed

- `mermaidVisualEditDom.ts` — Tool gains 'pan', wheel handler,
  Cmd-key handlers, viewport state, zoomCtrl UI, pan drag mode.
- `editor.css` — zoom controls + grab/grabbing cursors.
