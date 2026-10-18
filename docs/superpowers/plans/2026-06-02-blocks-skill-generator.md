# Blocks Skill Generator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A ⋯-menu action that generates a Claude **Skill** (`SKILL.md`) documenting MD Editor Plus's exact block grammar (Kanban/Table boards, Mermaid, Callouts, Toggles), and installs it (project or global `.claude/skills/`) or downloads it.

**Architecture:** One pure module (`blockFormatReference`) is the single source of truth for each block's grammar example + rules. A pure `skillBuilder` assembles `SKILL.md` from the selected blocks. A DOM `skillPanel` (checkboxes + destination) opens from the ⋯ menu. Host handlers write the file (project / `~/.claude/skills` / Save dialog). The existing ✨ prompt specs in `aiTransforms.ts` are refactored to read the board/mermaid grammar from the same reference so they can't drift.

**Tech Stack:** TypeScript, TipTap webview + VS Code extension host, Jest + ts-jest (node env, `tsconfig.webview.json`).

**Spec:** `docs/superpowers/specs/2026-06-02-blocks-skill-generator-design.md`

---

## File Structure

- **Create** `src/webview/blockFormatReference.ts` — pure. `BlockId` + `BLOCK_REFERENCES` (per block: title, whatItIs, example, rules). Single source of truth. No DOM/editor imports.
- **Create** `src/webview/skillBuilder.ts` — pure. `buildSkill(blockIds)` → `{ folderName, skillMd }`.
- **Create** `src/webview/skillPanel.ts` — DOM. `createSkillPanel(opts)` → `{ open() }`: block checkboxes + destination (Project/Global/Download) + confirm; posts host messages.
- **Modify** `src/webview/aiTransforms.ts` — board + mermaid specs derive their example/tokens from `blockFormatReference` (DRY).
- **Modify** `src/mdEditorPlusProvider.ts` — add `installSkill` + `downloadSkill` message handlers; add the "Create blocks skill…" button to the actions-menu HTML.
- **Modify** `src/webview/index.ts` — wire the new menu button to open `skillPanel`.
- **Modify** `src/webview/styles/editor.css` — styles for `skillPanel` (reuse `.ai-panel*` conventions).
- **Create** tests `tests/skill/blockFormatReference.test.ts`, `tests/skill/skillBuilder.test.ts`.

Pre-existing condition: `npx tsc -p tsconfig.webview.json --noEmit` already reports 4 errors in `toggle.ts` (3) and `sourceBubbleMenu.ts` (1); `tests/toggle.test.ts` fails to compile for the same reason. Ignore those — "no new errors" means nothing beyond those four.

---

## Task 1: `blockFormatReference.ts` — single source of truth

**Files:**
- Create: `src/webview/blockFormatReference.ts`
- Test: `tests/skill/blockFormatReference.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/skill/blockFormatReference.test.ts`:

