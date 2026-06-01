import { Editor } from '@tiptap/core';

export interface BlockDef {
  id: string;
  label: string;
  description: string;
  iconHtml: string;
  section: 'text' | 'lists' | 'media' | 'other';
  aliases?: string[];
  // Either inserts directly, or drills down into a sub-list of options.
  // Items with subItems must omit insert; items with insert must omit subItems.
  insert?: (editor: Editor, pos: number) => void;
  subItems?: BlockDef[];
  // For "convert this block" mode: matches the current top-level node,
  // and replaces it with a new node of this type preserving inline content.
  isActive?: (typeName: string, attrs: Record<string, unknown>) => boolean;
  convert?: (editor: Editor, blockPos: number) => void;
}

// Replace the block at `blockPos` with a new node of `schemaNodeName`,
// preserving the original block's inline content where possible. Used for
// "turn into" conversions from the dragger menu.
function replaceBlockWith(
  editor: Editor,
  blockPos: number,
  schemaNodeName: string,
  attrs: Record<string, unknown> | null = null,
): void {
  editor.chain().focus().command(({ tr, state, dispatch }) => {
    const node = tr.doc.nodeAt(blockPos);
    if (!node) return false;
    const targetType = state.schema.nodes[schemaNodeName];
    if (!targetType) return false;
    let newNode;
    try {
      newNode = targetType.create(attrs, node.content);
    } catch {
      try { newNode = targetType.create(attrs); } catch { return false; }
    }
    if (dispatch) tr.replaceWith(blockPos, blockPos + node.nodeSize, newNode);
    return true;
  }).run();
}

// Wrap the block's inline content in a list (bulletList / orderedList /
// taskList). Lists nest inline content inside listItem > paragraph, so a
// plain replaceBlockWith doesn't work for them.
function convertToList(
  editor: Editor,
  blockPos: number,
  listName: 'bulletList' | 'orderedList' | 'taskList',
): void {
  editor.chain().focus().command(({ tr, state, dispatch }) => {
    const node = tr.doc.nodeAt(blockPos);
    if (!node) return false;
    const listType = state.schema.nodes[listName];
    const itemName = listName === 'taskList' ? 'taskItem' : 'listItem';
    const itemType = state.schema.nodes[itemName];
    const paraType = state.schema.nodes.paragraph;
    if (!listType || !itemType || !paraType) return false;
    const paraNode = paraType.create(null, node.content);
    const itemAttrs = listName === 'taskList' ? { checked: false } : null;
    const itemNode = itemType.create(itemAttrs, paraNode);
    const listNode = listType.create(null, itemNode);
    if (dispatch) tr.replaceWith(blockPos, blockPos + node.nodeSize, listNode);
    return true;
  }).run();
}

