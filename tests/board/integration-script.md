# Board integration manual test

Run through this checklist after every release-worthy change to the board feature. Note any failures and open a fix task before merging.

1. Create a new .md file. Insert `/board`. A 3-column kanban appears with one "New card" in Todo.
2. Rename the board to "Test board". Switch to source view; confirm `name="Test board"`.
3. Click the card. Side panel opens. Type a title. Add a description ("body") with a heading and a list.
4. Add an "Owner" field via Properties → Add field → type=person. Set its value to `@me` in the side panel.
5. Add a "Due" field via Properties → Add field → type=date. Set to today + 1 day.
6. Add 2 more cards. Drag one from Todo to Done.
7. Drag the Done column to be first.
8. Switch to source view. Verify the file is a clean markdown table + bodies + markers — no JSON blobs.
9. Close VSCode. Reopen the file. Everything renders identically.
10. Open the file in another markdown viewer (e.g. GitHub preview). Verify the table is readable and the bodies render as normal markdown.
11. In the dots menu, enable read-only. Verify no edits, drags, or `+` buttons.
12. Disable read-only. Edit a status cell directly in source view (e.g. type "Doing" instead of "Done"). Save. Switch back to block view — the card moved.
