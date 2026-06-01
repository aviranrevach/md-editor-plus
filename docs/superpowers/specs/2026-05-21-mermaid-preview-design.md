# Mermaid block preview — design

Render fenced ` ```mermaid ` code blocks as live diagram previews in Block view, with a toggle (or double-click) to flip back to source. Themed to follow the editor's Light / Claude / Sepia / Dark palette, with a fullscreen / zoom modal, and SVG / PNG export. Mermaid is the only diagram engine in v1.

## Goal

When the user opens a markdown file containing ` ```mermaid ` blocks, each block reads as a diagram, not as code. Editing the source is one click away, and the preview's polish (theming, error handling, export, fullscreen) matches the rest of the editor — not a stock mermaid embed in a different visual language.

## Out of scope (v1)

- Other diagram languages (PlantUML, Graphviz, D2). The architecture leaves the door open, but no second renderer ships.
- A canvas / free-positioning "Miro-like" mode. Discussed for a follow-up phase, not in this spec.
- Server-side rendering / pre-rendering on save. Rendering is webview-side, on demand.
- Mermaid block insertion via the slash / block-picker. Users still type the fenced block manually (or it round-trips from existing files). A picker entry can come later.

## What the user sees

### Default state — preview

- Block is rendered as an inline SVG, centered, padded `24px 18px`, in a card with the same chrome as a code block (1px border, soft shadow, 10px radius).
- Header row (left → right):
  - `mermaid` language label (lowercase, monospace, muted).
  - **Edit toggle** — small label `Edit` + iOS-style switch (track 26×14, thumb 12×12). Off in preview, on in source. Hover cursor: pointer.
  - **Expand button** — `⤢` icon + text `Expand`. Opens the fullscreen modal.
  - **Copy split-button** — clickable label `Copy` (copies the mermaid source code by default), separated by a 1px divider from a `▾` caret that opens a menu:
    - `Copy mermaid code`
    - `Copy as SVG`
    - `Download as SVG`
    - `Download as PNG`
- Single click anywhere on the diagram does **nothing** (caret placement only). Double-click anywhere on the diagram is equivalent to flipping the Edit toggle on.
- Selecting the block via the global drag handle (the `⠿` that already exists for every block) works as for any other block — moving the whole mermaid block as a unit.

### Source state — editing

- The preview pane is replaced in place by the existing code-block source view (line gutter, monospace, syntax-highlighted via lowlight as `mermaid` language — falls back to plain text styling since lowlight has no mermaid grammar; that is fine).
- The toggle switches to on (filled track in `--accent`, label takes the accent color). The Edit toggle remains visible.
- Expand and Copy stay visible. Expand on a source state previews the most recent valid render. If there is no valid render yet, Expand is disabled with a tooltip *"Preview will appear after the source parses"*.
- **Editing snackbar**: a single dark pill (`bg #1f1f23`, white text, 8px/12px padding, 8px radius, soft shadow) floats just below the Edit toggle, anchored to the header right edge. Contents: a pencil icon + text *"Editing source · press"* + a small `Esc` kbd chip + *"to preview"*. Fades in over ~120ms, holds for ~1800ms, fades out. Appears on every entry to edit mode, regardless of trigger (toggle or double-click). Nothing is shown when exiting edit.
- Exit edit: toggle off, Esc, or click outside the block. On exit, the source text is parsed and either re-renders the diagram or shows the error placeholder (below).

### Error state

When the mermaid parser fails (initial render or exit-edit re-render):

- The preview pane is replaced by a centered, vertically-flowing error card:
  - 32×32 circular icon with `--danger-bg` fill, `--danger-fg` stroke, exclamation glyph.
  - Title `Couldn't render diagram` (semibold 13px).
  - Meta line `Parse error · line N` (monospace 12px, `--danger-fg`). `N` is the 1-based line number extracted from mermaid's error object.
  - Single button **Fix in source** (6px/12px, neutral border) — flips the toggle on AND moves the caret to the start of line N. The error snackbar pattern (line-N inline message) does NOT appear in source view; the cursor placement is the affordance.
- The Edit toggle remains accessible on the header; the user can also toggle it without clicking the button.
- If the parser can't extract a line number, the meta line reads `Parse error` only.

### Fullscreen modal

- Triggered by Expand button (preview state) or by pressing `F` while the block is focused via caret.
- Full-viewport overlay, semi-transparent dark backdrop (`rgba(20,21,25,0.78)`). Content centered.
- Top bar:
  - Left: `mermaid · <chart kind>` where `<chart kind>` is parsed from the source (e.g. `flowchart`, `sequenceDiagram`). Falls back to just `mermaid`.
  - Center: zoom toolbar — `−`, current zoom percent (tabular-nums), `+`, reset (`⤾`).
  - Right: `Close · Esc`.
- Body: the SVG rendered at 100% center, scrollable container, drag-to-pan (mouse), pinch / wheel-zoom.
- Keyboard: `Esc` closes; `+` / `=` zoom in; `-` zoom out; `0` reset; arrow keys pan.