const ICO = {
  paragraph: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M208,36H96a68,68,0,0,0,0,136h36v36a12,12,0,0,0,24,0V60h16V208a12,12,0,0,0,24,0V60h12a12,12,0,0,0,0-24ZM132,148H96a44,44,0,0,1,0-88h36Z"/></svg>`,
  h1: `<span class="bm-into-text" style="font-weight:800;font-size:14px;letter-spacing:-.5px">H1</span>`,
  h2: `<span class="bm-into-text" style="font-weight:700;font-size:13px;letter-spacing:-.4px">H2</span>`,
  h3: `<span class="bm-into-text" style="font-weight:600;font-size:12px;letter-spacing:-.3px">H3</span>`,
  bullet: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M76,64A12,12,0,0,1,88,52H216a12,12,0,0,1,0,24H88A12,12,0,0,1,76,64Zm140,52H88a12,12,0,0,0,0,24H216a12,12,0,0,0,0-24Zm0,64H88a12,12,0,0,0,0,24H216a12,12,0,0,0,0-24ZM44,112a16,16,0,1,0,16,16A16,16,0,0,0,44,112Zm0-64A16,16,0,1,0,60,64,16,16,0,0,0,44,48Zm0,128a16,16,0,1,0,16,16A16,16,0,0,0,44,176Z"/></svg>`,
  ordered: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M228,128a12,12,0,0,1-12,12H116a12,12,0,0,1,0-24H216A12,12,0,0,1,228,128ZM116,76H216a12,12,0,0,0,0-24H116a12,12,0,0,0,0,24ZM216,180H116a12,12,0,0,0,0,24H216a12,12,0,0,0,0-24ZM44,59.31V104a12,12,0,0,0,24,0V40A12,12,0,0,0,50.64,29.27l-16,8a12,12,0,0,0,9.36,22Zm39.73,96.86a27.7,27.7,0,0,0-11.2-18.63A28.89,28.89,0,0,0,32.9,143a27.71,27.71,0,0,0-4.17,7.54,12,12,0,0,0,22.55,8.21,4,4,0,0,1,.58-1,4.78,4.78,0,0,1,6.5-.82,3.82,3.82,0,0,1,1.61,2.6,3.63,3.63,0,0,1-.77,2.77l-.13.17L30.39,200.82A12,12,0,0,0,40,220H72a12,12,0,0,0,0-24H64l14.28-19.11A27.48,27.48,0,0,0,83.73,156.17Z"/></svg>`,
  task: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M228,128a12,12,0,0,1-12,12H128a12,12,0,0,1,0-24h88A12,12,0,0,1,228,128ZM128,76h88a12,12,0,0,0,0-24H128a12,12,0,0,0,0,24Zm88,104H128a12,12,0,0,0,0,24h88a12,12,0,0,0,0-24ZM79.51,39.51,56,63l-7.51-7.52a12,12,0,0,0-17,17l16,16a12,12,0,0,0,17,0l32-32a12,12,0,0,0-17-17Zm0,64L56,127l-7.51-7.52a12,12,0,1,0-17,17l16,16a12,12,0,0,0,17,0l32-32a12,12,0,0,0-17-17Zm0,64L56,191l-7.51-7.52a12,12,0,1,0-17,17l16,16a12,12,0,0,0,17,0l32-32a12,12,0,0,0-17-17Z"/></svg>`,
  image: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,16V158.75l-26.07-26.06a16,16,0,0,0-22.63,0l-20,20-44-44a16,16,0,0,0-22.62,0L40,149.37V56ZM40,172l52-52,80,80H40Zm176,28H194.63l-36-36,20-20L216,181.38V200ZM144,100a12,12,0,1,1,12,12A12,12,0,0,1,144,100Z"/></svg>`,
  callout: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M176,232a8,8,0,0,1-8,8H88a8,8,0,0,1,0-16h80A8,8,0,0,1,176,232Zm40-128a87.55,87.55,0,0,1-33.64,69.21A16.24,16.24,0,0,0,176,186v6a16,16,0,0,1-16,16H96a16,16,0,0,1-16-16v-6a16,16,0,0,0-6.23-12.66A87.59,87.59,0,0,1,40,104.49C39.74,56.83,78.26,17.14,125.88,16A88,88,0,0,1,216,104Zm-16,0a72,72,0,0,0-73.74-72c-39,1-70.47,33.43-70.26,72.39a71.65,71.65,0,0,0,27.64,56.3A32,32,0,0,1,96,186v6h64v-6a32.15,32.15,0,0,1,12.47-25.35A71.65,71.65,0,0,0,200,104Zm-16.11-9.34a57.6,57.6,0,0,0-46.56-46.55,8,8,0,0,0-2.66,15.78c16.57,2.79,30.63,16.85,33.44,33.45A8,8,0,0,0,176,104a9,9,0,0,0,1.35-.11A8,8,0,0,0,183.89,94.66Z"/></svg>`,
  toggle: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z"/></svg>`,
  quote: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M100,52H40A20,20,0,0,0,20,72v64a20,20,0,0,0,20,20H96v4a28,28,0,0,1-28,28,12,12,0,0,0,0,24,52.06,52.06,0,0,0,52-52V72A20,20,0,0,0,100,52Zm-4,80H44V76H96ZM216,52H156a20,20,0,0,0-20,20v64a20,20,0,0,0,20,20h56v4a28,28,0,0,1-28,28,12,12,0,0,0,0,24,52.06,52.06,0,0,0,52-52V72A20,20,0,0,0,216,52Zm-4,80H160V76h52Z"/></svg>`,
  code: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M71.68,97.22,34.74,128l36.94,30.78a12,12,0,1,1-15.36,18.44l-48-40a12,12,0,0,1,0-18.44l48-40A12,12,0,0,1,71.68,97.22Zm176,21.56-48-40a12,12,0,1,0-15.36,18.44L221.26,128l-36.94,30.78a12,12,0,1,0,15.36,18.44l48-40a12,12,0,0,0,0-18.44ZM164.1,28.72a12,12,0,0,0-15.38,7.18l-64,176a12,12,0,0,0,7.18,15.37A11.79,11.79,0,0,0,96,228a12,12,0,0,0,11.28-7.9l64-176A12,12,0,0,0,164.1,28.72Z"/></svg>`,
  hr: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M228,128a12,12,0,0,1-12,12H40a12,12,0,0,1,0-24H216A12,12,0,0,1,228,128Z"/></svg>`,
  board: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM104,200H40V56h64Zm32-144v144H120V56Zm80,0V200H152V56Z"/></svg>`,
  whiteboard: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M240,192h-8V56a16,16,0,0,0-16-16H40A16,16,0,0,0,24,56V192H16a8,8,0,0,0,0,16H240a8,8,0,0,0,0-16ZM40,56H216V192H200V168a8,8,0,0,0-8-8H120a8,8,0,0,0-8,8v24H72V88H184v48a8,8,0,0,0,16,0V80a8,8,0,0,0-8-8H64a8,8,0,0,0-8,8V192H40ZM184,192H128V176h56Z"/></svg>`,
  trash: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M216 48h-40v-8a24 24 0 0 0-24-24h-48a24 24 0 0 0-24 24v8H40a8 8 0 0 0 0 16h8v144a16 16 0 0 0 16 16h128a16 16 0 0 0 16-16V64h8a8 8 0 0 0 0-16ZM96 40a8 8 0 0 1 8-8h48a8 8 0 0 1 8 8v8H96Zm16 152a8 8 0 0 1-16 0v-72a8 8 0 0 1 16 0Zm48 0a8 8 0 0 1-16 0v-72a8 8 0 0 1 16 0Z"/></svg>`,
};

