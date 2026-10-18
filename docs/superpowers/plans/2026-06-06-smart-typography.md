# Smart Typography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** As the user types sequences like `->`, `--`, `...`, `(c)` in prose, replace them with the proper typographic character (→, —, …, ©) — Notion-style — with an on-by-default toggle in Visual settings, suppressed inside code, and reversible via Backspace/Cmd+Z.

**Architecture:** A pure, fully-unit-tested matcher (`findSmartTypographyMatch`) holds the replacement rule table and selection logic. A thin Tiptap `Extension` (`SmartTypography`) turns each rule into a ProseMirror `InputRule`, guarded by a module-level enabled flag and an inline-code check. Code *blocks* are skipped for free by ProseMirror's input-rule machinery. The Visual settings panel gets a "Smart typography" toggle persisted through the existing `init → applyDefaults → currentDefaults → saveDefaults` VS Code config flow.

**Tech Stack:** TypeScript, Tiptap 2.7 / ProseMirror, Jest (ts-jest, `testEnvironment: node` — so the editor cannot be mounted in tests; the matcher is the unit-tested seam, editor/settings wiring is verified manually in the Extension Development Host).

---

## File Structure

- **Create** `src/webview/extensions/smartTypography.ts` — the rule table, the pure `findSmartTypographyMatch` matcher, the `setSmartTypographyEnabled` flag setter, and the `SmartTypography` Tiptap extension. One file: the matcher and the extension that consumes it change together.
- **Create** `tests/smartTypography.test.ts` — unit tests for the matcher (mappings, exclusions, ordering).
- **Modify** `src/webview/editor.ts` — register `SmartTypography` in the main editor's extension list.
- **Modify** `src/mdEditorPlusProvider.ts` — config plumbing (init defaults, saveDefaults, resetDefaults keys, message type) + the toggle row in the settings-panel HTML.
- **Modify** `src/webview/index.ts` — `SavedDefaults`, `FACTORY_DEFAULTS`, `DEFAULT_KEYS`, toggle element + handler + setter, `applyDefaults`, `currentDefaults`, import the flag setter.
- **Modify** `package.json` — add the `mdEditorPlus.smartTypography` configuration property.

---

### Task 1: Pure matcher + rule table (TDD core)

**Files:**
- Create: `src/webview/extensions/smartTypography.ts`
- Test: `tests/smartTypography.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/smartTypography.test.ts`:

```typescript
import { findSmartTypographyMatch } from '../src/webview/extensions/smartTypography';

describe('findSmartTypographyMatch — single mappings', () => {
  const cases: Array<[string, string]> = [
    ['->', '→'],
    ['<-', '←'],
    ['=>', '⇒'],
    ['--', '—'],
    ['...', '…'],
    ['(c)', '©'],
    ['(r)', '®'],
    ['(tm)', '™'],
  ];
  it.each(cases)('replaces %s with %s', (typed, expected) => {
    const m = findSmartTypographyMatch(typed);
    expect(m).not.toBeNull();
    expect(m!.replacement).toBe(expected);
    expect(m!.matchLength).toBe(typed.length);
  });

  it('matches symbol triggers case-insensitively', () => {
    expect(findSmartTypographyMatch('(C)')!.replacement).toBe('©');
    expect(findSmartTypographyMatch('(TM)')!.replacement).toBe('™');
  });

  it('only considers the end of the buffer (prose before the trigger is ignored)', () => {
    const m = findSmartTypographyMatch('see this ->');
    expect(m!.replacement).toBe('→');
    expect(m!.matchLength).toBe(2);
  });
});

describe('findSmartTypographyMatch — ordering & double arrows', () => {
  it('prefers <=> (⇔) over => when both could match', () => {
    expect(findSmartTypographyMatch('<=>')!.replacement).toBe('⇔');
  });

  it('prefers literal <-> (↔) over -> when both could match', () => {
    expect(findSmartTypographyMatch('<->')!.replacement).toBe('↔');
  });

  it('completes ↔ from the post-conversion ←> buffer', () => {
    // After <- auto-converts to ←, typing > leaves "←>" before the cursor
    expect(findSmartTypographyMatch('←>')!.replacement).toBe('↔');
  });
});

describe('findSmartTypographyMatch — excluded sequences', () => {
  it('leaves <= untouched (means less-than-or-equal, not ⇐)', () => {
    expect(findSmartTypographyMatch('<=')).toBeNull();
  });
  it('leaves >= untouched', () => {
    expect(findSmartTypographyMatch('>=')).toBeNull();
  });
  it('returns null when nothing matches', () => {
    expect(findSmartTypographyMatch('hello')).toBeNull();
    expect(findSmartTypographyMatch('-')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/smartTypography.test.ts`
