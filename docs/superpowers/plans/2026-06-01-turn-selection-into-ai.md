# Turn selection into… (using AI) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a multi-block selection action that generates a ready-to-paste prompt for a file-aware AI tool — carrying the app's exact board/table/mermaid grammar and a file/anchor reference — so the AI edits the file directly and the output round-trips.

**Architecture:** A pure, unit-tested prompt-builder module (`aiTransforms.ts`) plus pure selection helpers (`aiSelection.ts`) hold all logic. A DOM panel (`aiTransformPanel.ts`) renders the result. The existing bubble menu (`bubbleMenu.ts`) gets a ✨ AI button and a "Using AI" section that gather selection context and open the panel. The host exposes the workspace-relative document path via the `init` message and gains a `copyText` clipboard handler. No network, no API — clipboard out only.

**Tech Stack:** TypeScript, TipTap (ProseMirror), tiptap-markdown, VS Code webview/extension-host messaging, Jest + ts-jest (node env, `tsconfig.webview.json`).

**Spec:** `docs/superpowers/specs/2026-06-01-turn-selection-into-ai-design.md`

---

## File Structure

- **Create** `src/webview/aiTransforms.ts` — types (`AiTarget`, `AiInsertMode`, `AiPromptContext`), format-spec constants, the `AI_TRANSFORMS` registry, and the pure `buildPrompt(ctx)` function. No editor/DOM imports → unit-testable in node.
- **Create** `src/webview/aiSelection.ts` — pure helpers: `summarizeSelection(text)`, `formatSummary(s)`, `locateAnchors(md, startText, endText)`, `truncateAnchor(text)`.
- **Create** `src/webview/docContext.ts` — tiny shared webview state: `setDocumentPath/getDocumentPath` + `copyToClipboard(text)` (posts to host). Avoids an `index.ts ↔ editor.ts ↔ bubbleMenu.ts` import cycle.
- **Create** `src/webview/aiTransformPanel.ts` — the panel DOM/controller: `createAiTransformPanel()` → `{ open(input) }`.
- **Modify** `src/webview/bubbleMenu.ts` — add the ✨ AI toolbar button, the AI target list, the "Using AI" section in the existing "Turn into" panel, and the glue that builds `AiPromptContext` from the live selection and opens the panel.
- **Modify** `src/webview/index.ts` — on `init`, store the document path via `docContext.setDocumentPath`.
- **Modify** `src/mdEditorPlusProvider.ts` — add `documentPath` to the `init` payload; add a `copyText` message handler.
- **Modify** `src/webview/styles/editor.css` — styles for the ✨ button, the AI list, the "Using AI" divider, and the panel.
- **Create** `tests/ai/buildPrompt.test.ts`, `tests/ai/aiSelection.test.ts` — unit tests.

---

## Task 1: Pure prompt-builder module (`aiTransforms.ts`)

**Files:**
- Create: `src/webview/aiTransforms.ts`
- Test: `tests/ai/buildPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ai/buildPrompt.test.ts`:

