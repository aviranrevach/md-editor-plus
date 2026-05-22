import { Node, mergeAttributes } from '@tiptap/core';
import mermaid from 'mermaid';

let mermaidInitialized = false;

function ensureMermaidInit(theme: 'default' | 'dark'): void {
  mermaid.initialize({
    startOnLoad: false,
    suppressErrorRendering: true,
    theme,
  });
  mermaidInitialized = true;
}

/** Detect current page theme and return mermaid-compatible theme name. */
function detectMermaidTheme(): 'default' | 'dark' {
  const html = document.documentElement;
  if (html.classList.contains('dark')) return 'dark';
  return 'default';
}

export function mermaidBlockToMarkdown(code: string): string {
  return '```mermaid\n' + code + '\n```\n';
}

export function isMermaidFence(line: string): boolean {
  return /^```mermaid\s*$/i.test(line.trim());
}

/**
 * Extract mermaid fenced blocks from raw markdown and convert them to HTML
 * div placeholders that our TipTap node can parse. This mirrors the callout
 * preprocessing approach.
 */
export function preprocessMermaidBlocks(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    if (!isMermaidFence(lines[i])) {
      out.push(lines[i]);
      i++;
      continue;
    }
    // Consume the fenced block
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && !lines[j].trim().startsWith('```')) {
      body.push(lines[j]);
      j++;
    }
    // Skip closing ```
    if (j < lines.length) j++;
    const code = body.join('\n');
    const escaped = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '&#10;');
    out.push(
      `<div data-mermaid-block data-code="${escaped}"></div>`,
      '',
    );
    i = j;
  }
  return out.join('\n');
}

let _idCounter = 0;
function uniqueId(): string {
  return `mermaid-${Date.now()}-${_idCounter++}`;
}

const MermaidBlock = Node.create({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      code: {
        default: '',
        parseHTML: (element) => {
          // getAttribute() already returns the decoded attribute value
          // (the browser's HTML parser decodes entities like &lt; → <).
          // No additional decoding step is needed.
          return element.getAttribute('data-code') ?? '';
        },
        renderHTML: (attrs) => ({ 'data-code': attrs.code }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-mermaid-block]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes({ 'data-mermaid-block': '', class: 'mermaid-block' }, HTMLAttributes),
    ];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div');
      dom.className = 'mermaid-block';

      // Header
      const header = document.createElement('div');
      header.className = 'mermaid-header';
      header.contentEditable = 'false';

      const label = document.createElement('span');
      label.className = 'mermaid-label';
      label.textContent = 'mermaid';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'mermaid-edit-btn';
      editBtn.textContent = 'Edit';
      editBtn.contentEditable = 'false';

      header.appendChild(label);
      header.appendChild(editBtn);

      // Diagram container
      const diagramContainer = document.createElement('div');
      diagramContainer.className = 'mermaid-diagram';
      diagramContainer.contentEditable = 'false';

      // Source editor (hidden by default)
      const sourceContainer = document.createElement('div');
      sourceContainer.className = 'mermaid-source';
      sourceContainer.style.display = 'none';

      const textarea = document.createElement('textarea');
      textarea.className = 'mermaid-textarea';
      textarea.spellcheck = false;
      textarea.value = node.attrs.code || '';

      sourceContainer.appendChild(textarea);

      dom.appendChild(header);
      dom.appendChild(diagramContainer);
      dom.appendChild(sourceContainer);

      let isEditing = false;
      let renderTimer: ReturnType<typeof setTimeout> | null = null;

      function toggleEdit(): void {
        isEditing = !isEditing;
        if (isEditing) {
          sourceContainer.style.display = 'block';
          editBtn.textContent = 'Done';
          textarea.value = node.attrs.code || '';
          textarea.focus();
        } else {
          sourceContainer.style.display = 'none';
          editBtn.textContent = 'Edit';
          // Commit changes to the node
          const newCode = textarea.value;
          if (newCode !== node.attrs.code && typeof getPos === 'function') {
            const pos = getPos();
            if (typeof pos === 'number') {
              editor.chain().focus().command(({ tr }) => {
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, code: newCode });
                return true;
              }).run();
            }
          }
        }
      }

      editBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      editBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleEdit();
      });

      // Prevent ProseMirror from capturing textarea events
      textarea.addEventListener('mousedown', (e) => e.stopPropagation());
      textarea.addEventListener('keydown', (e) => e.stopPropagation());

      // Live re-render on input (debounced)
      textarea.addEventListener('input', () => {
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = setTimeout(() => renderDiagram(textarea.value), 400);
      });

      async function renderDiagram(code: string): Promise<void> {
        if (!code.trim()) {
          diagramContainer.innerHTML = '<p class="mermaid-placeholder">Empty diagram</p>';
          return;
        }
        const theme = detectMermaidTheme();
        if (!mermaidInitialized) {
          ensureMermaidInit(theme);
        } else {
          // Re-init if theme changed
          mermaid.initialize({ startOnLoad: false, suppressErrorRendering: true, theme });
        }
        const id = uniqueId();
        try {
          const { svg } = await mermaid.render(id, code.trim());
          diagramContainer.innerHTML = svg;
          diagramContainer.classList.remove('mermaid-error');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          diagramContainer.innerHTML = `<p class="mermaid-error-msg">Diagram error: ${msg}</p>`;
          diagramContainer.classList.add('mermaid-error');
          // Clean up any leftover render element mermaid may have injected
          const leftover = document.getElementById('d' + id);
          if (leftover) leftover.remove();
        }
      }

      // Initial render
      renderDiagram(node.attrs.code || '');

      return {
        dom,
        ignoreMutation() {
          // We manage all DOM ourselves
          return true;
        },
        update(updatedNode) {
          if (updatedNode.type.name !== 'mermaidBlock') return false;
          if (updatedNode.attrs.code !== node.attrs.code) {
            node = updatedNode;
            if (!isEditing) {
              textarea.value = node.attrs.code || '';
              renderDiagram(node.attrs.code || '');
            }
          } else {
            node = updatedNode;
          }
          return true;
        },
        destroy() {
          if (renderTimer) clearTimeout(renderTimer);
        },
      };
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(mermaidBlockToMarkdown(node.attrs.code));
          state.ensureNewLine();
        },
      },
    };
  },
});

export default MermaidBlock;