Expected: FAIL — `Cannot find module '../src/webview/extensions/smartTypography'`.

- [ ] **Step 3: Write the matcher and rule table**

Create `src/webview/extensions/smartTypography.ts` with ONLY the pure parts for now (the extension is added in Task 2):

```typescript
// Smart typography: Notion-style replacements as you type.
//
// Rule order matters. ProseMirror runs input rules in array order and applies
// the FIRST match, so any multi-character trigger that ends in the same
// character as a shorter trigger must come first:
//   - `<=>` before `=>`  (both complete on `>`)
//   - `<->` before `->`  (literal "<->" ends in "->")
// `<-` auto-converts to ← the instant `-` is typed, before the closing `>` can
// be entered. So `<->` typed live arrives as "←>" — the `←>` rule completes it
// to ↔. (The literal `<->` rule is kept as a belt-and-suspenders for buffers
// that arrive whole, e.g. programmatic input.)
export interface SmartTypographyRule {
  find: RegExp;
  replace: string;
}

export const SMART_TYPOGRAPHY_RULES: SmartTypographyRule[] = [
  { find: /<=>$/, replace: '⇔' },
  { find: /<->$/, replace: '↔' },
  { find: /←>$/,  replace: '↔' },
  { find: /->$/,  replace: '→' },
  { find: /<-$/,  replace: '←' },
  { find: /=>$/,  replace: '⇒' },
  { find: /--$/,  replace: '—' },
  { find: /\.\.\.$/, replace: '…' },
  { find: /\(c\)$/i,  replace: '©' },
  { find: /\(r\)$/i,  replace: '®' },
  { find: /\(tm\)$/i, replace: '™' },
];

export interface SmartTypographyMatch {
  matchLength: number;
  replacement: string;
}

/**
 * Given the text immediately before the cursor, return the first matching
 * smart-typography replacement, or null. Pure — no editor/DOM dependency.
 */
export function findSmartTypographyMatch(textBefore: string): SmartTypographyMatch | null {
  for (const rule of SMART_TYPOGRAPHY_RULES) {
    const m = rule.find.exec(textBefore);
    if (m) return { matchLength: m[0].length, replacement: rule.replace };
  }
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/smartTypography.test.ts`
Expected: PASS — all describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add src/webview/extensions/smartTypography.ts tests/smartTypography.test.ts
git commit -m "feat(typography): smart typography rule table + matcher with tests"
```

---

### Task 2: SmartTypography Tiptap extension + register in editor

**Files:**
- Modify: `src/webview/extensions/smartTypography.ts` (append extension + flag setter)
- Modify: `src/webview/editor.ts:100-126` (extension list) and its import block

- [ ] **Step 1: Append the enabled flag and the extension to `smartTypography.ts`**

Add to the TOP of the imports in `src/webview/extensions/smartTypography.ts`:

```typescript
import { Extension, InputRule } from '@tiptap/core';
```

Append to the BOTTOM of `src/webview/extensions/smartTypography.ts`:

```typescript
// Module-level flag so the Visual-settings toggle can enable/disable replacement
// at runtime without re-creating the editor. When off, every rule no-ops.
let smartTypographyEnabled = true;

export function setSmartTypographyEnabled(on: boolean): void {
  smartTypographyEnabled = on;
}

export function isSmartTypographyEnabled(): boolean {
  return smartTypographyEnabled;
}

export const SmartTypography = Extension.create({
  name: 'smartTypography',

  addInputRules() {
    // Code BLOCKS are skipped automatically: ProseMirror's inputRules plugin
    // bails when the cursor's parent node spec has `code: true`. Inline `code`
    // is a MARK (parent is still a paragraph), so we guard that case manually.
    return SMART_TYPOGRAPHY_RULES.map(
      (rule) =>
        new InputRule({
          find: rule.find,
          handler: ({ state, range }) => {
            if (!smartTypographyEnabled) return null;

            const codeMark = state.schema.marks.code;
            if (codeMark) {
              const $from = state.doc.resolve(range.from);
              const marksHere = state.storedMarks ?? $from.marks();
              if (codeMark.isInSet(marksHere)) return null;
            }

            state.tr.insertText(rule.replace, range.from, range.to);
            return undefined;
          },
        }),
    );
  },
});

export default SmartTypography;
```

- [ ] **Step 2: Register the extension in the main editor**

In `src/webview/editor.ts`, add to the import block (near the other `./extensions/...` imports, around line 25):

```typescript
import SmartTypography from './extensions/smartTypography';
```

In the `extensions` array of `createEditor` (around line 124, after `BlockOutline,`), add:

```typescript
      BlockOutline,
      SmartTypography,
      SearchExtension,
