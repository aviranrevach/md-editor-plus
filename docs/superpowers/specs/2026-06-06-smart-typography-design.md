# Smart Typography — Design

**TODO item:** c5 — "When typing `->` `<-` should actually put arrow character (like in Notion), and check which combinations should also allow this."

**Status:** Approved, ready for implementation plan.

## Goal

As the user types certain character sequences in normal prose, replace them with
the proper typographic character (Notion-style). On by default, suppressed inside
code, and every replacement reversible with Backspace or Cmd+Z.

## Mechanism

A new custom Tiptap extension, `SmartTypography`, registered in the editor's
extension list. It uses Tiptap's built-in input-rule machinery
(`addInputRules()` with `textInputRule` from `@tiptap/core`, already a
dependency — no new packages).

Each mapping is a single input rule that fires when the user finishes typing the
trigger sequence. Tiptap input rules provide Backspace-to-revert and Cmd+Z undo
for free.

**Alternatives considered and rejected:**
- Manual `keydown`/`beforeinput` DOM handler — more code, must hand-roll undo.
- `@tiptap/extension-typography` — requires install (not permitted), and does not
  cover `->`-style arrows anyway.

## Replacement Map

| Trigger | Result | Description |
|---------|--------|-------------|
| `->`    | →      | rightwards arrow |
| `<-`    | ←      | leftwards arrow |
| `<->`   | ↔      | left-right arrow |
| `=>`    | ⇒      | rightwards double arrow |
| `<=>`   | ⇔      | left-right double arrow |
| `--`    | —      | em dash |
| `...`   | …      | horizontal ellipsis |
| `(c)`   | ©      | copyright |
| `(r)`   | ®      | registered |
| `(tm)`  | ™      | trademark |

**Deliberately excluded:** `<=` and `>=` are NOT mapped to double arrows, because
in prose they most often mean "less than or equal" / "greater than or equal".
Mapping them would be surprising.

### Ordering & premature-firing note

ProseMirror input rules fire on the **last character typed**, matching the text
immediately before the cursor. Two distinct cases must be handled:

**Case 1 — same terminal keystroke, longest-match-first.** When several rules
could fire on the *same* final character, register the longest first; ProseMirror
applies the first matching rule.
- `<=>` (`/<=>$/`) must be registered **before** `=>` (`/=>$/`), because both
  match on the `>` keystroke when the text is `<=>`. Longest-first ensures
  `<=>` → ⇔ instead of `<⇒`.

**Case 2 — shorter prefix fires early, needs a follow-up rule.** `<-` → ← fires
the moment `-` is typed, *before* the user can type the closing `>`. So `<->`
cannot be matched as a literal `<->` rule — by the third keystroke the text is
already `←>`. Handle this with a follow-up rule that matches the
already-converted character:
- `/←>$/` → ↔ (catches `←` + `>`, i.e. the user typing `<` `-` `>`).

This makes the practical rule set: register `<=>` before `=>`, and add a
`←>` → ↔ rule rather than a `<->` rule. (`<=>` does not hit Case 2 because `<=`
is intentionally not mapped, so nothing fires until the final `>`.)

## Code Suppression

Replacements never fire inside:
- fenced code blocks (`codeBlock` node)
- inline code (`code` mark)

Each input rule checks the resolved position / active marks before applying, and
returns `null` (no replacement) when in a code context. This keeps
`() => {}`, `ptr->field`, and `...spread` literal.

## Toggle & Persistence

- A new **"Smart typography"** toggle in the **Visual settings** panel, placed in
  the existing "Code & diagrams" section alongside the current toggles.
- **Default: ON** (note: differs from the existing toggles which default to off).
- Persisted via VS Code configuration as `mdEditorPlus.smartTypography`
  (`ConfigurationTarget.Global`), following the same `init` → `applyDefaults`
  → `currentDefaults` → `saveDefaults` flow as `alwaysDarkCode` et al.
- **Runtime toggle without reload:** the extension reads a module-level enabled
  flag; when the toggle is off, every input rule short-circuits and returns
  `null`. No editor re-creation needed. The settings handler flips the flag.

### Wiring checklist (consistency with existing settings)

1. `package.json` — add `mdEditorPlus.smartTypography` (boolean, default `true`)
   to the configuration schema.
2. `mdEditorPlusProvider.ts` — add to the `init` `defaults` payload
   (`cfg.get<boolean>('smartTypography', true)`) and to the `saveDefaults`
   handler (`cfg.update('smartTypography', ...)`).
3. `index.ts` — add to the `SavedDefaults` interface, `currentDefaults()`,
   `applyDefaults()`, and add the toggle element wiring (a `setSmartTypography`
   handler mirroring `setAlwaysDarkCode`).
4. The webview HTML in `_getHtml()` — add the toggle row markup.
5. The editor extension reads the flag the toggle controls.

## Undo Behavior

- Backspace immediately after a replacement restores the typed characters
  (native ProseMirror input-rule behavior).
- Cmd+Z undoes the replacement.

## Testing

- Unit-style tests for the rule set: each trigger produces the expected
  character in plain prose.
- Suppression: triggers inside a code block and inside inline code leave text
  untouched.
- Excluded sequences: `<=` and `>=` remain literal.
- Ordering: typing `<->` yields ↔ (not ← followed by stray `>`); `<=>` yields ⇔.
- Toggle off: no replacements occur; toggle back on: replacements resume without
  reload.

## Out of Scope

- Smart quotes (straight → curly) — not requested; can be added later as another
  rule if wanted.
- Fractions, ×, ±, and other extended typography — not requested.
