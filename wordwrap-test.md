# Word wrap — Code view test

Switch to the **Code** view (segmented toggle) then open settings (Aa) → Code blocks → toggle **Word wrap: Only in Code view**.

The line below should wrap once the toggle is on, and overflow horizontally when it's off.

This is a very long line of plain markdown text that should overflow horizontally without word wrap enabled — and then wrap into multiple visible lines once you turn on the new Word wrap toggle in the settings panel, with no horizontal scrollbar needed. It keeps going to make sure the line is genuinely longer than the viewport at any reasonable width so you can really see the difference between the two modes side by side.

A second long line for good measure, also intended to exceed the viewport width and let you see how a paragraph with multiple long sentences wraps when the new option is enabled, versus what it currently does without the option, which is to extend off the right edge until the user scrolls horizontally to read the rest of the line.

## Conflict banner test

To test the conflict banner: open a `.md` file in this editor, start typing, then have an AI agent (or `echo "new content" > file.md` in another terminal) overwrite the file while your edits are still in the 500ms debounce. You should see the yellow banner at the top.

## Read-only test

Settings (Aa) → Editing → toggle **Read only**. Typing should be blocked, drag handle hidden.

## Refresh test

Click the refresh icon in the toolbar (right of the filename, before Aa). It re-pulls the current document content into the webview.