```

(Insert `SmartTypography,` between `BlockOutline,` and `SearchExtension,`.)

- [ ] **Step 3: Type-check / build**

Run: `npm run compile`
Expected: completes with no TypeScript errors (tsc passes, esbuild bundles).

- [ ] **Step 4: Re-run the matcher tests (guard against import-time regressions)**

Run: `npx jest tests/smartTypography.test.ts`
Expected: PASS — adding the extension/import must not break the pure tests.

- [ ] **Step 5: Commit**

```bash
git add src/webview/extensions/smartTypography.ts src/webview/editor.ts
git commit -m "feat(typography): SmartTypography extension wired into the editor"
```

---

### Task 3: Settings toggle + persistence (default ON)

**Files:**
- Modify: `package.json` (configuration property)
- Modify: `src/mdEditorPlusProvider.ts:114-129` (init defaults), `:152-163` (message type), `:180-191` (saveDefaults), `:196` (resetDefaults keys), `:636-668` (settings HTML)
- Modify: `src/webview/index.ts` — interface, factory defaults, default keys, element ref, setter, listener, applyDefaults, currentDefaults, import

- [ ] **Step 1: Add the configuration property to `package.json`**

In `package.json`, under `contributes.configuration.properties`, add after the `mdEditorPlus.sourceWordWrap` entry (match the existing formatting):

```json
        "mdEditorPlus.smartTypography": {
          "type": "boolean",
          "default": true,
          "description": "Smart typography: replace typed sequences like -> with arrows (→), -- with em dash (—), ... with ellipsis (…) as you type. Suppressed inside code."
        }
```

- [ ] **Step 2: Plumb the value through the provider**

In `src/mdEditorPlusProvider.ts`:

(a) In `sendInit`'s `defaults` object (after `sourceWordWrap:` at line 127), add:

```typescript
          smartTypography:     cfg.get<boolean>('smartTypography', true),
```

(b) In the `onDidReceiveMessage` `msg.defaults` type (after `shortenCodeSnippets?: boolean;` at line 162), add:

```typescript
        smartTypography?: boolean;
```

(c) In the `saveDefaults` `Promise.all` (after the `shortenCodeSnippets` line at line 190), add:

```typescript
          cfg.update('smartTypography',     d.smartTypography,     target),
```

(d) In the `resetDefaults` `keys` array (line 196), append `'smartTypography'`:

```typescript
        const keys = ['theme','font','textSize','pageWidth','fullWidth','alwaysDarkCode','alwaysDarkDiagram','alwaysDarkSource','sourceFullWidth','shortenCodeSnippets','smartTypography'];
```

- [ ] **Step 3: Add the toggle row to the settings panel HTML**

In `src/mdEditorPlusProvider.ts`, immediately AFTER the Code & diagrams section closes (the `</div>` at line 668) and BEFORE the `<div class="settings-divider"></div>` at line 669, insert a new section:

```html
    <div class="settings-divider"></div>
    <div class="settings-section">
      <div class="settings-label">Editing</div>
      <div class="settings-row" data-tip="Replace typed sequences like -&gt; with → and -- with — as you type (never inside code)">
        <span class="settings-row-icon">${iArrowsH}</span>
        <span class="settings-row-label">Smart typography</span>
        <button class="toggle-switch" id="smart-typography-toggle" role="switch" aria-checked="true"></button>
      </div>
    </div>
```

- [ ] **Step 4: Wire the toggle in `src/webview/index.ts`**

(a) Add the import near the other webview imports (top of file, with the `./extensions/...` group):

```typescript
import { setSmartTypographyEnabled } from './extensions/smartTypography';
```

(b) In the `SavedDefaults` interface (after `sourceWordWrap?: boolean;` at line 79), add:

```typescript
  smartTypography?: boolean;
```

(c) In `FACTORY_DEFAULTS` (after `shortenCodeSnippets: false,` at line 107), add:

```typescript
  smartTypography:     true,
```

(d) In `DEFAULT_KEYS` (line 110-113), append `'smartTypography'`:

```typescript
const DEFAULT_KEYS = [
  'theme', 'font', 'textSize', 'pageWidth', 'fullWidth',
  'alwaysDarkCode', 'alwaysDarkDiagram', 'alwaysDarkSource', 'sourceFullWidth', 'shortenCodeSnippets',
  'smartTypography',
] as const;
```

(e) Add the element ref next to the other toggle refs (after `shortenSnippetsToggle` at line 177):

```typescript
  const smartTypographyToggle = document.getElementById('smart-typography-toggle') as HTMLElement;
```

(f) Add the setter next to the other `set*` toggle functions (after `setShortenSnippets` ends at line 219):

```typescript
  function setSmartTypography(on: boolean): void {
    setSmartTypographyEnabled(on);
    smartTypographyToggle.classList.toggle('on', on);
    smartTypographyToggle.setAttribute('aria-checked', String(on));
    refreshDefaultsButtons();
  }