## Theming

- Mermaid is initialized with `securityLevel: 'strict'` and `startOnLoad: false`.
- Per editor theme, we pass a `themeVariables` object pulled from existing editor CSS variables. Concretely we map:
  - `primaryColor` ← `--cb-bg` / theme accent fill
  - `primaryBorderColor` ← `--accent` / theme accent stroke
  - `primaryTextColor` ← `--text`
  - `secondaryColor`, `tertiaryColor` ← softer accent variants for sequence/state
  - `lineColor` ← `--text-muted`
  - `textColor` ← `--text`
  - `mainBkg` ← `--bg`
  - `clusterBkg` ← `--cb-bg`
  - `noteBkgColor`, `noteTextColor` ← callout-note variables already defined
- Concrete color values per theme are defined in code (constant `MERMAID_THEME_VARS` keyed by `light | claude | sepia | dark`). One stub per theme that pulls from the same hex/rgba values the editor's CSS already uses, so swapping the theme palette later updates both surfaces.
- When the editor theme changes (user toggles theme, OS / IDE sync flips), every live `mermaidBlock` NodeView re-renders using its cached source. The notification mechanism: `src/webview/theme.ts` is extended to expose `subscribeThemeChanges(cb: (resolved: Resolved) => void): () => void`. Internally, `applyTheme` calls registered subscribers after toggling the html classes. The same hook fires for the existing MutationObserver / matchMedia paths, so sync-os and sync-ide flips also trigger re-render. `mermaidRenderer` subscribes once at module init and dispatches a `mermaid-theme-changed` CustomEvent on the editor root that NodeViews listen to.
- **Setting: `mdEditorPlus.alwaysDarkDiagram`** (boolean, default `false`). When true, the dark `themeVariables` are used regardless of editor theme. Mirrors `alwaysDarkCode`. Exposed in `package.json` `contributes.configuration` and as a toggle in the Aa panel under the existing "Code-block toggles" section (renamed to "Code & diagrams").

## Architecture

Three units, each with one job:

### `src/webview/extensions/mermaidBlock.ts` — the Tiptap extension

- Extends (does not replace) the existing `CodeBlock` extension. Same node type, same schema, lossless markdown round-trip is free.
- Overrides `addNodeView` to branch on `node.attrs.language === 'mermaid'`:
  - If yes: render the **mermaid NodeView** (header with Edit toggle / Expand / Copy menu, preview pane, source pane, snackbar, error placeholder).
  - If no: defer to the existing code-block NodeView (line gutter, line-drag, copy button, lowlight).
