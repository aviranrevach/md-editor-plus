# Board markdown round-trip bug — investigation findings

## TL;DR

**Yes, this is a real bug in the published extension.** Anyone who has a board in their markdown file and reopens the file will:

1. See the board render with **empty cards** (just column headers, no rows)
2. If they then click/drag/type *anywhere* in the editor, the editor's debounced autosave **overwrites the file on disk with the empty board** — silently destroying all card data

The bug is in `src/webview/extensions/board.ts:7-13`. One-line fix proposed below.

---

## How I verified it

I reproduced the full pipeline outside the editor — same `markdown-it` config tiptap-markdown uses (`html: true`, `linkify: false`, `breaks: false`) — and parsed the result with a real Chromium browser (via playwright). I tested with content as simple as the working `demo.md` board (3 rows, Todo/Doing/Done).

**Result:** the `<div data-board>` element is **not in the DOM at all** after parsing. The browser drops it and everything after it.

```
boardDivFound: false
boardDivCount: 0
htmlTablesInDom: 0
bodyChildCount: 2     ← only the <h1> and <hr> survive
bodyHTMLLength: 49
```

This means TipTap never sees the board node, so it has nothing to attach the source attribute to. The card data is lost.

---

## Root cause

[src/webview/extensions/board.ts:7-13](src/webview/extensions/board.ts#L7-L13):

```ts
function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

**Newlines aren't escaped.** So `preprocessMarkdownBoards` produces:

```html
<div data-board source="&lt;!-- board:start ... --&gt;
                                                       ← blank line inside attribute
| Title | Status | id |
|---|---|---|
| ...rows... |
                                                       ← blank line inside attribute
&lt;!-- board:end --&gt;"></div>
```

When this goes through markdown-it, the blank line inside the attribute is interpreted as the **end of the HTML block** (per CommonMark). markdown-it then:

1. Emits `<div data-board source="...board:start...` (with an unclosed attribute and no closing `>`)
2. Parses the `|` lines as a markdown table → emits `<table>...</table>` as a sibling
3. Emits the closing `"></div>` as text inside a paragraph

The browser sees malformed HTML with an unterminated attribute. Chromium discards the entire `<div data-board>` and swallows everything after it.

---

## Why "demo.md works" is misleading

`demo.md`'s board has the same structure and would hit the same bug — but only **manifests as data loss when the user interacts with the board after reopening**. Quietly opening + scrolling past it doesn't trigger the autosave loop, so disk stays intact. The user has probably been seeing empty cards in `demo.md` after every reopen without registering it (or assuming it's a different issue).

**The bug strike sequence:**
1. Create a board via `/board kanban` → renders fine (no markdown roundtrip yet)
2. Add cards → still fine (NodeView state is in memory)
3. File saves to disk via the serializer → disk is correct
4. Close file
5. Reopen file → markdown-it pipeline runs → board renders empty
6. Any keystroke or click → onUpdate fires (~500ms debounce) → serializeBoard with 0 cards → writes empty board to disk → **data lost**

---

## Why tests didn't catch it

Looking at the existing tests:

- [tests/board/preprocess.test.ts](tests/board/preprocess.test.ts) only verifies the regex shape of `preprocessMarkdownBoards` output — doesn't pass it through markdown-it
- [tests/board/roundtrip.test.ts](tests/board/roundtrip.test.ts) only tests `parse(serialize(parse(x)))` on the board source string — doesn't exercise the markdown→HTML→DOM pipeline
- [tests/board/mount-kanban.test.ts](tests/board/mount-kanban.test.ts) and friends use synthetic Board objects passed directly to renderers — skips the markdown layer entirely
- The editor itself is **stubbed** in tests via [tests/__mocks__/editorMock.js](tests/__mocks__/editorMock.js), so no test ever runs the real TipTap + tiptap-markdown pipeline on board content

There's no end-to-end test of `markdown → preprocess → tiptap-markdown → DOM → board node`.

---

## Proposed fix (1 line)

[src/webview/extensions/board.ts:7-13](src/webview/extensions/board.ts#L7-L13) — add newline escaping so the source attribute becomes single-line, which markdown-it handles correctly:

```ts
function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;');   // ← add this
}
```

**Why this works:** `&#10;` is the HTML entity for newline. Inside an attribute value, browsers decode it back to `\n` automatically when you call `el.getAttribute('source')` — so `parseBoardSource` sees the same source string it always did. But during markdown-it's HTML-block detection, the attribute is a single line, so the blank-line rule doesn't trigger and the `<div>` survives intact.

### Verified with the same playwright/markdown-it setup

| Input | `div[data-board]` in DOM? | source attr length | parseable rows |
|---|---|---|---|
| Current (no `\n` escape) | ❌ Not found | 0 | 0 |
| Fixed (`\n` → `&#10;`) | ✅ Found | 159 | 2 |

Same test board, same markdown-it config, same parser — only the htmlEscape changed.

---

## Same fix probably needs to be applied to callouts

[src/webview/extensions/callout.ts](src/webview/extensions/callout.ts) likely has the same pattern (it's preprocessed alongside boards by the same `preprocessMarkdownCallouts` → `preprocessMarkdownBoards` chain in [src/webview/editor.ts:91](src/webview/editor.ts#L91)). Worth checking — if callout source attributes are also multi-line, they'd hit the same bug.

---

## Recommended follow-up

1. **Apply the 1-line fix** to `htmlEscape` in `board.ts`
2. **Check `callout.ts`** for the same pattern and fix if needed
3. **Add a regression test** that runs the full pipeline (preprocess → markdown-it → DOM → parseHTML rule → parseBoardSource) and asserts the cards survive
4. **Bump version** to 0.5.2 — this is a critical data-loss fix
5. **Consider whether to write a recovery doc** for users who may have already lost data (anyone who opened + interacted with a board file in 0.4.x or 0.5.x)

I have NOT applied the fix or modified any source code — left that for you to decide on direction when you're back.

---

## Screenshots situation

For the morning: the simplest screenshot path is still **demo.md** — open it, scroll to the Sprint board section. It probably renders empty cards now (per the bug above), so you'd need to either:
- Re-add the 3 cards manually in the editor, then snap (and don't close the file before snapping, or they'll be lost again)
- Apply the htmlEscape fix first, then everything works automatically

Your call when you're back.