export const BLOCK_DEFS: BlockDef[] = [
  {
    id: 'paragraph',
    label: 'Paragraph',
    description: 'Plain text block',
    iconHtml: ICO.paragraph,
    section: 'text',
    isActive: (t) => t === 'paragraph',
    insert: (editor, pos) =>
      editor.chain().focus().insertContentAt(pos, { type: 'paragraph', content: [] }).run(),
    convert: (editor, blockPos) => replaceBlockWith(editor, blockPos, 'paragraph'),
  },
  {
    id: 'heading1',
    label: 'Heading 1',
    description: 'Big section title',
    iconHtml: ICO.h1,
    section: 'text',
    aliases: ['h1'],
    isActive: (t, a) => t === 'heading' && a.level === 1,
    insert: (editor, pos) =>
      editor.chain().focus().insertContentAt(pos, { type: 'heading', attrs: { level: 1 }, content: [] }).run(),
    convert: (editor, blockPos) => replaceBlockWith(editor, blockPos, 'heading', { level: 1 }),
  },
  {
    id: 'heading2',
    label: 'Heading 2',
    description: 'Sub-section heading',
    iconHtml: ICO.h2,
    section: 'text',
    aliases: ['h2'],
    isActive: (t, a) => t === 'heading' && a.level === 2,
    insert: (editor, pos) =>
      editor.chain().focus().insertContentAt(pos, { type: 'heading', attrs: { level: 2 }, content: [] }).run(),
    convert: (editor, blockPos) => replaceBlockWith(editor, blockPos, 'heading', { level: 2 }),
  },
  {
    id: 'heading3',
    label: 'Heading 3',
    description: 'Small heading',
    iconHtml: ICO.h3,
    section: 'text',
    aliases: ['h3'],
    isActive: (t, a) => t === 'heading' && a.level === 3,
    insert: (editor, pos) =>
      editor.chain().focus().insertContentAt(pos, { type: 'heading', attrs: { level: 3 }, content: [] }).run(),
    convert: (editor, blockPos) => replaceBlockWith(editor, blockPos, 'heading', { level: 3 }),
  },
  {
    id: 'bulletList',
    label: 'Bullet list',
    description: 'Unordered list',
    iconHtml: ICO.bullet,
    section: 'lists',
    isActive: (t) => t === 'bulletList',
    insert: (editor, pos) =>
      editor.chain().focus().insertContentAt(pos, {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [] }] }],
      }).run(),
    convert: (editor, blockPos) => convertToList(editor, blockPos, 'bulletList'),
  },
  {
    id: 'orderedList',
    label: 'Numbered list',
    description: 'Ordered list',
    iconHtml: ICO.ordered,
    section: 'lists',
    isActive: (t) => t === 'orderedList',
    insert: (editor, pos) =>
      editor.chain().focus().insertContentAt(pos, {
        type: 'orderedList',
        content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [] }] }],
      }).run(),
    convert: (editor, blockPos) => convertToList(editor, blockPos, 'orderedList'),
  },
  {
    id: 'taskList',
    label: 'Task list',
    description: 'Checkbox list',
    iconHtml: ICO.task,
    section: 'lists',
    isActive: (t) => t === 'taskList',
    insert: (editor, pos) =>
      editor.chain().focus().insertContentAt(pos, {
        type: 'taskList',
        content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [] }] }],
      }).run(),
    convert: (editor, blockPos) => convertToList(editor, blockPos, 'taskList'),
  },
  {
    id: 'image',
    label: 'Image',
    description: 'Paste URL or drag & drop',
    iconHtml: ICO.image,
    section: 'media',
    isActive: (t) => t === 'image',
    insert: (editor, pos) => {
      const url = window.prompt('Image URL:');
      if (url) editor.chain().focus().insertContentAt(pos, { type: 'image', attrs: { src: url, alt: '' } }).run();
    },
  },
  {
    id: 'callout',
    label: 'Callout',
    description: 'Pick a type — Note, Tip, Important, Warning, Caution',
    iconHtml: ICO.callout,
    section: 'media',
    aliases: ['note', 'tip', 'important', 'warning', 'caution'],
    isActive: (t) => t === 'callout',
    subItems: [
      { id: 'callout-note',      label: 'Note',      description: 'Informational',
        iconHtml: '<span class="block-picker-emoji-icon" data-callout-preview="note">💡</span>',
        section: 'media',
        isActive: (t, a) => t === 'callout' && a.type === 'note',
        insert: (editor, pos) => editor.chain().focus().insertContentAt(pos, {
          type: 'callout', attrs: { type: 'note', emoji: '💡' },
          content: [{ type: 'text', text: ' ' }],
        }).run(),
        convert: (editor, blockPos) => replaceBlockWith(editor, blockPos, 'callout', { type: 'note', emoji: '💡' }) },
      { id: 'callout-tip',       label: 'Tip',       description: 'Helpful suggestion',
        iconHtml: '<span class="block-picker-emoji-icon" data-callout-preview="tip">✅</span>',
        section: 'media',
        isActive: (t, a) => t === 'callout' && a.type === 'tip',
        insert: (editor, pos) => editor.chain().focus().insertContentAt(pos, {
          type: 'callout', attrs: { type: 'tip', emoji: '✅' },
          content: [{ type: 'text', text: ' ' }],
        }).run(),
        convert: (editor, blockPos) => replaceBlockWith(editor, blockPos, 'callout', { type: 'tip', emoji: '✅' }) },
      { id: 'callout-important', label: 'Important', description: 'Crucial context',
        iconHtml: '<span class="block-picker-emoji-icon" data-callout-preview="important">📌</span>',
        section: 'media',
        isActive: (t, a) => t === 'callout' && a.type === 'important',
        insert: (editor, pos) => editor.chain().focus().insertContentAt(pos, {
          type: 'callout', attrs: { type: 'important', emoji: '📌' },
          content: [{ type: 'text', text: ' ' }],
        }).run(),
        convert: (editor, blockPos) => replaceBlockWith(editor, blockPos, 'callout', { type: 'important', emoji: '📌' }) },
      { id: 'callout-warning',   label: 'Warning',   description: 'Heads-up — possible footgun',
        iconHtml: '<span class="block-picker-emoji-icon" data-callout-preview="warning">⚠️</span>',
        section: 'media',
        isActive: (t, a) => t === 'callout' && a.type === 'warning',
        insert: (editor, pos) => editor.chain().focus().insertContentAt(pos, {
          type: 'callout', attrs: { type: 'warning', emoji: '⚠️' },
          content: [{ type: 'text', text: ' ' }],
        }).run(),
        convert: (editor, blockPos) => replaceBlockWith(editor, blockPos, 'callout', { type: 'warning', emoji: '⚠️' }) },
      { id: 'callout-caution',   label: 'Caution',   description: 'Dangerous — irreversible',
        iconHtml: '<span class="block-picker-emoji-icon" data-callout-preview="caution">🛑</span>',
        section: 'media',
        isActive: (t, a) => t === 'callout' && a.type === 'caution',
        insert: (editor, pos) => editor.chain().focus().insertContentAt(pos, {
          type: 'callout', attrs: { type: 'caution', emoji: '🛑' },
          content: [{ type: 'text', text: ' ' }],
        }).run(),
        convert: (editor, blockPos) => replaceBlockWith(editor, blockPos, 'callout', { type: 'caution', emoji: '🛑' }) },
    ],
  },
  {
    id: 'toggle',
    label: 'Toggle',
    description: 'Collapsible section',
    iconHtml: ICO.toggle,
    section: 'media',
    isActive: (t) => t === 'toggle',
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
    iconHtml: ICO.quote,
    section: 'other',
    isActive: (t) => t === 'blockquote',
    insert: (editor, pos) =>
      editor.chain().focus().insertContentAt(pos, {
        type: 'blockquote',
        content: [{ type: 'paragraph', content: [] }],
      }).run(),
    convert: (editor, blockPos) => {
      // Blockquote wraps paragraph(s); preserve inline content via paragraph wrapper.
      editor.chain().focus().command(({ tr, state, dispatch }) => {
        const node = tr.doc.nodeAt(blockPos);
        if (!node) return false;
        const bqType = state.schema.nodes.blockquote;
        const paraType = state.schema.nodes.paragraph;
        if (!bqType || !paraType) return false;
        const paraNode = paraType.create(null, node.content);
        const bqNode = bqType.create(null, paraNode);
        if (dispatch) tr.replaceWith(blockPos, blockPos + node.nodeSize, bqNode);
        return true;
      }).run();
    },
  },
  {
    id: 'codeBlock',
    label: 'Code block',
    description: 'Syntax-highlighted code',
    iconHtml: ICO.code,
    section: 'other',
    isActive: (t) => t === 'codeBlock',
    insert: (editor, pos) =>
      editor.chain().focus().insertContentAt(pos, { type: 'codeBlock', attrs: { language: null } }).run(),
    convert: (editor, blockPos) => replaceBlockWith(editor, blockPos, 'codeBlock', { language: null }),
  },
  {
    id: 'horizontalRule',
    label: 'Divider',
    description: 'Horizontal rule',
    iconHtml: ICO.hr,
    section: 'other',
    isActive: (t) => t === 'horizontalRule',
    insert: (editor, pos) =>
      editor.chain().focus().insertContentAt(pos, { type: 'horizontalRule' }).run(),
  },
  {
    id: 'board-kanban',
    label: 'Board: Kanban',
    description: 'Kanban board with columns and cards',
    iconHtml: ICO.board,
    section: 'lists',
    aliases: ['board', 'kanban', 'tasks', 'project', 'board kanban'],
    insert: (editor, pos) => insertBoardWith('kanban', editor, pos),
  },
  {
    id: 'board-table',
    label: 'Board: Table',
    description: 'Table board: rows, columns, inline editing',
    iconHtml: ICO.board,
    section: 'lists',
    aliases: ['board', 'table', 'database', 'grid', 'board table'],
    insert: (editor, pos) => insertBoardWith('table', editor, pos),
  },
  {
    id: 'whiteboard',
    label: 'Whiteboard',
    description: 'Freeform diagram canvas — drag, connect, style',
    iconHtml: ICO.whiteboard,
    section: 'media',
    aliases: ['mermaid', 'diagram', 'flowchart', 'graph', 'canvas'],
    insert: (editor, pos) => insertWhiteboard(editor, pos),
  },
];

