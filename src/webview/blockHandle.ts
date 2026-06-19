import { Editor } from '@tiptap/core';
import { createBlockPicker } from './blockPicker';
import { createCalloutMenu } from './calloutMenu';
import { slashShouldOpenPicker } from './slashTrigger';
import { createPlusIcon, createGripIcon } from './handleIcons';

function getInsertPosFromHandle(editor: Editor, handleEl: HTMLElement): number {
  const rect = handleEl.getBoundingClientRect();
  // Sample a point just to the right of the handle, at vertical mid-point
  const result = editor.view.posAtCoords({
    left: rect.right + 24,
    top:  rect.top + rect.height / 2,
  });
  if (!result) return editor.state.doc.content.size;

  const $pos = editor.view.state.doc.resolve(result.pos);
  // Walk up to a top-level child of the doc
  let depth = $pos.depth;
  while (depth > 1) depth--;
  return $pos.end(depth);
}

interface BlockUnderHandle {
  typeName: string;
  attrs: Record<string, unknown>;
  blockPos: number;
  blockEnd: number;
}

function getBlockAtHandle(editor: Editor, handleEl: HTMLElement): BlockUnderHandle | null {
  try {
    const rect = handleEl.getBoundingClientRect();
    const result = editor.view.posAtCoords({
      left: rect.right + 24,
      top:  rect.top + rect.height / 2,
    });
    if (!result) return null;
    const $pos = editor.view.state.doc.resolve(result.pos);
    if ($pos.depth < 1) return null;
    const blockPos = $pos.before(1);
    const node = editor.state.doc.nodeAt(blockPos);
    if (!node) return null;
    return {
      typeName: node.type.name,
      attrs: { ...node.attrs },
      blockPos,
      blockEnd: blockPos + node.nodeSize,
    };
  } catch (err) {
    console.error('[md-editor-plus] getBlockAtHandle failed', err);
    return null;
  }
}

function showTooltip(tooltip: HTMLElement, targetEl: HTMLElement, text: string): void {
  tooltip.innerHTML = text;
  tooltip.style.display = 'block';
  const rect = targetEl.getBoundingClientRect();
  tooltip.style.left = `${rect.left + rect.width / 2}px`;
  tooltip.style.top  = `${rect.top - tooltip.offsetHeight - 6}px`;
  // Correct left/top after measuring size, with viewport-edge clamping
  requestAnimationFrame(() => {
    const margin = 8;
    const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
    let left = rect.left + rect.width / 2 - tw / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - tw - margin));
    let top = rect.top - th - 6;
    if (top < margin) top = rect.bottom + 6;  // flip below if no room above
    top = Math.max(margin, Math.min(top, window.innerHeight - th - margin));
    tooltip.style.left = `${left}px`;
    tooltip.style.top  = `${top}px`;
  });
}

function hideTooltip(tooltip: HTMLElement): void {
  tooltip.style.display = 'none';
}