```typescript
import { buildPrompt, AI_TRANSFORMS, type AiPromptContext } from '../../src/webview/aiTransforms';

const base: AiPromptContext = {
  filePath: 'notes/q2-launch.md',
  target: 'table',
  mode: 'replace',
  startLine: 20,
  endLine: 23,
  startText: 'Draft press release — Maya, Fri',
  endText: 'Set up analytics — Dev, Thu',
};

describe('AI_TRANSFORMS registry', () => {
  it('registers exactly the three phase-1 targets', () => {
    expect(AI_TRANSFORMS.map(t => t.id)).toEqual(['table', 'kanban', 'mermaid']);
  });
  it('every entry has a label, iconHtml and target', () => {
    for (const t of AI_TRANSFORMS) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.iconHtml).toContain('<svg');
      expect(['table', 'kanban', 'mermaid']).toContain(t.target);
    }
  });
});

describe('buildPrompt — shared parts', () => {
  it('names the file', () => {
    expect(buildPrompt(base)).toContain('notes/q2-launch.md');
  });
  it('includes both anchors with line hints and text', () => {
    const p = buildPrompt(base);
    expect(p).toContain('line 20');
    expect(p).toContain('Draft press release — Maya, Fri');
    expect(p).toContain('line 23');
    expect(p).toContain('Set up analytics — Dev, Thu');
  });
  it('omits the line number when it is null but keeps the text anchor', () => {
    const p = buildPrompt({ ...base, startLine: null });
    expect(p).toContain('Draft press release — Maya, Fri');
    expect(p).not.toMatch(/about line null/);
  });
  it('uses replace wording for replace mode', () => {
    expect(buildPrompt(base)).toMatch(/Replace that entire section/i);
  });
  it('uses add wording for add mode', () => {
    expect(buildPrompt({ ...base, mode: 'add' })).toMatch(/immediately after it, leaving the original/i);
  });
  it('always carries the content-handling rule and the no-chatter rule', () => {
    const p = buildPrompt(base);
    expect(p).toMatch(/Never silently drop content/i);
    expect(p).toMatch(/reply with nothing else/i);
  });
});

describe('buildPrompt — per-target format spec', () => {
  it('table → GFM pipe table spec', () => {
    const p = buildPrompt({ ...base, target: 'table' });
    expect(p).toContain('| Title | Status |');
    expect(p).toContain('|---|');
  });
  it('kanban → board markers and allowed values', () => {
    const p = buildPrompt({ ...base, target: 'kanban' });
    expect(p).toContain('<!-- board:start');
    expect(p).toContain('<!-- board:end -->');
    expect(p).toContain('<!-- board:body id=');
    expect(p).toContain('text, status, date, person, tags');
    expect(p).toContain('gray, blue, amber, emerald, red, purple');
  });
  it('mermaid → fenced mermaid block', () => {
    const p = buildPrompt({ ...base, target: 'mermaid' });
    expect(p).toContain('```mermaid');
    expect(p).toContain('flowchart');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/ai/buildPrompt.test.ts`
Expected: FAIL — `Cannot find module '../../src/webview/aiTransforms'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/webview/aiTransforms.ts`:

```typescript
// Pure prompt-builder for "Turn selection into… (using AI)".
// No editor/DOM imports — must stay unit-testable in the node jest env.

export type AiTarget = 'table' | 'kanban' | 'mermaid';
export type AiInsertMode = 'replace' | 'add';

export interface AiPromptContext {
  /** Workspace-relative path of the file being edited. */
  filePath: string;
  target: AiTarget;
  mode: AiInsertMode;
  /** 1-based source line of the first selected line; null when unknown. */
  startLine: number | null;
  /** 1-based source line of the last selected line; null when unknown. */
  endLine: number | null;
  /** Plain text of the first selected line (the primary locator). */
  startText: string;
  /** Plain text of the last selected line. */
  endText: string;
}

export interface AiTransform {
  id: AiTarget;
  label: string;
  iconHtml: string;
  target: AiTarget;
}

// A simple 4-point sparkle (viewBox 0 0 256 256), fill currentColor.
const SPARKLE =
  '<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor">' +
  '<path d="M128 24 L150 106 L232 128 L150 150 L128 232 L106 150 L24 128 L106 106 Z"/></svg>';
const TABLE_ICON =
  '<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor">' +
  '<path d="M216 40H40a16 16 0 0 0-16 16v144a16 16 0 0 0 16 16h176a16 16 0 0 0 16-16V56a16 16 0 0 0-16-16ZM40 56h64v40H40Zm80 0h96v40h-96ZM40 112h64v40H40Zm0 88v-32h64v32Zm80 0v-32h96v32Zm96-48h-96v-40h96Z"/></svg>';

export const AI_TRANSFORMS: AiTransform[] = [
  { id: 'table',   label: 'Table',         iconHtml: TABLE_ICON, target: 'table' },
  { id: 'kanban',  label: 'Kanban board',  iconHtml: SPARKLE,    target: 'kanban' },
  { id: 'mermaid', label: 'Mermaid diagram', iconHtml: SPARKLE,  target: 'mermaid' },
];

const TARGET_PHRASE: Record<AiTarget, string> = {
  table:   'a markdown table',
  kanban:  'a Kanban board',
  mermaid: 'a Mermaid diagram',
};

const CONTENT_RULE =
  'The selection may reference images (![alt](src)) and contain existing diagrams, ' +
  'tables, or boards. Read each one you can access — open referenced image files ' +
  '(paths are relative to this markdown file) and read diagram/table/board source — ' +
  'and use what they show as context or data when building the result. Represent items ' +
  'as cells or links where they belong; preserve anything you cannot fold in; if an ' +
  'image is unreadable, use its alt text and the link. Never silently drop content.';

