# c43 — Notion-style block picker menu

**Date:** 2026-06-20
**Status:** Design — awaiting review
**Task:** TODO.md c43 — "Menu list just like in notion - more compact menu lines and with icons with no borders - less padding, and footer (the footer text should be with smaller text like caption and not like notion)"

## Goal

Make the block / slash (`/`) picker read like Notion's slash menu: **borderless flat icons**, **tighter rows**, **less padding**, and a **caption-sized footer**. The reference is the screenshot pinned on the c43 card (`TODO.assets/image-5.png`).

## Scope

**In scope:** the block picker only — `.block-picker` and its children, styled in [editor.css:1994-2231](src/webview/styles/editor.css#L1994-L2231), built in [blockPicker.ts](src/webview/blockPicker.ts). This is the slash menu, the `+` insert menu, the dragger "Turn into" menu, and the convert/delete menu — they all share these classes.

**Out of scope:** the shared `.mp-menu` component (the `⋯` action menus, etc.) in [board.css:225-244](src/webview/styles/board.css#L225-L244). It is already borderless and compact; touching it would balloon the diff across 10+ menus for little gain. Decided during brainstorm (option A).

## Decisions (locked during visual brainstorm)

| Question | Decision |
| --- | --- |
| How wide a scope | Block picker only |
| Icon treatment | Borderless, transparent background |
| Icon size | **24×24** (was 36×36 boxed) |
| Row density | Tighter — less vertical padding, full-width hover |
| Search field placement | **Top** (today's position — unchanged) |
| Footer | **Navigation hints**, caption-sized: `↑↓ Navigate · ↵ Select · esc Close` |
| Shortcut hints (`#`, `##`…) | **Include** — small new addition (see Open question) |

## Visual changes — before → after

All values are in [editor.css](src/webview/styles/editor.css). No structural HTML change to existing rows; the footer is the one new element.

### Icons — `.block-picker-icon`
The headline change. Today each icon sits in a 36px bordered box.

| Property | Before | After |
| --- | --- | --- |
| `width` / `height` | `36px` | `24px` |
| `border` | `1px solid var(--border)` | `0` |
| `border-radius` | `7px` | `4px` (harmless; no visible bg) |
| `background` | `var(--bg)` | `transparent` |
| `color` | `var(--text-primary)` | `var(--text-secondary)` |
| font-size of glyph | inherited | `15px` |

### Rows — `.block-picker-item`
| Property | Before | After |
| --- | --- | --- |
| `gap` | `12px` | `10px` |
| `padding` | `6px 8px` | `4px 12px` |
| `border-radius` | `7px` | `6px` (keep; rounds the hover) |

`.block-picker-list { gap }` stays `1px`.

### Section labels — `.block-picker-section-label`
Notion uses calm sentence-case labels, not heavy uppercase.

| Property | Before | After |
| --- | --- | --- |
| `font-size` | `10px` | `11px` |
| `font-weight` | `700` | `600` |
| `text-transform` | `uppercase` | `none` |
| `letter-spacing` | `.08em` | `.01em` |
| `padding` | `8px 10px 4px` | `8px 12px 4px` |

### Active / current state — adapt for borderless icons
Today `.block-picker-item.active` and `.current` signal selection partly via the **icon border** turning `var(--link)`. With borderless icons that affordance disappears, so the state must lean on the row instead:

- `.block-picker-item.active` — keep row `background: var(--block-hover)`; icon + label tint to `var(--link)` (no border to color).
- `.block-picker-item.current` — keep the `color-mix` link-tinted row background, link-colored label, and the existing `.block-picker-current-mark` check. Drop the now-meaningless icon `border-color` rule.

### Footer — NEW element `.block-picker-footer`
Rendered once per picker, pinned at the bottom of `.block-picker` (after `.block-picker-list`), present in both the root menu and drill-down views.

```
.block-picker-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 7px 12px 5px; margin-top: 2px;
  border-top: 1px solid var(--border);
  font-size: 11px;            /* caption — smaller than Notion's ~14px */
  color: var(--text-secondary);
}
```

Content: `↑↓ Navigate · ↵ Select · esc Close`. The keys (`↑↓`, `↵`, `esc`) render in an even smaller (`10px`) muted style; verbs sit at `11px`. These actions are already wired ([blockPicker.ts:951-967](src/webview/blockPicker.ts#L951-L967)), so the footer is honest. In a drill-down view (where Esc means "go back"), the footer label adapts: `esc Back`.

### Container — `.block-picker`
`width` may stay `260px` or nudge to `280px` for the footer's three-part text to breathe on one line. Implementer's call during build; default to `260px` and only widen if the footer wraps.

## Shortcut hints (`#`, `##`, `-` …)

The reference shows a right-aligned markdown shortcut per row. The picker has **no such element today**, so this is a small addition, not a restyle:

- A new optional trailing span `.block-picker-shortcut` (muted, `12px`, `var(--text-secondary)` at ~`0.6` opacity), right-aligned before any caret/check.
- A static map from block type → shortcut label (`Heading 1 → #`, `Heading 2 → ##`, `Bulleted list → -`, `Numbered list → 1.`, `Quote → "`, `Code → \`\`\``, etc.). Only rows with a known shortcut show one.

This is the only piece that goes beyond the literal c43 wording. It is cheap and matches the reference. **Flagged for the reviewer to keep or drop.**

## Things to preserve (no regressions)

- **Drill-down / back button** (`.block-picker-back`) — Turn-into and callout pickers drill down. Footer coexists with the back button; both visible.
- **Delete action** (`.block-picker-delete`) — red styling unchanged; its icon is also borderless now (color stays red).
- **Inline fields** (`.block-picker-inline-field`, e.g. Embed link) — unchanged.
- **Emoji / callout preview icons** (`.block-picker-emoji-icon`) — these are content, not chrome; they keep their look but lose the surrounding box like every other icon.
- **Menu positioning** — `placeFloating()` (c34) owns height/scroll/flip. The footer is inside `.block-picker`, so it scrolls with content only if the menu overflows; verify the footer doesn't get clipped when the list is long (footer should stay visible — confirm whether it should be sticky or scroll with the list during build; default: scrolls with content, matching today's lack of any pinned chrome).
- **Dark theme** — all new colors use existing `var(--border)` / `var(--text-secondary)` tokens, so dark mode follows automatically.

## Testing

- Existing test suite stays green (`npm test`).
- Manual (F5): open the slash menu, the `+` menu, a dragger "Turn into" (drill-down), and the convert/delete menu. Confirm in light **and** dark theme: borderless 24px icons, tighter rows, sentence-case section labels, shortcut hints on the right where applicable, footer pinned at the bottom with caption text, footer label flips to "Back" inside a drill-down.
- Confirm active-row and current-block affordances are still obvious without the icon border (row tint + label color + check).

## Out of scope / explicitly not doing

- Restyling `.mp-menu` (shared action menus).
- Moving the search field to the bottom (considered, rejected — option A).
- Any change to picker behavior, ordering, or which blocks appear.