```typescript
import { BLOCK_REFERENCES, BLOCK_IDS, type BlockId } from '../../src/webview/blockFormatReference';
import { parseBoardSource } from '../../src/webview/boardModel';

describe('BLOCK_REFERENCES', () => {
  it('covers exactly the five block types', () => {
    expect(BLOCK_IDS).toEqual(['kanban', 'table', 'mermaid', 'callout', 'toggle']);
    for (const id of BLOCK_IDS) {
      const r = BLOCK_REFERENCES[id];
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.whatItIs.length).toBeGreaterThan(0);
      expect(r.example.length).toBeGreaterThan(0);
      expect(r.rules.length).toBeGreaterThan(0);
    }
  });

  it('kanban + table examples are real boards that round-trip through the parser', () => {
    for (const id of ['kanban', 'table'] as BlockId[]) {
      const board = parseBoardSource(BLOCK_REFERENCES[id].example);
      expect(board.columns.length).toBeGreaterThanOrEqual(2);
      expect(board.cards.length).toBeGreaterThanOrEqual(2);
      // every card's Status is one of the declared columns
      const cols = board.columns.map(c => c.name);
      for (const card of board.cards) {
        expect(cols).toContain(card.values.Status);
      }
    }
  });

  it('table example declares the table view, kanban does not', () => {
    expect(BLOCK_REFERENCES.table.example).toContain('active-view="table"');
    expect(BLOCK_REFERENCES.kanban.example).not.toContain('active-view="table"');
  });

  it('board rules name the allowed colour and field-type tokens', () => {
    const rules = BLOCK_REFERENCES.kanban.rules.join(' ');
    expect(rules).toMatch(/gray, blue, amber, emerald, red, purple/);
    expect(rules).toMatch(/text, status, date, person, tags/);
  });

  it('mermaid example is a fenced mermaid block', () => {
    expect(BLOCK_REFERENCES.mermaid.example).toContain('```mermaid');
  });

  it('callout example uses a GFM callout header and the five+ types are documented', () => {
    expect(BLOCK_REFERENCES.callout.example).toMatch(/> \[!NOTE\]/);
    const rules = BLOCK_REFERENCES.callout.rules.join(' ');
    expect(rules).toMatch(/NOTE/);
    expect(rules).toMatch(/CAUTION/);
  });

  it('toggle example is a <details>/<summary> block', () => {
    expect(BLOCK_REFERENCES.toggle.example).toContain('<details>');
    expect(BLOCK_REFERENCES.toggle.example).toContain('<summary>');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/skill/blockFormatReference.test.ts`
Expected: FAIL — `Cannot find module '../../src/webview/blockFormatReference'`.

- [ ] **Step 3: Write the implementation**

Create `src/webview/blockFormatReference.ts`:

```typescript
// Single source of truth for MD Editor Plus block grammar. Consumed by BOTH
// the "blocks skill" generator (skillBuilder.ts) and the ✨ AI prompts
// (aiTransforms.ts), so the grammar can never drift between them.
// Pure — no DOM/editor imports (unit-testable in the node jest env).

export type BlockId = 'kanban' | 'table' | 'mermaid' | 'callout' | 'toggle';

export const BLOCK_IDS: BlockId[] = ['kanban', 'table', 'mermaid', 'callout', 'toggle'];

export interface BlockReference {
  id: BlockId;
  title: string;
  whatItIs: string;
  /** A complete, real on-disk example that round-trips through the parser. */
  example: string;
  /** The constraints that make an instance valid. */
  rules: string[];
}

// A board region that parses cleanly (verified by the round-trip test). The
// kanban and table views share the same grammar — only `active-view` differs.
function boardExample(view: 'kanban' | 'table'): string {
  const av = ` active-view="${view}"`;
  return [
    `<!-- board:start id="b1" name="My Board" columns="Todo|Doing|Done" column-colors="blue|amber|emerald" field-types="Title=text,Status=status,Owner=person,Due=date,id=text" hidden-fields="id"${av} -->`,
    ``,
    `| Title | Status | Owner | Due | id |`,
    `|---|---|---|---|---|`,
    `| Write the spec | Doing | @maya | 2026-06-10 | c1 |`,
    `| Review the PR | Todo |  |  | c2 |`,
    ``,
    `<!-- board:body id="c1" -->`,
    ``,
    `Longer notes for this card live here.`,
    ``,
    `<!-- board:end -->`,
  ].join('\n');
}

const BOARD_RULES = [
  'The whole region from `<!-- board:start … -->` through `<!-- board:end -->` is ONE block — do not split it.',
  'Start-marker attributes, in order: `id`, `name`, `columns` (pipe-separated), `column-colors`, `field-types`, `hidden-fields`, optional `active-view`.',
  'Allowed `column-colors` tokens (one per column, same order): gray, blue, amber, emerald, red, purple.',
  'Allowed `field-types` values: text, status, date, person, tags. Keep the hidden `id` field.',
  "Each card's Status MUST be exactly one of the `columns`.",
  'Every card needs a unique `id` (c1, c2, …) used in BOTH its table row and its `<!-- board:body id=\"…\" -->` block.',
  'Dates as `YYYY-MM-DD`; people as `@name`. In table cells, escape pipes as `\\|` and use `<br>` for line breaks.',
];

export const BLOCK_REFERENCES: Record<BlockId, BlockReference> = {
  kanban: {
    id: 'kanban',
    title: 'Kanban board',
    whatItIs: 'A board shown as columns of cards, grouped by a Status field. A custom block the app parses — the exact format below is required.',
    example: boardExample('kanban'),
    rules: BOARD_RULES,
  },
  table: {
    id: 'table',
    title: 'Table board (database view)',
    whatItIs: 'The SAME custom board block as Kanban, shown as a table/database grid (typed fields as columns). It is NOT a plain markdown table — it is the board block with `active-view="table"`.',
    example: boardExample('table'),
    rules: BOARD_RULES,
  },
  mermaid: {
    id: 'mermaid',
    title: 'Mermaid diagram',
    whatItIs: 'A fenced code block with the `mermaid` language; renders as a live diagram.',
    example: [
      '```mermaid',
      'flowchart TB',
      '    A[Start] --> B[Process]',
      '    B --> C[End]',
      '```',
    ].join('\n'),
    rules: [
      'Use a fenced code block whose info string is exactly `mermaid`.',
      'Use standard Mermaid syntax; pick the diagram type that fits (flowchart, sequenceDiagram, stateDiagram-v2, gantt, …).',
      'Do NOT hand-author position/style sidecar comments (`%% mb-positions: …`); the app\'s visual editor manages those automatically.',
    ],
  },
  callout: {
    id: 'callout',
    title: 'Callout',
    whatItIs: 'A GFM-style admonition with a coloured background and an icon.',
    example: [
      '> [!NOTE] 💡',
      '> Body text here. Continuation lines are also prefixed with `>`.',
    ].join('\n'),
    rules: [
      'First line: `> [!TYPE] <emoji>` — TYPE uppercase; the emoji is optional (a sensible default is used per type).',
      'Allowed TYPEs: NOTE, TIP, IMPORTANT, WARNING, CAUTION, INFO.',
      'Every body line is prefixed with `> ` (like a blockquote).',
    ],
  },
  toggle: {
    id: 'toggle',
    title: 'Toggle (collapsible)',
    whatItIs: 'A collapsible section using HTML `<details>` / `<summary>`.',
    example: [
      '<details>',
      '<summary>Click to expand</summary>',
      '',
      'Hidden content goes here — any markdown is allowed.',
      '',
      '</details>',
    ].join('\n'),
    rules: [
      'Use `<details>` with a `<summary>` as the first child (the clickable label).',
      'Leave a blank line after `</summary>` and before `</details>` so the inner markdown parses.',
    ],
  },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/skill/blockFormatReference.test.ts`
Expected: PASS. (If a board example fails to round-trip, fix the example string until `parseBoardSource` returns the columns/cards — the test is the guarantee of "exact format".)

- [ ] **Step 5: Commit**

```bash
git add src/webview/blockFormatReference.ts tests/skill/blockFormatReference.test.ts
git commit -m "feat(skill): blockFormatReference — single source of truth for block grammar"
```

---

## Task 2: `skillBuilder.ts` — assemble `SKILL.md`

**Files:**
- Create: `src/webview/skillBuilder.ts`
- Test: `tests/skill/skillBuilder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/skill/skillBuilder.test.ts`:

```typescript
import { buildSkill } from '../../src/webview/skillBuilder';

describe('buildSkill', () => {
  it('returns the fixed folder name', () => {
    expect(buildSkill(['kanban']).folderName).toBe('md-editor-blocks');
  });

  it('has frontmatter with name and an auto-trigger description', () => {
    const { skillMd } = buildSkill(['kanban', 'table', 'mermaid', 'callout', 'toggle']);
    expect(skillMd.startsWith('---\n')).toBe(true);
    expect(skillMd).toMatch(/^name: md-editor-blocks$/m);
    expect(skillMd).toMatch(/^description: .+/m);
  });

  it('includes a section only for each selected block', () => {
    const { skillMd } = buildSkill(['kanban', 'mermaid']);
    expect(skillMd).toContain('## Kanban board');
    expect(skillMd).toContain('## Mermaid diagram');
    expect(skillMd).not.toContain('## Table board');
    expect(skillMd).not.toContain('## Callout');
    expect(skillMd).not.toContain('## Toggle');
  });

  it('embeds each block example inside a fenced code block', () => {
    const { skillMd } = buildSkill(['kanban']);
    expect(skillMd).toContain('<!-- board:start');
    expect(skillMd).toMatch(/```markdown[\s\S]*<!-- board:end -->[\s\S]*```/);
  });

  it('preserves the order of BLOCK_IDS regardless of input order', () => {
    const { skillMd } = buildSkill(['toggle', 'kanban']);
    expect(skillMd.indexOf('## Kanban board')).toBeLessThan(skillMd.indexOf('## Toggle'));
  });

  it('ignores duplicates and is stable', () => {
    expect(buildSkill(['kanban', 'kanban']).skillMd).toBe(buildSkill(['kanban']).skillMd);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/skill/skillBuilder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/webview/skillBuilder.ts`:

```typescript
import { BLOCK_IDS, BLOCK_REFERENCES, type BlockId } from './blockFormatReference';

export interface BuiltSkill {
  folderName: string;
  skillMd: string;
}

const FOLDER_NAME = 'md-editor-blocks';
const DESCRIPTION =
  'Use when creating or editing Kanban/Table boards, Mermaid diagrams, callouts, ' +
  'or toggles in markdown files for MD Editor Plus. Provides the exact block ' +
  'grammar so they render correctly instead of as raw text.';

// A block example is itself fenced markdown; wrap it in a ```markdown fence,
// and bump any inner ``` to ~~~~ so the outer fence isn't broken by mermaid's
// triple-backticks.
function fenceExample(example: string): string {
  const inner = example.replace(/```/g, '~~~~');
  return '```markdown\n' + inner + '\n```';
}

function section(id: BlockId): string {
  const r = BLOCK_REFERENCES[id];
  const rules = r.rules.map((x) => `- ${x}`).join('\n');
  return [
    `## ${r.title}`,
    ``,
    r.whatItIs,
    ``,
    `**Example:**`,
    ``,
    fenceExample(r.example),
    ``,
    `**Rules:**`,
    ``,
    rules,
  ].join('\n');
}

export function buildSkill(blockIds: BlockId[]): BuiltSkill {
  // Normalise: dedupe + restore canonical order, ignore anything unknown.
  const selected = BLOCK_IDS.filter((id) => blockIds.includes(id));
  const body = selected.map(section).join('\n\n');
  const skillMd =
    `---\n` +
    `name: ${FOLDER_NAME}\n` +
    `description: ${DESCRIPTION}\n` +
    `---\n\n` +
    `# MD Editor Plus — block formats\n\n` +
    `These are the exact on-disk formats MD Editor Plus needs so each block ` +
    `renders instead of showing as raw text. Reproduce them precisely.\n\n` +
    body +
    `\n`;
  return { folderName: FOLDER_NAME, skillMd };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/skill/skillBuilder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/skillBuilder.ts tests/skill/skillBuilder.test.ts
git commit -m "feat(skill): skillBuilder assembles SKILL.md from selected blocks"
```

---

## Task 3: Refactor `aiTransforms.ts` to share the grammar (no drift)

**Files:**
- Modify: `src/webview/aiTransforms.ts`
- Test: `tests/ai/buildPrompt.test.ts` (existing — must stay green; add one no-drift test)

The board + mermaid grammar must come from `blockFormatReference` so the ✨ prompts and the skill share one source. The board prompt spec currently lives in `boardSpec(view)` and `MERMAID_SPEC`. Rebuild them from the reference's `example` + `rules`.

- [ ] **Step 1: Add a no-drift test to `tests/ai/buildPrompt.test.ts`**

Add the import at the **top of the file** (with the other imports):

```typescript
import { BLOCK_REFERENCES } from '../../src/webview/blockFormatReference';
```

Then append this `describe` block at the end:

```typescript
describe('prompt grammar stays in sync with blockFormatReference', () => {
  it('kanban prompt embeds the reference board example', () => {
    const p = buildPrompt({ ...base, target: 'kanban' });
    // a distinctive line from the shared board example
    expect(p).toContain('| Write the spec | Doing | @maya | 2026-06-10 | c1 |');
  });
  it('mermaid prompt embeds the reference mermaid example', () => {
    const p = buildPrompt({ ...base, target: 'mermaid' });
    expect(p).toContain(BLOCK_REFERENCES.mermaid.example);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/ai/buildPrompt.test.ts`
Expected: FAIL on the two new assertions (current specs use different example text).

- [ ] **Step 3: Refactor `boardSpec` and `MERMAID_SPEC` to use the reference**

In `src/webview/aiTransforms.ts`, add the import at the top:

```typescript
import { BLOCK_REFERENCES } from './blockFormatReference';
```

Replace the `boardSpec(view)` function body so it composes from the reference (keep the transform framing, but the example + rules come from the shared source):

```typescript
function boardSpec(view: 'kanban' | 'table'): string {
  const ref = BLOCK_REFERENCES[view === 'table' ? 'table' : 'kanban'];
  const intro = view === 'kanban'
    ? 'Use EXACTLY this custom board block, displayed as a Kanban board (cards grouped into columns by their Status).'
    : 'Use EXACTLY this custom board block, displayed as a table / database view. This is NOT a plain markdown table — it is the same board block with active-view="table".';
  const rules = ref.rules.map((r) => `- ${r}`).join('\n');
  return `${intro} The app parses it — do not deviate.\n\n${ref.example}\n\nConstraints:\n${rules}`;
}
```

Replace the `MERMAID_SPEC` constant:

```typescript
const MERMAID_SPEC = `Use a fenced code block whose language is mermaid — it renders as a live diagram:\n\n${BLOCK_REFERENCES.mermaid.example}\n\nPick the diagram type that best fits the content (flowchart, sequenceDiagram, stateDiagram-v2, gantt, etc.).`;
```

(Leave `TABLE_SPEC` — the plain-GFM `table` target — and the Phase-2 thinking specs untouched; they are not board grammar.)

- [ ] **Step 4: Run the AI tests to verify they pass**

Run: `npm test -- tests/ai`
Expected: PASS — the new no-drift assertions plus all existing `buildPrompt` tests (the kanban/board-table tests still find `<!-- board:start`, `active-view="kanban"/"table"`, and the token lists, which the reference rules contain).

If an existing assertion referenced exact old wording that the reference phrases differently (e.g. the token-list test expects `text, status, date, person, tags`), confirm the reference `BOARD_RULES` contains that exact substring — it does — so they pass.

- [ ] **Step 5: Commit**

```bash
git add src/webview/aiTransforms.ts tests/ai/buildPrompt.test.ts
git commit -m "refactor(ai): derive board+mermaid prompt grammar from blockFormatReference (single source)"
```

---

## Task 4: Host handlers — install + download

**Files:**
- Modify: `src/mdEditorPlusProvider.ts`

The host already imports `os`, `path`, `vscode`. It uses `vscode.window.showSaveDialog`, `vscode.workspace.fs.writeFile(uri, Buffer)`, and `vscode.workspace.getWorkspaceFolder(document.uri)` (see the `exportHtml` / `duplicate` handlers). Add directory creation with `vscode.workspace.fs.createDirectory(uri)`.

- [ ] **Step 1: Add the `installSkill` handler**

In the `onDidReceiveMessage` chain (next to `copyText` / `exportHtml`), add:

```typescript
      if (msg.type === 'installSkill') {
        const m = msg as unknown as { scope?: unknown; skillMd?: unknown };
        const skillMd = m.skillMd;
        if (typeof skillMd !== 'string') return;
        const scope = m.scope === 'global' ? 'global' : 'project';
        let baseDir: vscode.Uri;
        if (scope === 'global') {
          baseDir = vscode.Uri.file(path.join(os.homedir(), '.claude', 'skills'));
        } else {
          const ws = vscode.workspace.getWorkspaceFolder(document.uri);
          if (!ws) {
            await vscode.window.showErrorMessage('MD Editor Plus: no workspace folder for a project skill. Use Global or Download.');
            return;
          }
          baseDir = vscode.Uri.joinPath(ws.uri, '.claude', 'skills');
        }
        const skillDir = vscode.Uri.joinPath(baseDir, 'md-editor-blocks');
        const target = vscode.Uri.joinPath(skillDir, 'SKILL.md');
        // Confirm overwrite if it already exists.
        try {
          await vscode.workspace.fs.stat(target);
          const overwrite = 'Overwrite';
          const choice = await vscode.window.showWarningMessage(
            `A blocks skill already exists at ${target.fsPath}. Replace it?`,
            { modal: true },
            overwrite,
          );
          if (choice !== overwrite) return;
        } catch { /* doesn't exist — proceed */ }
        try {
          await vscode.workspace.fs.createDirectory(skillDir);
          await vscode.workspace.fs.writeFile(target, Buffer.from(skillMd, 'utf8'));
        } catch (err) {
          await vscode.window.showErrorMessage(`MD Editor Plus: skill install failed — ${(err as Error).message}`);
          return;
        }
        const reveal = 'Reveal';
        const choice = await vscode.window.showInformationMessage(
          `Blocks skill installed → ${target.fsPath}`,
          reveal,
        );
        if (choice === reveal) {
          await vscode.commands.executeCommand('revealFileInOS', target);
        }
        return;
      }
```

- [ ] **Step 2: Add the `downloadSkill` handler**

Right after it:

```typescript
      if (msg.type === 'downloadSkill') {
        const skillMd = (msg as unknown as { skillMd?: unknown }).skillMd;
        if (typeof skillMd !== 'string') return;
        const dir = vscode.Uri.joinPath(document.uri, '..');
        const defaultUri = vscode.Uri.joinPath(dir, 'SKILL.md');
        const target = await vscode.window.showSaveDialog({
          defaultUri,
          filters: { Markdown: ['md'] },
          saveLabel: 'Save skill',
          title: 'Download blocks skill (place it in a md-editor-blocks/ folder in your skills dir)',
        });
        if (!target) return;
        try {
          await vscode.workspace.fs.writeFile(target, Buffer.from(skillMd, 'utf8'));
        } catch (err) {
          await vscode.window.showErrorMessage(`MD Editor Plus: save failed — ${(err as Error).message}`);
          return;
        }
        await vscode.window.showInformationMessage(`Saved ${target.fsPath.split('/').pop()}`);
        return;
      }
```

- [ ] **Step 3: Add the menu button to the actions panel HTML**

In `_getHtml`, the actions menu lists `.settings-action` buttons (e.g. `act-duplicate`, `act-export-menu`). Add a button after the Export entry, in BOTH copies of the actions list if there are two (wide + narrow). Use the existing `iDownload` (or another available) icon variable:

```html
    <button class="settings-action act-blocks-skill" data-tip="Generate a Claude skill that teaches your AI this app's block grammar">${iDownload}<span class="settings-action-label">Create blocks skill…</span></button>
```

- [ ] **Step 4: Type-check the host**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/mdEditorPlusProvider.ts
git commit -m "feat(skill): host installSkill (project/global) + downloadSkill handlers + menu button"
```

---

## Task 5: `skillPanel.ts` — the customization panel

**Files:**
- Create: `src/webview/skillPanel.ts`

- [ ] **Step 1: Create the panel**

Create `src/webview/skillPanel.ts`:

```typescript
import { BLOCK_IDS, BLOCK_REFERENCES, type BlockId } from './blockFormatReference';
import { buildSkill } from './skillBuilder';

interface Bridge { postMessage: (m: unknown) => void; }

function bridge(): Bridge | undefined {
  return (window as unknown as { __mdViewerVscode?: Bridge }).__mdViewerVscode;
}

export interface SkillPanel { open(): void; }

export function createSkillPanel(): SkillPanel {
  const el = document.createElement('div');
  el.className = 'ai-panel skill-panel';
  el.style.display = 'none';
  const checks = BLOCK_IDS
    .map(
      (id) =>
        `<label class="skill-block"><input type="checkbox" data-block="${id}" checked> ${BLOCK_REFERENCES[id].title}</label>`,
    )
    .join('');
  el.innerHTML = `
    <div class="ai-panel-head">
      <span class="ai-panel-title">✨ Create blocks skill</span>
      <button class="ai-panel-close" data-skill-act="close" aria-label="Close">✕</button>
    </div>
    <div class="ai-panel-summary">A Claude skill that teaches your AI MD Editor Plus's exact block grammar.</div>
    <div class="skill-blocks">${checks}</div>
    <div class="ai-panel-foot skill-foot">
      <button class="ai-panel-btn" data-skill-act="download">Download…</button>
      <button class="ai-panel-btn" data-skill-act="install-global">Install globally</button>
      <button class="ai-panel-btn ai-panel-btn-primary" data-skill-act="install-project">Install in project</button>
    </div>
  `;
  document.body.appendChild(el);

  function selected(): BlockId[] {
    return Array.from(el.querySelectorAll<HTMLInputElement>('input[data-block]:checked'))
      .map((c) => c.dataset.block as BlockId);
  }
  function close(): void { el.style.display = 'none'; }

  el.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-skill-act]');
    if (!btn) return;
    const act = btn.dataset.skillAct;
    if (act === 'close') { close(); return; }
    const blocks = selected();
    if (blocks.length === 0) return;
    const { skillMd } = buildSkill(blocks);
    const vs = bridge();
    if (act === 'download') vs?.postMessage({ type: 'downloadSkill', skillMd });
    else if (act === 'install-global') vs?.postMessage({ type: 'installSkill', scope: 'global', skillMd });
    else if (act === 'install-project') vs?.postMessage({ type: 'installSkill', scope: 'project', skillMd });
    close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.style.display !== 'none') close();
  });

  return { open(): void { el.style.display = 'block'; } };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.webview.json --noEmit`
Expected: only the 4 pre-existing errors.

- [ ] **Step 3: Commit**

```bash
git add src/webview/skillPanel.ts
git commit -m "feat(skill): skillPanel (block checkboxes + install/download)"
```

---

## Task 6: Wire the menu button to open the panel

**Files:**
- Modify: `src/webview/index.ts`

- [ ] **Step 1: Import and instantiate the panel**

At the top of `src/webview/index.ts`, add:

```typescript
import { createSkillPanel } from './skillPanel';
```

Inside `init()` (near where the other panels/menus are set up), add:

```typescript
  const skillPanel = createSkillPanel();
```

- [ ] **Step 2: Wire the actions-menu button**

Where the other `.settings-action` clicks are wired (next to `.act-duplicate`), add — for every actions panel instance the code wires (there may be two: wide + narrow):

```typescript
    panel.querySelector<HTMLElement>('.act-blocks-skill')?.addEventListener('click', () => {
      skillPanel.open();
    });
```

(If the actions buttons are wired via a shared `panel.querySelectorAll('.settings-action')` loop, instead add a branch keyed off the `.act-blocks-skill` class there. Match the file's existing pattern.)

- [ ] **Step 3: Build the webview**

Run: `npx tsc -p tsconfig.webview.json --noEmit`
Expected: only the 4 pre-existing errors.

- [ ] **Step 4: Commit**

```bash
git add src/webview/index.ts
git commit -m "feat(skill): open the blocks-skill panel from the actions menu"
```

---

## Task 7: Panel styling

**Files:**
- Modify: `src/webview/styles/editor.css`

- [ ] **Step 1: Add CSS**

Append (reuses the `.ai-panel*` look from the ✨ panel, which already styles position, background, border, shadow):

```css
/* Blocks-skill panel */
.skill-blocks { display: flex; flex-direction: column; gap: 8px; padding: 8px 16px 4px; }
.skill-block { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text-primary); cursor: pointer; }
.skill-block input { cursor: pointer; }
.skill-foot { flex-wrap: wrap; }
```

- [ ] **Step 2: Commit**

```bash
git add src/webview/styles/editor.css
git commit -m "style(skill): blocks-skill panel layout"
```

---

## Task 8: Full build + manual verification

**Files:** none.

- [ ] **Step 1: Full build + tests**

Run: `npm run compile && npm test`
Expected: compile succeeds; all tests pass except the known pre-existing `tests/toggle.test.ts` suite-compile failure.

- [ ] **Step 2: Manual smoke test (Extension Development Host)**

Launch (F5), open a markdown file, then:
- ⋯ menu → **Create blocks skill…** opens the panel with five checked blocks.
- Untick **Toggle**, click **Install in project** → a `Blocks skill installed → …/.claude/skills/md-editor-blocks/SKILL.md` notice with **Reveal**; open the file and confirm it has Kanban/Table/Mermaid/Callout sections and no Toggle section, with valid board examples.
- Click **Install globally** → confirm it writes under `~/.claude/skills/md-editor-blocks/SKILL.md`; re-running prompts to **Overwrite**.
- Click **Download…** → Save dialog writes `SKILL.md`.
- In a Claude Code session with the project skill installed, ask it to "make a kanban board of these tasks" and confirm the output renders as a board in the editor.

- [ ] **Step 2b: Commit any fixes**

```bash
git add -A && git commit -m "fix(skill): address issues found during manual verification"
```

(Skip if none.)

---

## Notes for the implementer

- **The round-trip test in Task 1 is the safety net** — if `parseBoardSource` ever rejects the example, the example (not the test) is wrong; fix it until it parses. This is what makes the skill's grammar trustworthy.
- **Two actions-menu copies:** the provider HTML appears to render the `.settings-action` list twice (wide + narrow layouts). Add the new button to BOTH, and wire BOTH in `index.ts`, or the item will be missing at one width.
- **When the board-parse-bug fix from the other session lands**, the shared `blockFormatReference` example must still round-trip — Task 1's test will catch any mismatch.
