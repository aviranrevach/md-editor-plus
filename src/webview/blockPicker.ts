import { Editor } from '@tiptap/core';

export interface BlockDef {
  id: string;
  label: string;
  description: string;
  icon: string;
  section: 'text' | 'lists' | 'media' | 'other';
  aliases?: string[];
  insert: (editor: Editor, pos: number) => void;
}

export const BLOCK_DEFS: BlockDef[] = [
  {
    id: 'paragraph',
    label: 'Paragraph',
    description: 'Plain text block',
    icon: '¶',
    section: 'text',
    insert: (editor, pos) =>
      editor.chain().focus().insertContentAt(pos, { type: 'paragraph', content: [] }).run(),
  },
  {
    id: 'heading1',
    label: 'Heading 1',
    description: 'Big section title',
    icon: 'H1',
    section: 'text',
    aliases: ['h1'],
    insert: (editor, pos) =>
      editor.chain().focus().insertContentAt(pos, { type: 'heading', attrs: { level: 1 }, content: [] }).run(),
  },
  {
    id: 'heading2',
    label: 'Heading 2',
    description: 'Sub-section heading',
    icon: 'H2',
    section: 'text',
    aliases: ['h2'],
    insert: (editor, pos) =>
      editor.chain().focus().insertContentAt(pos, { type: 'heading', attrs: { level: 2 }, content: [] }).run(),
  },
  {
    id: 'heading3',
    label: 'Heading 3',
    description: 'Small heading',
    icon: 'H3',
    section: 'text',
    aliases: ['h3'],
    insert: (editor, pos) =>
      editor.chain().focus().insertContentAt(pos, { type: 'heading', attrs: { level: 3 }, content: [] }).run(),
  },
  {
    id: 'bulletList',
    label: 'Bullet list',
    description: 'Unordered list',
    icon: '•',
    section: 'lists',
    insert: (editor, pos) =>
      editor.chain().focus().insertContentAt(pos, {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [] }] }],
      }).run(),
  },
  {
    id: 'orderedList',
    label: 'Numbered list',
    description: 'Ordered list',
    icon: '1.',
    section: 'lists',
    insert: (editor, pos) =>
      editor.chain().focus().insertContentAt(pos, {
        type: 'orderedList',
        content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [] }] }],
      }).run(),
  },
  {
    id: 'taskList',
    label: 'Task list',
    description: 'Checkbox list',
    icon: '☑',
    section: 'lists',
    insert: (editor, pos) =>
      editor.chain().focus().insertContentAt(pos, {
        type: 'taskList',
        content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [] }] }],
      }).run(),
  },
  {
    id: 'image',
    label: 'Image',
    description: 'Paste URL or drag & drop',
    icon: '🖼',
    section: 'media',
    insert: (editor, pos) => {
      const url = window.prompt('Image URL:');
      if (url) editor.chain().focus().insertContentAt(pos, { type: 'image', attrs: { src: url, alt: '' } }).run();
    },
  },
  {
    id: 'callout',
    label: 'Callout',
    description: 'Highlighted note block',
    icon: '💡',
    section: 'media',
    insert: (editor, pos) =>
      editor.chain().focus().insertContentAt(pos, {
        type: 'callout',
        attrs: { type: 'note', emoji: '💡' },
        content: [{ type: 'text', text: ' ' }],
      }).run(),
  },
  {
    id: 'toggle',
    label: 'Toggle',
    description: 'Collapsible section',
    icon: '▶',
    section: 'media',
    insert: (editor, pos) =>
      editor.chain().focus().insertContentAt(pos, {
        type: 'toggle',
        attrs: { summary: 'Toggle' },
        content: [{ type: 'paragraph', content: [] }],
      }).run(),
  },
  {
    id: 'blockquote',
    label: 'Blockquote',
    description: 'Quoted text',
    icon: '❝',
    section: 'other',
    insert: (editor, pos) =>
      editor.chain().focus().insertContentAt(pos, {
        type: 'blockquote',
        content: [{ type: 'paragraph', content: [] }],
      }).run(),
  },
  {
    id: 'codeBlock',
    label: 'Code block',
    description: 'Syntax-highlighted code',
    icon: '</>',
    section: 'other',
    insert: (editor, pos) =>
      editor.chain().focus().insertContentAt(pos, { type: 'codeBlock', attrs: { language: null } }).run(),
  },
  {
    id: 'horizontalRule',
    label: 'Divider',
    description: 'Horizontal rule',
    icon: '—',
    section: 'other',
    insert: (editor, pos) =>
      editor.chain().focus().insertContentAt(pos, { type: 'horizontalRule' }).run(),
  },
];

