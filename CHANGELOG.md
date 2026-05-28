# Change Log

All notable changes to **MD Editor Plus** are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
