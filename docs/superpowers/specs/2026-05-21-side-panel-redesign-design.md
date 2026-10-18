# Side panel redesign — design

A focused redesign of the board's card-detail side panel so that opening a card reads as a clear "card detail page" — visually closer to Notion's open-card view, while keeping our feature set.

## Goal

When the user clicks a card, the side panel that slides in should *obviously* be a place where:
- the card has a title you can edit,
- each property is a labelled, typed row (empty rows still visible),
- there's a clearly demarcated body area with a hint that you can type in it.

No new features beyond "+ Add a property" inside the panel. No comments, no AI, no share. Build only what closes the clarity gap.

## What changes

### Toolbar (top of panel)
- Single button: **× Close**, top right, ~28px hit area, hover background.
- No "open as full page" icon. (Discussed and explicitly out of scope.)

### Title section
- Big **32px / weight 700 / `--board-text`** heading, contenteditable.
- Placeholder: `Untitled` (rendered as `color: #d4d4d2` via a `is-placeholder` class — same pattern as the board name).
- Click → focus + select-all (matches the board-name and column-name behaviour).
- Enter blurs (commits) and is intercepted from inserting a newline.

### Properties section
Per field row:
- **16×16 type icon** in `--board-text-muted`, inline-SVG. One per field type:
  - `text` — file/lines glyph
  - `status` — small circle with inner dot
  - `date` — calendar
  - `person` — bust silhouette
  - `tags` — hash
- **Label** (`--board-text-muted`, 14px, width 110px).
- **Value cell** (14px, `--board-text`):
  - Filled: the existing editor for that field type (status select, date input, contenteditable for text/person, chip multi-select for tags). Replaces today's mixed look.
  - Empty: the literal word `Empty` in `#d4d4d2`. Clicking still activates the editor inline.

Row gets a subtle `--board-hover` background on hover for affordance.

#### "+ Add a property" (new in the side panel)
- Bottom row of the properties section, same shape as a normal property row but with a `+` icon and `Add a property` label in `--board-text-muted`.
- Click → reuses the existing inline picker from `boardProperties.ts` (`promptNewField`). Anchored to the `+` row.
- This is the only behavioural addition. It exists in the board's `Properties` menu already, but real users discover the need for new fields while looking at a card, so duplicating it here is worth the small UI cost.

### Divider
- Single 1px line in `--board-border-soft`, 16px margin above and below. Separates properties from body.

### Body section
- Existing nested Tiptap editor stays.
- **Bigger type**: 16px / line-height 1.55 / `--board-text`. The current 13px feels like a tooltip.
- **Empty-state placeholder** when the body is blank: a single line of muted text:
  `Press / for commands or just start typing…`
  with `/` rendered as a small `kbd`-style chip (`--board-hover` bg, 3px radius, 1px 5px padding).
- Placeholder disappears on focus or on first non-empty character.

## What stays the same

- Panel position, width (420px), and slide-in behaviour.
- Close on Esc, click outside, or close button.
- All existing field editors (status select, date picker, tag chip input, contenteditable text/person).
- Card-mutate wiring (`currentOnChange`).
- Read-only mode honouring.

## File layout

```
src/webview/boardSidePanel.ts   — restructure renderPanel for the new layout
                                  (toolbar, big title, props with icons + Empty
                                  state, + Add a property row, divider, body
                                  with placeholder)
src/webview/styles/board.css    — new classes:
                                  .board-panel-toolbar
                                  .board-panel-title (size + placeholder rules)
                                  .board-panel-prop-row
                                  .board-panel-prop-icon
                                  .board-panel-prop-empty
                                  .board-panel-add-prop
                                  .board-panel-divider
                                  .board-panel-body-placeholder + kbd inside
```

`boardProperties.ts` is reused — the side-panel "+ Add a property" calls the existing `promptNewField(anchor, board, onChange)`.

## Behaviour details

- The body placeholder is implemented as a separate `<div>` overlaid on the empty Tiptap editor, NOT as a CSS `::placeholder` (Tiptap doesn't expose that on the contenteditable). The div is removed on first input.
- When opening a card with `body === ''`, the Tiptap instance still mounts; the placeholder div sits next to it inside the body container.
- Field icon mapping is a small constant `FIELD_TYPE_ICONS: Record<FieldType, string>` in `boardSidePanel.ts`.

## Out of scope (will not be built)

- Comments
- AI "press space" prompt
- Share / link / star icons
- "Open as full page" toolbar action
- Inline rename of property labels from the side panel (do that from the board Properties menu)
- Drag-reordering properties in the side panel

## Open questions

None. The "+ Add a property" choice was the last open one and the user said yes.