export function filterBlocks(query: string): BlockDef[] {
  if (!query.trim()) return BLOCK_DEFS;
  const q = query.toLowerCase();
  return BLOCK_DEFS.filter(
    b =>
      b.label.toLowerCase().includes(q) ||
      b.description.toLowerCase().includes(q) ||
      b.id.toLowerCase().includes(q) ||
      (b.aliases ?? []).some(a => a.toLowerCase().includes(q)),
  );
}

const SECTION_LABELS: Record<BlockDef['section'], string> = {
  text:  'Text',
  lists: 'Lists',
  media: 'Media & blocks',
  other: 'Other',
};

export interface BlockPicker {
  open: (anchorEl: HTMLElement, insertPos: number) => void;
  close: () => void;
}

export function createBlockPicker(editor: Editor): BlockPicker {
  let currentPos = 0;
  let activeIdx  = 0;
  let filtered: BlockDef[] = BLOCK_DEFS;

  const el = document.createElement('div');
  el.className = 'block-picker';
  el.innerHTML = `
    <div class="block-picker-search">
      <input class="block-picker-input" placeholder="Filter blocks…" autocomplete="off" spellcheck="false" />
    </div>
    <div class="block-picker-list"></div>
  `;
  document.body.appendChild(el);

  const input = el.querySelector<HTMLInputElement>('.block-picker-input')!;
  const list  = el.querySelector<HTMLElement>('.block-picker-list')!;

  function renderList(items: BlockDef[]): void {
    list.innerHTML = '';
    let globalIdx = 0;
    ((['text', 'lists', 'media', 'other'] as const)).forEach(section => {
      const sectionItems = items.filter(b => b.section === section);
      if (!sectionItems.length) return;
      if (list.childElementCount > 0) {
        const sep = document.createElement('div');
        sep.className = 'block-picker-sep';
        list.appendChild(sep);
      }
      const lbl = document.createElement('div');
      lbl.className = 'block-picker-section-label';
      lbl.textContent = SECTION_LABELS[section];
      list.appendChild(lbl);
      sectionItems.forEach(block => {
        const row = document.createElement('div');
        row.className = 'block-picker-item';
        row.dataset.idx = String(globalIdx);
        row.innerHTML = `<span class="block-picker-icon">${block.icon}</span><span class="block-picker-label">${block.label}</span>`;
        row.addEventListener('mousedown', e => { e.preventDefault(); select(block); });
        list.appendChild(row);
        globalIdx++;
      });
    });
    activeIdx = 0;
    updateActive();
  }

  function updateActive(): void {
    list.querySelectorAll<HTMLElement>('.block-picker-item').forEach((row, i) => {
      row.classList.toggle('active', i === activeIdx);
    });
  }

  function select(block: BlockDef): void {
    block.insert(editor, currentPos);
    close();
  }

  input.addEventListener('input', () => {
    filtered = filterBlocks(input.value);
    renderList(filtered);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, filtered.length - 1);
      updateActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      updateActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[activeIdx]) select(filtered[activeIdx]);
    } else if (e.key === 'Escape') {
      close();
    }
  });

  function open(anchorEl: HTMLElement, insertPos: number): void {
    currentPos = insertPos;
    filtered = BLOCK_DEFS;
    input.value = '';
    renderList(BLOCK_DEFS);
    el.classList.add('open');

    const rect = anchorEl.getBoundingClientRect();
    el.style.left = `${rect.left + window.scrollX}px`;
    el.style.top  = `${rect.bottom + window.scrollY + 6}px`;

    requestAnimationFrame(() => {
      const pickerRect = el.getBoundingClientRect();
      if (pickerRect.bottom > window.innerHeight - 12) {
        el.style.top = `${rect.top + window.scrollY - pickerRect.height - 6}px`;
      }
      input.focus();
    });
  }

  function close(): void {
    el.classList.remove('open');
    input.value = '';
  }

  document.addEventListener('mousedown', e => {
    if (!el.contains(e.target as Node)) close();
  });

  return { open, close };
}