export function filterBlocks(query: string, source: BlockDef[] = BLOCK_DEFS): BlockDef[] {
  if (!query.trim()) return source;
  const q = query.toLowerCase();
  return source.filter(
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

export interface PickerContext {
  // When set, the picker is in "convert this block" mode: items whose
  // isActive matches the node are highlighted, and clicking calls convert
  // (falling back to insert below at blockPos if no convert is defined).
  activeBlock?: {
    typeName: string;
    attrs: Record<string, unknown>;
    blockPos: number;
    blockEnd: number;
  };
}

export interface BlockPicker {
  open: (anchorEl: HTMLElement, insertPos: number, context?: PickerContext) => void;
  close: () => void;
}

export function createBlockPicker(editor: Editor): BlockPicker {
  let currentPos = 0;
  let activeIdx  = 0;
  let filtered: BlockDef[] = BLOCK_DEFS;
  let drillParent: BlockDef | null = null;
  let context: PickerContext = {};

  function isActiveItem(block: BlockDef): boolean {
    const ab = context.activeBlock;
    if (!ab || !block.isActive) return false;
    return block.isActive(ab.typeName, ab.attrs);
  }

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

  function currentSource(): BlockDef[] {
    return drillParent?.subItems ?? BLOCK_DEFS;
  }

  function renderList(items: BlockDef[]): void {
    list.innerHTML = '';
    let globalIdx = 0;

    if (drillParent) {
      const back = document.createElement('div');
      back.className = 'block-picker-back';
      back.innerHTML = `<span class="block-picker-back-icon">‹</span><span class="block-picker-back-label">${drillParent.label}</span>`;
      back.addEventListener('mousedown', (e) => {
        e.preventDefault();
        drillParent = null;
        input.placeholder = 'Filter blocks…';
        input.value = '';
        filtered = BLOCK_DEFS;
        renderList(filtered);
        input.focus();
      });
      list.appendChild(back);
    }

    if (drillParent) {
      // Drilled-down view: flat list, no section headers.
      items.forEach((block) => {
        list.appendChild(renderRow(block, globalIdx));
        globalIdx++;
      });
    } else {
      ((['text', 'lists', 'media', 'other'] as const)).forEach((section) => {
        const sectionItems = items.filter((b) => b.section === section);
        if (!sectionItems.length) return;
        if (list.childElementCount > (drillParent ? 1 : 0)) {
          const sep = document.createElement('div');
          sep.className = 'block-picker-sep';
          list.appendChild(sep);
        }
        const lbl = document.createElement('div');
        lbl.className = 'block-picker-section-label';
        lbl.textContent = SECTION_LABELS[section];
        list.appendChild(lbl);
        sectionItems.forEach((block) => {
          list.appendChild(renderRow(block, globalIdx));
          globalIdx++;
        });
      });
    }

    // Convert mode (dragger opened over an existing block): offer a Delete
    // action at the bottom. It targets the block captured when the picker was
    // opened (context.activeBlock.blockPos) — reliable for atom nodes like
    // boards, unlike re-sampling coordinates at click time.
    if (!drillParent && context.activeBlock) {
      const sep = document.createElement('div');
      sep.className = 'block-picker-sep';
      list.appendChild(sep);
      const del = document.createElement('div');
      del.className = 'block-picker-item block-picker-delete';
      del.innerHTML = `<span class="block-picker-icon">${ICO.trash}</span><span class="block-picker-label">Delete</span>`;
      del.addEventListener('mousedown', (e) => { e.preventDefault(); deleteActiveBlock(); });
      list.appendChild(del);
    }

    activeIdx = 0;
    updateActive();
  }

  function deleteActiveBlock(): void {
    const ab = context.activeBlock;
    if (!ab) { close(); return; }
    editor.chain().focus().command(({ tr, dispatch }) => {
      // Re-read the node at the captured position to get its current size,
      // then delete exactly that one block.
      const node = tr.doc.nodeAt(ab.blockPos);
      if (!node) return false;
      if (dispatch) tr.delete(ab.blockPos, ab.blockPos + node.nodeSize);
      return true;
    }).run();
    close();
  }

  function renderRow(block: BlockDef, idx: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'block-picker-item';
    if (isActiveItem(block)) row.classList.add('current');
    row.dataset.idx = String(idx);
    const drillCaret = block.subItems?.length ? '<span class="block-picker-caret">›</span>' : '';
    const checkMark = isActiveItem(block) ? '<span class="block-picker-current-mark">✓</span>' : '';
    row.innerHTML = `<span class="block-picker-icon">${block.iconHtml}</span><span class="block-picker-label">${block.label}</span>${checkMark}${drillCaret}`;
    row.addEventListener('mousedown', (e) => { e.preventDefault(); select(block); });
    return row;
  }

  function updateActive(): void {
    list.querySelectorAll<HTMLElement>('.block-picker-item').forEach((row, i) => {
      row.classList.toggle('active', i === activeIdx);
    });
  }

  function select(block: BlockDef): void {
    if (block.subItems?.length) {
      drillParent = block;
      input.placeholder = `Filter ${block.label.toLowerCase()}…`;
      input.value = '';
      filtered = block.subItems;
      renderList(filtered);
      input.focus();
      return;
    }
    // Convert mode: use the item's convert function if available. Falls back
    // to insert (below the active block) when convert isn't defined for this
    // block type — that way Image / Toggle / HR still work from the dragger.
    if (context.activeBlock) {
      if (isActiveItem(block)) {
        // Already that type — nothing to do.
        close();
        return;
      }
      if (block.convert) {
        block.convert(editor, context.activeBlock.blockPos);
      } else if (block.insert) {
        block.insert(editor, context.activeBlock.blockEnd);
      }
      close();
      setTimeout(() => {
        editor.commands.focus();
        editor.commands.scrollIntoView();
      }, 30);
      return;
    }
    block.insert?.(editor, currentPos);
    close();
    setTimeout(() => {
      editor.commands.focus();
      editor.commands.scrollIntoView();
    }, 30);
  }

  input.addEventListener('input', () => {
    filtered = filterBlocks(input.value, currentSource());
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
      if (drillParent) {
        drillParent = null;
        input.placeholder = 'Filter blocks…';
        input.value = '';
        filtered = BLOCK_DEFS;
        renderList(filtered);
        input.focus();
      } else {
        close();
      }
    }
  });

  function open(anchorEl: HTMLElement, insertPos: number, ctx: PickerContext = {}): void {
    currentPos = insertPos;
    context = ctx;
    drillParent = null;
    // If the user clicked the dragger over a callout, drill straight into the
    // callout sub-list so they see the five type options with the current one
    // highlighted instead of the top-level Callout entry.
    if (ctx.activeBlock?.typeName === 'callout') {
      const calloutItem = BLOCK_DEFS.find((b) => b.id === 'callout');
      if (calloutItem?.subItems?.length) {
        drillParent = calloutItem;
        input.placeholder = `Filter ${calloutItem.label.toLowerCase()}…`;
        filtered = calloutItem.subItems;
        input.value = '';
        renderList(filtered);
        el.classList.add('open');
        positionPopover(anchorEl);
        return;
      }
    }
    input.placeholder = 'Filter blocks…';
    filtered = BLOCK_DEFS;
    input.value = '';
    renderList(BLOCK_DEFS);
    el.classList.add('open');
    positionPopover(anchorEl);
  }

  function positionPopover(anchorEl: HTMLElement): void {
    const rect = anchorEl.getBoundingClientRect();
    el.style.left = `${rect.left}px`;
    el.style.top  = `${rect.bottom + 6}px`;
    requestAnimationFrame(() => {
      const pickerRect = el.getBoundingClientRect();
      if (pickerRect.bottom > window.innerHeight - 12) {
        el.style.top = `${rect.top - pickerRect.height - 6}px`;
      }
      input.focus();
    });
  }

  function close(): void {
    el.classList.remove('open');
    drillParent = null;
    context = {};
    input.value = '';
  }

  document.addEventListener('mousedown', e => {
    if (!el.contains(e.target as Node)) close();
  });
  // Close on scroll — the popover is anchored to a viewport position and
  // would otherwise drift away from its trigger. Ignore scrolls that
  // originate inside the picker itself (the list scrolls when items overflow).
  window.addEventListener('scroll', (e) => {
    if (!el.classList.contains('open')) return;
    const target = e.target as Node | null;
    if (target && el.contains(target)) return;
    close();
  }, { capture: true, passive: true });

  return { open, close };
}

export function freshWhiteboardSource(): string {
  return [
    'flowchart LR',
    '    A[Idea]',
    '    B[Next]',
    '    C[Done]',
    '    A --> B',
    '    B --> C',
  ].join('\n');
}

export function insertWhiteboard(editor: Editor, pos: number): void {
  const source = freshWhiteboardSource();
  editor
    .chain()
    .focus()
    .insertContentAt(pos, [
      {
        type: 'codeBlock',
        attrs: { language: 'mermaid' },
        content: [{ type: 'text', text: source }],
      },
      { type: 'paragraph' },
    ])
    .run();

  requestAnimationFrame(() => {
    const dom = (editor as unknown as {
      view: { nodeDOM: (pos: number) => (HTMLElement & { __mbOpenVisualMode?: () => void }) | null };
    }).view.nodeDOM(pos);
    dom?.__mbOpenVisualMode?.();
  });
}

function freshBoardSource(id: string, activeView?: 'kanban' | 'table'): string {
  const av = activeView === 'table' ? ' active-view="table"' : '';
  const parts: string[] = [
    `<!-- board:start id="${id}" name="" columns="Todo|Doing|Done" column-colors="gray|amber|emerald" field-types="Title=text,Status=status,id=text" hidden-fields="id"${av} -->`,
    ``,
  ];
  if (activeView === 'table') {
    parts.push(`<!-- board:view name="table" -->`, ``);
  }
  parts.push(
    `| Title    | Status | id |`,
    `|----------|--------|----|`,
    `| New card | Todo   | c1 |`,
    ``,
    `<!-- board:end -->`,
  );
  return parts.join('\n');
}

function insertBoardWith(
  activeView: 'kanban' | 'table',
  editor: Editor,
  pos: number,
): void {
  const id = `b-${Math.random().toString(36).slice(2, 6)}`;
  const source = freshBoardSource(id, activeView);
  // Insert the board followed by an empty paragraph so the cursor has
  // somewhere to land below the (atom) board.
  editor
    .chain()
    .focus()
    .insertContentAt(pos, [
      { type: 'board', attrs: { source } },
      { type: 'paragraph' },
    ])
    .run();
  // Focus the NEW board specifically by its id — querySelector('.board-name')
  // alone would return the first board on the page and steal focus when
  // adding a second/third board to the same doc.
  requestAnimationFrame(() => {
    const board = document.querySelector(
      `.board-block[data-board-id="${id}"]`,
    ) as HTMLElement | null;
    const name = board?.querySelector('.board-name') as HTMLElement | null;
    if (!name) return;
    name.focus();
    const range = document.createRange();
    range.selectNodeContents(name);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  });
}
