# Notion MD Viewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code extension that opens `.md` files in a Notion-styled Tiptap editor by default, with inline block editing, a source-view toggle, and theme sync with VS Code.

**Architecture:** A `CustomTextEditorProvider` registers for `*.md` files. The provider serves a webview that bundles Tiptap with Notion CSS. The extension host and webview exchange `postMessage` messages: host sends file content on open and on external changes; webview sends debounced serialized Markdown back on each edit.

**Tech Stack:** TypeScript, VS Code Extension API (`CustomTextEditorProvider`), Tiptap v2, `tiptap-markdown`, `lowlight`, esbuild (webview bundle), tsc (extension host), Jest + ts-jest (unit tests)

---

## File Map

| File | Responsibility |
|---|---|
| `package.json` | Manifest, deps, scripts, Jest config |
| `tsconfig.json` | Extension host compile config |
| `tsconfig.webview.json` | Webview compile config (DOM libs, bundler resolution) |
| `esbuild.config.js` | Bundles `src/webview/index.ts` → `dist/webview.js` |
| `.vscodeignore` | Excludes src/tests from packaged extension |
| `src/extension.ts` | Activates extension, registers provider and commands |
| `src/notionEditorProvider.ts` | `CustomTextEditorProvider`: reads file, generates HTML, syncs edits |
| `src/webview/global.d.ts` | TypeScript declaration for `*.css` module imports |
| `src/webview/index.ts` | Webview bootstrap: injects CSS, initialises editor, handles postMessage |
| `src/webview/editor.ts` | Creates/updates/destroys Tiptap instance; all extensions wired here |
| `src/webview/theme.ts` | Detects VS Code theme class; applies/cycles Notion theme CSS variable set |
| `src/webview/extensions/callout.ts` | Tiptap Node for Notion callout blocks; exports testable parse/serialize helpers |
| `src/webview/extensions/toggle.ts` | Tiptap Node for collapsible toggle blocks; exports testable helpers |
| `src/webview/styles/notion-light.css` | Light-theme CSS custom properties |
| `src/webview/styles/notion-dark.css` | Dark-theme CSS custom properties (scoped to `.theme-dark`) |
| `src/webview/styles/editor.css` | All block-level Notion styles (headings, code, table, callout, toggle, …) |
| `tests/callout.test.ts` | Unit tests for callout parse/serialize helpers |
| `tests/toggle.test.ts` | Unit tests for toggle parse/serialize helpers |

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.webview.json`
- Create: `esbuild.config.js`
- Create: `.vscodeignore`
- Create: `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "notion-md-viewer",
  "displayName": "Notion MD Viewer",
  "description": "View and edit Markdown files with a Notion-style interface",
  "version": "0.1.0",
  "publisher": "notion-md-viewer",
  "engines": { "vscode": "^1.74.0" },
  "categories": ["Other"],
  "activationEvents": [],
  "main": "./dist/extension.js",
  "contributes": {
    "customEditors": [
      {
        "viewType": "notion-md-viewer",
        "displayName": "Notion MD Viewer",
        "selector": [{ "filenamePattern": "*.md" }],
        "priority": "default"
      }
    ],
    "commands": [
      {
        "command": "notion-md.openSourceView",
        "title": "Notion MD: Open Source View"
      },
      {
        "command": "notion-md.openNotionView",
        "title": "Notion MD: Open Notion View"
      }
    ],
    "configuration": {
      "title": "Notion MD Viewer",
      "properties": {
        "notionMdViewer.theme": {
          "type": "string",
          "enum": ["auto", "light", "dark"],
          "default": "auto",
          "description": "Color theme override for Notion MD Viewer"
        }
      }
    }
  },
  "scripts": {
    "compile": "tsc -p tsconfig.json && node esbuild.config.js",
    "watch": "concurrently \"tsc -p tsconfig.json -w\" \"node esbuild.config.js --watch\"",
    "test": "jest",
    "package": "vsce package"
  },
  "dependencies": {
    "@tiptap/core": "^2.7.0",
    "@tiptap/starter-kit": "^2.7.0",
    "@tiptap/extension-task-list": "^2.7.0",
    "@tiptap/extension-task-item": "^2.7.0",
    "@tiptap/extension-table": "^2.7.0",
    "@tiptap/extension-table-row": "^2.7.0",
    "@tiptap/extension-table-cell": "^2.7.0",
    "@tiptap/extension-table-header": "^2.7.0",
    "@tiptap/extension-image": "^2.7.0",
    "@tiptap/extension-link": "^2.7.0",
    "@tiptap/extension-code-block-lowlight": "^2.7.0",
    "lowlight": "^3.1.0",
    "tiptap-markdown": "^0.8.10"
  },
  "devDependencies": {
    "@types/vscode": "^1.74.0",
    "@types/jest": "^29.0.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "esbuild": "^0.21.0",
    "concurrently": "^8.0.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "@vscode/vsce": "^2.0.0"
  },
  "jest": {
    "preset": "ts-jest",
    "testEnvironment": "node",
    "testMatch": ["**/tests/**/*.test.ts"],
    "moduleNameMapper": { "\\.css$": "<rootDir>/tests/__mocks__/fileMock.js" },
    "transform": {
      "^.+\\.tsx?$": ["ts-jest", { "tsconfig": "tsconfig.webview.json" }]
    }
  }
}
```

- [ ] **Step 2: Create `tsconfig.json` (extension host)**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2020",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src/extension.ts", "src/notionEditorProvider.ts"],
  "exclude": ["src/webview/**", "node_modules", "dist"]
}
```

