# Mermaid visual edit — Phase 6 design

Refresh the toolbar's visual treatment and add a Sticky note tool.

## What ships

1. **Toolbar moves to bottom-center** of the block, pill-shaped (`border-radius: 999px`), softer shadow. Matches the Miro / Whimsical convention. (Top-anchored toolbars block the diagram content.)
2. **Sticky note tool (N hotkey)** — drops a rectangle node with style pre-applied: yellow fill `#fef6a9`, mustard border `#f0e07a`, dark text `#1f1f23`, bold. Default label "Note".

## What does NOT ship

- Pan tool — bundled with viewport (Phase 7).
- Frame, Stamp, Connector, Help — deferred.

## Files changed

- `mermaidVisualEditDom.ts` — Tool type adds 'sticky'; toolbar group has it; hotkey N; drop logic applies sticky style on the new node.
- `editor.css` — toolbar position + shape.