```

(g) Add the click listener next to the other toggle listeners (after the `shortenSnippetsToggle` listener at line 233-235):

```typescript
  smartTypographyToggle.addEventListener('click', () => {
    setSmartTypography(!smartTypographyToggle.classList.contains('on'));
  });
```

(h) In `applyDefaults` (after `setShortenSnippets(...)` at line 825), add — note `?? true`, this setting is ON by default unlike the others:

```typescript
    setSmartTypography(d.smartTypography ?? true);
```

(i) In `currentDefaults`'s returned object (after `shortenCodeSnippets:` at line 883), add:

```typescript
      smartTypography:     smartTypographyToggle.classList.contains('on'),
```

- [ ] **Step 5: Type-check / build, then run the full test suite**

Run: `npm run compile`
Expected: no TypeScript errors.

Run: `npm test`
Expected: the smartTypography suite passes; the suite count is otherwise unchanged from baseline. (Per project memory, one pre-existing `toggle.test.ts` type-check failure may show — that is unrelated to this change.)

- [ ] **Step 6: Commit**

```bash
git add package.json src/mdEditorPlusProvider.ts src/webview/index.ts
git commit -m "feat(typography): Smart typography toggle in Visual settings (default on)"
```

---

### Task 4: Manual verification in the Extension Development Host

The test env (`testEnvironment: node`) cannot mount the Tiptap editor, so live behavior is verified by hand. This is the acceptance gate.

**Files:** none (verification + TODO update only)

- [ ] **Step 1: Launch the extension**

In VS Code, press **F5** (Run Extension / "Start Debugging"). A second VS Code window opens (Extension Development Host).

- [ ] **Step 2: Open a markdown file in MD Editor Plus and verify replacements**

Open any `.md` file (it opens in MD Editor Plus). In a normal paragraph, type each sequence and confirm the result:

- `->` → `→`
- `<-` → `←`
- `<` then `-` then `>` (live) → `↔`
- `=>` → `⇒`
- `<=>` → `⇔`
- `--` → `—`
- `...` → `…`
- `(c)` → `©`, `(r)` → `®`, `(tm)` → `™`
- `<=` and `>=` → **stay literal** (no replacement)

- [ ] **Step 3: Verify undo and code suppression**

- Type `->` → `→`, then press **Backspace** once → returns to `->`. Type `->` → `→`, then **Cmd+Z** → returns to `->`.
- Inside a fenced code block, type `() => {}` and `ptr->field` → they stay literal (no ⇒/→).
- Inside inline `code` (backticks), type `->` → stays literal.

- [ ] **Step 4: Verify the toggle**

- Open Visual settings (gear) → "Editing" → confirm "Smart typography" shows **on** by default.
- Turn it **off**, type `->` in prose → stays literal (no reload needed).
- Turn it back **on**, type `->` → becomes `→`.
- Click **Save view as default**, reload the window → toggle is still **on** (persisted). Toggle off + Save + reload → stays off.

- [ ] **Step 5: Mark the TODO item done and commit**

Edit `TODO.md`: change the `c5` row's Status cell from `Todo` to `Done`.

```bash
git add TODO.md
git commit -m "chore(todo): mark c5 (smart typography) done"
```

---

## Self-Review

**Spec coverage** (checked against `2026-06-06-smart-typography-design.md`):
- Mechanism (Tiptap input rules, no new deps) → Task 2. ✔
- Full replacement map (arrows, double arrows, em-dash, ellipsis, ©/®/™) → Task 1 rule table + tests. ✔
- `<=` / `>=` excluded → Task 1 tests assert null. ✔
- Ordering / premature-firing (`<=>` before `=>`; `←>` completes ↔) → Task 1 rule order + ordering tests. ✔
- Code suppression (blocks free, inline code manual guard) → Task 2 handler + Task 4 step 3. ✔
- Toggle in Visual settings, default ON, runtime no-reload, persisted via config → Task 3 (`?? true` in applyDefaults, `setSmartTypographyEnabled` flag) + Task 4 step 4. ✔
- Undo via Backspace/Cmd+Z (native input-rule behavior) → Task 4 step 3. ✔

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step shows complete code. ✔

**Type consistency:** `findSmartTypographyMatch` returns `{ matchLength, replacement }` — used consistently in tests. `setSmartTypographyEnabled(boolean)` defined in Task 2, imported/called in Task 3. `SmartTypography` default export imported in editor.ts (Task 2) and is the same symbol. Toggle id `smart-typography-toggle` matches between HTML (Task 3 step 3) and `getElementById` (Task 3 step 4e). ✔
