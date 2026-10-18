# Header Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two CSS media-query tiers (900px and 640px) so the toolbar chrome, outline panel, and Preview/Code segmented control all shrink gracefully at narrow editor widths instead of overlapping.

**Architecture:** Two `@media` blocks appended to [src/webview/styles/editor.css](src/webview/styles/editor.css) near the existing toolbar rules. No JS, no HTML, no schema changes — the segmented control's existing click handlers handle the single-icon-switch behaviour at <640px naturally.

**Tech Stack:** CSS3 media queries.

**Spec:** [docs/superpowers/specs/2026-05-28-header-responsiveness-design.md](docs/superpowers/specs/2026-05-28-header-responsiveness-design.md)

**Testing note:** Per spec, no automated tests are viable for CSS media queries (jsdom can verify rules exist in the stylesheet but not that they apply at given viewport widths). Manual verification at the end of each task is the meaningful check.

---

## Task 1: Add the 900px breakpoint

Hide the Preview/Code text labels and tighten the centered filename's `max-width` so neither overlaps the right-side chrome buttons at narrow widths. Both icons remain visible; the segmented pill stays intact.

**Files:**
- Modify: `src/webview/styles/editor.css` — append a new `@media (max-width: 900px)` block near the existing `#toolbar` rules (around line 100, after the toolbar's own block ends)

- [ ] **Step 1.1: Locate the right insertion point**

Open [src/webview/styles/editor.css](src/webview/styles/editor.css). Find the end of the `.toolbar-filename` block (it ends around line 98 with `}`). The next selector after it is `/* Segmented control — macOS style */` at line 100. Insert the new `@media` block BEFORE that comment, so the toolbar-related rules stay grouped.

- [ ] **Step 1.2: Add the 900px media-query block**

Insert the following block immediately after `.toolbar-filename.active { ... }` closes, and before the `/* Segmented control — macOS style */` comment:

```css
/* ────────────────────────────────────────────────────────────────────────
   Header / chrome responsiveness — see
   docs/superpowers/specs/2026-05-28-header-responsiveness-design.md.
   Tier 1 (≤ 900px): drop the Preview/Code text labels and tighten the
   filename's max-width so neither runs into the right-side chrome.
   ──────────────────────────────────────────────────────────────────── */
@media (max-width: 900px) {
  /* Icon-only Preview/Code — same as the in-block mermaid view toggle. */
  #toolbar #view-seg .seg-btn .seg-label { display: none; }

  /* 50vw → 30vw — leaves room for the right-side reload / Aa / ⋯ trio. */
  .toolbar-filename { max-width: 30vw; }
}
```

- [ ] **Step 1.3: Run the bundler to confirm no syntax errors**

```
npm run compile
```

Expected: ends with `Webview built.` (the CSS goes through esbuild's CSS pipeline). Any CSS parse error will surface as a build failure.

- [ ] **Step 1.4: Run the full test suite to confirm no regressions**

```
npm test
```

Expected: 153 tests pass (or whatever the current count is). The pre-existing `toggle.test.ts` suite-load failure is acceptable.

- [ ] **Step 1.5: Manual smoke for the 900px tier**

Launch the extension dev host (F5 in VS Code). Open any `.md` file. Slowly narrow the editor split / window past 900px wide:

- Preview / Code labels disappear; eye + `<>` icons remain visible inside the segmented pill.
- Filename still centered but truncates with `…` earlier; never overlaps the reload / Aa / ⋯ buttons.
- Above 900px: behavior unchanged (labels visible, filename at 50vw).

If anything overlaps or layout breaks, stop and triage before continuing.

- [ ] **Step 1.6: Commit**

```bash
git add src/webview/styles/editor.css
git commit -m "feat(toolbar): icon-only Preview/Code labels + tighter filename max-width below 900px — drops the text labels and shrinks max-width from 50vw to 30vw so neither collides with the right-side chrome"
```

---

## Task 2: Add the 640px breakpoint

Auto-collapse the outline panel + its toolbar button, AND collapse the Preview/Code segmented pair into a single-icon switch that toggles to the inactive view on click.

**Files:**
- Modify: `src/webview/styles/editor.css` — append a `@media (max-width: 640px)` block immediately after the 900px block from Task 1

- [ ] **Step 2.1: Add the 640px media-query block**

Immediately after the closing `}` of the `@media (max-width: 900px)` block from Task 1, append:

```css
/* Tier 2 (≤ 640px): also auto-collapse the outline (its 240px gutter
   would leave < 400px for content), and collapse the segmented
   Preview/Code pair to a single-icon "tap to switch" — only the
   inactive view's icon shows. */
@media (max-width: 640px) {
  /* Outline panel + button. `!important` so the media query wins when
     the panel is in its open state (no .hidden class on it). */
  .outline-panel { display: none !important; }
  html.outline-visible #editor,
  html.outline-visible #source-view { padding-left: 0; }
  #toolbar #outline-btn { display: none; }

  /* Preview/Code collapse to a single icon. Hide the active button so
     only the OTHER view's icon stays visible. The remaining button's
     existing click handler already switches to its own view, so the
     visible icon naturally represents the action — like a dark-mode
     toggle that shows the sun if you're in dark mode. */
  #toolbar #view-seg .seg-btn.active { display: none; }

  /* Drop the segmented pill background at this width so the lone icon
     reads as a plain icon button, not half of a pill. Override the
     focus / cursor-near / panel-open variants too so it stays flat. */
  #toolbar #view-seg,
  #toolbar.cursor-near #view-seg,
  #toolbar:focus-within #view-seg,
  #toolbar.panel-open #view-seg {
    background: transparent;
    padding: 0;
  }
}
```

- [ ] **Step 2.2: Compile + run the test suite**

```
npm run compile && npm test
```

Expected: `Webview built.` and 153 tests pass. The pre-existing `toggle.test.ts` failure is acceptable.

- [ ] **Step 2.3: Manual smoke for the 640px tier**

Launch the extension dev host again (or reload if still running) and open a `.md` file. Walk through the full range:

1. **Start wide (> 900px).** Confirm Task 1 still works — labels visible, both Preview and Code buttons.
2. **Narrow to ~800px.** Labels disappear (Task 1 effect). Outline button still visible. Both Preview and Code icons still in segmented pill.
3. **Narrow to < 640px.** Outline button vanishes from the toolbar. The segmented pill background disappears; only ONE Preview/Code icon remains — whichever view you're NOT currently in.
4. **Click that icon at < 640px.** View switches. The icon now flips to the other view's icon automatically (the previously-active button becomes inactive and visible).
5. **Open outline above 640px, then narrow below.** The 240px left gutter on the editor disappears (content reclaims it). When you grow back wide, the outline returns in its previous open state.
6. **Grow back wide (> 900px).** Everything restores: labels back, both Preview/Code icons back, outline button back, outline panel back if it was open.

- [ ] **Step 2.4: Commit**

```bash
git add src/webview/styles/editor.css
git commit -m "feat(toolbar): below 640px auto-collapse the outline panel + its button, and collapse the Preview/Code segmented pair to a single-icon switch (hide active button, drop the segmented pill background so it reads as a plain icon)"
```

---

## Task 3: Push the branch

The two commits go to `origin/feat/board-block` so the work is visible.

**Files:** none

- [ ] **Step 3.1: Push**

```
git push origin feat/board-block
```

Expected: two new commits land on the remote.

- [ ] **Step 3.2: Confirm clean state**

```
git status
```

Expected: `On branch feat/board-block`, `Your branch is up to date with 'origin/feat/board-block'`, `nothing to commit, working tree clean`.