const TABLE_SPEC = `Use a standard GitHub-flavored markdown pipe table — a header row, a \`|---|\` separator row, then one row per item:

| Title | Status | Due |
|---|---|---|
| Draft press release | Todo | 2026-06-05 |

In cells: escape literal pipes as \\| and use <br> instead of a newline.`;

const KANBAN_SPEC = `Use EXACTLY this custom board block (the app parses it — do not deviate). The whole region from <!-- board:start --> through <!-- board:end --> is one block:

<!-- board:start id="b-XXXX" name="Board name" columns="Todo|Doing|Done" column-colors="blue|amber|emerald" field-types="Title=text,Status=status,Owner=person,Due=date,id=text" hidden-fields="id" -->

| Title | Status | Owner | Due | id |
|---|---|---|---|---|
| Card title | Doing | @name | 2026-06-01 | c1 |

<!-- board:body id="c1" -->

Optional longer notes for this card.

<!-- board:end -->

Constraints:
- columns="..." are the kanban lanes (pipe-separated). Each card's Status must be EXACTLY one of those column names.
- column-colors: one token per column, same order, from: gray, blue, amber, emerald, red, purple.
- field-types values allowed: text, status, date, person, tags. Keep the hidden id field.
- Every card needs a unique id (c1, c2, …) used in BOTH its table row and its <!-- board:body id="..."  --> block.
- Dates as YYYY-MM-DD; people as @name. In cells escape pipes as \\| and use <br> for newlines.`;

const MERMAID_SPEC = `Use a fenced code block whose language is mermaid — it renders as a live diagram:

\`\`\`mermaid
flowchart TB
    A[Start] --> B[Process]
    B --> C[End]
\`\`\`

Pick the diagram type that best fits the content (flowchart, sequenceDiagram, stateDiagram-v2, gantt, etc.).`;

const FORMAT_SPECS: Record<AiTarget, string> = {
  table:   TABLE_SPEC,
  kanban:  KANBAN_SPEC,
  mermaid: MERMAID_SPEC,
};

function buildWhere(ctx: AiPromptContext): string {
  const anchor = (line: number | null, text: string, edge: 'starts' | 'ends') =>
    line != null
      ? `${edge} at about line ${line} (\`${text}\`)`
      : `${edge} at the line \`${text}\``;
  return (
    `You are editing the file \`${ctx.filePath}\` in this workspace.\n` +
    `In that file, find the section that ${anchor(ctx.startLine, ctx.startText, 'starts')} ` +
    `and ${anchor(ctx.endLine, ctx.endText, 'ends')}.`
  );
}

function buildInstruction(ctx: AiPromptContext): string {
  const phrase = TARGET_PHRASE[ctx.target];
  return ctx.mode === 'replace'
    ? `Replace that entire section with ${phrase} built from its content.`
    : `Insert ${phrase} built from that section's content immediately after it, leaving the original text in place.`;
}