- The two views share the header chrome where possible (Copy split-button reuses the existing copy button's icon + behavior).
- Knows nothing about mermaid internals; talks only to `mermaidRenderer`.

### `src/webview/mermaidRenderer.ts` — the renderer module

- Lazy-loads the `mermaid` library on first use via dynamic `import('mermaid')`. The import is shared across all blocks; subsequent calls reuse the resolved module.
- Exposes:
  - `renderMermaid(source: string, theme: ThemeKey): Promise<{ svg: string } | { error: { message: string; line?: number } }>`
  - `subscribeThemeChanges(cb): () => void`
  - `currentTheme(): ThemeKey` — reads the `theme-dark` / `theme-sepia` / `theme-claude` class on `<html>` (or none → light) and combines with the `alwaysDarkDiagram` setting to return the effective theme key.
- Maintains a small LRU cache keyed by `${theme}::${hash(source)}` so theme toggles don't re-parse identical sources, and so re-mounts (caused by ProseMirror node swaps) are instant.
- A single render queue serializes mermaid invocations — mermaid's global state means parallel renders can clash.
- Knows nothing about ProseMirror.

### `src/webview/mermaidFullscreen.ts` — the fullscreen modal

- Pure DOM. Single exported function `openFullscreen({ svg: string, title: string }): void`.
- Builds the overlay, top bar, zoom controls, pan/zoom handlers. Cleans up on close.
- Knows nothing about the editor, ProseMirror, or mermaid the library.

### Data flow

```
Open file
  → CodeBlock NodeView constructs for each block
  → if lang === 'mermaid':
      mount mermaid preview pane
      mermaidRenderer.renderMermaid(source, currentTheme())
        ↓ success → inject SVG
        ↓ failure → render error placeholder with line N
  → user toggles Edit on (or double-clicks):
      swap preview DOM for source DOM (no node mutation)
      show snackbar
  → user toggles Edit off (or Esc / click outside):
      re-render via mermaidRenderer using fresh source text
  → editor theme change:
      mermaid-theme-changed event fires
      every mermaidBlock NodeView re-renders from cache
```

## Files changed

- **New**: `src/webview/extensions/mermaidBlock.ts` — extension + NodeView.
- **New**: `src/webview/mermaidRenderer.ts` — lazy loader, theming, cache, queue.
- **New**: `src/webview/mermaidFullscreen.ts` — modal.
- **New**: styles in `src/webview/styles/editor.css` for the toggle, snackbar, error placeholder, fullscreen modal. (If the additions push editor.css past ~1500 lines we split a `mermaid.css` file.)
- **Modified**: `src/webview/editor.ts` — register the new extension after the existing `CodeBlock` registration (or replace, since `mermaidBlock` extends it).
- **Modified**: `src/webview/styles/board.css`-style theme variable bookkeeping if any new vars are needed for the mermaid palette.
- **Modified**: `src/webview/theme.ts` — add `subscribeThemeChanges` export; call subscribers inside `applyTheme` after toggling html classes (and in the MutationObserver / matchMedia callbacks).
- **Modified**: `src/webview/index.ts` — add `alwaysDarkDiagram` to the settings dictionary, the saved-state list, the Aa-panel DOM toggle alongside `#always-dark-code-toggle`, and the persistence list.
- **Modified**: `package.json` — add `mdEditorPlus.alwaysDarkDiagram` to `contributes.configuration`; add `mermaid` as a regular `dependencies` entry (ships in the bundle).
- **Modified**: extension host code that reads settings and forwards them to the webview — extend with the new `alwaysDarkDiagram` key (parallel to `alwaysDarkCode`).
- **Modified**: `esbuild.config.js` — confirm mermaid is bundled / not externalized; mermaid pulls in `dagre`, `d3` and several other transitive deps, which adds ~1.5 MB to the webview bundle. Acceptable, but call out in PR.

## Performance

- The bundle weight from mermaid is the main cost. We mitigate with **dynamic import**: cold-open of a `.md` file with no mermaid blocks pays nothing extra. The first mermaid block in any file triggers `import('mermaid')`, after which all subsequent blocks render instantly.
- The per-block cache means flipping themes does not re-parse.
- The render queue means a file with 20 mermaid blocks renders sequentially, not in parallel, avoiding visible thrash.
- Initial render is async; the preview pane shows a 24×24 spinner (existing `--text-muted` ring) during the first render of any block.

## Markdown fidelity

- ` ```mermaid ` blocks are stored on disk as plain fenced code. The block-rendered view is purely a webview concern; the file content never changes shape.
- Code view (whole-doc raw source) shows mermaid blocks as code, not rendered. This is consistent with how code view treats every other block.
- Copy / Cut / Paste: copying a mermaid block as a ProseMirror selection copies the fenced markdown (same as a code block). Copying as SVG / PNG is explicitly a separate menu action.
- RTL: mermaid blocks render LTR even inside RTL pages. The block direction extension explicitly excludes `language === 'mermaid'`, matching how code blocks already force LTR.

## Accessibility

- Edit toggle has `role="switch"` + `aria-checked` reflecting state, `aria-label="Edit mermaid source"`.
- Snackbar has `role="status"` so screen readers announce the state change.
- Error placeholder has `role="alert"`.
- Fullscreen modal traps focus; Esc closes; first tab target is the close button.
- SVG output is wrapped with `role="img"` and an `aria-label` derived from the diagram kind + first node label (e.g. *"Flowchart diagram starting with Start"*).

## Testing

- **Unit**: `tests/webview/mermaidRenderer.test.ts` — covers cache hits, theme key resolution under `alwaysDarkDiagram`, error parsing for missing-line-number cases.
- **Unit**: `tests/webview/mermaidBlock.test.ts` — covers NodeView mount/unmount, toggle state transitions, error → fix-in-source caret placement.
- **Integration / DOM**: `tests/webview/mermaidFullscreen.test.ts` — opening, zoom math, Esc closing, pan delta clamping.
- **Manual smoke** before merge:
  - Open a file with flowchart, sequence, state, ER diagrams. All render in all four themes.
  - Break the syntax mid-edit, exit edit: error placeholder shows correct line. Click Fix in source: caret on that line.
  - Toggle theme: every block re-renders without flicker.
  - Toggle `alwaysDarkDiagram`: diagrams flip immediately.
  - Fullscreen: zoom +/-, reset, drag-pan, Esc.
  - File with no mermaid blocks: confirm mermaid bundle does NOT load (devtools network tab).

## Open question for v2 — "Miro-like" canvas

Discussed with the user; capturing the spirit so the v1 architecture stays compatible:

- A future "board" mode where multiple mermaid blocks (and possibly other content) live on a free-positioning canvas, with pan/zoom, alignment guides, multi-select. Likely a new custom block type (`canvas`) that *contains* a list of mermaid blocks (and other widgets) with `{ x, y, w, h }` attributes on each child.
- The v1 design keeps `mermaidBlock` as a self-contained unit (one source, one SVG, one fullscreen modal). That unit can be embedded inside a future canvas block without changes — the canvas would own positioning, the mermaid block keeps owning rendering. We are intentionally NOT designing the canvas now, but the boundaries are drawn so nothing has to be rewritten.

A follow-up brainstorm + spec will cover the canvas mode separately.
