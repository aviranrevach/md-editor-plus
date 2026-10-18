import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Plugin } from '@tiptap/pm/state';

function stripCodeFence(text: string): string {
  // Strip ```lang\n...\n``` or ```\n...\n``` if it wraps the whole clipboard
  const m = text.match(/^```[a-zA-Z0-9_+\-#.]*\n([\s\S]*?)\n```\s*$/);
  return m ? m[1] : text;
}

const COPY_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

const CodeBlock = CodeBlockLowlight.extend({
  addProseMirrorPlugins() {
    const parentPlugins = this.parent?.() ?? [];
    return [
      ...parentPlugins,
      new Plugin({
        props: {
          handlePaste(view, event) {
            const { $from } = view.state.selection;
            // Only intervene when pasting inside a code block
            if ($from.parent.type.name !== 'codeBlock') return false;
            const raw = event.clipboardData?.getData('text/plain') ?? '';
            if (!raw) return false;
            const stripped = stripCodeFence(raw);
            if (stripped === raw) return false;
            event.preventDefault();
            view.dispatch(view.state.tr.insertText(stripped));
            return true;
          },
        },
      }),
    ];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div');
      dom.className = 'cb';

      // Header
      const header = document.createElement('div');
      header.className = 'cb-header';
      header.contentEditable = 'false';

      const lang = document.createElement('span');
      lang.className = 'cb-lang';
      lang.textContent = node.attrs.language || 'text';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'cb-copy';
      copyBtn.contentEditable = 'false';
      copyBtn.dataset.tip = 'Copy code to clipboard';
      const setLabel = (text: string): void => {
        copyBtn.innerHTML = `${COPY_ICON_SVG}<span>${text}</span>`;
      };
      setLabel('Copy');

      header.appendChild(lang);
      header.appendChild(copyBtn);

      // Body: gutter + content
      const body = document.createElement('div');
      body.className = 'cb-body';

      const gutter = document.createElement('div');
      gutter.className = 'cb-gutter';
      gutter.contentEditable = 'false';
      gutter.setAttribute('aria-hidden', 'true');

      const pre = document.createElement('pre');
      pre.className = 'cb-content';

      const code = document.createElement('code');
      code.className = `hljs language-${node.attrs.language || 'text'}`;

      pre.appendChild(code);
      body.appendChild(gutter);
      body.appendChild(pre);

      // Show more / Show less button — visible only when html.shorten-snippets
      // is set AND this block is long enough to be collapsed (cb-can-collapse).
      const showMoreBtn = document.createElement('button');
      showMoreBtn.type = 'button';
      showMoreBtn.className = 'cb-show-more';
      showMoreBtn.contentEditable = 'false';
      showMoreBtn.textContent = 'Show more';
      showMoreBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
      showMoreBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const expanded = dom.classList.toggle('cb-expanded');
        showMoreBtn.textContent = expanded ? 'Show less' : 'Show more';
      });

      dom.appendChild(header);
      dom.appendChild(body);
      dom.appendChild(showMoreBtn);

      const COLLAPSE_THRESHOLD = 14;

      function updateGutter(): void {
        const text = code.textContent ?? '';
        const trimmed = text.endsWith('\n') ? text.slice(0, -1) : text;
        const lineCount = Math.max(1, trimmed.split('\n').length);
        const lines: HTMLDivElement[] = [];
        for (let i = 0; i < lineCount; i++) {
          const div = document.createElement('div');
          div.className = 'cb-line';
          div.dataset.line = String(i);
          div.textContent = String(i + 1);
          lines.push(div);
        }
        gutter.replaceChildren(...lines);
        dom.classList.toggle('cb-can-collapse', lineCount > COLLAPSE_THRESHOLD);
        if (!dom.classList.contains('cb-expanded')) showMoreBtn.textContent = 'Show more';
      }

      function moveLine(srcIdx: number, insertIdx: number): void {
        if (typeof getPos !== 'function') return;
        const pos = getPos();
        if (typeof pos !== 'number') return;
        const cbNode = editor.state.doc.nodeAt(pos);
        if (!cbNode) return;
        const text = cbNode.textContent;
        const lines = text.split('\n');
        if (srcIdx < 0 || srcIdx >= lines.length) return;
        if (insertIdx < 0 || insertIdx > lines.length) return;
        if (insertIdx === srcIdx || insertIdx === srcIdx + 1) return;
        const [moved] = lines.splice(srcIdx, 1);
        const adjusted = insertIdx > srcIdx ? insertIdx - 1 : insertIdx;
        lines.splice(adjusted, 0, moved);
        const newText = lines.join('\n');
        // Replace the whole code block node so lowlight's plugin re-tokenizes.
        // (Replacing only inner text leaves the existing decoration set in
        // place — colors get mapped through but never recomputed.)
        const newContent = newText.length > 0 ? editor.schema.text(newText) : undefined;
        const newNode = cbNode.type.create(cbNode.attrs, newContent);
        editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + cbNode.nodeSize, newNode));
      }

      // Manual drag with mouse events — HTML5 dragstart is intercepted by
      // ProseMirror, so we drive the interaction ourselves.
      let dragSrc: { idx: number; el: HTMLElement } | null = null;
      let dropEl: HTMLDivElement | null = null;

      function showDropLine(insertIdx: number): void {
        const lh = parseFloat(getComputedStyle(pre).lineHeight) || 22;
        const padTop = parseFloat(getComputedStyle(body).paddingTop) || 26;
        const bodyRect = body.getBoundingClientRect();
        if (!dropEl) {
          dropEl = document.createElement('div');
          dropEl.className = 'cb-drop-line';
          // Attach to document.body so ProseMirror doesn't observe this mutation
          // inside the NodeView and tear down the drag mid-flight.
          document.body.appendChild(dropEl);
        }
        dropEl.style.top = `${bodyRect.top + padTop + insertIdx * lh - 1}px`;
        dropEl.style.left = `${bodyRect.left + 6}px`;
        dropEl.style.width = `${Math.max(0, bodyRect.width - 12)}px`;
      }

      function hideDropLine(): void {
        if (dropEl) { dropEl.remove(); dropEl = null; }
      }

      type Hit = { idx: number; insertBefore: boolean };

      function hitAt(clientY: number): Hit | null {
        const lines = gutter.querySelectorAll<HTMLElement>('.cb-line');
        if (lines.length === 0) return null;
        for (const el of Array.from(lines)) {
          const r = el.getBoundingClientRect();
          if (clientY >= r.top && clientY <= r.bottom) {
            const idx = parseInt(el.dataset.line ?? '-1', 10);
            if (!Number.isFinite(idx) || idx < 0) return null;
            return { idx, insertBefore: clientY < r.top + r.height / 2 };
          }
        }
        const firstR = lines[0].getBoundingClientRect();
        if (clientY < firstR.top) return { idx: 0, insertBefore: true };
        const lastR = lines[lines.length - 1].getBoundingClientRect();
        if (clientY > lastR.bottom) {
          const idx = parseInt(lines[lines.length - 1].dataset.line ?? '-1', 10);
          return { idx, insertBefore: false };
        }
        return null;
      }

      function onMove(e: MouseEvent): void {
        if (!dragSrc) return;
        e.preventDefault();
        const hit = hitAt(e.clientY);
        if (!hit) { hideDropLine(); return; }
        const insertIdx = hit.insertBefore ? hit.idx : hit.idx + 1;
        if (insertIdx === dragSrc.idx || insertIdx === dragSrc.idx + 1) {
          hideDropLine();
          return;
        }
        showDropLine(insertIdx);
      }

      function onUp(e: MouseEvent): void {
        if (!dragSrc) return;
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', onUp, true);
        const src = dragSrc;
        dragSrc = null;
        src.el.classList.remove('cb-line-dragging');
        document.body.classList.remove('cb-line-drag-active');
        document.body.style.cursor = '';
        hideDropLine();
        const hit = hitAt(e.clientY);
        if (hit) {
          const insertIdx = hit.insertBefore ? hit.idx : hit.idx + 1;
          moveLine(src.idx, insertIdx);
        }
      }

      gutter.addEventListener('mousedown', (e) => {
        const el = (e.target as HTMLElement).closest?.('.cb-line') as HTMLElement | null;
        if (!el) return;
        e.preventDefault();
        e.stopPropagation();
        const idx = parseInt(el.dataset.line ?? '-1', 10);
        if (!Number.isFinite(idx) || idx < 0) return;
        dragSrc = { idx, el };
        el.classList.add('cb-line-dragging');
        document.body.classList.add('cb-line-drag-active');
        document.body.style.cursor = 'grabbing';
        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('mouseup', onUp, true);
      });
      // Initial render is empty — ProseMirror injects content after construction.
      // Watch the code element for any text changes (initial fill, edits, lowlight retokenize).
      const observer = new MutationObserver(updateGutter);
      observer.observe(code, { childList: true, characterData: true, subtree: true });
      requestAnimationFrame(updateGutter);

      copyBtn.addEventListener('mousedown', (e) => {
        // Prevent ProseMirror from handling this and stealing focus
        e.preventDefault();
        e.stopPropagation();
      });
      copyBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const text = code.textContent ?? '';
        navigator.clipboard.writeText(text).then(() => {
          setLabel('Copied!');
          setTimeout(() => setLabel('Copy'), 1500);
        });
      });

      return {
        dom,
        contentDOM: code,
        update(updatedNode) {
          if (updatedNode.type.name !== node.type.name) return false;
          const newLang = updatedNode.attrs.language || 'text';
          if (lang.textContent !== newLang) {
            lang.textContent = newLang;
            code.className = `hljs language-${newLang}`;
          }
          // Defer so contentDOM has updated text before we count lines
          requestAnimationFrame(updateGutter);
          return true;
        },
        ignoreMutation(mutation) {
          // Don't let header/gutter/show-more mutations bubble back into ProseMirror
          const t = mutation.target as Node;
          if (t === gutter || gutter.contains(t)) return true;
          if (t === header || header.contains(t)) return true;
          if (t === showMoreBtn || showMoreBtn.contains(t)) return true;
          // Class changes on the .cb wrapper (cb-expanded, cb-can-collapse) are ours
          if (t === dom && mutation.type === 'attributes') return true;
          return false;
        },
        destroy() {
          observer.disconnect();
          document.removeEventListener('mousemove', onMove, true);
          document.removeEventListener('mouseup', onUp, true);
          hideDropLine();
        },
      };
    };
  },
});

export default CodeBlock;
