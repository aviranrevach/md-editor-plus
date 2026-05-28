# Header / chrome responsiveness — design

Three responsive-design fixes to the top-of-plugin toolbar and outline
panel. Deferred from manual smoke during the whiteboard rollout (logged
in `docs/superpowers/backlog.md`). All three failure modes happen at
narrow editor widths — common in VS Code with side-by-side splits,
sidebars, or non-fullscreen windows.

## Why

At narrow widths today:

- The **Preview / Code segmented control** keeps its full text labels
  even when there's no room. The labels collide with the centered
  filename pill.
- The **filename** is `position: absolute, left: 50%, max-width: 50vw`.
  At narrow widths 50vw is too generous and the filename overlaps the
  right-side button group (reload / Aa / `⋯`).
- The **outline panel** is 240px wide on the left. At narrow widths
  it crowds the editor content and overlaps the toolbar's view-toggle
  pill underneath, leaving very little room for actual text.

The user surfaced all three from real-window smoke testing the
whiteboard work. See `docs/superpowers/backlog.md` for the original
report.

## What ships

Two media-query blocks in `src/webview/styles/editor.css`. No JS, no
HTML, no schema changes.

### Breakpoint table

| | ≥ 900 px | < 900 px | < 640 px |
|---|---|---|---|
| Preview / Code labels | shown | **hidden** (icon-only) | hidden |
| Filename `max-width` | `50vw` | `30vw` | `30vw` |
| Outline panel        | toggleable | toggleable | **hidden** |
| Outline button       | shown | shown | **hidden** |
| Editor `padding-left` when outline open | `240px` | `240px` | `0` |

### Why two tiers

- **900 px (narrow):** the Preview / Code labels and the wide filename
  are the first things to crowd into the right-side chrome. The outline
  is still useful at this width.
- **640 px (very narrow):** the 240 px outline would leave under 400
  px for editor content — text becomes unreadable. Auto-collapse +
  hide the button. The labels are already gone from the 900 px tier.

### Why CSS-only

All three rules are layout-state changes, not behavior changes:

- Hiding the labels: `display: none` on `.seg-label`.
- Tightening the filename: drop `max-width` from `50vw` to `30vw`.
- Auto-collapsing the outline: `display: none` on `.outline-panel`,
  reset the `padding-left` on `#editor` / `#source-view` that the
  open-state CSS adds, and hide the toolbar button.

No JS state change is needed because the outline's open/closed status
is a class on `<html>` (`html.outline-visible`). Resizing back wide
restores the previous state automatically.

## Architecture

The CSS lives next to the existing toolbar block at the top of
`src/webview/styles/editor.css`. Two new `@media` blocks added:

```css
@media (max-width: 900px) {
  #toolbar #view-seg .seg-btn .seg-label { display: none; }
  .toolbar-filename { max-width: 30vw; }
}

@media (max-width: 640px) {
  .outline-panel { display: none !important; }
  html.outline-visible #editor,
  html.outline-visible #source-view { padding-left: 0; }
  #toolbar #outline-btn { display: none; }
}
```

### Three implementation notes

**`!important` on `.outline-panel`** — required because the panel may
be in its open state (no `.hidden` class) when the user resizes below
640 px. The base rule `.outline-panel.hidden { display: none }` only
fires when the user explicitly closes the panel; the media query needs
to win against the open state.

**`padding-left: 0` reset on `#editor` / `#source-view`** — when the
outline is open, the editor and source views have `padding-left:
240px` so the panel doesn't overlap the content. Hiding the panel
without resetting this leaves a 240 px gutter on the left. The reset
lets the editor reclaim the space.

**No state preservation logic** — when the window grows back above
640 px, the outline panel and button reappear with whatever
open/closed state the user had previously. The DOM never lost its
class; only CSS suppressed rendering.

## Files changed

- `src/webview/styles/editor.css` — append two `@media` blocks near
  the existing `#toolbar` block (around line 13-100).

No other files. No tests, no docs (this design document IS the doc).

## Testing

Automated tests are not viable — testing CSS media queries in jsdom
would only verify the rules exist in the stylesheet, not that they
apply at given viewport widths. Real-browser visual verification is
the only meaningful test.

### Manual verification

1. **≥ 900 px baseline.** Open any `.md` file in a wide window.
   Toolbar shows logo + Preview/Code segmented control (with text
   labels) + outline button + centered filename + right-side chrome
   (reload / Aa / `⋯`). Nothing overlaps.
2. **Narrow to 900 px.** Drag the editor split until the window
   crosses 900 px wide. Preview/Code labels disappear — only the
   eye and `<>` icons remain. Filename truncates earlier (its
   max-width is now 30vw). No overlap with the right-side buttons
   even with a long filename.
3. **Narrow to 640 px.** Drag further until under 640 px. Outline
   button vanishes from the toolbar. If the outline panel was open,
   it disappears AND the editor reclaims that 240 px gutter
   (content shifts left to fill).
4. **Resize back up.** Drag the split back wide. Labels return at
   900 px. Outline returns at 640 px in its previous state.
5. **Outline state preservation.** Open outline at wide width →
   shrink below 640 → outline disappears → grow back → outline
   returns automatically. Confirms no JS state was destroyed.

### Regressions to watch for

- Toolbar idle-fade (50% opacity until cursor approaches) — none of
  the rules touch opacity; should not be affected.
- Filename hover-to-open-actions-menu behavior — only `max-width`
  changes, not the position or click handlers.
- Fullscreen mermaid mode chrome — uses `.mermaid-fullscreen-*`
  classes; none of the rules target those.

## Out of scope

- Refactoring the absolute-positioned filename to a flex-based
  centered layout. The existing absolute layout supports the toolbar
  idle-fade and the hover-actions-menu in a specific way that a
  refactor would risk regressing. The max-width tweak is sufficient.
- Mobile / touch-specific styling. VS Code's webview is a desktop
  context.
- Theme-specific responsiveness. Both light and dark themes use the
  same toolbar styles; the new rules apply equally.
