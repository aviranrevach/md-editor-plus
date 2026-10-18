# c27 — Text styles don't render inside board views

**Status:** in progress · **Branch:** `feat/board-inline-text-styles-c27` · **Impact:** Urgent

## Problem

In both board views (table + kanban), text values are painted with
`textContent` / `renderInlineWithImages` — which only turns `![](…)` into a
thumbnail and leaves everything else as plain text. So a cell or card body that
contains inline markdown the editor itself produces (`**bold**`, `*italic*`,
`~~strike~~`, `` `code` ``, `==highlight==`, `[link](url)`, color/underline via
`<span style="color:…">` / `<u>`) renders as raw characters instead of styled
text.

The editor (Tiptap) supports bold, italic, strike, code, underline, color
(`TextStyle`+`Color`) and multicolor highlight. Board cell values and card
bodies are raw markdown strings (boardModel parses table cells verbatim), so all
of those markings can legitimately live in board text.

## Fix

Add one shared, dependency-free inline renderer
`src/webview/boardInlineRender.ts` → `renderInlineMarkdown(host, value)` that
parses the supported inline set into **DOM nodes** (never `innerHTML`, so no XSS
from document content) and use it everywhere a board view *displays* a text
value in read mode. Editing mode is untouched — cells still edit raw markdown
(`fillCellForEditing`), preserving exact round-trip.

### Supported inline set

| Syntax | Render |
|---|---|
| `` `code` `` | `<code>` (inner not re-parsed) |
| `![alt](src)` | inline thumbnail (existing behavior) |
| `[text](url)` | `<a>` (inner re-parsed) |
| `**x**` / `__x__` | `<strong>` |
| `*x*` / `_x_` | `<em>` |
| `~~x~~` | `<s>` |
| `==x==` | `<mark>` |
| `<u>`,`<mark>`,`<s>`,`<strong>`,`<em>`,`<b>`,`<i>`,`<code>` | matching element |
| `<span style="color:…">` | `<span>` with **whitelisted** `color`/`background-color` only |

Parsing is recursive (earliest-delimiter wins; inner content re-parsed except
for code). Unmatched delimiters fall through as literal text — never throws.

### Call sites

- `boardTableRender.ts`: replace the two display `renderInlineWithImages` calls
  (preview + value) — the dedicated image column and edit path stay as-is.
- `boardKanbanRender.ts`: card title + body preview (`textContent` → renderer).

### CSS

`board.css` — make `code`/`mark`/`a`/`s` inside board cells & cards inherit
sensible size and not blow up row height.

## Out of scope

- Editing styled text inline in a board cell (cells remain raw-markdown edit).
- Block-level markdown in previews (headings, lists) — inline only.