export function buildPrompt(ctx: AiPromptContext): string {
  return [
    buildWhere(ctx),
    buildInstruction(ctx),
    FORMAT_SPECS[ctx.target],
    `Rules:\n- ${CONTENT_RULE}\n- Edit the file directly; reply with nothing else.`,
  ].join('\n\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/ai/buildPrompt.test.ts`
Expected: PASS (all assertions green).

- [ ] **Step 5: Commit**

```bash
git add src/webview/aiTransforms.ts tests/ai/buildPrompt.test.ts
git commit -m "feat(ai): pure prompt-builder + AI_TRANSFORMS registry for turn-into-AI"
```

---

## Task 2: Pure selection helpers (`aiSelection.ts`)

**Files:**
- Create: `src/webview/aiSelection.ts`
- Test: `tests/ai/aiSelection.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ai/aiSelection.test.ts`:

```typescript
import {
  summarizeSelection,
  formatSummary,
  locateAnchors,
  truncateAnchor,
} from '../../src/webview/aiSelection';

describe('summarizeSelection', () => {
  it('counts lines and words', () => {
    expect(summarizeSelection('one two\nthree')).toEqual({ lines: 2, words: 3 });
  });
  it('handles empty text', () => {
    expect(summarizeSelection('')).toEqual({ lines: 0, words: 0 });
  });
  it('ignores blank lines for the line count but counts words', () => {
    expect(summarizeSelection('a\n\n b ')).toEqual({ lines: 2, words: 2 });
  });
});

describe('formatSummary', () => {
  it('renders the count line', () => {
    expect(formatSummary({ lines: 23, words: 340 })).toBe('Converting 23 lines · ~340 words');
  });
  it('uses singular for one line', () => {
    expect(formatSummary({ lines: 1, words: 4 })).toBe('Converting 1 line · ~4 words');
  });
});

describe('locateAnchors', () => {
  const md = ['# Title', '', '- Draft press release', '- Brief sales', '- Set up analytics'].join('\n');
  it('finds 1-based line numbers by substring match', () => {
    expect(locateAnchors(md, 'Draft press release', 'Set up analytics'))
      .toEqual({ startLine: 3, endLine: 5 });
  });
  it('returns null when a line is not found', () => {
    expect(locateAnchors(md, 'nope', 'Set up analytics'))
      .toEqual({ startLine: null, endLine: 5 });
  });
});

describe('truncateAnchor', () => {
  it('passes short text through', () => {
    expect(truncateAnchor('short line')).toBe('short line');
  });
  it('truncates long text with an ellipsis', () => {
    const long = 'x'.repeat(100);
    const out = truncateAnchor(long);
    expect(out.length).toBeLessThanOrEqual(81);
    expect(out.endsWith('…')).toBe(true);
  });
  it('collapses internal whitespace/newlines', () => {
    expect(truncateAnchor('a\n  b\tc')).toBe('a b c');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/ai/aiSelection.test.ts`
Expected: FAIL — `Cannot find module '../../src/webview/aiSelection'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/webview/aiSelection.ts`:

```typescript
// Pure helpers for deriving prompt context from a selection. No DOM/editor imports.

export interface SelectionSummary {
  lines: number;
  words: number;
}

export function summarizeSelection(text: string): SelectionSummary {
  const lines = text.split('\n').filter(l => l.trim().length > 0).length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return { lines, words };
}

export function formatSummary(s: SelectionSummary): string {
  const lineWord = s.lines === 1 ? 'line' : 'lines';
  return `Converting ${s.lines} ${lineWord} · ~${s.words} words`;
}

export function locateAnchors(
  md: string,
  startText: string,
  endText: string,
): { startLine: number | null; endLine: number | null } {
  const lines = md.split('\n');
  const find = (needle: string): number | null => {
    if (!needle) return null;
    const idx = lines.findIndex(l => l.includes(needle));
    return idx === -1 ? null : idx + 1;
  };
  return { startLine: find(startText), endLine: find(endText) };
}

export function truncateAnchor(text: string, max = 80): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : collapsed.slice(0, max) + '…';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/ai/aiSelection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/aiSelection.ts tests/ai/aiSelection.test.ts
git commit -m "feat(ai): pure selection summary + anchor-location helpers"
```

---

## Task 3: Shared webview doc-context module (`docContext.ts`)

**Files:**
- Create: `src/webview/docContext.ts`

No unit test (thin global state + postMessage glue; covered by manual verification in Task 8).

- [ ] **Step 1: Create the module**

Create `src/webview/docContext.ts`:

```typescript
// Small shared state for webview modules that need the current document's
// path or want to copy text via the extension host. Kept separate from
// index.ts/editor.ts to avoid an import cycle with bubbleMenu.ts.

let _documentPath = '';

export function setDocumentPath(p: string): void {
  _documentPath = p || '';
}

export function getDocumentPath(): string {
  return _documentPath;
}

export function copyToClipboard(text: string): void {
  const vs = (window as unknown as {
    __mdViewerVscode?: { postMessage: (m: unknown) => void };
  }).__mdViewerVscode;
  vs?.postMessage({ type: 'copyText', text });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.webview.json --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/webview/docContext.ts
git commit -m "feat(ai): shared webview doc-context + clipboard bridge"
```

---

## Task 4: Host exposes document path + clipboard handler

**Files:**
- Modify: `src/mdEditorPlusProvider.ts` (the `init` payload ~lines 105-127; the message handler block ~lines 138-328)
- Modify: `src/webview/index.ts` (the `init` message handler ~lines 54-61 bridge is already there; add storage on init)

- [ ] **Step 1: Add `documentPath` to the `init` payload**

In `src/mdEditorPlusProvider.ts`, inside the `sendInit` payload object (alongside `markdown` and `mediaBaseUri`), add:

```typescript
      documentPath: vscode.workspace.asRelativePath(document.uri),
```

- [ ] **Step 2: Add the `copyText` host handler**

In `src/mdEditorPlusProvider.ts`, in the `onDidReceiveMessage` handler chain (next to the existing `copyContent` / `copyFilePath` handlers), add:

```typescript
      if (msg.type === 'copyText' && typeof msg.text === 'string') {
        await vscode.env.clipboard.writeText(msg.text);
        await vscode.window.showInformationMessage('AI prompt copied to clipboard');
        return;
      }
```

(If the handler uses a `switch`, add a `case 'copyText':` mirroring the surrounding cases instead. Match the file's existing style.)

- [ ] **Step 3: Store the path on the webview side**

In `src/webview/index.ts`, find where incoming messages are handled (the `window.addEventListener('message', …)` block that switches on `msg.type === 'init'`). In the `init` branch, add:

```typescript
      // existing init handling (markdown, mediaBaseUri, defaults) stays…
      setDocumentPath(msg.documentPath ?? '');
```

And add the import at the top of `src/webview/index.ts`:

```typescript
import { setDocumentPath } from './docContext';
```

- [ ] **Step 4: Type-check and build**

Run: `npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.webview.json --noEmit`
Expected: no new errors. (If `msg` is typed narrowly on the host, widen the local type or cast `msg as { type: string; text?: string }` consistent with neighboring handlers.)

- [ ] **Step 5: Commit**

```bash
git add src/mdEditorPlusProvider.ts src/webview/index.ts
git commit -m "feat(ai): expose workspace-relative doc path + copyText clipboard handler"
```

---

## Task 5: The AI transform panel (`aiTransformPanel.ts`)

**Files:**
- Create: `src/webview/aiTransformPanel.ts`

DOM controller; verified manually in Task 8.

- [ ] **Step 1: Create the panel module**

Create `src/webview/aiTransformPanel.ts`:

```typescript
import {
  buildPrompt,
  type AiTarget,
  type AiInsertMode,
  type AiPromptContext,
} from './aiTransforms';
import { formatSummary, type SelectionSummary } from './aiSelection';
import { copyToClipboard } from './docContext';

export interface AiPanelInput {
  target: AiTarget;
  targetLabel: string;
  filePath: string;
  startText: string;
  endText: string;
  startLine: number | null;
  endLine: number | null;
  summary: SelectionSummary;
}

export interface AiTransformPanel {
  open(input: AiPanelInput): void;
}

export function createAiTransformPanel(): AiTransformPanel {
  const el = document.createElement('div');
  el.className = 'ai-panel';
  el.style.display = 'none';
  el.innerHTML = `
    <div class="ai-panel-head">
      <span class="ai-panel-title"></span>
      <button class="ai-panel-close" data-ai-act="close" aria-label="Close">✕</button>
    </div>
    <div class="ai-panel-summary"></div>
    <div class="ai-panel-mode">
      <button class="ai-mode-btn" data-ai-mode="replace">↻ Replace selection</button>
      <button class="ai-mode-btn" data-ai-mode="add">＋ Add below (keep original)</button>
    </div>
    <details class="ai-panel-prompt-wrap">
      <summary>Prompt (format spec + file reference)</summary>
      <textarea class="ai-panel-prompt" spellcheck="false"></textarea>
    </details>
    <ol class="ai-panel-steps">
      <li><b>Copy</b> the prompt.</li>
      <li><b>Paste it into your file-aware AI</b> (Claude Code, Cursor, the VS Code AI).</li>
      <li>It <b>edits the file</b> — your viewer re-renders with the result.</li>
    </ol>
    <div class="ai-panel-foot">
      <button class="ai-panel-btn" data-ai-act="edit">Edit prompt</button>
      <button class="ai-panel-btn ai-panel-btn-primary" data-ai-act="copy">📋 Copy prompt</button>
    </div>
  `;
  document.body.appendChild(el);

  const titleEl   = el.querySelector<HTMLElement>('.ai-panel-title')!;
  const summaryEl = el.querySelector<HTMLElement>('.ai-panel-summary')!;
  const promptEl  = el.querySelector<HTMLTextAreaElement>('.ai-panel-prompt')!;
  const copyBtn   = el.querySelector<HTMLElement>('[data-ai-act="copy"]')!;
  const modeBtns  = Array.from(el.querySelectorAll<HTMLElement>('[data-ai-mode]'));

  let current: AiPanelInput | null = null;
  let mode: AiInsertMode = 'replace';

  function ctx(): AiPromptContext {
    return {
      filePath: current!.filePath,
      target:   current!.target,
      mode,
      startLine: current!.startLine,
      endLine:   current!.endLine,
      startText: current!.startText,
      endText:   current!.endText,
    };
  }

  function render(): void {
    if (!current) return;
    titleEl.textContent = `✨ Turn selection into ${current.targetLabel} — using AI`;
    summaryEl.textContent = formatSummary(current.summary);
    promptEl.value = buildPrompt(ctx());
    modeBtns.forEach(b =>
      b.classList.toggle('active', b.dataset.aiMode === mode),
    );
  }

  function close(): void {
    el.style.display = 'none';
    current = null;
  }

  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const modeBtn = target.closest<HTMLElement>('[data-ai-mode]');
    if (modeBtn) {
      mode = modeBtn.dataset.aiMode as AiInsertMode;
      render();
      return;
    }
    const actBtn = target.closest<HTMLElement>('[data-ai-act]');
    if (!actBtn) return;
    switch (actBtn.dataset.aiAct) {
      case 'close': close(); break;
      case 'edit':
        (el.querySelector('.ai-panel-prompt-wrap') as HTMLDetailsElement).open = true;
        promptEl.focus();
        break;
      case 'copy': {
        copyToClipboard(promptEl.value);
        const prev = copyBtn.textContent;
        copyBtn.textContent = '✓ Copied';
        setTimeout(() => { copyBtn.textContent = prev; }, 1500);
        break;
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.style.display !== 'none') close();
  });

  return {
    open(input: AiPanelInput): void {
      current = input;
      mode = 'replace';
      render();
      el.style.display = 'block';
    },
  };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.webview.json --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/webview/aiTransformPanel.ts
git commit -m "feat(ai): AI transform panel (summary, replace/add toggle, prompt, copy)"
```

---

## Task 6: Wire the bubble menu (✨ button + "Using AI" section + glue)

**Files:**
- Modify: `src/webview/bubbleMenu.ts`

- [ ] **Step 1: Add imports**

At the top of `src/webview/bubbleMenu.ts`, after the existing imports, add:

```typescript
import { AI_TRANSFORMS, type AiTarget } from './aiTransforms';
import { createAiTransformPanel } from './aiTransformPanel';
import { summarizeSelection, locateAnchors, truncateAnchor } from './aiSelection';
import { getDocumentPath } from './docContext';
```

- [ ] **Step 2: Add the ✨ AI button to the second toolbar row**

In `buildEl()`, in the second `.bubble-row` (the one containing `data-action="more"`), add an AI button right after the `more` button (before the closing `</div>` of that row):

```typescript
      <button class="bm-btn bm-ai-btn" data-action="ai" data-tip="Turn into… using AI">${svg('M128 24 L150 106 L232 128 L150 150 L128 232 L106 150 L24 128 L106 106 Z', 20)}</button>
```

- [ ] **Step 3: Add the AI target list panel and the "Using AI" section markup**

In `buildEl()`, immediately after the `<div class="bubble-into hidden" id="bm-into">…</div>` block, add a second panel for the ✨ button:

```typescript
    <div class="bubble-ai hidden" id="bm-ai">
      <div class="bubble-into-title">Turn selection into — using AI</div>
      <div class="bubble-into-list">${aiListHtml()}</div>
    </div>
```

And inside the existing `bubble-into` panel, append the "Using AI" group at the end of its `.bubble-into-list` — change that list line to:

```typescript
      <div class="bubble-into-list">${turnIntoHtml()}<div class="bm-into-divider"></div><div class="bm-into-sublabel">✨ Using AI</div>${aiListHtml('ai-into')}</div>
```

Then add this helper near `turnIntoHtml()`:

```typescript
function aiListHtml(attr = 'ai'): string {
  return AI_TRANSFORMS.map(t =>
    `<button class="bm-into-item" data-${attr}="${t.id}">
      <span class="bm-into-icon">${t.iconHtml}</span>
      <span class="bm-into-label">${t.label}</span>
    </button>`
  ).join('');
}
```

- [ ] **Step 4: Add panel handle, glue function, and open/close logic in `createBubbleMenu`**

In `createBubbleMenu`, after the existing `const intoPanel = …;` line, add:

```typescript
  const aiPanel = el.querySelector<HTMLElement>('#bm-ai')!;
  const aiBtn   = el.querySelector<HTMLElement>('[data-action="ai"]')!;
  const aiTransformPanel = createAiTransformPanel();
```

Add a `closeAi()` next to `closeInto()`:

```typescript
  function closeAi(): void {
    aiPanel.classList.add('hidden');
    aiBtn.classList.remove('active');
  }
```

Add the context-builder + opener (place it after `unhighlightBlock()`):

```typescript
  function openAiPanel(target: AiTarget, label: string): void {
    const { from, to } = editor.state.selection;
    const slice = editor.state.doc.textBetween(from, to, '\n', '\n');
    const nonEmpty = slice.split('\n').filter(l => l.trim().length > 0);
    const startRaw = nonEmpty[0] ?? '';
    const endRaw   = nonEmpty[nonEmpty.length - 1] ?? startRaw;
    const startText = truncateAnchor(startRaw);
    const endText   = truncateAnchor(endRaw);
    // Best-effort line numbers from the editor's own markdown (frontmatter
    // excluded; line numbers are a hint — the text anchor is the real locator).
    const md = editor.storage.markdown.getMarkdown() as string;
    const { startLine, endLine } = locateAnchors(md, startText, endText);
    aiTransformPanel.open({
      target,
      targetLabel: label,
      filePath: getDocumentPath() || 'this file',
      startText,
      endText,
      startLine,
      endLine,
      summary: summarizeSelection(slice),
    });
    closeAi();
    closeInto();
  }
```

- [ ] **Step 5: Handle clicks for the AI list items and the ✨ button**

In the `el.addEventListener('click', e => { … })` handler, at the very top (before the existing `intoItem` block), add handling for AI items:

```typescript
    // AI turn-into item clicked? (from either the ✨ panel or the "Using AI" group)
    const aiItem = target.closest<HTMLElement>('[data-ai], [data-ai-into]');
    if (aiItem) {
      e.stopPropagation();
      const tgt = (aiItem.dataset.ai ?? aiItem.dataset.aiInto) as AiTarget;
      const def = AI_TRANSFORMS.find(t => t.id === tgt);
      if (def) openAiPanel(def.id, def.label);
      return;
    }
```

In the same handler's `switch (btn.dataset.action)`, add an `ai` case mirroring `more`:

```typescript
      case 'ai': {
        closeSwatch();
        closeInto();
        const open = !aiPanel.classList.contains('hidden');
        if (!open) { aiPanel.classList.remove('hidden'); aiBtn.classList.add('active'); }
        else closeAi();
        break;
      }
```

And in the existing `more` case, after `closeSwatch();` add `closeAi();` so the two panels are mutually exclusive.

- [ ] **Step 6: Close the AI panel when the selection empties**

In the `editor.on('transaction', …)` block, inside the `if (e.state.selection.empty) {` branch, add:

```typescript
      closeAi();
```

- [ ] **Step 7: Build to verify the webview compiles**

Run: `npx tsc -p tsconfig.webview.json --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/webview/bubbleMenu.ts
git commit -m "feat(ai): bubble-menu ✨ AI button + Using AI section, wired to the panel"
```

---

## Task 7: Styles for the ✨ button, AI list, and panel

**Files:**
- Modify: `src/webview/styles/editor.css`

- [ ] **Step 1: Add CSS**

Append to `src/webview/styles/editor.css` (reuse existing bubble-menu variables/looks; match `.bubble-into` conventions):

```css
/* ── Turn into… using AI ─────────────────────────────────────────────── */
.bubble-ai.hidden { display: none; }
.bubble-ai { padding: 4px; }
.bm-ai-btn.active { color: var(--accent, #6b4ad4); }

.bm-into-divider {
  height: 1px;
  background: var(--bm-border, rgba(128,128,128,0.25));
  margin: 6px 4px;
}
.bm-into-sublabel {
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.6;
  padding: 2px 8px;
}

.ai-panel {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(560px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  overflow: auto;
  background: var(--bg, #fff);
  color: var(--fg, #1d1d1f);
  border: 1px solid var(--bm-border, rgba(128,128,128,0.25));
  border-radius: 14px;
  box-shadow: 0 12px 48px rgba(0,0,0,0.28);
  z-index: 9999;
  padding: 0;
}
.ai-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--bm-border, rgba(128,128,128,0.2));
}
.ai-panel-title { font-size: 14px; font-weight: 700; }
.ai-panel-close { background: none; border: none; cursor: pointer; font-size: 15px; opacity: 0.5; color: inherit; }
.ai-panel-close:hover { opacity: 1; }
.ai-panel-summary { padding: 12px 16px 4px; font-size: 12px; opacity: 0.7; }
.ai-panel-mode { display: flex; gap: 8px; padding: 8px 16px; }
.ai-mode-btn {
  flex: 1; padding: 8px; font-size: 12px; cursor: pointer;
  border: 1px solid var(--bm-border, rgba(128,128,128,0.3));
  border-radius: 8px; background: transparent; color: inherit;
}
.ai-mode-btn.active {
  border-color: #2f9f5f;
  background: rgba(47,159,95,0.12);
  font-weight: 600;
}
.ai-panel-prompt-wrap { padding: 4px 16px; }
.ai-panel-prompt-wrap > summary { font-size: 12px; cursor: pointer; opacity: 0.7; padding: 6px 0; }
.ai-panel-prompt {
  width: 100%; box-sizing: border-box; min-height: 160px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
  border: 1px solid var(--bm-border, rgba(128,128,128,0.3)); border-radius: 8px;
  padding: 10px; background: var(--code-bg, rgba(128,128,128,0.06)); color: inherit;
  resize: vertical;
}
.ai-panel-steps { margin: 8px 16px; padding-left: 20px; font-size: 12.5px; line-height: 1.6; opacity: 0.85; }
.ai-panel-foot {
  display: flex; gap: 8px; justify-content: flex-end;
  padding: 12px 16px; border-top: 1px solid var(--bm-border, rgba(128,128,128,0.2));
}
.ai-panel-btn {
  padding: 8px 14px; font-size: 12px; cursor: pointer;
  border: 1px solid var(--bm-border, rgba(128,128,128,0.3)); border-radius: 8px;
  background: transparent; color: inherit;
}
.ai-panel-btn-primary { background: #2f9f5f; border-color: #2f9f5f; color: #fff; font-weight: 600; }
```

(If the codebase defines theme variables under different names than `--bg`/`--fg`/`--accent`/`--bm-border`, substitute the project's actual variable names — grep `editor.css` for the existing bubble-menu colors and reuse them.)

- [ ] **Step 2: Commit**

```bash
git add src/webview/styles/editor.css
git commit -m "style(ai): panel, ✨ button, and Using AI section styling"
```

---

## Task 8: Full build + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Full type-check + bundle**

Run: `npm run compile`
Expected: completes with no errors.

- [ ] **Step 2: Run the whole test suite**

Run: `npm test`
Expected: all tests pass, including the two new `tests/ai/*.test.ts` files.

- [ ] **Step 3: Manual smoke test in the Extension Development Host**

Launch the extension (F5 / "Run Extension"), open a markdown file, then verify:
- Select several lines → bubble menu appears → a ✨ AI button is present in the second row.
- Click ✨ → a panel lists Table / Kanban board / Mermaid diagram.
- Open the "Turn into" (⋯) list → a **✨ Using AI** group with the same three appears under a divider.
- Pick **Table** → the panel opens showing *"Converting N lines · ~M words"*, a Replace/Add toggle (Replace active), an expandable prompt, the 3 steps, and Copy.
- Expand the prompt → it names the file (workspace-relative), shows both anchors (line + text), the GFM table spec, the content-handling rule, and "reply with nothing else".
- Toggle to **Add** → the instruction line changes to "insert … immediately after it, leaving the original".
- Click **Copy prompt** → button flashes "✓ Copied"; VS Code shows "AI prompt copied to clipboard"; paste elsewhere confirms the prompt text.
- Repeat for **Kanban** (board markers + allowed value lists present) and **Mermaid** (```mermaid block present).
- Press Escape or ✕ → panel closes; clearing the selection closes both bubble panels.

- [ ] **Step 4: Commit any fixes found during smoke test**

```bash
git add -A
git commit -m "fix(ai): address issues found during manual verification"
```

(Skip if nothing needed fixing.)

---

## Notes for the implementer

- **Frontmatter line offset:** `editor.storage.markdown.getMarkdown()` excludes frontmatter, so `startLine`/`endLine` can be off by the frontmatter's line count when the file has frontmatter. This is acceptable — the design treats line numbers as a *hint* and the verbatim text anchor as the primary locator. Do not add complexity to fix this in Phase 1.
- **Atom-node selections (boards):** boards may not be partially selectable; if `textBetween` returns little for such a selection, the anchors still work on whatever text is captured. No special handling required for Phase 1.
- **Phase 2** (Summary / Action items / Outline / Timeline) extends `AI_TRANSFORMS` and `FORMAT_SPECS` with simpler plain-markdown specs and surfaces them under the same ✨ button — out of scope here.
- When the board-parse-bug fix lands in the other session, re-verify the Kanban `KANBAN_SPEC` example still matches the corrected on-disk grammar.
```
