# MD Editor Plus

A Notion-style markdown block editor for VS Code. **Every feature below is live in this file** — open the block view to feel it, switch to **Code** view to see how it round-trips to plain Markdown.

![MD Editor Plus rendering a Markdown file with the bubble menu open](media/MD-editor-plus.png)\---

## Headings

# Heading 1

## Heading 2

### Heading 3

Three heading levels with tight, confident line heights.

---

## Inline formatting

Every selection-driven control lives in the **bubble menu**. Select any of these to try it:

- **Bold**, *italic*, ~~strikethrough~~, and `inline code`
- A [named link to GitHub](https://github.com) and an autolink: <https://code.visualstudio.com>
- Mix it up: a [**bold link**](https://example.com) or `italic code`
- Underlines and color/highlight are applied via the bubble menu — pick a swatch and watch it round-trip
- Emoji from the bubble menu's picker: 🚀 📝 ✨ 🎨 🔥

Keyboard shortcuts that work right now:

| Shortcut | Action |
| --- | --- |
| `⌘B` / `Ctrl+B` | Bold |
| `⌘I` / `Ctrl+I` | Italic |
| `⌘U` / `Ctrl+U` | Underline |
| `⌘⇧X` / `Ctrl+Shift+X` | Strikethrough |
| `⌘E` / `Ctrl+E` | Inline code |
| `⌘K` / `Ctrl+K` | Insert link |
| `⌘/` / `Ctrl+/` | Open block picker |

---

## Lists

### Task list

- [x] Install MD Editor Plus

- [x] Open a Markdown file

- [ ] Try the bubble menu on selected text

- [ ] Drag a block by its `⠿` handle

- [ ] Open the block picker with `⌘/`

- [ ] Toggle "Always dark: Code Snippets" in the settings panel

### Bulleted list (with nesting)

- Top-level item
  - Nested child
    - Deeply nested grandchild
  - Sibling under top-level
- Another top-level item with **inline formatting** and a [link](https://github.com)

### Numbered list

1. Select some text
2. The bubble menu appears above the selection
3. Pick a formatting option
4. Continue typing — focus stays where you left it

---

## Blockquotes

> "Notes should feel like writing, not like coding."
>
> — every developer who ever opened a markdown file at 11 PM

---

## Callouts

GitHub-flavored callouts render with a colored background and an icon.

> [!NOTE] 💡
> Use Note for general context, links to related docs, or anything informational. [!TIP] ✅ Use Tip for shortcuts, optimizations, or the "you probably also want…" hint. [!IMPORTANT] 📌 Use Important when the reader needs to know this before they act on the rest of the doc. [!WARNING] ⚠️ Use Warning for things that will surprise people: breaking changes, side effects, footguns. [!CAUTION] 🛑 Use Caution for the dangerous stuff. Data loss, irreversible operations, security gotchas.
---

## Tables

| Feature | Status | Notes |
| --- | --- | --- |
| Inline editing | ✅ | Click any block |
| Bubble menu | ✅ | Appears on text select |
| Block picker | ✅ | `⌘/` or `+` icon |
| Drag to reorder | ✅ | Grab the `⠿` handle |
| Frontmatter (YAML / TOML) | ✅ | Preserved, hidden, jumps to Code view |
| Themes | ✅ | Light · Claude · Sepia · Dark |
| Sync with VS Code theme | ✅ | Toggle in settings panel |
| Page width | ✅ | 600 → 1400 px slider with magnetic stops |

---

## Code blocks

Syntax highlighting for \~50 languages. Each block has a header, a line-number gutter (drag a line to reorder it), and a copy button.

### TypeScript

```typescript
interface Block {
  id: string;
  type: 'paragraph' | 'heading' | 'code' | 'list';
  content: string;
}

function render(blocks: Block[]): string {
  return blocks
    .map((block) => `<div data-id="${block.id}">${block.content}</div>`)
    .join('\n');
}
```

### Python

```python
from dataclasses import dataclass
from typing import Iterable

@dataclass
class Note:
    title: str
    body: str

def search(notes: Iterable[Note], query: str) -> list[Note]:
    q = query.casefold()
    return [n for n in notes if q in n.title.casefold() or q in n.body.casefold()]
```

### Bash

```bash
# Build and package the extension
npm install
npm run compile
npm run package
code --install-extension md-editor-plus-0.1.0.vsix
```

### JSON

```json
{
  "mdEditorPlus.theme": "claude",
  "mdEditorPlus.font": "serif",
  "mdEditorPlus.pageWidth": 1000,
  "mdEditorPlus.alwaysDarkCode": true,
  "mdEditorPlus.shortenCodeSnippets": true
}
```

### A long block (try "Shorten Code Snippets")

Turn on **Shorten Code Snippets** in the settings panel — anything over \~12 lines collapses behind a Show more / Show less button.

```css
:root {
  --bg: #ffffff;
  --fg: #37352f;
  --muted: #787774;
  --accent: #2383e2;
  --border: rgba(55, 53, 47, 0.09);
  --code-bg: #f7f6f3;
  --callout-note-bg: #eaf3ff;
  --callout-tip-bg: #ddf4e4;
  --callout-warning-bg: #fff5d9;
  --callout-important-bg: #f3e8ff;
  --callout-caution-bg: #ffe4e1;
}

body {
  font-family: ui-sans-serif, Inter, system-ui, sans-serif;
  background: var(--bg);
  color: var(--fg);
  line-height: 1.6;
}

h1, h2, h3 { font-weight: 700; letter-spacing: -0.01em; }
h1 { font-size: 2.25rem; margin-top: 2rem; }
h2 { font-size: 1.6rem; margin-top: 1.6rem; }
h3 { font-size: 1.25rem; margin-top: 1.25rem; }

code, pre { font-family: ui-monospace, "JetBrains Mono", Menlo, monospace; }

pre {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem 1.2rem;
  overflow-x: auto;
}

a { color: var(--accent); text-decoration: none; border-bottom: 1px solid transparent; }
a:hover { border-bottom-color: currentColor; }
```

---

## Images

Local image (extension icon, from `media/`):

![MD Editor Plus icon](media/icon.png)Vector logo (SVG):

![Logo SVG](media/icon.svg)A reference-style image works too:

![Claude icon](media/claude-icon.svg "Claude theme icon")&gt; \[!NOTE\] 💡

> Image paths render relative to the workspace root, so media/icon.png resolves the same way it does on GitHub.

---

## Links

- Bare autolink: <https://code.visualstudio.com>
- Inline link: [VS Code Marketplace](https://marketplace.visualstudio.com)
- Reference link: [GitHub repo](https://github.com/aviranrevach/md-editor-plus)
- Email: [aviran@atera.com](mailto:aviran@atera.com)
- Anchor link to a heading on this page: [jump to Tables](#tables)

---

## Toggles (collapsible sections)

Toggles round-trip as HTML `<details>` blocks. Click to expand.

<details>
<summary>Toggle</summary>

ToggleToggleHow does the bubble menu decide where to appear?It listens to TipTap's selectionUpdate event, measures the selection's bounding rect, then flips above or below depending on viewport space. There's a 350 ms debounce so it doesn't flicker mid-drag.

</details>
<details>
<summary>Toggle</summary>

ToggleToggleWhat happens to my YAML frontmatter?It's stripped out before the editor parses the document, kept in a side buffer, and re-attached on save. When a file has frontmatter, a small numeric badge appears on the Code view-toggle button showing the line count — click it to jump to Code view and edit the YAML directly.

</details>
<details>
<summary>Toggle</summary>

ToggleToggleCan I use this on .mdx files?Yes — .mdx is registered as a supported extension. JSX expressions render as raw text in Preview; switch to Code view to edit them as Markdown source.

</details>
\\---

## Horizontal rules

The line below is a horizontal rule.

---

…and the editor also renders standalone `***` and `___` rules.

---

---

---

## Special characters & escapes

Backticks in prose: `` `foo` `` renders as `` `foo` ``. An escaped asterisk \*not italic\* stays literal. HTML entities like `&amp;` and `&copy;` work inline: 2026 © Aviran Revach.

---

## Math-flavored line (just text)

Inline math isn't a built-in block, but you can write expressions as inline code: `E = mc²`, `∀x ∈ ℝ, f(x) ≥ 0`.

---

*Made for developers who want their notes to look as good as their code.*[Made with MD Editor Plus](https://github.com/aviranrevach/md-editor-plus) · [Report a bug](https://github.com/aviranrevach/md-editor-plus/issues)