export function createBlockHandle(editor: Editor): void {
  const picker  = createBlockPicker(editor);
  // Initialize the callout popover so its emoji-click trigger gets installed.
  // The dragger itself always opens the regular block picker — type/emoji
  // changes for an existing callout happen via clicking the emoji.
  try {
    createCalloutMenu(editor);
  } catch (err) {
    console.error('[md-editor-plus] callout menu init failed', err);
  }
  const tooltip = document.createElement('div');
  tooltip.className = 'block-handle-tooltip';
  document.body.appendChild(tooltip);

  // GlobalDragHandle creates a .drag-handle element after the editor mounts.
  // We augment it with our + button and drag icon once it exists.
  const interval = setInterval(() => {
    const handleEl = document.querySelector<HTMLElement>('.drag-handle');
    if (!handleEl) return;
    clearInterval(interval);

    // Inject + button at the start of the handle
    const plusBtn = document.createElement('button');
    plusBtn.className = 'block-handle-plus';
    plusBtn.appendChild(createPlusIcon());
    handleEl.insertAdjacentElement('afterbegin', plusBtn);

    // Wrap the existing drag icon content in a styled span
    const dragIcon = document.createElement('div');
    dragIcon.className = 'block-handle-drag';
    dragIcon.appendChild(createGripIcon());
    // Replace whatever GlobalDragHandle put inside (keep only our icon)
    Array.from(handleEl.children).forEach(child => {
      if (child !== plusBtn) child.remove();
    });
    handleEl.appendChild(dragIcon);

    // + button: click → open picker
    plusBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      picker.open(plusBtn, getInsertPosFromHandle(editor, handleEl));
    });

    // + button: tooltip
    plusBtn.addEventListener('mouseenter', () => {
      showTooltip(tooltip, plusBtn, 'Add block below');
    });
    plusBtn.addEventListener('mouseleave', () => hideTooltip(tooltip));

    // drag icon: click without drag → open the block action menu (Turn into /
    // Duplicate / Delete) for the current block. Also place the editor
    // selection inside the block so the user sees it as "selected" and the
    // view scrolls if needed.
    let dragStarted = false;
    dragIcon.addEventListener('dragstart', () => { dragStarted = true; });
    dragIcon.addEventListener('click', e => {
      if (dragStarted) { dragStarted = false; return; }
      e.preventDefault();
      e.stopPropagation();
      const block = getBlockAtHandle(editor, handleEl);
      if (block) {
        try {
          editor
            .chain()
            .setTextSelection(block.blockPos + 1)
            .scrollIntoView()
            .run();
        } catch { /* ignore — selection may not be valid for atomic nodes */ }
      }
      picker.open(
        dragIcon,
        getInsertPosFromHandle(editor, handleEl),
        block ? { activeBlock: block } : undefined,
      );
    });

    // drag icon: tooltip
    dragIcon.addEventListener('mouseenter', () => {
      showTooltip(tooltip, dragIcon,
        '<strong>Drag</strong> to move<br><strong>Click</strong> or <span class="kbd">⌘/</span> to open menu'
      );
    });
    dragIcon.addEventListener('mouseleave', () => hideTooltip(tooltip));

    // Hide the global block handle when the cursor is over a code block —
    // code blocks have their own per-line drag in the gutter. Use mousemove
    // (not a mutation observer on the handle's style) so we never get stuck
    // in the wrong state if the extension toggles via class changes.
    let hideCb = false;
    document.addEventListener('mousemove', (e) => {
      const t = e.target as HTMLElement | null;
      // Don't change state while hovering the handle itself — keep last value
      if (t?.closest?.('.drag-handle')) return;
      const overCb = !!t?.closest?.('.ProseMirror .cb');
      if (overCb !== hideCb) {
        hideCb = overCb;
        handleEl.classList.toggle('hide-cb', overCb);
      }
    });

  }, 100);

  // ⌘/ anywhere, or plain "/" on an empty block — opens picker at the cursor.
  editor.view.dom.addEventListener('keydown', (e: KeyboardEvent) => {
    const metaSlash = e.key === '/' && (e.metaKey || e.ctrlKey);
    const sel = editor.state.selection;
    const plainSlash =
      e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey &&
      slashShouldOpenPicker(sel.$from.parent.textContent, sel.empty);
    if (metaSlash || plainSlash) {
      e.preventDefault();
      const { from } = editor.state.selection;
      const $pos  = editor.view.state.doc.resolve(from);
      let depth = $pos.depth;
      while (depth > 1) depth--;
      const insertPos = $pos.end(depth);

      // Position picker near cursor
      const coords = editor.view.coordsAtPos(from);
      const anchor = document.createElement('div');
      anchor.style.cssText = `position:fixed;left:${coords.left}px;top:${coords.bottom}px;width:0;height:0`;
      document.body.appendChild(anchor);
      picker.open(anchor, insertPos);
      requestAnimationFrame(() => anchor.remove());
    }
  });
}
