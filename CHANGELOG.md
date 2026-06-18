# Change Log

All notable changes to **MD Editor Plus** are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-06-18

### Added

- **Plain table block** — a simple Markdown table is back as its own block in the **+ / slash menu** and the dragger **Turn into** menu, listed under **Lists** alongside the board blocks. Inserting it drops a 3×3 grid with a header row; it round-trips as standard `| col | col |` Markdown. Distinct from **Board: Table** (the database-style board), so typing `table` in the picker now surfaces both. (c32)
- **Turn a table into a board** — **Turn into → Board: Table** converts a plain Markdown table into a board: the header row becomes the columns, each body row becomes a card, and the first column becomes the card titles. The board opens in table view; flip it to Kanban with the existing view toggle. (c31)
- **AI transforms in the dragger Turn-into** — the ⠿ block-handle **Turn into** menu now has a **✨ Using AI** section (Ask AI…, Board: Kanban, Mermaid diagram, Summary, Action items, Outline, Timeline), mirroring the text-selection bubble menu. Targets that already have a deterministic converter (Table, Board: Table) aren't duplicated under AI. (c33)
- **Image file actions** — the image menu's folder control is now a drill-down offering **Reveal in Finder** and **Copy path** (the path is copied through the host clipboard via a webview bridge). (c38)

### Fixed

- **Save could wipe the file to a fragment** — the card-description editor is now isolated so a save can no longer truncate the whole file down to a single card's content. (c37)

## [0.5.5] - 2026-06-17

### Added

- **Image controls** — click any image in the document body to reveal a small menu styled like the text bubble menu (one row of actions, one row of sizes): drag the **resize grips** on the image's left/right edges (or pick S / M / L / Full) to resize, **Replace** to swap it via the drill-down picker (upload / browse / clipboard), **Compress** to re-encode it locally (canvas pass, no server round-trip; never writes a larger file — its tooltip shows the current file size and, after compressing, the saving, e.g. `1.2 MB → 410 KB`), **Reveal in Finder** to open the containing folder, and **Remove** to delete the node. Resized images are stored as a standard HTML `<img src="…" width="…">` so they render at the right size everywhere the file is read (GitHub, Obsidian, VS Code preview, other editors); images that have never been resized continue to round-trip as plain `![](src)` Markdown. The board image manager (table and kanban image cells) also gained per-thumbnail **Compress** and **Reveal in Finder** actions. (Image bytes are read through the extension, since the webview's content-security policy blocks `fetch()` of local files.)

