# MD Editor Plus

**Notion-style markdown block editor / viewer for Visual Studio Code, Cursor etc.**

Open any Markdown file and it renders as polished, block-based content. Click anywhere to edit, drag blocks to reorder, slash to insert. Your file stays plain Markdown on disk, so it works with every other tool in your pipeline.

![MD Editor Plus](media/MD-editor-plus.png)\---

## Why use it

VS Code's built-in preview is great for reading. The default text editor is great for editing. **MD Editor Plus is what you want when you actually want to write**: the way you write in Notion or Linear, not the way you write a config file.

- **Blocks behave like blocks**: drag, click, slash to insert
- **Real headings, real lists, real tables**, no `## Heading 2` clutter
- **Coming from Notion?** Same muscle memory. Block model, drag handles, slash menu, bubble toolbar, page-width feel- rendered over your local `.md` files instead of a SaaS database. No migration.
- Round-trips **Markdown losslessly**, so commits stay clean
- Works on any folder. No database, no cloud, no migration

---

## Features

### Block editor

- **Drag-handle reordering** — hover any block for a `⠿` handle and move it anywhere
- **Slash / block picker** — `⌘/` (`Ctrl+/`) opens an inline picker; type to filter
- **Bubble menu** — select text for inline formatting, links, color, highlight, emoji, a "Turn into" converter, and a ✨ **AI** button ([see below](#turn-selection-into-ai))
- **Click-to-edit** — every block is editable in place; no mode switching
- **Delete any block** — from the `⠿` dragger menu, a block's own `⋯` menu (boards, diagrams), or select it and press <kbd>Delete</kbd> / <kbd>Backspace</kbd>

### Block types

- **Text** — paragraph, H1, H2, H3
- **Lists** — bullet, numbered, task lists with real checkboxes that round-trip to `- [ ]` / `- [x]`
- **Tables** — GFM pipe syntax, inline cell editing, add rows/columns from the bubble menu
- **Code blocks** — syntax highlighting for \~50 languages, line-number gutter, drag lines to reorder, copy button, optional auto-collapse for long snippets
- **Callouts** — GFM `> [!NOTE]`, `> [!WARNING]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!CAUTION]` with colored backgrounds and icons
- **Toggles** — collapsible `<details>` sections
- **Boards** — `/board kanban` or `/board table` for project/task views with columns, cards, properties, drag-to-reorder, inline editing, hideable fields. Stored as a fenced HTML comment block so the file stays plain Markdown.
- **Mermaid diagrams** — `/whiteboard` (or `/mermaid` / `/diagram` / `/flowchart` / `/graph` / `/canvas`) drops a freeform mermaid canvas with a starter `flowchart LR` (`Idea → Next → Done`). Visual edit opens automatically: drag nodes, draw arrows, add sticky notes, change shapes, zoom and pan. Persists as a normal `` ```mermaid `` code fence with optional position/style sidecars in mermaid comments. Code view shows raw mermaid source you can hand-edit.
- **Media & misc** — images, blockquotes, dividers

### Turn selection into… (AI)

Select any run of blocks, click the ✨ button in the bubble menu (or the **Using AI** group inside *Turn into*), and MD Editor Plus builds a ready-to-paste prompt for your **file-aware AI** (Claude Code, Cursor, the VS Code AI). Paste it in — the AI edits the file, and the viewer re-renders. **No network, no API keys, no accounts: the prompt travels through your clipboard, nothing else.**

The prompt carries the file path, the selection's location (line + text anchors), and — crucially — the app's *exact* block grammar, so the AI's output round-trips into a real board/table/diagram instead of a near-miss. Targets:

- **Ask AI…** — a free-text request ("explain this", "find the risks", "rewrite for clarity"); opens a conversation about the selected section (optional — you can also continue in your AI after pasting)
- **Table** — a GFM pipe table from loose notes
- **Board: Kanban** / **Board: Table** — a full board, in either of its two views
- **Mermaid diagram** — a diagram from a process description
- **Summary** · **Action items** · **Outline** · **Timeline** — plain-markdown "thinking" transforms

For the structural targets you choose **Replace selection** or **Add below**, and the panel previews the exact prompt before you copy it.

### Display settings (Aa panel)

- **Four themes** — Light, Claude, Sepia, Dark — plus a **Sync with** selector (Off / OS / IDE) that follows your system or editor's light/dark mode
- **RTL aware** — Hebrew/Arabic content auto-detected per block; lists keep all bullets on the title side, Markdown stays plain on disk
- **Page width slider** — magnetic snap stops at 600 / 800 / 1000 / 1200 / 1400 px, or full-window override
- **Text size** — S / M / L / XL with live "quick brown fox" tooltip previews
- **Font family** — Sans / Serif / Mono with live previews
- **Code-block toggles** — force-dark snippets, force-dark source view, full-width source, auto-collapse long blocks
- **Save view as default** — persist every setting to User-scope VS Code settings; **Reset** restores built-ins

### Markdown fidelity

- **Lossless round-trip** — disk stays plain CommonMark + GFM, so commits stay clean
- **Frontmatter aware** — YAML (`---`) and TOML (`+++`) auto-detected, hidden from preview, preserved on save, with a badge to jump straight to Code view
- **MDX-lite** — `.mdx` renders as Markdown; embedded JSX falls back to raw text or Code view

### Workflow & UX

- **Code / Preview toggle** — switch between rendered blocks and raw Markdown without leaving the editor
- **Auto-fading toolbar** — drops to 50% opacity when your cursor is away, lights up when you approach
- **Filename actions menu** — Copy page content, Copy file path, Duplicate, Open in Finder
- **Rich tooltips** — color swatches, font and size previews, 350 ms hover delay, edge-aware flipping
- **Keyboard shortcuts** — `⌘B` / `⌘I` / `⌘U` / `⌘⇧X` / `⌘E` / `⌘K` / `⌘/` work the way you expect
- **Command palette** — Open Block View / Open Source View on any file

### Privacy & footprint

- **100% local** — no telemetry, no network calls, no accounts (even the ✨ AI assist works purely through your clipboard — it never calls out)
- **Works on any folder** — no database, no cloud, no migration

---

## Supported file types

The block view registers itself as a custom editor for:

`*.md`, `*.markdown`, `*.mdown`, `*.mkd`, `*.mdx`

MDX content is rendered as Markdown; embedded JSX falls into raw paragraphs (or you can edit it directly in **Code view**).

---

## Getting started

1. Install **MD Editor Plus** from the Marketplace.
2. Open any `.md` file. It appears in the block view by default.
3. Press `⌘/` (`Ctrl+/` on Windows/Linux) anywhere to insert a new block.
4. Hover any block to grab its drag handle (`⠿`) and reorder it.
5. Need raw Markdown? Click the **Code** segment in the toolbar, or run **MD Editor Plus: Open Source View** from the Command Palette.

To switch a single file back to VS Code's default editor, run **MD Editor Plus: Open Source View** or use **Reopen Editor With…** from the editor's title bar.

---

## The toolbar

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [logo]  [Preview | Code]              filename.md              [Aa] [⋯] │
└─────────────────────────────────────────────────────────────────────────┘
```

The toolbar fades to 50% opacity when your cursor isn't near it, so it stays out of the way while you write. Bring the mouse within \~150 px of the top of the page and it lights back up.

| Element | Behavior |
| --- | --- |
| **Logo** | Icon for the extension. |
| **Preview / Code** | Switch between the rendered block view and the raw Markdown view. The active button shows its label (`Preview` or `Code`). |
| **Filename** | Centered. **Hover** to open the actions menu (Copy, Duplicate, etc.). The full name shows in a native tooltip when truncated. |
| **Aa** | **Click** to open the display-settings panel (theme, page width, font, code-block options). |
| **⋯** | **Click** to open the actions menu, anchored to the top-right. |

Filename hover and ⋯ click open the same actions list, but each anchors its own panel. They are independent surfaces, so the hover behavior never accidentally triggers the click target and vice versa.

---

## Display settings (Aa)

![Display settings panel](media/visual-settings.png)Every visual setting is **runtime-only by default**. Change anything you like for the current session and it won't follow you to other files. Click **Save view as default** at the bottom to commit the current view as your global default; **Reset** clears your saved defaults and restores the built-in ones.

### Theme

Four hand-tuned themes:

| Theme | Vibe |
| --- | --- |
| **Light** | Notion's classic clean white background |
| **Claude** | Soft warm tones inspired by Claude.ai |
| **Sepia** | Paper-warm, easy on long reading sessions |
| **Dark** | Deep neutrals, comfortable at night |

Hover any theme button for a live color-swatch preview.

Below the theme buttons, the **Sync with** row offers three modes:

| Mode | Behavior |
| --- | --- |
| **Off** | Use the manually selected theme above. |
| **OS** | Follow the operating system's light/dark mode (`prefers-color-scheme`). Updates live. |
| **IDE** | Follow the host editor's color theme (light vs dark). Picks up theme switches in real time. |

Picking any of the four manual themes automatically flips Sync back to **Off**.

### Page width

A continuous slider with **magnetic snap stops** at 600 / 800 / 1000 / 1200 / 1400 px.

- Drag the thumb freely; release within \~30 px of a stop and it snaps.
- Click any dot to jump to that width.
- The blue pill on the right shows the live value.
- **Full width** toggle below acts as an override. When on, the page fills the entire window. Touching the slider or clicking a stop while Full width is on automatically turns it off.

### Text size

`S` / `M` / `L` / `XL` (14 / 16 / 18 / 20 px). Each button's tooltip previews "The quick brown fox" rendered at that exact size, so you can taste-test before committing.

### Font

`Sans` / `Serif` / `Mono`. Tooltips preview each face the same way.

### Code blocks

Four toggles for the developer-leaning bits:

| Toggle | Effect |
| --- | --- |
| **Always dark: Code Snippets** | Force fenced code blocks to use a dark background even when the page theme is light. Editing a doc on a light theme but want IDE-style code? This. |
| **Always dark: Code view** | Same idea, but for the raw Markdown source view. |
| **Full width: Only in Code view** | Source view fills the window even when the rendered view stays narrow. Great for diff-friendly long lines. |
| **Shorten Code Snippets** | Long code blocks collapse to a preview with a **Show more / Show less** button. |

### Save view as default

Captures every visible setting (theme, font, text size, page width, full-width, all four code-block toggles) and writes them to your **User-scope** VS Code settings. They follow you across every project from now on. The button is disabled when the current view already matches what's saved.

### Reset

Clears the saved defaults and restores the built-in ones (Light theme, Sans font, Medium text, 800 px page, all toggles off). Disabled when nothing has been customized.

---

## Actions menu (filename hover or ⋯)

| Action | What it does |
| --- | --- |
| **Copy page content** | Copies the entire Markdown to your clipboard |
| **Copy file path** | Copies the absolute filesystem path |
| **Duplicate** | Creates `name copy.md` in the same folder and opens it |
| **Open in Finder** | Reveals the file in Finder / Explorer / your OS browser |

---

## Editor blocks

Click `+` in the gutter or press `⌘/` (`Ctrl+/`) to open the **block picker**. Filter by typing.

| Section | Blocks |
| --- | --- |
| **Text** | Paragraph, Heading 1, Heading 2, Heading 3 |
| **Lists** | Bullet list, Numbered list, Task list, Board: Kanban, Board: Table |
| **Media & blocks** | Image, Callout, Toggle, **Whiteboard** |
| **Other** | Blockquote, Code block, Divider |

### Task lists

Render as actual checkboxes. Click to toggle. Your changes round-trip to standard `- [ ]` / `- [x]` Markdown.

### Tables

Insert from the block picker, then edit cells inline. Add rows and columns from the bubble menu when the cursor is in a table.

### Code blocks

![Code block with dark theme and line gutter](media/code-dark.png)A first-class block, not just a `<pre>`:

- **Syntax highlighting** for \~50 languages via [lowlight](https://github.com/wooorm/lowlight)
- **Line-number gutter** with click-and-drag to **reorder lines** within the block
- **Copy button** in the header
- **Show more / Show less** when "Shorten Code Snippets" is on (collapses anything over \~12 lines)
- **Smart paste**: pasting a fenced code block (```` ```lang\n…\n``` ````) into an existing code block strips the wrapper

### Callouts

GitHub-flavored `> [!NOTE]`, `> [!WARNING]`, `> [!TIP]`, etc. Render with a colored background and an emoji icon.

```markdown
<div data-callout data-type="note" data-emoji="💡">Callout blocks render with color and icon.</div>
```

### Toggles

Collapsible sections that hide their contents until clicked. Useful for FAQs, long answer keys, etc. Round-trip as HTML `<details>` blocks.

### Whiteboard / Mermaid diagrams

Type `/whiteboard` in the block picker (aliases: `/mermaid`, `/diagram`, `/flowchart`, `/graph`, `/canvas`) to drop a freeform mermaid canvas onto the page. Ships with a starter `flowchart LR` (`Idea → Next → Done`) so you can begin dragging immediately — visual edit opens automatically on insert.

**In visual-edit mode** (eye icon in the block chrome, or double-click on the diagram):

- **Drag nodes** anywhere — the canvas auto-grows to include them; the block frame stays the same physical size.
- **Drag from a node hook (N/E/S/W)** to draw a new edge to another node.
- **Shape palette** — pick rectangle, pill, circle, diamond, hexagon, cylinder, subroutine, trapezoid, parallelogram.
- **Sticky notes**, free text, free lines, and arrows — add via the toolbar.
- **Multi-select** with the marquee or `Shift+click`; align/distribute and bulk-style multiple nodes at once.
- **Per-edge styling** — solid / dashed / dotted, thickness, color, marching-ants animation (slow / fast, forward / reverse), arrow / circle caps on either end.
- **Zoom + pan** — `Cmd+wheel` to zoom (clamped to 20–400%), space-drag or the hand tool to pan, `Cmd +/-` from the keyboard, `Cmd+0` resets.
- **Viewport lock** (lock icon in the toolbar) — engage after arranging things to freeze the view; toggle off to let the canvas auto-fit on every render.
- **Undo / redo** across all visual-edit mutations.

**Toggle to source** (`</>` icon) to see and edit the raw mermaid syntax. Pinned positions, per-node styles, free lines, and edge styles persist as mermaid comments (`%% mb-positions:`, `%% mb-styles:`, etc.) so the diagram round-trips losslessly as a normal `` ```mermaid `` code fence in your Markdown file.

```markdown
​```mermaid
flowchart LR
    A[Idea]
    B[Next]
    C[Done]
    A --> B
    B --> C
​```
```

**Click the expand icon** (top-right of the block) for a fullscreen modal — useful for presenting a complex diagram. **Copy / Download** is available from the `⋯` menu: copy source, copy SVG, download SVG, download PNG.

### Boards (Kanban / Table)

Type `/board kanban` or `/board table` to drop a project board. Two views over the same data:

- **Kanban view** — columns of cards. Drag cards between columns, drag columns to reorder. Add columns from the right edge, add cards from the bottom of any column. Double-click a column header to rename. Per-column color swatch (gray / amber / emerald / blue / etc.).
- **Table view** — a true database table. Sort by column, resize columns, drag to reorder. Show / hide properties from the Properties popover. Inline-edit every cell. The Description column is a synthetic field that maps to the card body text.

**Field types** — `text`, `status`, `date`, `tags`, with type-aware editors. **Locked columns** (gray pill) can be renamed but not moved. Boards round-trip as an HTML comment block + a fenced Markdown table, so the file stays plain text and works with any other Markdown tool.

### Drag handle

Hover any block (paragraph, heading, list, image, code block, anything) to surface a `⠿` handle in the left gutter. Grab it to drag the whole block to a new position.

### Bubble menu

![Bubble menu floating above selected text](media/line-menu.png)Select any text and a contextual toolbar appears above the selection.

| Group | Buttons |
| --- | --- |
| **Inline formatting** | Bold, italic, underline, strikethrough, inline code |
| **Linking & color** | Insert link, text color, highlight color |
| **Insert** | Emoji picker |
| **Convert** | "Turn into" submenu. Change paragraph to heading, list, quote, code block, etc. |

### Frontmatter

YAML (`---`) and TOML (`+++`) frontmatter is **detected automatically** and hidden from the rendered view (so the document doesn't start with stray horizontal rules and ugly key-value paragraphs). A small **FRONTMATTER · N lines** pill appears at the top of the editor. Click it to jump to **Code view** where you can edit the frontmatter directly. The frontmatter is preserved losslessly on save.

---

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘/`  /  `Ctrl+/` | Open the block picker at the cursor |
| `⌘B`  /  `Ctrl+B` | Bold |
| `⌘I`  /  `Ctrl+I` | Italic |
| `⌘U`  /  `Ctrl+U` | Underline |
| `⌘⇧X`  /  `Ctrl+Shift+X` | Strikethrough |
| `⌘E`  /  `Ctrl+E` | Inline code |
| `⌘K`  /  `Ctrl+K` | Insert link |
| `Esc` | Close any open menu / popover |

The bubble menu shows the relevant shortcut next to each button.

---

## Tooltips

Every interactive control has a custom tooltip. Text-only for buttons, **rich previews** where useful (theme color swatches, text-size and font samples, slider stop labels). Tooltips appear after a 350 ms hover delay, flip above/below the target depending on screen edge, and dismiss on scroll, click, blur, or `Esc`.

---

## Commands

Available via the Command Palette (`⌘⇧P` / `Ctrl+Shift+P`):

| Command | Description |
| --- | --- |
| **MD Editor Plus: Open Block View** | Reopens the active file with the block editor |
| **MD Editor Plus: Open Source View** | Reopens the active file with VS Code's default text editor |

---

## Settings reference

All settings live under `mdEditorPlus.*` in your User or Workspace settings. They're written by the **Save view as default** button, but you can edit them by hand if you prefer.

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `mdEditorPlus.theme` | `"auto"` | `"light"` | `"sepia"` |
| `mdEditorPlus.font` | `"sans"` | `"serif"` | `"mono"` |
| `mdEditorPlus.textSize` | `"s"` | `"m"` | `"l"` |
| `mdEditorPlus.pageWidth` | `number` (400 to 2400) | `800` | Default page width in px |
| `mdEditorPlus.fullWidth` | `boolean` | `false` | Open in full-window-width by default |
| `mdEditorPlus.alwaysDarkCode` | `boolean` | `false` | Force dark code blocks regardless of page theme |
| `mdEditorPlus.alwaysDarkSource` | `boolean` | `false` | Force dark source view regardless of page theme |
| `mdEditorPlus.sourceFullWidth` | `boolean` | `false` | Render source view at full width even when the page is narrow |
| `mdEditorPlus.shortenCodeSnippets` | `boolean` | `false` | Collapse long code snippets behind a Show more button |

---

## Markdown compatibility

MD Editor Plus reads and writes **CommonMark** plus the GitHub-flavored extensions you'd expect:

- Headings, paragraphs, blockquotes, lists (bulleted, ordered, task)
- Tables (GFM pipe syntax)
- Strikethrough, inline code, fenced code blocks with language
- Links, autolinks, images
- HTML passthrough (`<details>`, etc.)
- GFM callouts: `> [!NOTE]`, `> [!WARNING]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!CAUTION]`
- YAML / TOML frontmatter (preserved, not rendered)

Open the bundled `demo.md` to see every supported block in one place.

---

## RTL / bidirectional content

Hebrew, Arabic, and other RTL scripts are auto-detected per block. Direction is computed from the first strong character and applied as an explicit `dir="ltr"` / `dir="rtl"` on every paragraph, heading, blockquote, callout, table cell, and toggle. No setting to flip — it just works.

**Lists keep coherence**: bullets, numbers, and task checkboxes stay on the same side throughout a single list, set by the **first item's** direction. So a list whose first item is English keeps every marker on the left, even when later items are Hebrew (their characters still render right-to-left within the line). Flip the first item to Hebrew and every marker moves to the right. The rule is "no list ever shows mixed-side markers".

**Code stays LTR**: fenced code blocks and the source view are forced to `dir="ltr"` regardless of the surrounding document direction — code is always left-to-right. Inline `<code>` inside an RTL paragraph inherits paragraph direction (which is the right behavior for embedded technical terms).

**Toggles**: the disclosure caret renders as `▶` in LTR contexts and `◀` in RTL contexts, with the open-state rotation flipped accordingly.

Storage is plain Markdown — no special tokens, no frontmatter required. Direction lives in the rendered view only, computed each load.

---

## Tips & tricks

- **Quick raw view**: even without leaving the block view, the bubble menu's `code` button wraps the selection in inline code. For a full code block, use the block picker.
- **Drag a code line**: inside a code block, the line numbers are draggable. Reorder lines without re-typing.
- **Touch the slider, kill Full width**: Full width is intentionally an override, not a mode. Any interaction with the page-width slider (drag, keyboard arrows, click a stop) automatically clears Full width.
- **Save view per project**: saves are global by default (every project gets the same defaults). Edit `.vscode/settings.json` directly if you want a project-specific override; Workspace-scope settings beat User-scope on file open.
- **Frontmatter edits**: the pill at the top is your shortcut into Code view, where the frontmatter is the first block of text.

---

## Requirements

- VS Code **1.74** or newer.
- No external services, no telemetry, no network calls. Everything runs locally in the webview.

---

## Known limitations

- Very large Markdown files (&gt;1 MB) may take a beat to render on first open.
- Image paths render relative to the workspace root.
- MDX support is "lite". Embedded JSX renders as raw text in the rendered view; for full MDX editing, switch to **Code view**.

---

## Release notes

See [CHANGELOG.md](CHANGELOG.md).

---

## License

[MIT](LICENSE)