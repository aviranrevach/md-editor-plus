# TODO

<!-- board:start id="b1" name="My Board" columns="Todo|Doing|Review|Done" column-colors="blue|amber|purple|emerald" field-types="Title=text,Status=status,id=text,Impact=status,Area=text,Tags=tags" field-options="Impact=Low:gray|Medium:indigo|High:red|Urgent!!:red;Tags=Gilad:blue" active-view="table" -->
<!-- board:view name="table" columns="Title,Area,Status,Description,Impact" sort="Impact,desc" group="Impact" widths="Area=94,Impact=60,Status=85" -->

| Title | Status | id | Impact | Area | Tags |
|---|---|---|---|---|---|
| Bug! How do I know the file im viewing is saved?? i changed a file and to my horror when i closed and opened it i got old version. i need an indicator that this is saved, and clicking cmd S should check and give me feedback that it is saved | Done | c8 | Urgent!! | General |  |
| Fix Add image feature. now it doesnt work at all when you click on it. | Done | c1 | High | Add / Modify Block |  |
| In some block types, clicking the dragger doesn't let you reach "Turn into", "Delete", "Duplicate", etc. | Done | c2 | High | Add / Modify Block |  |
| Pasting Image in - add image to workspace options (consider also in table / board table) | Review | c10 | High | General |  |
| Bug! Changing column size | Todo | c11 | High | Board table |  |
| Bug in description when pasting | Todo | c9 | Medium | General |  |
| Add "Delete property" option to the table column three-dot menu | Todo | c3 | Medium | Board Table -> Three dot menu |  |
| In the column three-dot menu, give Sort a dropdown: None / Ascending / Descending | Todo | c4 | Medium | Board Table -> Three dot menu |  |
| Board table view bug when moving title  column (Bug) | Todo | c6 | Medium | Board Table |  |
| board table sometimes clicking on a cell doesnt add in the curser and allow you to change its location in cell (Bug) | Todo | c7 | Medium | Board table -> cell |  |
| When typing -> <- Should actually put arrow character (like in notion), and check which combinations should also allow this | Done | c5 | Low | General |  |
| Board table grouping visual bugs- the color doesnt fill the whole cell | Review | c12 | High | Board table grouping |  |
| Board table grouping - allow dragging whole group and reorder groups, or organize by sorting order | Todo | c13 | Medium | Board table grouping |  |
| Main three dots menu duplicate should have two options- save in workspace, or download (saved in your download) | Todo | c14 | Medium | Main three dots menu |  |
| Export pdf doesnt work, probably html too. | Todo | c15 | High | Main three dots menu |  |
| Board table cells - the content of status clipped out of their cells when you are scaling down the window | Done | c16 | Medium | Board table -> cell |  |
| ID doesnt added automatically whe you unhide it. maybe should be read only | Done | c17 | Urgent!! | Board table |  |
| Board table remove stroke on left dragger edge cell | Todo | c18 | Low | Board table |  |
| Status is broken on boards (spotted on table view). doesnt allow you to change order, when you add new it was synched with another status- changing it would change the other one. plus on the main three dot menu- editing it from there is blocked altogether | Todo | c19 | High | Boards |  |
| Filter on Boards- allow to show / hide specific items by status / tag etc | Done | c20 | Low | Boards |  |
| Handle pasting images from clipboard. can we drop the image in a folder in the workspace? ask the user? need to brainstorm | Done | c21 | High | Images |  |
| Allow images in table cells on board list. it can be a view of a link in mid text or something? brainstorm on this | Done | c22 | High | Images |  |
| Copy unstyled (refine the naming) - when a user copied text he got this | Doing | c23 | Medium | General |  |
| Diff viewer like in vs code. | Done | c24 | Medium | General |  |
| in description panel there's no text blinking typing indicator sometimes when you click somewhere to type | Todo | c25 | Medium | Board side panel |  |
| RTL not working well usecase | Todo | c26 | Urgent!! | General |  |
| text styles doesnt work in board views | Todo | c27 | Urgent!! | Boards |  |
| Editor reports "unsaved changes" when nothing was edited, so an external / other-tab change pops a conflict banner you didn't cause. And when the two changes don't actually collide, it should merge silently instead of asking. | Done | c28 | High | Boards / Save |  |
| When the "changed outside the editor" conflict banner appears, show WHAT changed (a diff of the rows/lines that differ) so you can choose Reload vs Keep my version with context, instead of blind. Ties into c24 (diff viewer). | Done | c29 | High | Conflict banner |  |
| Gap B — a differing external change can silently revert just-made edits before they persist. Currently only instrumented (a console warning); the real fix needs the host to signal "edit in flight" so the webview can surface a conflict instead of applying. | Review | c30 | High | Boards / Save |  |
| Convert table into board teable doesnt work | Todo | c31 | High |  |  |
| Regular table dissappeard from the + and tunr into menu | Todo | c32 | Urgent!! |  |  |
| Turn into with AI is not in the Turn into menu | Todo | c33 | Urgent!! |  |  |
| fix all the menus drill downs that get cropped because they are out of the screen, and make sure this doesnt happen again in this project. if needed show me all instances of this to check them | Todo | c34 | Urgent!! |  |  |
| Search doesnt work. i tried searching "type" in this page- showed me nothing | Done | c35 | Urgent!! |  |  |
| The | Todo | c36 | Urgent!! |  |  |
| Bug! Saving says "Saved" but the file is wiped to empty (0 bytes) on disk — the whole board can vanish | Todo | c37 | Urgent!! | Boards / Save |  |
| On the image bubble menu, add another items with 2 options- 1. find file on finder. 2. copy path. it pops these options to choose- make it make sense | Todo | c38 | High |  | Gilad |