- **Smart typography everywhere you type** — type `->` / `<-` and they turn into `→` / `←` as you go (plus `<->` → `↔`, `=>` → `⇒`, `--` → `—`, `...` → `…`, and `(c)` / `(r)` / `(tm)` → `©` / `®` / `™`), Notion-style. Previously this only fired in the rich-text body; it now also works in **board table cells, the Title column, card titles, the "new card" input, and column/field rename**. Code spans and code blocks are left untouched, and the whole thing honours the Visual-settings toggle. Arrows in board cells also render in the correct text font now (they were falling through to a heavier symbol-font fallback, so a `→` in a table looked like a mismatched icon next to one in the body).
- **Add image — four ways in** — the **Image** block now drills down inside the block picker (like Callout) instead of doing nothing: **Upload from computer** (copied into a per-note `<note>.assets/` folder next to your file), **Browse project** (native file picker showing real folders, referenced in place — no duplicate copy), **Embed link** (an in-window field for a URL or project path), and **Embed from clipboard** (use the image link already on your clipboard). Uploaded files get a clean relative link (`![](./Note.assets/photo.png)`), so your Markdown stays portable and the image survives closing and reopening the file. Filenames are kept readable, with a `-2` suffix only when there's a name clash. _(Known issue: "Embed link" isn't inserting reliably in the editor yet — tracked in the backlog.)_
- **Paste images into the body** — paste an image from the clipboard (⌘V / Ctrl+V) anywhere in the document and it's saved into the per-note `<note>.assets/` folder and inserted inline, named `pasted-YYYY-MM-DD.<ext>`. _(Dragging an image file in from Finder is a known limitation: VS Code's workbench opens the dropped file in a tab before the editor can catch it — use paste, or the Image block's Upload, for now.)_
- **Images in boards** — boards now do images three ways: a new **Image column type** (pick "Image" when adding a column) whose cells show a thumbnail with a **+N** badge for extras — click to add via Upload / Browse project / clipboard; **inline thumbnails** for any `![](…)` image link inside a text or Description cell; and a **card cover** on the kanban view, taken automatically from the first image in a card's body. Image cells store clean relative links and round-trip safely.
- **Save status indicator + auto-save** — a condensed indicator sits next to the filename and always tells you the truth about your file: `• Unsaved` the instant you type, `⟳ Saving…` while it writes, and `✓ Saved` at rest (it shows `✓ Saved` from the moment a file opens). Edits now **auto-save to disk ~1 second after you stop typing** — no action needed. Pressing **⌘S / Ctrl+S** saves immediately and gives the indicator a brief confirming pulse. Works in both Preview and Code views (⌘S saves whichever view is active).
- **External-edit safety** — if the file changes on disk (git, sync, another app) while you have unsaved edits, **auto-save pauses** and the existing conflict banner (Reload from disk / Keep my version) lets you choose — your version is never silently overwritten.
- **See what changed before resolving a conflict** — the external-edit conflict banner now has a red **"N changes"** pill that expands a row-aligned, side-by-side diff of just the changed lines: the **on-disk** version on the left (red), **your unsaved edits** on the right (green), each column labelled by the button that keeps it, with hatched gaps where a line exists on only one side. Choosing *Reload from disk* vs *Keep my version* is now an informed decision instead of a blind one.
- **Full diff viewer** — a toolbar **diff** button (and the conflict banner's **Open full diff**) opens VS Code's **native** diff editor comparing the current file against the **last commit** — or, when the file isn't in git, against the version from **when you opened it**. It's the real VS Code diff (minimap, synchronized scroll, intra-line highlighting), not a reimplementation.

### Changed

- **Board card `id` is read-only and uses a canonical `C<n>` scheme** — the table's `id` column now always shows each card's real id (never blank), rendered read-only but still selectable/copyable, styled as a muted system field, and defaulting to a compact width. New ids continue from the highest existing number and **match the case the file already uses** (a file written with lowercase `c<n>` keeps minting lowercase; otherwise `C<n>`). Card ids are **preserved exactly as written** — the editor no longer rewrites their case on save — and table cells are matched to their `<!-- board:body id="…" -->` anchors case-insensitively, so every card stays linked to its description and an untouched board round-trips byte-for-byte. Both card-creation paths (table and kanban inline-add) and the serialize fallback share one case-aware id minter.

### Fixed

- **Block dragger menu is consistent for every block type** — clicking the ⠿ handle now opens one Notion-style action menu: **Turn into**, **Duplicate**, and **Delete**, for callouts, boards, toggles, images — everything. Previously some blocks (callouts especially) dropped you straight into their own options with no way back out to convert and no Duplicate/Delete. One search box at the top filters everything at once: leave it empty for the grouped menu, or type to jump straight to an action or a turn-into target (`h1` → Heading 1, `warning` → Warning callout). **Duplicate** copies the block right below it; duplicating a **board** mints a fresh board id so the copy stays independent and saves cleanly.
- **Paste an image into a board text cell** — pasting an image while editing a text/Notes cell now saves it and inserts a `![](…)` link (shown as a colored token while editing, a small thumbnail otherwise) instead of dropping a full-size image that vanished on save. Editable cells also show the text caret again, and a cell with an image link reliably re-renders its thumbnail after you click away.
- **Board image cells: thumbnails that wouldn't load, and no way to remove them** — image filenames with parentheses or other special characters (e.g. `Image (1).png`) produced a markdown link that got truncated at the first `)`, so the thumbnail silently failed to load (blank cell). Filenames are now URL-safe and the link parser tolerates parentheses. Clicking an image cell also now opens a small manager — your images as thumbnails, each removable, plus the add options — and a cell shows several thumbnails side by side (overflow collapses to `+N`). The empty state is a proper icon, and a thumbnail that still can't load shows a visible marker instead of blank space.
- **Add image did nothing when clicked** — the **Image** block used the browser's `window.prompt` to ask for a URL, which VS Code webviews silently block, so picking *Image* from the block picker had no effect at all. Replaced with the in-webview picker described above (upload / browse / embed link).
- **Data loss on close (the big one)** — edits made in the last moment before closing a tab could be lost: the editor buffered changes in a 500 ms debounce that was *discarded* on close instead of flushed, and edits only ever reached VS Code's in-memory copy, never disk, unless you manually saved. Now pending edits are flushed on blur / tab-close / window-hide (for both the Preview and Code editors), and the extension persists them to disk. Closing and reopening a file shows your latest edits.
- **"Saved" that lied / vanishing board rows** — adding rows in a board's **table view** could show the row in the editor while it never reached the document underneath, so the file displayed **✓ Saved** yet the new rows were never written to disk (and were lost on reload). The board's edit was being silently dropped whenever its position pointer was momentarily unavailable during a re-render (common when another tab/process touches the file); it now retries instead of dropping — and logs loudly if it genuinely can't commit — so what you see is what's saved.
- **Phantom "unsaved changes" / spurious conflict prompts** — opening a board whose ids were lowercase (`c8`) immediately marked the file "unsaved", because saving rewrote every id to the canonical uppercase (`C8`) and the document no longer matched disk. Board serialization is now idempotent — it preserves ids exactly as written — so an untouched board produces byte-identical output and the editor stops flagging changes you never made.

## [0.5.4] - 2026-06-06

### Changed

- **README refresh** — replaced the static hero image with an animated walkthrough GIF (linking through to the full video), added a Kanban-board demo GIF under the Boards section and a Table-board screenshot under Table view, swapped the ASCII toolbar diagram for a real screenshot, added "see below" jump-links on the showpiece features (Boards, Mermaid), and added a footer credit. Documentation only — no code changes.

## [0.5.3] - 2026-06-05

### Added

- **Multiple status columns** — a board is no longer limited to one Status. Add any number of `status` columns (e.g. *Impact*, *Priority*), each owning its own set of states with colors. Edit a column's states (add / rename / recolor / delete) from three places — the new-column popover (set them at creation), the column header `⋯`, and the property `⋯` in the More panel — all opening the same options editor. Clicking a state now sets the column you clicked, independently of Status (previously every status cell wrote to a hardcoded `Status` field). Each extra column's states persist via a new `field-options` attribute on `board:start`; existing boards open unchanged.
- **Color palette expanded 6 → 10** — added orange, teal, indigo, and pink alongside gray, blue, amber, emerald, red, purple, available wherever a board color is picked (kanban columns, status states, tags, group bands).
- **Group the table by any status or tag** — *Group by this* (column `⋯`) stacks rows into sections, each a full-width band tinted in that group's real color and ordered by the field's own options (tags group one section per tag, with a multi-tag card appearing under each of its tags). Tighter rows, and a *Remove grouping* entry on the grouped column. Status sorting now follows each field's own state order, too.
- **Managed, colored multi-select tags** — `tags` columns become a defined set with colors instead of plain gray free text. Clicking a tag cell opens a checklist picker (toggle tags on/off, or type to create a new one); new tags auto-pick a stable color you can change later. Rename / recolor / delete the whole set from **Edit options**, with renames and deletes propagating across every card. Existing boards derive their tag set (auto-colored) on load. Round-trips via the same `field-options` attribute.
- **Preview in Create blocks skill** — the skill panel now has a **Preview** button that expands a read-only, scrollable view of the exact `SKILL.md` it will write, updating live as you tick/untick blocks. Lets you see what lands on disk before committing to **Create skill** — no surprise file. Purely client-side (the markdown is generated by `buildSkill()`); destinations are unchanged.

### Changed

- **Broader trigger wording for the generated blocks skill** — the `SKILL.md` description now lists the synonyms people actually type (project/task/sprint board, database view, flowchart/graph, the specific callout names, expandable/collapsible) so the user's AI recognizes a match more reliably, while staying anchored to "MD Editor Plus" + Markdown files so the app-specific board format never hijacks generic markdown.

- **Find in page (⌘F / Ctrl+F)** — a Notion-style find bar for the editor. VS Code's native find can't reach inside a custom-editor webview, so this is a built-in search over the document. Highlights every match with a live `3 / 12` count, <kbd>Enter</kbd> / <kbd>Shift+Enter</kbd> (or ↑ ↓) navigates, <kbd>Esc</kbd> closes. Also reachable from the `⋯` menu as **Find in page**.
  - **Searches the document model, not the DOM**, via a ProseMirror decoration plugin — so it finds text inside a *collapsed* toggle, then auto-expands the toggle and scrolls the match into view. Decorations never touch content, so highlighting can't dirty the file.
  - **Works in both views** — Preview and Code. Switching views while the bar is open moves the search to the now-active editor.
  - **Searches inside boards too** — card titles, body previews, visible field/tag values, column names, and the board name. A board is an atom node that renders its own DOM and tells ProseMirror to ignore mutations inside it, so board matches are painted with the **CSS Custom Highlight API** (no DOM mutation — safe alongside the board's re-renders) and the matched card is scrolled into view. A coordinator merges ProseMirror and board matches into one list ordered top-to-bottom, so the count and Enter/Shift+Enter navigation flow through everything in visual order. (If the runtime lacks the Highlight API, board matches just aren't highlighted; the rest of search still works.)
  - Case-insensitive plain-text matching (no regex/replace in this version).
  - Match-finding is a pure function ([src/webview/search.ts](src/webview/search.ts)); board DOM scanning is covered by jsdom tests. See [tests/search.test.ts](tests/search.test.ts) and [tests/boardSearch.test.ts](tests/boardSearch.test.ts).

### Fixed

- **Webview init-race blank screen** — the webview occasionally rendered blank on reload because init could fire before the host was ready. Added a handshake so the editor waits for the host before initializing, eliminating the intermittent blank screen.

## [0.5.2] - 2026-06-02

### Fixed

- **Critical: board card data lost on file reopen** — boards in markdown files round-tripped through the editor were silently losing every card on the second open. Root cause: `preprocessMarkdownBoards` wrapped the board region in `<div data-board source="...">` without escaping newlines inside the attribute. markdown-it (used by tiptap-markdown) saw the multi-line attribute, terminated the HTML block at the blank line inside it, parsed the markdown table as a sibling, and the browser then dropped the entire malformed `<div>` from the DOM. With no `<div data-board>` in the DOM, TipTap had nothing to attach the source to, the board rendered empty, and the next autosave overwrote the file with the empty state. Fixed by escaping `\n` → `&#10;` in `htmlEscape` so the source attribute is single-line — markdown-it now sees a complete `<div>` and the browser parses it cleanly. `getAttribute('source')` decodes `&#10;` back to `\n`, so `parseBoardSource` sees the same string it always did.

### Added

- **Turn selection into… (using AI)** — select a run of blocks and the ✨ AI button in the bubble menu (or the **Using AI** group in *Turn into*) builds a ready-to-paste prompt for a **file-aware AI** (Claude Code, Cursor, the VS Code AI). The prompt carries the file path, the selection's location (line + text anchors), and the app's *exact* block grammar so the AI's output round-trips into a real board/table/diagram. **No network, no API keys — the prompt travels through the clipboard, nothing else.**
  - Targets: **Ask AI…** (free-form conversation), **Table**, **Board: Kanban**, **Board: Table**, **Mermaid diagram**, and the plain-markdown "thinking" transforms **Summary**, **Action items**, **Outline**, **Timeline**.
  - Placement via a segmented control — **Add below** (default), **Replace**, or **Custom** (leaves placement open so you direct it in the chat). The chosen mode is reflected in the prompt.
  - Prompts are ordered context → format spec → rules → **action last**, so the cursor lands where you'd keep typing; Ask AI / Custom end open on purpose.
  - Hardened against agents that reply "done" without acting — the prompt asks them to either edit the file or output the block, never just acknowledge.
  - A small panel previews the exact prompt (read-only) with a 3-step "what to do next", and copies it to the clipboard.
- **Delete blocks** — remove any block from the **⠿ dragger menu** ("Delete"), a board from its **⋯ menu** ("Delete board"), a Mermaid diagram from its **⋯ menu** ("Delete"), or select a board and press **Delete / Backspace** (click the board's chrome to select it; it shows a selected outline).

- **Create blocks skill** — a ⋯-menu action ("Create blocks skill…") that generates a reusable **Claude Skill** (`SKILL.md`) documenting the exact grammar for this app's blocks (Kanban/Table boards, Mermaid, Callouts, Toggles). Tick which blocks to include, then **Install in project** (`.claude/skills/`), **Install globally** (`~/.claude/skills/`), or **Download**. The grammar is shared with the ✨ AI prompts via a single source of truth, and the board examples are proven to round-trip through the parser. No network — local file write only.
- **End-to-end pipeline regression test** ([tests/board/pipeline.test.ts](tests/board/pipeline.test.ts)) — runs the full chain `preprocess → markdown-it → DOMParser → parseBoardSource` and asserts every card survives. Covers single board, multi-word column names ("Up Next", "In Progress"), two boards in one file, and boards with `board:body` blocks attached. Locks the fix in.

### Developer

- `F5` ("Run Extension") opens `demo-tester.md` in the Extension Development Host.

## [0.5.1] - 2026-05-28

### Added

- **Responsive header/chrome** — two media-query tiers keep the toolbar usable at narrow editor widths:
  - **≤ 900px:** Preview/Code labels drop to icons-only inside the segmented pill; filename `max-width` tightens (50vw → 30vw) so it stops colliding with the right-side reload / Aa / ⋯ trio.
  - **≤ 640px:** outline panel + its toolbar button auto-collapse (the 240px gutter would otherwise leave < 400px for content); the Preview/Code segmented pair collapses to a single "tap to switch" icon (only the *inactive* view's icon shows — like a dark-mode toggle that shows the sun when you're in dark mode); segmented pill background drops so the lone icon reads as a plain icon button; filename left-aligns (was absolute-centered) and the logo shrinks; dedicated refresh button hides and gains a **Reload from disk** entry in the ⋯ menu so the action stays reachable.
- **`.conflict-banner` reset at ≤ 640px** — when the outline auto-collapses, the banner's `left: 240px` offset is reset to `0` so it doesn't leave a visible gap on the left.

### Changed

- **Logo margins at ≤ 640px** — small left margin added so the logo doesn't sit flush against the toolbar edge; right margin trimmed so it isn't over-spaced against the view-toggle icon.

## [0.5.0] - 2026-05-27

### Added

- **Whiteboard slash-menu entry** — type `/whiteboard` (or `/mermaid` / `/diagram` / `/flowchart` / `/graph` / `/canvas`) to drop a freeform mermaid canvas onto the page with three starter nodes (Idea → Next → Done). Lives in **Media & blocks** with a Phosphor chalkboard icon. The visual-edit palette opens automatically on insert so you can drag, connect, and style immediately — no manual `/code` + language flip needed.

### Changed

- **Light-theme node fills** — diagram node fills bump from `#eef2ff` (Tailwind indigo-50) to `#dbeafe` (blue-100). Better contrast against the visual-edit backdrop and white previews; still well above WCAG AAA for text contrast. Applies to every mermaid block in light mode, not just whiteboard.
- **Dot-grid pattern removed** from visual-edit mode — the bounded dotted region was reading as a hard canvas boundary. The pane is now a clean tinted backdrop.
- **Visual-edit canvas behavior** — the viewport lock now defaults to OFF, so the SVG viewBox auto-grows as you drag nodes outward; the frame stays the same physical size. Inner SVG uses `overflow: visible` so dragged content extends to the frame edge during drag (clipped by the `.mb` frame so it never overlaps surrounding markdown). Pane height bumped to `70vh` in visual mode for substantially more drag room.
- **Zoom step halved** (0.10 → 0.05) for in/out controls and Cmd+/`-`; wheel-zoom caps per-event delta so trackpad pinches and wheel mice both feel proportional instead of jumping.

### Fixed

- **Visual-edit first-paint canvas race** — `createVisualEditor` no longer engages the lock before the SVG has rendered. The lock is captured lazily on the first re-render that has real content. Eliminates the "canvas inside a canvas" frame users hit on whiteboard insert.
- **Mermaid `style.maxWidth` override** — mermaid sets an inline `style="max-width: <natural>px"` on every render that was clamping the SVG to its natural-content width after every drag. The visual-edit fit and viewBox stamp now reset `style.maxWidth = '100%'` alongside width/height.

## [0.2.0] - 2026-05-10

### Added

- **RTL / bidirectional support** — Hebrew, Arabic, and other RTL scripts auto-detected per block. Standalone paragraphs, headings, blockquotes, callouts, table cells, and toggles get their own direction based on the first strong character. Lists detect once at the list level so all bullets, numbers, and task checkboxes stay on the same side as the first item — no mixed-side markers within a single list. Toggle disclosure caret swaps from `▶` to `◀` in RTL contexts. Code blocks and the source view stay forced to LTR.
- **Sync with selector** — replaces the old "Sync with system" toggle with a 3-way **Off / OS / IDE** segmented control in the Aa panel. **OS** follows `prefers-color-scheme`, **IDE** follows the host editor's color theme. Existing `mdEditorPlus.theme = "auto"` settings are silently migrated to **IDE**.

### Fixed

- **Toggle disclosure click** — `<details>` now opens and stays open when its triangle is clicked. Was previously intercepted by ProseMirror's edit handling and snapped closed by the mutation observer.
- **Block picker / callout menu / drag-handle tooltip positioning** — popovers now appear correctly even after the document has been scrolled. Fixed coordinate math that incorrectly added `window.scrollX/Y` to `position: fixed` element coordinates.
- **Block picker scroll dismiss** — wheel-scrolling inside the block picker's own list no longer dismisses it. The capture-phase scroll listener now ignores events whose target is inside the picker, plus `overscroll-behavior: contain` keeps the scroll from chaining to the document.
- **Adjacent callouts merging** — back-to-back GFM callouts (`> [!NOTE]` blocks) no longer collapse into a single block when separated by no blank line. The preprocessor stops body collection at a new `[!TYPE]` header, and the serializer now emits a blank line after each callout so saved files round-trip correctly.

## [0.1.1] - 2026-05-09

### Changed

- README rewrite — adds hero screenshot, three feature shots (display settings, code blocks, bubble menu), a structured Features section, and folds the "Coming from Notion" subsection into the "Why use it" bullets.

## [0.1.0] - 2026-05-09

### Added

#### Core editor
- Notion-style WYSIWYG editor for `.md` / `.markdown` / `.mdown` / `.mkd` / `.mdx` files via a custom editor.
- Source view alongside the rendered view, with syntax-highlighted Markdown via lowlight.
- Lossless YAML / TOML frontmatter handling with a "Frontmatter · N lines" pill that jumps to Source view.

#### Blocks
- Block picker (`⌘/` or `Ctrl+/`) with rich icons: paragraph, H1–H3, bullet/numbered/task lists, image, callout, toggle, blockquote, code block, divider.
- Drag handle (`⠿`) in the gutter to reorder any block.
- Bubble menu on text selection: bold, italic, underline, strikethrough, inline code, link, color, highlight, emoji, plus a "Turn into" submenu.
- Task lists with interactive checkboxes that round-trip Markdown.
- GFM tables.
- Code blocks with language label, copy button, line-number gutter, drag-to-reorder lines, smart-paste fence stripping, and an optional **Show more / Show less** collapse for long blocks.
- GFM callouts (`> [!NOTE]`, `> [!WARNING]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!CAUTION]`).
- Toggle blocks (collapsible `<details>`).

#### Toolbar
- Brand logo, view segmented control (Preview / Code, with animated active label), centered filename, settings (Aa) and actions (⋯) buttons.
- Idle-fade toolbar — drops to 50% opacity until the cursor is within 150 px of the top of the viewport.
- Filename hover opens an actions menu centered under the filename.
- Three-dots click opens an actions menu pinned to the top-right.

#### Settings panel (Aa)
- Four themes: Light, Claude, Sepia, Dark — with rich color-swatch tooltip previews.
- "Sync with system" toggle.
- Page-width slider (600–1400 px) with magnetic snap stops at 600 / 800 / 1000 / 1200 / 1400 and a live value pill.
- Full-width override toggle (auto-disables when slider is touched).
- Text-size segmented control (S / M / L / XL) with rich live-preview tooltips.
- Font segmented control (Sans / Serif / Mono) with rich live-preview tooltips.
- Code-block toggles: Always dark code snippets, Always dark code view, Full width in Code view, Shorten code snippets.
- **Save view as default** + **Reset** footer — every setting is runtime-only until explicitly saved to User-scope settings.

#### Actions menu
- Copy page content
- Copy file path
- Duplicate (creates `name copy.md` next to the file)
- Open in Finder / Explorer

#### Polish
- Custom tooltip system across the whole UI, with rich previews for theme, font, and text-size buttons and `<kbd>` shortcut hints in the bubble menu.
- Animated dropdowns (`scale + translateY` ease-out) for both Settings and Actions panels.
- Theme-aware scrollbars in code blocks.
- Smart preview/code toggling that tears down stray bubble menus / drop-lines on view switch.

#### Commands
- `MD Editor Plus: Open Block View`
- `MD Editor Plus: Open Source View`

#### Settings (`mdEditorPlus.*`)
- `theme`, `font`, `textSize`, `pageWidth`, `fullWidth`
- `alwaysDarkCode`, `alwaysDarkSource`, `sourceFullWidth`, `shortenCodeSnippets`
