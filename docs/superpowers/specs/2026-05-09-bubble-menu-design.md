# Bubble Menu — Design Spec

**Date:** 2026-05-09
**Status:** Approved

---

## Overview

A Notion-style floating bubble menu that appears above selected text in the editor. Shows inline formatting options by default, with a "more" button that swaps the entire bubble to a second panel of block-type conversions. Clicking back returns to the first panel.

---

## Visual Style

Dark pill — `#1a1a1a` background, `border-radius: 9px`, subtle drop shadow. Matches Notion's own selection toolbar. Appears above the selected text via Tiptap's `BubbleMenu` extension which handles positioning, viewport flipping, and show/hide automatically.

Buttons: 26px tall, icon-only (28px wide) or text label (H1/H2/H3). Active state: `background: rgba(255,255,255,0.1)`. Dividers: 1px `#333` vertical lines separating groups.

---

## Panel System

Two panels share the same DOM element. Switching is a CSS class toggle — no re-render.

### Panel 1 — Default (inline marks)

| Button | Icon | Phosphor name | Action |
|---|---|---|---|
| Bold | TextB | `TextB` | `toggleBold()` |
| Italic | TextItalic | `TextItalic` | `toggleItalic()` |
| Underline | TextUnderline | `TextUnderline` | `toggleUnderline()` |
| Strikethrough | TextStrikethrough | `TextStrikethrough` | `toggleStrike()` |
| — divider — | | | |
| Inline code | Code brackets | `Code` | `toggleCode()` |
| Link | Chain link | `Link` | `window.prompt('URL:')` → `setLink({ href })` or `unsetLink()` if already linked |
| — divider — | | | |
| Text color | Custom A + color bar | drawn SVG | opens color swatch |
| Highlight | Marker pen | `Highlighter` | opens highlight swatch |
| — divider — | | | |
| More | Caret | `CaretDown` | → Panel 2 |

The text color button shows a colored bar under the letter "A" reflecting the currently applied color (red `#e55757` when none is set). Clicking opens an 8-color swatch panel directly below the bubble. Clicking a swatch applies the color and closes the panel; clicking the first swatch (⊘) removes the color.

The highlight button opens a 6-color swatch panel the same way.

### Panel 2 — Block types (replaces Panel 1)

| Button | Icon | Phosphor name | Action |
|---|---|---|---|
| Back | Caret | `CaretLeft` | → Panel 1 |
| — divider — | | | |
| H1 | text label | — | `toggleHeading({ level: 1 })` |
| H2 | text label | — | `toggleHeading({ level: 2 })` |
| H3 | text label | — | `toggleHeading({ level: 3 })` |
| — divider — | | | |
| Blockquote | Double quotes | `Quotes` | `toggleBlockquote()` |
| Bullet list | Dot list | `ListBullets` | `toggleBulletList()` |
| Ordered list | Numbered list | `ListNumbers` | `toggleOrderedList()` |
| Task list | Checklist | `ListChecks` | `toggleTaskList()` |

The active block type button is highlighted. H1/H2/H3 use text labels (`font-size: 11px`, `font-weight: 700/600/500`) since Phosphor has no heading icons.

---

## Architecture

### New packages

| Package | Purpose |
|---|---|
| `@tiptap/extension-bubble-menu` | Positioning, show/hide, viewport flip |
| `@tiptap/extension-color` | Text color mark |
| `@tiptap/extension-highlight` | Highlight mark (multi-color) |
| `@phosphor-icons/core` | SVG source (already installed as devDep for build reference) |

### New file: `src/webview/bubbleMenu.ts`

Single responsibility: owns the bubble menu DOM element and all its behaviour. Exports one function:

```typescript
export function createBubbleMenu(editor: Editor): void
```

Internally:
- Creates the DOM element with both panels rendered in HTML
- Registers the element with Tiptap's `BubbleMenu` extension
- Wires all button click handlers (`editor.chain().focus().toggleBold().run()` etc.)
- Manages panel state (`panel1` / `panel2` CSS class toggle)
- Manages swatch panels (color + highlight) — shown/hidden via CSS class

### Modified files

| File | Change |
|---|---|
| `src/webview/editor.ts` | Add `Color`, `Highlight`, `BubbleMenu` extensions; call `createBubbleMenu(editor)` |
| `src/webview/styles/editor.css` | Bubble menu styles: dark pill, buttons, active states, swatch panels |

---

## Color & Highlight Swatches

**Text colors (8):** default (remove), red `#e55757`, orange `#e8954a`, yellow `#e8c94a`, green `#57b35b`, blue `#4a9ee8`, purple `#9b5de5`, pink `#e85a9b`

**Highlight colors (6):** none (remove), yellow `#ffd700aa`, orange `#ff8c0066`, green `#57b35b66`, blue `#4a9ee866`, purple `#9b5de566`

Swatch panel appears absolutely-positioned below the bubble, 6px gap. Clicking outside dismisses it. Implemented as a `<div>` inside the bubble menu element, shown/hidden via `.swatch-open` class.

---

## CSS Summary

```
.bubble-menu           — dark pill container
.bubble-menu button    — icon button base
.bubble-menu .active   — active/toggled state
.bubble-menu .dim      — muted (back/more buttons)
.bubble-menu .divider  — vertical separator
.bubble-panel          — panel wrapper (panel1 / panel2)
.bubble-panel.hidden   — hides a panel
.swatch-panel          — color swatch dropdown
.swatch-panel.open     — shows the swatch
.swatch-item           — individual color dot
```

---

## Out of Scope

- Font size selector
- Text alignment (Tiptap TextAlign not installed)
- Comment / mention insertion
- Drag handle integration