<!-- board:body id="c8" -->

<span style="color: rgb(26, 26, 26);">How do I know the file im viewing is saved?? i changed a file and to my horror when i closed and opened it i got old version. i need an indicator that this is saved, and clicking cmd S should check and give me feedback that it is saved</span>

<!-- board:body id="c2" -->

The dragger menu actions are missing for certain block types — fix so "Turn into", "Delete", "Duplicate", etc. are reachable.

<!-- board:body id="c9" -->

when i pasted into desctiption i got some code in the table view (in the panel view its was fine)

<!-- board:body id="c3" -->

The column header three-dot menu has Rename, Sort, Group by, Reset width, and Hide column — but no way to delete a property/column. Add a "Delete property" action.

<!-- board:body id="c4" -->

In the column header three-dot menu, replace the separate sort actions with a Sort dropdown input offering three choices: None, Ascending, Descending.

<!-- board:body id="c23" -->

When a user copied text from the page they got this (unstyled / wrong styling — refine the naming):

![copied-text screenshot](TODO.assets/image.png)

<!-- board:body id="c24" -->

comments from users: like a built-in diff, for example to see what changed when I change things (I marked the tab so you can see it) — this of course needs git for it. You also have the minimap idea.

> ⚠️ Reconstructed text + best-guess image (verify / re-paste from TODO.assets/).

![diff idea screenshot](TODO.assets/image-2.png)

<!-- board:body id="c26" -->

RTL use-case where Hebrew/English mixing doesn't work well. (Hebrew note, reconstructed — verify): "good morning 😊 here's a use-case where the Hebrew/English doesn't work right… you have here the two Anthropic options — try enabling 'automatic' (recommended)."

> ⚠️ Reconstructed text + best-guess image (verify / re-paste from TODO.assets/).

![RTL screenshot](TODO.assets/image-3.png)

<!-- board:body id="c27" -->

Text styles (bold/italic/color etc.) don't apply correctly inside board views.

> ⚠️ Best-guess image (verify / re-paste from TODO.assets/).

![text-styles screenshot](TODO.assets/image-4.png)

<!-- board:body id="c28" -->

Two related issues seen while testing the save fix:
1. **Phantom dirty** — opening / receiving an external update can leave the editor thinking it has unsaved changes even when the user typed nothing, so a change from another tab triggers the conflict banner unnecessarily. (No `appendTransaction` auto-transform found yet — cause still open.)
2. **Smarter conflict** — when the external change and the local change don't actually overlap (different rows/lines), merge them silently instead of prompting. Errs toward keeping both, never dropping.

Related: the save-says-"Saved"-but-not-on-disk fix (Gap A) — see docs/superpowers/plans/2026-06-16-save-says-saved-but-not-on-disk-c26.md

<!-- board:body id="c29" -->

When the "changed outside the editor" conflict banner appears, show a diff of what differs (which rows/lines) so the Reload-vs-Keep choice isn't blind. Ties into c24 (diff viewer).

<!-- board:body id="c30" -->

The narrow silent-revert: when the editor's content equals what it last sent (so it looks "in sync"), an inbound external `update` that differs gets applied, discarding edits that were sent but not yet persisted. `decideExternalUpdate` only flags a conflict for *unsent* edits, not sent-but-unconfirmed ones. Shipped a `console.warn` at the apply path to catch it live; a real fix needs the extension to tell the webview an edit is in flight (un-persisted) so it can surface a conflict instead of applying. See docs/superpowers/plans/2026-06-16-save-says-saved-but-not-on-disk-c26.md (Gap B).

**What to review:**
1. **Reproduce it** — in a git repo, edit the board, then have another tab/process change the *same* file at the moment the editor is "in sync" (its content == last-sent). Open the webview dev console (filter `md-editor-plus`) and watch for `possible silent revert — Gap B`.
2. **Confirm the harm** — does the editor's content actually get overwritten / the just-made edit lost, or does auto-save save it first? (Establish whether it's real data loss or only a theoretical window now that the save + idempotent fixes shipped.)
3. **Check the warning fires** at the apply path in `src/webview/index.ts` (the Gap B `console.warn`).
4. **Decide the fix** — host signals "edit in flight (un-persisted)" so `decideExternalUpdate` returns `conflict` for sent-but-unconfirmed edits, *without* breaking legitimate external-sync (the `syncGuard.test.ts` case that expects `apply` when truly in sync with no pending edits must stay green).
5. **Frequency** — judge whether this is worth a full fix or stays a logged tripwire (it's narrow + auto-save makes the window small).

<!-- board:body id="c37" -->

Hit live on 2026-06-17 while adding c35: **TODO.md dropped to 0 bytes on disk** while the editor still displayed the full board. Cmd+S reported success ("Saved"), but the file stayed empty — every card would have been lost without git + screenshot recovery. The on-disk file was also *behind* git in a way that suggests the wipe wasn't a one-off.

Almost certainly the same save/sync family as c8, c26, c28, c30: the editor signals "Saved" but the bytes never reach disk, and in this case an **empty buffer overwrote a non-empty file**.

**Fix direction:**
- Never write an empty / blank buffer over a non-empty file without an explicit confirm — treat "serialized output is empty but the doc is non-empty" as a bug, abort the save.
- After a save, verify the byte count actually changed on disk before reporting "Saved" (ties into the c8 save-indicator work).
- Reproduce: open TODO.md in the editor, add a row, watch disk byte count during/after save.

<!-- board:end -->