- [ ] **Step 3: Create `tsconfig.webview.json`**

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "target": "ES2020",
    "lib": ["ES2020", "DOM"],
    "outDir": "./dist-webview",
    "rootDir": "./src/webview",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "moduleResolution": "bundler"
  },
  "include": ["src/webview/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create `esbuild.config.js`**

```javascript
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/webview/index.ts'],
    bundle: true,
    outfile: 'dist/webview.js',
    format: 'iife',
    platform: 'browser',
    sourcemap: true,
    loader: { '.css': 'text' },
  });

  if (watch) {
    await ctx.watch();
    console.log('Watching webview...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log('Webview built.');
  }
}

main().catch(console.error);
```

- [ ] **Step 5: Create `.vscodeignore`**

```
.vscode/**
src/**
tests/**
node_modules/**
*.map
tsconfig*.json
esbuild.config.js
.gitignore
docs/**
```

- [ ] **Step 6: Create `tests/__mocks__/fileMock.js`** (CSS stub for Jest)

```javascript
module.exports = '';
```

- [ ] **Step 7: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` populated, no errors.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json tsconfig.webview.json esbuild.config.js .vscodeignore .gitignore tests/__mocks__/fileMock.js
git commit -m "chore: project scaffold with build pipeline and Jest config"
```

---

### Task 2: CSS design tokens and editor styles

**Files:**
- Create: `src/webview/global.d.ts`
- Create: `src/webview/styles/notion-light.css`
- Create: `src/webview/styles/notion-dark.css`
- Create: `src/webview/styles/editor.css`

- [ ] **Step 1: Create `src/webview/global.d.ts`**

```typescript
declare module '*.css' {
  const content: string;
  export default content;
}
```

- [ ] **Step 2: Create `src/webview/styles/notion-light.css`**

```css
:root {
  --bg: #ffffff;
  --bg-secondary: #f7f6f3;
  --text-primary: #37352f;
  --text-secondary: #9b9a97;
  --border: #e8e8e8;
  --block-hover: #f7f6f3;
  --callout-bg: #f7f6f3;
  --callout-border: #d3d3d3;
  --code-bg: #f7f6f3;
  --code-text: #eb5757;
  --table-header-bg: #f7f6f3;
  --table-border: #e8e8e8;
  --blockquote-border: #d3d3d3;
  --checkbox-checked: #2563eb;
  --link: #2563eb;
  --toolbar-bg: #ffffff;
  --toolbar-border: #e8e8e8;
  --toolbar-btn-hover: #f7f6f3;
  --font-body: ui-sans-serif, 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-heading: ui-serif, 'Georgia', serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
}
```

- [ ] **Step 3: Create `src/webview/styles/notion-dark.css`**

```css
.theme-dark {
  --bg: #191919;
  --bg-secondary: #252525;
  --text-primary: #cfcfcf;
  --text-secondary: #6c7086;
  --border: #2f2f2f;
  --block-hover: #252525;
  --callout-bg: #2d2d1a;
  --callout-border: #555555;
  --code-bg: #252525;
  --code-text: #f38ba8;
  --table-header-bg: #252525;
  --table-border: #2f2f2f;
  --blockquote-border: #555555;
  --checkbox-checked: #93c5fd;
  --link: #93c5fd;
  --toolbar-bg: #1e1e1e;
  --toolbar-border: #2f2f2f;
  --toolbar-btn-hover: #252525;
}
```

- [ ] **Step 4: Create `src/webview/styles/editor.css`**

```css
* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.75;
}

#toolbar {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  background: var(--toolbar-bg);
  border-bottom: 1px solid var(--toolbar-border);
}

#toolbar button {
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}

#toolbar button:hover {
  background: var(--toolbar-btn-hover);
  color: var(--text-primary);
}

#editor {
  max-width: 720px;
  margin: 0 auto;
  padding: 48px 24px 96px;
}

.ProseMirror { outline: none; min-height: 200px; }

.ProseMirror h1 {
  font-family: var(--font-heading);
  font-size: 2rem;
  font-weight: 700;
  margin: 1.5rem 0 0.5rem;
}
.ProseMirror h2 {
  font-family: var(--font-heading);
  font-size: 1.5rem;
  font-weight: 600;
  margin: 1.25rem 0 0.4rem;
}
.ProseMirror h3 {
  font-family: var(--font-heading);
  font-size: 1.2rem;
  font-weight: 600;
  margin: 1rem 0 0.3rem;
}

.ProseMirror p { margin: 0.3rem 0; }

.ProseMirror blockquote {
  border-left: 3px solid var(--blockquote-border);
  margin: 0.5rem 0;
  padding: 0.25rem 0 0.25rem 1rem;
  color: var(--text-secondary);
  font-style: italic;
}

.ProseMirror code {
  background: var(--code-bg);
  color: var(--code-text);
  border-radius: 3px;
  padding: 0.1em 0.4em;
  font-family: var(--font-mono);
  font-size: 0.875em;
}

.ProseMirror pre {
  background: var(--code-bg);
  border-radius: 6px;
  padding: 1rem 1.25rem;
  overflow-x: auto;
  margin: 0.75rem 0;
}
.ProseMirror pre code {
  background: transparent;
  color: var(--text-primary);
  padding: 0;
  font-size: 0.875rem;
  line-height: 1.6;
}

.ProseMirror ul, .ProseMirror ol {
  padding-left: 1.5rem;
  margin: 0.3rem 0;
}

.ProseMirror ul[data-type="taskList"] {
  list-style: none;
  padding-left: 0.25rem;
}
.ProseMirror ul[data-type="taskList"] li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.ProseMirror ul[data-type="taskList"] li > label { margin-top: 3px; flex-shrink: 0; }
.ProseMirror ul[data-type="taskList"] li input[type="checkbox"] {
  accent-color: var(--checkbox-checked);
  width: 15px;
  height: 15px;
  cursor: pointer;
}
.ProseMirror ul[data-type="taskList"] li[data-checked="true"] > div {
  text-decoration: line-through;
  color: var(--text-secondary);
}

.ProseMirror hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1.5rem 0;
}

.ProseMirror table {
  border-collapse: collapse;
  width: 100%;
  margin: 0.75rem 0;
  font-size: 0.9rem;
}
.ProseMirror th {
  background: var(--table-header-bg);
  font-weight: 600;
  text-align: left;
  padding: 8px 12px;
  border: 1px solid var(--table-border);
}
.ProseMirror td {
  padding: 8px 12px;
  border: 1px solid var(--table-border);
}

.ProseMirror img {
  max-width: 100%;
  border-radius: 4px;
  margin: 0.5rem 0;
}

.ProseMirror a { color: var(--link); text-decoration: underline; }

.ProseMirror .callout {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: var(--callout-bg);
  border: 1px solid var(--callout-border);
  border-radius: 5px;
  padding: 12px 16px;
  margin: 0.75rem 0;
}
.ProseMirror .callout-emoji { flex-shrink: 0; font-size: 1.1rem; line-height: 1.6; }
.ProseMirror .callout-content { flex: 1; }

.ProseMirror details { margin: 0.5rem 0; }
.ProseMirror details summary {
  cursor: pointer;
  user-select: none;
  font-weight: 500;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 6px;
}
.ProseMirror details summary::before {
  content: '▶';
  font-size: 0.65rem;
  transition: transform 0.15s;
  color: var(--text-secondary);
}
.ProseMirror details[open] summary::before { transform: rotate(90deg); }
.ProseMirror details .toggle-content { padding-left: 1.5rem; margin-top: 4px; }
```

- [ ] **Step 5: Commit**

```bash
git add src/webview/global.d.ts src/webview/styles/
git commit -m "feat: add Notion design tokens and editor block styles"
```

---

### Task 3: Callout Tiptap extension (TDD)

**Files:**
- Create: `tests/callout.test.ts`
- Create: `src/webview/extensions/callout.ts`

- [ ] **Step 1: Write failing test `tests/callout.test.ts`**

```typescript
import { calloutToMarkdown, parseCalloutLine } from '../src/webview/extensions/callout';

describe('callout serialization', () => {
  it('serializes a NOTE callout to markdown', () => {
    expect(calloutToMarkdown('note', '💡', 'This is a note')).toBe(
      '> [!NOTE] 💡\n> This is a note\n'
    );
  });

  it('serializes a WARNING callout to markdown', () => {
    expect(calloutToMarkdown('warning', '⚠️', 'Be careful')).toBe(
      '> [!WARNING] ⚠️\n> Be careful\n'
    );
  });

  it('serializes a TIP callout to markdown', () => {
    expect(calloutToMarkdown('tip', '✅', 'Pro tip')).toBe(
      '> [!TIP] ✅\n> Pro tip\n'
    );
  });
});

describe('callout parsing', () => {
  it('parses a NOTE callout header line', () => {
    expect(parseCalloutLine('> [!NOTE] 💡')).toEqual({ type: 'note', emoji: '💡' });
  });

  it('parses a WARNING callout header line', () => {
    expect(parseCalloutLine('> [!WARNING] ⚠️')).toEqual({ type: 'warning', emoji: '⚠️' });
  });

  it('returns null for a regular blockquote', () => {
    expect(parseCalloutLine('> regular blockquote')).toBeNull();
  });

  it('defaults emoji when not specified in the header', () => {
    expect(parseCalloutLine('> [!TIP]')).toEqual({ type: 'tip', emoji: '✅' });
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
npx jest tests/callout.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '../src/webview/extensions/callout'`

- [ ] **Step 3: Create `src/webview/extensions/callout.ts`**

```typescript
import { Node, mergeAttributes } from '@tiptap/core';

export type CalloutType = 'note' | 'warning' | 'tip' | 'info';

const DEFAULT_EMOJIS: Record<CalloutType, string> = {
  note: '💡',
  warning: '⚠️',
  tip: '✅',
  info: 'ℹ️',
};

const CALLOUT_PATTERN = /^> \[!(NOTE|WARNING|TIP|INFO)\]\s*(.*)?$/i;

export interface CalloutAttrs {
  type: CalloutType;
  emoji: string;
}

export function parseCalloutLine(line: string): CalloutAttrs | null {
  const match = line.match(CALLOUT_PATTERN);
  if (!match) return null;
  const type = match[1].toLowerCase() as CalloutType;
  const emoji = match[2]?.trim() || DEFAULT_EMOJIS[type];
  return { type, emoji };
}

export function calloutToMarkdown(
  type: CalloutType,
  emoji: string,
  content: string
): string {
  return `> [!${type.toUpperCase()}] ${emoji}\n> ${content}\n`;
}

const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'inline*',

  addAttributes() {
    return {
      type: { default: 'note' as CalloutType },
      emoji: { default: '💡' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes({ 'data-callout': '', class: 'callout' }, HTMLAttributes),
      ['span', { class: 'callout-emoji', contenteditable: 'false' }, node.attrs.emoji as string],
      ['div', { class: 'callout-content' }, 0],
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const content = node.textContent as string;
          state.write(calloutToMarkdown(node.attrs.type, node.attrs.emoji, content));
          state.ensureNewLine();
        },
      },
    };
  },
});

export default Callout;
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest tests/callout.test.ts --no-coverage
```

Expected: PASS — 7 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/webview/extensions/callout.ts tests/callout.test.ts
git commit -m "feat: add Callout Tiptap extension with unit tests"
```

---

### Task 4: Toggle Tiptap extension (TDD)

**Files:**
- Create: `tests/toggle.test.ts`
- Create: `src/webview/extensions/toggle.ts`

- [ ] **Step 1: Write failing test `tests/toggle.test.ts`**

```typescript
import { toggleToMarkdown, parseToggleSummary } from '../src/webview/extensions/toggle';

describe('toggle serialization', () => {
  it('wraps content in details/summary markdown', () => {
    expect(toggleToMarkdown('Click to expand', 'Hidden content')).toBe(
      '<details>\n<summary>Click to expand</summary>\n\nHidden content\n\n</details>\n'
    );
  });

  it('handles empty content gracefully', () => {
    expect(toggleToMarkdown('Title', '')).toBe(
      '<details>\n<summary>Title</summary>\n\n\n\n</details>\n'
    );
  });
});

describe('toggle parsing', () => {
  it('identifies an opening details tag', () => {
    expect(parseToggleSummary('<details>')).toBe(true);
  });

  it('identifies details tag with attributes', () => {
    expect(parseToggleSummary('<details open>')).toBe(true);
  });

  it('rejects non-details HTML tags', () => {
    expect(parseToggleSummary('<div>')).toBe(false);
  });

  it('rejects plain text', () => {
    expect(parseToggleSummary('regular text')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
npx jest tests/toggle.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '../src/webview/extensions/toggle'`

- [ ] **Step 3: Create `src/webview/extensions/toggle.ts`**

```typescript
import { Node, mergeAttributes } from '@tiptap/core';

const DETAILS_PATTERN = /^<details(\s[^>]*)?>/i;

export function toggleToMarkdown(summary: string, content: string): string {
  return `<details>\n<summary>${summary}</summary>\n\n${content}\n\n</details>\n`;
}

export function parseToggleSummary(line: string): boolean {
  return DETAILS_PATTERN.test(line.trim());
}

const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'block+',

  addAttributes() {
    return {
      summary: { default: 'Toggle' },
    };
  },

  parseHTML() {
    return [{ tag: 'details' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'details',
      mergeAttributes(HTMLAttributes),
      ['summary', {}, node.attrs.summary as string],
      ['div', { class: 'toggle-content' }, 0],
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const content = node.textContent as string;
          state.write(toggleToMarkdown(node.attrs.summary, content));
          state.ensureNewLine();
        },
      },
    };
  },
});

export default Toggle;
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest tests/toggle.test.ts --no-coverage
```

Expected: PASS — 6 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/webview/extensions/toggle.ts tests/toggle.test.ts
git commit -m "feat: add Toggle Tiptap extension with unit tests"
```

---

### Task 5: Tiptap editor module

**Files:**
- Create: `src/webview/editor.ts`

- [ ] **Step 1: Create `src/webview/editor.ts`**

```typescript
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { Markdown } from 'tiptap-markdown';
import Callout from './extensions/callout';
import Toggle from './extensions/toggle';

const lowlight = createLowlight(common);

let _editor: Editor | null = null;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

export type OnChangeCallback = (markdown: string) => void;

export function createEditor(
  element: HTMLElement,
  initialMarkdown: string,
  onChange: OnChangeCallback
): Editor {
  _editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CodeBlockLowlight.configure({ lowlight }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Image,
      Link.configure({ openOnClick: false }),
      Markdown.configure({ transformCopiedText: true }),
      Callout,
      Toggle,
    ],
    content: initialMarkdown,
    onUpdate({ editor }) {
      if (_debounceTimer) clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(() => {
        const markdown = editor.storage.markdown.getMarkdown() as string;
        onChange(markdown);
      }, 500);
    },
  });

  return _editor;
}

export function updateContent(markdown: string): void {
  if (!_editor) return;
  _editor.commands.setContent(markdown);
}

export function destroyEditor(): void {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _editor?.destroy();
  _editor = null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/webview/editor.ts
git commit -m "feat: add Tiptap editor module with all block extensions"
```

---

### Task 6: Theme module

**Files:**
- Create: `src/webview/theme.ts`

- [ ] **Step 1: Create `src/webview/theme.ts`**

```typescript
export type ThemeSetting = 'auto' | 'light' | 'dark';

let _currentSetting: ThemeSetting = 'auto';

function resolveTheme(setting: ThemeSetting): 'light' | 'dark' {
  if (setting === 'light') return 'light';
  if (setting === 'dark') return 'dark';
  return document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast-dark')
    ? 'dark'
    : 'light';
}

function updateThemeButton(resolved: 'light' | 'dark'): void {
  const btn = document.getElementById('btn-theme');
  if (!btn) return;
  if (_currentSetting === 'auto') {
    btn.textContent = `Auto (${resolved === 'dark' ? '🌙' : '☀️'})`;
  } else {
    btn.textContent = resolved === 'dark' ? '🌙 Dark' : '☀️ Light';
  }
}

export function applyTheme(setting: ThemeSetting): void {
  _currentSetting = setting;
  const resolved = resolveTheme(setting);
  document.documentElement.classList.toggle('theme-dark', resolved === 'dark');
  updateThemeButton(resolved);
}

export function initTheme(setting: ThemeSetting): void {
  applyTheme(setting);
  const observer = new MutationObserver(() => {
    if (_currentSetting === 'auto') applyTheme('auto');
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

export function cycleTheme(): ThemeSetting {
  const next: Record<ThemeSetting, ThemeSetting> = {
    auto: 'light',
    light: 'dark',
    dark: 'auto',
  };
  const newSetting = next[_currentSetting];
  applyTheme(newSetting);
  return newSetting;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/webview/theme.ts
git commit -m "feat: add theme detection and CSS variable management"
```

---

### Task 7: Webview entry point

**Files:**
- Create: `src/webview/index.ts`

- [ ] **Step 1: Create `src/webview/index.ts`**

```typescript
import lightCss from './styles/notion-light.css';
import darkCss from './styles/notion-dark.css';
import editorCss from './styles/editor.css';
import { createEditor, updateContent } from './editor';
import { initTheme, cycleTheme, ThemeSetting } from './theme';

declare function acquireVsCodeApi(): {
  postMessage: (msg: unknown) => void;
};

const vscode = acquireVsCodeApi();

interface InitMessage   { type: 'init';        markdown: string; theme: ThemeSetting; }
interface UpdateMessage { type: 'update';      markdown: string; }
interface ThemeMessage  { type: 'themeChange'; theme: ThemeSetting; }
type HostMessage = InitMessage | UpdateMessage | ThemeMessage;

function injectStyles(): void {
  const style = document.createElement('style');
  style.textContent = lightCss + darkCss + editorCss;
  document.head.appendChild(style);
}

function init(): void {
  injectStyles();

  const editorEl = document.getElementById('editor')!;
  const btnSource = document.getElementById('btn-source')!;
  const btnTheme = document.getElementById('btn-theme')!;
  let editorReady = false;

  btnSource.addEventListener('click', () => {
    vscode.postMessage({ type: 'openSourceView' });
  });

  btnTheme.addEventListener('click', () => {
    const newSetting = cycleTheme();
    vscode.postMessage({ type: 'themeOverride', theme: newSetting });
  });

  window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
    const msg = event.data;

    if (msg.type === 'init') {
      initTheme(msg.theme);
      createEditor(editorEl, msg.markdown, (markdown) => {
        vscode.postMessage({ type: 'edit', markdown });
      });
      editorReady = true;
    }

    if (msg.type === 'update' && editorReady) {
      updateContent(msg.markdown);
    }

    if (msg.type === 'themeChange') {
      initTheme(msg.theme);
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
```

- [ ] **Step 2: Commit**

```bash
git add src/webview/index.ts
git commit -m "feat: add webview entry point with CSS injection and postMessage handling"
```

---

### Task 8: NotionEditorProvider

**Files:**
- Create: `src/notionEditorProvider.ts`

- [ ] **Step 1: Create `src/notionEditorProvider.ts`**

```typescript
import * as vscode from 'vscode';

export class NotionEditorProvider implements vscode.CustomTextEditorProvider {
  private static readonly viewType = 'notion-md-viewer';
  private _isApplyingEdit = false;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new NotionEditorProvider(context.extensionUri);
    return vscode.window.registerCustomEditorProvider(
      NotionEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    );
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'dist')],
    };

    webviewPanel.webview.html = this._getHtml(webviewPanel.webview);

    const sendInit = () => {
      const theme = vscode.workspace
        .getConfiguration('notionMdViewer')
        .get<string>('theme', 'auto');
      webviewPanel.webview.postMessage({
        type: 'init',
        markdown: document.getText(),
        theme,
      });
    };

    const onDocChange = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      if (this._isApplyingEdit) return;
      webviewPanel.webview.postMessage({
        type: 'update',
        markdown: document.getText(),
      });
    });

    const onConfigChange = vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('notionMdViewer.theme')) return;
      const theme = vscode.workspace
        .getConfiguration('notionMdViewer')
        .get<string>('theme', 'auto');
      webviewPanel.webview.postMessage({ type: 'themeChange', theme });
    });

    webviewPanel.webview.onDidReceiveMessage(async (msg: {
      type: string;
      markdown?: string;
      theme?: string;
    }) => {
      if (msg.type === 'edit' && msg.markdown !== undefined) {
        await this._applyEdit(document, msg.markdown);
      }
      if (msg.type === 'openSourceView') {
        await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
      }
      if (msg.type === 'themeOverride' && msg.theme) {
        await vscode.workspace
          .getConfiguration('notionMdViewer')
          .update('theme', msg.theme, vscode.ConfigurationTarget.Workspace);
      }
    });

    webviewPanel.onDidDispose(() => {
      onDocChange.dispose();
      onConfigChange.dispose();
    });

    sendInit();
  }

  private async _applyEdit(document: vscode.TextDocument, markdown: string): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, document.lineCount, 0),
      markdown
    );
    this._isApplyingEdit = true;
    await vscode.workspace.applyEdit(edit);
    this._isApplyingEdit = false;
  }

  private _getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js')
    );
    const nonce = this._nonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}';
             img-src ${webview.cspSource} data: https:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Notion MD</title>
</head>
<body>
  <div id="toolbar">
    <button id="btn-source">⌨ View Source</button>
    <button id="btn-theme">Auto</button>
  </div>
  <div id="editor"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private _nonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 32 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/notionEditorProvider.ts
git commit -m "feat: add NotionEditorProvider with file sync and webview HTML"
```

---

### Task 9: Extension entry point

**Files:**
- Create: `src/extension.ts`

- [ ] **Step 1: Create `src/extension.ts`**

```typescript
import * as vscode from 'vscode';
import { NotionEditorProvider } from './notionEditorProvider';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(NotionEditorProvider.register(context));

  context.subscriptions.push(
    vscode.commands.registerCommand('notion-md.openSourceView', async () => {
      const activeTabInput = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      if (!activeTabInput || typeof activeTabInput !== 'object' || !('uri' in activeTabInput)) return;
      await vscode.commands.executeCommand(
        'vscode.openWith',
        (activeTabInput as { uri: vscode.Uri }).uri,
        'default'
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('notion-md.openNotionView', async () => {
      const activeTabInput = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      if (!activeTabInput || typeof activeTabInput !== 'object' || !('uri' in activeTabInput)) return;
      await vscode.commands.executeCommand(
        'vscode.openWith',
        (activeTabInput as { uri: vscode.Uri }).uri,
        'notion-md-viewer'
      );
    })
  );
}

export function deactivate(): void {}
```

- [ ] **Step 2: Commit**

```bash
git add src/extension.ts
git commit -m "feat: add extension entry point and command registrations"
```

---

### Task 10: Build and smoke test

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: All 13 tests pass (7 callout + 6 toggle). Zero failures.

- [ ] **Step 2: Build the extension**

```bash
npm run compile
```

Expected: No TypeScript errors. `dist/extension.js` and `dist/webview.js` created.

- [ ] **Step 3: Verify dist output**

```bash
ls dist/
```

Expected output includes: `extension.js  extension.js.map  webview.js  webview.js.map`

- [ ] **Step 4: Launch the Extension Development Host**

Press `F5` in VS Code (with this project open) to launch the Extension Development Host. Then open any `.md` file.

Verify each of the following works:
- File opens in Notion view by default (no raw Markdown visible)
- `# Heading` renders large and serif; `## Heading` slightly smaller
- Clicking a paragraph makes it editable inline
- `> [!NOTE] 💡 My note` renders as a yellow callout box
- `<details><summary>Title</summary>content</details>` renders as a collapsible toggle
- ` ```typescript` renders a syntax-highlighted code block
- `- [ ] task` renders an interactive checkbox
- The "⌨ View Source" button reopens the file in the default text editor
- The theme button cycles: Auto → Light → Dark → Auto
- Editing text and pressing Cmd+S saves the file (check the raw `.md` file to confirm)

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "chore: finalize build output and complete smoke test"
```

---

## Self-Review Notes

**Spec coverage confirmed:**
- Opens by default → `CustomTextEditorProvider` with `priority: "default"` in Task 1
- Inline editing → Tiptap editor in Task 5
- All 11 block types → Task 5 wires all extensions
- Custom Callout block → Task 3
- Custom Toggle block → Task 4
- Persistent toggle button → `btn-source` in Tasks 7 & 8 HTML
- Theme sync + override → Tasks 6, 7, 8
- Edit debounce + WorkspaceEdit → Task 8
- External change guard (`_isApplyingEdit`) → Task 8
- postMessage protocol (init/update/edit/themeChange) → Tasks 7 & 8
- Build pipeline → Task 1

**Type consistency confirmed:**
- `ThemeSetting` exported from `theme.ts`, imported in `index.ts` ✅
- `calloutToMarkdown` / `parseCalloutLine` exported from `callout.ts`, imported in tests ✅
- `toggleToMarkdown` / `parseToggleSummary` exported from `toggle.ts`, imported in tests ✅
- `OnChangeCallback` defined and consumed within `editor.ts` ✅
- `createEditor` / `updateContent` exported from `editor.ts`, imported in `index.ts` ✅
