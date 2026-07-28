import { Editor } from '@tiptap/core';
import { BubbleMenuPlugin } from '@tiptap/extension-bubble-menu';
import { PluginKey, NodeSelection } from '@tiptap/pm/state';
import { AI_TRANSFORMS, type AiTarget } from './aiTransforms';
import { createAiTransformPanel } from './aiTransformPanel';
import { buildAiPanelInput } from './aiSelection';
import { placeFloating, type PlacementHandle } from './menuPosition';
import { copySelectionAsPlainText, copySelectionRich } from './copySelection';
import { MORE_MENU_ITEMS, runMoreMenuAction, type MoreMenuId } from './moreMenu';

// All paths verified from @phosphor-icons/core assets/bold/
const P = {
  textB:         'M185.08,114.46A48,48,0,0,0,148,36H80A12,12,0,0,0,68,48V200a12,12,0,0,0,12,12h80a52,52,0,0,0,25.08-97.54ZM92,60h56a24,24,0,0,1,0,48H92Zm68,128H92V132h68a28,28,0,0,1,0,56Z',
  textItalic:    'M204,56a12,12,0,0,1-12,12H160.65l-40,120H144a12,12,0,0,1,0,24H64a12,12,0,0,1,0-24H95.35l40-120H112a12,12,0,0,1,0-24h80A12,12,0,0,1,204,56Z',
  textUnderline: 'M204,224a12,12,0,0,1-12,12H64a12,12,0,0,1,0-24H192A12,12,0,0,1,204,224Zm-76-28a68.07,68.07,0,0,0,68-68V56a12,12,0,0,0-24,0v72a44,44,0,0,1-88,0V56a12,12,0,0,0-24,0v72A68.07,68.07,0,0,0,128,196Z',
  textStrike:    'M228,128a12,12,0,0,1-12,12H185.86A41.48,41.48,0,0,1,196,168c0,14.45-7.81,28.32-21.43,38.05C162,215.05,145.44,220,128,220s-34-4.95-46.57-13.95C67.81,196.32,60,182.45,60,168a12,12,0,0,1,24,0c0,15.18,20.15,28,44,28s44-12.82,44-28c0-12.76-9.3-20.18-35.35-28H40a12,12,0,0,1,0-24H216A12,12,0,0,1,228,128ZM75.11,100a12,12,0,0,0,12-12c0-16,17.58-28,40.89-28,17.36,0,31.37,6.65,37.48,17.78a12,12,0,0,0,21-11.56C176.13,47.3,154.25,36,128,36,91,36,63.11,58.35,63.11,88A12,12,0,0,0,75.11,100Z',
  code:          'M71.68,97.22,34.74,128l36.94,30.78a12,12,0,1,1-15.36,18.44l-48-40a12,12,0,0,1,0-18.44l48-40A12,12,0,0,1,71.68,97.22Zm176,21.56-48-40a12,12,0,1,0-15.36,18.44L221.26,128l-36.94,30.78a12,12,0,1,0,15.36,18.44l48-40a12,12,0,0,0,0-18.44ZM164.1,28.72a12,12,0,0,0-15.38,7.18l-64,176a12,12,0,0,0,7.18,15.37A11.79,11.79,0,0,0,96,228a12,12,0,0,0,11.28-7.9l64-176A12,12,0,0,0,164.1,28.72Z',
  link:          'M117.18,188.74a12,12,0,0,1,0,17l-5.12,5.12A58.26,58.26,0,0,1,70.6,228h0A58.62,58.62,0,0,1,29.14,127.92L63.89,93.17a58.64,58.64,0,0,1,98.56,28.11,12,12,0,1,1-23.37,5.44,34.65,34.65,0,0,0-58.22-16.58L46.11,144.89A34.62,34.62,0,0,0,70.57,204h0a34.41,34.41,0,0,0,24.49-10.14l5.11-5.12A12,12,0,0,1,117.18,188.74ZM226.83,45.17a58.65,58.65,0,0,0-82.93,0l-5.11,5.11a12,12,0,0,0,17,17l5.12-5.12a34.63,34.63,0,1,1,49,49L175.1,145.86A34.39,34.39,0,0,1,150.61,156h0a34.63,34.63,0,0,1-33.69-26.72,12,12,0,0,0-23.38,5.44A58.64,58.64,0,0,0,150.56,180h.05a58.28,58.28,0,0,0,41.47-17.17l34.75-34.75a58.62,58.62,0,0,0,0-82.91Z',
  highlighter:   'M252.49,107.51a12,12,0,0,0-17,0L192,151,113,72l43.52-43.51a12,12,0,0,0-17-17L93.17,57.86a20,20,0,0,0-4.72,20.72L69.17,97.86a20,20,0,0,0,0,28.28L71,128,15.51,183.51a12,12,0,0,0,4.7,19.87l72,24A11.8,11.8,0,0,0,96,228a12,12,0,0,0,8.49-3.52L136,193l1.86,1.86a20,20,0,0,0,28.28,0l19.27-19.27a20.27,20.27,0,0,0,6.59,1.13,19.86,19.86,0,0,0,14.14-5.86l46.35-46.34A12,12,0,0,0,252.49,107.51ZM92.76,202.27,46.21,186.76,88,145l31,31ZM152,175,96.49,119.52h0L89,112l15-15,63,63Z',
  smiley:        'M178.39,158c-11,19.06-29.39,30-50.39,30s-39.36-10.93-50.39-30a12,12,0,0,1,20.78-12c3.89,6.73,12.91,18,29.61,18s25.72-11.28,29.61-18a12,12,0,1,1,20.78,12ZM236,128A108,108,0,1,1,128,20,108.12,108.12,0,0,1,236,128Zm-24,0a84,84,0,1,0-84,84A84.09,84.09,0,0,0,212,128ZM92,124a16,16,0,1,0-16-16A16,16,0,0,0,92,124Zm72-32a16,16,0,1,0,16,16A16,16,0,0,0,164,92Z',
  dotsThree:     'M144,128a16,16,0,1,1-16-16A16,16,0,0,1,144,128ZM60,112a16,16,0,1,0,16,16A16,16,0,0,0,60,112Zm136,0a16,16,0,1,0,16,16A16,16,0,0,0,196,112Z',
  paragraph:     'M208,36H96a68,68,0,0,0,0,136h36v36a12,12,0,0,0,24,0V60h16V208a12,12,0,0,0,24,0V60h12a12,12,0,0,0,0-24ZM132,148H96a44,44,0,0,1,0-88h36Z',
  listBullets:   'M76,64A12,12,0,0,1,88,52H216a12,12,0,0,1,0,24H88A12,12,0,0,1,76,64Zm140,52H88a12,12,0,0,0,0,24H216a12,12,0,0,0,0-24Zm0,64H88a12,12,0,0,0,0,24H216a12,12,0,0,0,0-24ZM44,112a16,16,0,1,0,16,16A16,16,0,0,0,44,112Zm0-64A16,16,0,1,0,60,64,16,16,0,0,0,44,48Zm0,128a16,16,0,1,0,16,16A16,16,0,0,0,44,176Z',
  listNumbers:   'M228,128a12,12,0,0,1-12,12H116a12,12,0,0,1,0-24H216A12,12,0,0,1,228,128ZM116,76H216a12,12,0,0,0,0-24H116a12,12,0,0,0,0,24ZM216,180H116a12,12,0,0,0,0,24H216a12,12,0,0,0,0-24ZM44,59.31V104a12,12,0,0,0,24,0V40A12,12,0,0,0,50.64,29.27l-16,8a12,12,0,0,0,9.36,22Zm39.73,96.86a27.7,27.7,0,0,0-11.2-18.63A28.89,28.89,0,0,0,32.9,143a27.71,27.71,0,0,0-4.17,7.54,12,12,0,0,0,22.55,8.21,4,4,0,0,1,.58-1,4.78,4.78,0,0,1,6.5-.82,3.82,3.82,0,0,1,1.61,2.6,3.63,3.63,0,0,1-.77,2.77l-.13.17L30.39,200.82A12,12,0,0,0,40,220H72a12,12,0,0,0,0-24H64l14.28-19.11A27.48,27.48,0,0,0,83.73,156.17Z',
  listChecks:    'M228,128a12,12,0,0,1-12,12H128a12,12,0,0,1,0-24h88A12,12,0,0,1,228,128ZM128,76h88a12,12,0,0,0,0-24H128a12,12,0,0,0,0,24Zm88,104H128a12,12,0,0,0,0,24h88a12,12,0,0,0,0-24ZM79.51,39.51,56,63l-7.51-7.52a12,12,0,0,0-17,17l16,16a12,12,0,0,0,17,0l32-32a12,12,0,0,0-17-17Zm0,64L56,127l-7.51-7.52a12,12,0,1,0-17,17l16,16a12,12,0,0,0,17,0l32-32a12,12,0,0,0-17-17Zm0,64L56,191l-7.51-7.52a12,12,0,1,0-17,17l16,16a12,12,0,0,0,17,0l32-32a12,12,0,0,0-17-17Z',
  quotes:        'M100,52H40A20,20,0,0,0,20,72v64a20,20,0,0,0,20,20H96v4a28,28,0,0,1-28,28,12,12,0,0,0,0,24,52.06,52.06,0,0,0,52-52V72A20,20,0,0,0,100,52Zm-4,80H44V76H96ZM216,52H156a20,20,0,0,0-20,20v64a20,20,0,0,0,20,20h56v4a28,28,0,0,1-28,28,12,12,0,0,0,0,24,52.06,52.06,0,0,0,52-52V72A20,20,0,0,0,216,52Zm-4,80H160V76h52Z',
  minus:         'M228,128a12,12,0,0,1-12,12H40a12,12,0,0,1,0-24H216A12,12,0,0,1,228,128Z',
  copy:          'M216,28H88A12,12,0,0,0,76,40V76H40A12,12,0,0,0,28,88V216a12,12,0,0,0,12,12H168a12,12,0,0,0,12-12V180h36a12,12,0,0,0,12-12V40A12,12,0,0,0,216,28ZM156,204H52V100H156Zm48-48H180V88a12,12,0,0,0-12-12H100V52H204Z',
  subtractSquare:'M228,160V96a12,12,0,0,0-12-12H172V40a12,12,0,0,0-12-12H40A12,12,0,0,0,28,40V160a12,12,0,0,0,12,12H84v44a12,12,0,0,0,12,12H216a12,12,0,0,0,12-12V160Zm-63,44-32-32H155l32,32Zm7-49V133l32,32V187Zm32-24-23-23h23ZM52,52h96v52h0v44H52Zm56,129,23,23H108Z',
  squaresFour:   'M100,36H56A20,20,0,0,0,36,56v44a20,20,0,0,0,20,20h44a20,20,0,0,0,20-20V56A20,20,0,0,0,100,36ZM96,96H60V60H96ZM200,36H156a20,20,0,0,0-20,20v44a20,20,0,0,0,20,20h44a20,20,0,0,0,20-20V56A20,20,0,0,0,200,36Zm-4,60H160V60h36Zm-96,40H56a20,20,0,0,0-20,20v44a20,20,0,0,0,20,20h44a20,20,0,0,0,20-20V156A20,20,0,0,0,100,136Zm-4,60H60V160H96Zm104-60H156a20,20,0,0,0-20,20v44a20,20,0,0,0,20,20h44a20,20,0,0,0,20-20V156A20,20,0,0,0,200,136Zm-4,60H160V160h36Z',
  sparkle:       'M128 24 L150 106 L232 128 L150 150 L128 232 L106 150 L24 128 L106 106 Z',
  caretRight:    'M181,133.66l-80,80A8,8,0,0,1,89,202.34L163.31,128,89,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181,133.66Z',
} as const;

function svg(path: string, size = 20): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 256 256" fill="currentColor"><path d="${path}"/></svg>`;
}

const MENU_ICONS: Record<MoreMenuId, string> = {
  'turn-into':    P.squaresFour,
  'turn-into-ai': P.sparkle,
  'copy':         P.copy,
  'copy-plain':   P.subtractSquare,
};

// Rows for the ⋯ menu, rendered from the shared MORE_MENU_ITEMS list. A divider
// is inserted before the first non-chevron (Copy) row.
function moreMenuHtml(): string {
  let html = '';
  let dividerDone = false;
  for (const item of MORE_MENU_ITEMS) {
    if (!item.chevron && !dividerDone) {
      html += `<div class="bm-into-divider"></div>`;
      dividerDone = true;
    }
    const chev = item.chevron
      ? `<span class="bm-menu-chevron">${svg(P.caretRight, 16)}</span>`
      : '';
    html += `<button class="bm-into-item bm-menu-item" data-menu="${item.id}">`
      + `<span class="bm-menu-ic">${svg(MENU_ICONS[item.id], 18)}</span>`
      + `<span class="bm-menu-label">${item.label}</span>${chev}</button>`;
  }
  return html;
}

const TEXT_COLORS: Array<{ value: string | null; label: string }> = [
  { value: null,      label: 'Default' },
  { value: '#e55757', label: 'Red' },
  { value: '#e8954a', label: 'Orange' },
  { value: '#e8c94a', label: 'Yellow' },
  { value: '#57b35b', label: 'Green' },
  { value: '#4a9ee8', label: 'Blue' },
  { value: '#9b5de5', label: 'Purple' },
  { value: '#e85a9b', label: 'Pink' },
];

const HIGHLIGHT_COLORS: Array<{ value: string | null; label: string }> = [
  { value: null,        label: 'None' },
  { value: '#ffd700aa', label: 'Yellow' },
  { value: '#ff8c0066', label: 'Orange' },
  { value: '#57b35b66', label: 'Green' },
  { value: '#4a9ee866', label: 'Blue' },
  { value: '#9b5de566', label: 'Purple' },
];

// Curated emoji set — useful for documents and notes
const EMOJIS = [
  '😀','😂','😍','🥰','😎','🤔','😢','😡','🙏','👍',
  '👎','❤️','✅','❌','⚠️','💡','❓','❗','⭐','✨',
  '🔥','🎯','🚀','📌','📝','📚','💻','📱','🎉','💯',
  '🌟','🌈','🌸','🍀','☀️','🌙','⏰','🎨','📊','🎁',
];

// "Turn into" — converts the current block to a different type
interface TurnIntoOption {
  id: string;
  label: string;
  iconHtml: string;
  isActive: (e: Editor) => boolean;
  apply:    (e: Editor) => void;
}

const TURN_INTO: TurnIntoOption[] = [
  {
    id: 'paragraph',
    label: 'Text',
    iconHtml: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M208,36H96a68,68,0,0,0,0,136h36v36a12,12,0,0,0,24,0V60h16V208a12,12,0,0,0,24,0V60h12a12,12,0,0,0,0-24ZM132,148H96a44,44,0,0,1,0-88h36Z"/></svg>`,
    isActive: e => e.isActive('paragraph'),
    apply:    e => e.chain().focus().setParagraph().run(),
  },
  {
    id: 'heading1',
    label: 'Heading 1',
    iconHtml: `<span class="bm-into-text" style="font-weight:800;font-size:14px;letter-spacing:-.5px">H1</span>`,
    isActive: e => e.isActive('heading', { level: 1 }),
    apply:    e => e.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    id: 'heading2',
    label: 'Heading 2',
    iconHtml: `<span class="bm-into-text" style="font-weight:700;font-size:13px;letter-spacing:-.4px">H2</span>`,
    isActive: e => e.isActive('heading', { level: 2 }),
    apply:    e => e.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    id: 'heading3',
    label: 'Heading 3',
    iconHtml: `<span class="bm-into-text" style="font-weight:600;font-size:12px;letter-spacing:-.3px">H3</span>`,
    isActive: e => e.isActive('heading', { level: 3 }),
    apply:    e => e.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    id: 'bulletList',
    label: 'Bullet list',
    iconHtml: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M76,64A12,12,0,0,1,88,52H216a12,12,0,0,1,0,24H88A12,12,0,0,1,76,64Zm140,52H88a12,12,0,0,0,0,24H216a12,12,0,0,0,0-24Zm0,64H88a12,12,0,0,0,0,24H216a12,12,0,0,0,0-24ZM44,112a16,16,0,1,0,16,16A16,16,0,0,0,44,112Zm0-64A16,16,0,1,0,60,64,16,16,0,0,0,44,48Zm0,128a16,16,0,1,0,16,16A16,16,0,0,0,44,176Z"/></svg>`,
    isActive: e => e.isActive('bulletList'),
    apply:    e => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'orderedList',
    label: 'Numbered list',
    iconHtml: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M228,128a12,12,0,0,1-12,12H116a12,12,0,0,1,0-24H216A12,12,0,0,1,228,128ZM116,76H216a12,12,0,0,0,0-24H116a12,12,0,0,0,0,24ZM216,180H116a12,12,0,0,0,0,24H216a12,12,0,0,0,0-24ZM44,59.31V104a12,12,0,0,0,24,0V40A12,12,0,0,0,50.64,29.27l-16,8a12,12,0,0,0,9.36,22Zm39.73,96.86a27.7,27.7,0,0,0-11.2-18.63A28.89,28.89,0,0,0,32.9,143a27.71,27.71,0,0,0-4.17,7.54,12,12,0,0,0,22.55,8.21,4,4,0,0,1,.58-1,4.78,4.78,0,0,1,6.5-.82,3.82,3.82,0,0,1,1.61,2.6,3.63,3.63,0,0,1-.77,2.77l-.13.17L30.39,200.82A12,12,0,0,0,40,220H72a12,12,0,0,0,0-24H64l14.28-19.11A27.48,27.48,0,0,0,83.73,156.17Z"/></svg>`,
    isActive: e => e.isActive('orderedList'),
    apply:    e => e.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'taskList',
    label: 'Task list',
    iconHtml: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M228,128a12,12,0,0,1-12,12H128a12,12,0,0,1,0-24h88A12,12,0,0,1,228,128ZM128,76h88a12,12,0,0,0,0-24H128a12,12,0,0,0,0,24Zm88,104H128a12,12,0,0,0,0,24h88a12,12,0,0,0,0-24ZM79.51,39.51,56,63l-7.51-7.52a12,12,0,0,0-17,17l16,16a12,12,0,0,0,17,0l32-32a12,12,0,0,0-17-17Zm0,64L56,127l-7.51-7.52a12,12,0,1,0-17,17l16,16a12,12,0,0,0,17,0l32-32a12,12,0,0,0-17-17Zm0,64L56,191l-7.51-7.52a12,12,0,1,0-17,17l16,16a12,12,0,0,0,17,0l32-32a12,12,0,0,0-17-17Z"/></svg>`,
    isActive: e => e.isActive('taskList'),
    apply:    e => e.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'blockquote',
    label: 'Quote',
    iconHtml: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M100,52H40A20,20,0,0,0,20,72v64a20,20,0,0,0,20,20H96v4a28,28,0,0,1-28,28,12,12,0,0,0,0,24,52.06,52.06,0,0,0,52-52V72A20,20,0,0,0,100,52Zm-4,80H44V76H96ZM216,52H156a20,20,0,0,0-20,20v64a20,20,0,0,0,20,20h56v4a28,28,0,0,1-28,28,12,12,0,0,0,0,24,52.06,52.06,0,0,0,52-52V72A20,20,0,0,0,216,52Zm-4,80H160V76h52Z"/></svg>`,
    isActive: e => e.isActive('blockquote'),
    apply:    e => e.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'codeBlock',
    label: 'Code block',
    iconHtml: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M71.68,97.22,34.74,128l36.94,30.78a12,12,0,1,1-15.36,18.44l-48-40a12,12,0,0,1,0-18.44l48-40A12,12,0,0,1,71.68,97.22Zm176,21.56-48-40a12,12,0,1,0-15.36,18.44L221.26,128l-36.94,30.78a12,12,0,1,0,15.36,18.44l48-40a12,12,0,0,0,0-18.44ZM164.1,28.72a12,12,0,0,0-15.38,7.18l-64,176a12,12,0,0,0,7.18,15.37A11.79,11.79,0,0,0,96,228a12,12,0,0,0,11.28-7.9l64-176A12,12,0,0,0,164.1,28.72Z"/></svg>`,
    isActive: e => e.isActive('codeBlock'),
    apply:    e => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'horizontalRule',
    label: 'Divider',
    iconHtml: `<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M228,128a12,12,0,0,1-12,12H40a12,12,0,0,1,0-24H216A12,12,0,0,1,228,128Z"/></svg>`,
    isActive: () => false,
    apply:    e => e.chain().focus().setHorizontalRule().run(),
  },
];

const DIV = `<span class="bm-div"></span>`;

function swatchHtml(
  items: Array<{ value: string | null; label: string }>,
  attr: string,
): string {
  return items
    .map(c =>
      c.value
        ? `<button class="bm-swatch-item" data-${attr}="${c.value}" style="background:${c.value}" data-tip="${c.label}"></button>`
        : `<button class="bm-swatch-item bm-swatch-clear" data-${attr}="" data-tip="${c.label}">⊘</button>`,
    )
    .join('');
}

function emojiHtml(): string {
  return EMOJIS
    .map(e => `<button class="bm-swatch-item" data-emoji="${e}" data-tip="${e}">${e}</button>`)
    .join('');
}

function turnIntoHtml(): string {
  return TURN_INTO.map(o =>
    `<button class="bm-into-item" data-into="${o.id}">
      <span class="bm-into-icon">${o.iconHtml}</span>
      <span class="bm-into-label">${o.label}</span>
    </button>`
  ).join('');
}

function aiListHtml(attr = 'ai'): string {
  return AI_TRANSFORMS.map(t =>
    `<button class="bm-into-item" data-${attr}="${t.id}">
      <span class="bm-into-icon">${t.iconHtml}</span>
      <span class="bm-into-label">${t.label}</span>
    </button>`
  ).join('');
}

function buildEl(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'bubble-menu';
  el.innerHTML = `
    <div class="bubble-row">
      <button class="bm-btn" data-action="bold" data-tip-html="Bold<kbd>⌘B</kbd>">${svg(P.textB)}</button>
      <button class="bm-btn" data-action="italic" data-tip-html="Italic<kbd>⌘I</kbd>">${svg(P.textItalic)}</button>
      <button class="bm-btn" data-action="underline" data-tip-html="Underline<kbd>⌘U</kbd>">${svg(P.textUnderline)}</button>
      <button class="bm-btn" data-action="strike" data-tip-html="Strikethrough<kbd>⌘⇧X</kbd>">${svg(P.textStrike)}</button>
      ${DIV}
      <button class="bm-btn" data-action="code" data-tip-html="Inline code<kbd>⌘E</kbd>">${svg(P.code)}</button>
    </div>
    <div class="bubble-row">
      <button class="bm-btn" data-action="link" data-tip-html="Add link<kbd>⌘K</kbd>">${svg(P.link)}</button>
      <button class="bm-btn" data-action="color" data-tip="Text color">
        <svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor">
          <path d="M216,208a12,12,0,0,1-11.41-7.97L180.09,148H75.91L51.41,200.03A12,12,0,0,1,40,208a12,12,0,0,1-11.41-15.97L113.09,12.97a12,12,0,0,1,21.82,0l84.5,179.06A12,12,0,0,1,216,208ZM87.09,124h81.82L128,42.84Z"/>
          <rect id="bm-color-bar" x="32" y="224" width="192" height="20" rx="6" fill="#e55757"/>
        </svg>
      </button>
      <button class="bm-btn" data-action="highlight" data-tip="Highlight">${svg(P.highlighter)}</button>
      <button class="bm-btn" data-action="emoji" data-tip="Insert emoji">${svg(P.smiley)}</button>
      ${DIV}
      <button class="bm-btn" data-action="more" data-tip="More">${svg(P.dotsThree, 22)}</button>
    </div>
    <div class="bubble-into hidden" id="bm-into">
      <div class="bubble-into-search">
        <input type="text" class="bubble-into-input" placeholder="Filter…" autocomplete="off" spellcheck="false" />
      </div>
      <div class="bubble-into-title">Turn row into</div>
      <div class="bubble-into-list">${turnIntoHtml()}<div class="bm-into-divider"></div><div class="bm-into-sublabel">✨ Using AI</div>${aiListHtml('ai-into')}</div>
    </div>
    <div class="bubble-ai hidden" id="bm-ai">
      <div class="bubble-into-title">Turn selection into — using AI</div>
      <div class="bubble-into-list">${aiListHtml()}</div>
    </div>
    <div class="bubble-into bm-menu hidden" id="bm-menu">
      <div class="bubble-into-list">${moreMenuHtml()}</div>
    </div>
    <div class="bm-swatch-panel" id="bm-color-swatch">
      ${swatchHtml(TEXT_COLORS, 'color')}
    </div>
    <div class="bm-swatch-panel" id="bm-hl-swatch">
      ${swatchHtml(HIGHLIGHT_COLORS, 'hl')}
    </div>
    <div class="bm-swatch-panel" id="bm-emoji-swatch">
      ${emojiHtml()}
    </div>
    <div class="bm-link-row" id="bm-link-row" style="display:none">
      <input type="text" class="bm-link-row-input" id="bm-link-row-input" placeholder="Paste URL, press ↵" />
      <button class="bm-link-row-icon bm-link-row-apply" id="bm-link-row-apply" title="Apply"><svg width="14" height="14" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"><polyline points="40,144 96,200 224,72"/></svg></button>
      <button class="bm-link-row-icon bm-link-row-cancel" id="bm-link-row-cancel" title="Cancel"><svg width="14" height="14" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="32" stroke-linecap="round"><line x1="60" y1="60" x2="196" y2="196"/><line x1="196" y1="60" x2="60" y2="196"/></svg></button>
    </div>
  `;
  document.body.appendChild(el);
  return el;
}

export function createBubbleMenu(editor: Editor): void {
  const el           = buildEl();
  const colorSwatch  = el.querySelector<HTMLElement>('#bm-color-swatch')!;
  const hlSwatch     = el.querySelector<HTMLElement>('#bm-hl-swatch')!;
  const emojiSwatch  = el.querySelector<HTMLElement>('#bm-emoji-swatch')!;
  const intoPanel    = el.querySelector<HTMLElement>('#bm-into')!;
  const aiPanel      = el.querySelector<HTMLElement>('#bm-ai')!;
  const menuPanel    = el.querySelector<HTMLElement>('#bm-menu')!;
  const aiTransformPanel = createAiTransformPanel();
  const intoInput    = el.querySelector<HTMLInputElement>('.bubble-into-input')!;
  const moreBtn      = el.querySelector<HTMLElement>('[data-action="more"]')!;
  const colorBar     = el.querySelector<SVGRectElement>('#bm-color-bar');
  const linkRow      = el.querySelector<HTMLElement>('#bm-link-row')!;
  const linkRowInput = el.querySelector<HTMLInputElement>('#bm-link-row-input')!;
  const linkRowApply = el.querySelector<HTMLElement>('#bm-link-row-apply')!;
  const linkRowCancel = el.querySelector<HTMLElement>('#bm-link-row-cancel')!;
  const buttonRows   = Array.from(el.querySelectorAll<HTMLElement>(':scope > .bubble-row'));

  function filterInto(query: string): void {
    const q = query.trim().toLowerCase();
    TURN_INTO.forEach(opt => {
      const item = el.querySelector<HTMLElement>(`[data-into="${opt.id}"]`);
      if (!item) return;
      const visible = !q ||
        opt.label.toLowerCase().includes(q) ||
        opt.id.toLowerCase().includes(q);
      item.style.display = visible ? '' : 'none';
    });
  }

  let highlightedBlock: HTMLElement | null = null;

  function highlightBlock(): void {
    unhighlightBlock();
    const { from } = editor.state.selection;
    const $pos = editor.state.doc.resolve(from);
    let depth = $pos.depth;
    while (depth > 1) depth--;
    const blockStart = $pos.before(depth);
    const dom = editor.view.nodeDOM(blockStart);
    if (dom instanceof HTMLElement) {
      dom.classList.add('bm-target-block');
      highlightedBlock = dom;
    }
  }

  function unhighlightBlock(): void {
    if (highlightedBlock) {
      highlightedBlock.classList.remove('bm-target-block');
      highlightedBlock = null;
    }
  }

  function openAiPanel(target: AiTarget, label: string): void {
    const { from, to } = editor.state.selection;
    aiTransformPanel.open(buildAiPanelInput(editor, target, label, from, to));
    closeAi();
    closeInto();
    // Collapse the selection so the bubble menu hides behind the panel.
    editor.commands.setTextSelection(to);
  }

  editor.registerPlugin(
    BubbleMenuPlugin({
      pluginKey:    new PluginKey('bubbleMenu'),
      editor,
      element:      el,
      tippyOptions: { duration: 100, placement: 'bottom' },
      shouldShow:   ({ state }) => {
        // Keep the menu visible while the URL input is showing, even if focus
        // moved out of the editor.
        if (linkRow.style.display !== 'none') return true;
        // A selected image (or any node selection) gets its own menu — don't
        // clash by also showing the text-formatting menu over it.
        if (state.selection instanceof NodeSelection) return false;
        return !state.selection.empty;
      },
      updateDelay:  250,
    }),
  );

  function closeSwatch(): void {
    colorSwatch.classList.remove('open');
    hlSwatch.classList.remove('open');
    emojiSwatch.classList.remove('open');
  }

  function closeInto(): void {
    intoPanel.classList.add('hidden');
    unhighlightBlock();
  }

  function closeAi(): void {
    aiPanel.classList.add('hidden');
  }

  function closeMenu(): void {
    menuPanel.classList.add('hidden');
    moreBtn.classList.remove('active');
  }

  function postToHost(msg: unknown): void {
    const vs = (window as unknown as {
      __mdViewerVscode?: { postMessage: (m: unknown) => void };
    }).__mdViewerVscode;
    vs?.postMessage(msg);
  }

  // Open the "Turn into" panel (block types + "✨ Using AI"). Was inline in the
  // old 'more' case; now reached from the ⋯ menu.
  function openInto(): void {
    closeSwatch();
    closeAi();
    closeMenu();
    highlightBlock();
    intoInput.value = '';
    filterInto('');
    intoPanel.classList.remove('hidden');
    setTimeout(() => intoInput.focus({ preventScroll: true }), 30);
  }

  // Open the AI transform list. Was the old ✦ button's job.
  function openAi(): void {
    closeSwatch();
    closeInto();
    closeMenu();
    aiPanel.classList.remove('hidden');
  }

  function openLinkRow(): void {
    closeSwatch();
    closeInto();
    closeMenu();
    const existing = (editor.getAttributes('link').href as string | undefined) ?? '';
    linkRowInput.value = existing;
    buttonRows.forEach((r) => { r.style.display = 'none'; });
    linkRow.style.display = 'flex';
    setTimeout(() => { linkRowInput.focus(); linkRowInput.select(); }, 0);
  }

  function closeLinkRow(): void {
    linkRow.style.display = 'none';
    buttonRows.forEach((r) => { r.style.display = ''; });
  }

  function applyLinkRow(): void {
    const url = linkRowInput.value.trim();
    if (!url) { closeLinkRow(); return; }
    editor.chain().focus().setLink({ href: url }).run();
    closeLinkRow();
  }

  linkRowApply.addEventListener('mousedown', (e) => { e.preventDefault(); applyLinkRow(); }, true);
  linkRowCancel.addEventListener('mousedown', (e) => { e.preventDefault(); closeLinkRow(); }, true);
  linkRowInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyLinkRow(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeLinkRow(); }
  });

  // ── Floating link popover ───────────────────────────────────────────────
  // Hover any link in the editor to show: open / edit / remove. Mounted on
  // document.body so it isn't tied to bubble-menu visibility.
  const ICON_OPEN   = `<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M228,104a12,12,0,0,1-24,0V69l-59.51,59.51a12,12,0,0,1-17-17L187,52H152a12,12,0,0,1,0-24h64a12,12,0,0,1,12,12Zm-44,24a12,12,0,0,0-12,12v64H52V84h64a12,12,0,0,0,0-24H48A20,20,0,0,0,28,80V208a20,20,0,0,0,20,20H176a20,20,0,0,0,20-20V140A12,12,0,0,0,184,128Z"/></svg>`;
  const ICON_EDIT   = `<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M230.14,70.54,185.46,25.85a20,20,0,0,0-28.29,0L33.86,149.17A19.85,19.85,0,0,0,28,163.31V208a20,20,0,0,0,20,20H92.69a19.86,19.86,0,0,0,14.14-5.86L230.14,98.82a20,20,0,0,0,0-28.28ZM91,204H52V165l84-84,39,39ZM192,103,153,64l18.34-18.34,39,39Z"/></svg>`;
  const ICON_UNLINK = `<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M195.8,60.2a28,28,0,0,0-39.51-.09L144.68,72.28a12,12,0,1,1-17.36-16.56L139,43.43l.2-.2a52,52,0,0,1,73.54,73.54l-.2.2-12.29,11.71a12,12,0,0,1-16.56-17.36l12.17-11.61A28,28,0,0,0,195.8,60.2ZM111.32,183.72,99.71,195.89a28,28,0,0,1-39.6-39.6l12.17-11.61a12,12,0,0,0-16.56-17.36L43.43,139l-.2.2a52,52,0,0,0,73.54,73.54l.2-.2,11.71-12.29a12,12,0,1,0-17.36-16.56ZM216,148H192a12,12,0,0,0,0,24h24a12,12,0,0,0,0-24ZM40,108H64a12,12,0,0,0,0-24H40a12,12,0,0,0,0,24Zm120,72a12,12,0,0,0-12,12v24a12,12,0,0,0,24,0V192A12,12,0,0,0,160,180ZM96,76a12,12,0,0,0,12-12V40a12,12,0,0,0-24,0V64A12,12,0,0,0,96,76Z"/></svg>`;
  const ICON_CHECK  = `<svg width="14" height="14" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"><polyline points="40,144 96,200 224,72"/></svg>`;
  const ICON_X      = `<svg width="12" height="12" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="32" stroke-linecap="round"><line x1="60" y1="60" x2="196" y2="196"/><line x1="196" y1="60" x2="60" y2="196"/></svg>`;

  const linkPop = document.createElement('div');
  linkPop.className = 'link-pop';
  linkPop.style.display = 'none';
  linkPop.innerHTML = `
    <div class="link-pop-view">
      <a class="link-pop-href" target="_blank" rel="noopener noreferrer"></a>
      <button class="link-pop-btn" data-tip="Open in browser" data-action="open">${ICON_OPEN}</button>
      <button class="link-pop-btn" data-tip="Edit link" data-action="edit">${ICON_EDIT}</button>
      <button class="link-pop-btn" data-tip="Remove link" data-action="remove">${ICON_UNLINK}</button>
    </div>
    <div class="link-pop-edit" style="display:none">
      <input type="text" class="link-pop-input" placeholder="Paste URL, press ↵" />
      <button class="link-pop-btn link-pop-btn-apply" data-action="apply" data-tip="Apply">${ICON_CHECK}</button>
      <button class="link-pop-btn" data-action="cancel" data-tip="Cancel">${ICON_X}</button>
    </div>
  `;
  document.body.appendChild(linkPop);

  const lpView   = linkPop.querySelector<HTMLElement>('.link-pop-view')!;
  const lpHref   = linkPop.querySelector<HTMLAnchorElement>('.link-pop-href')!;
  const lpEdit   = linkPop.querySelector<HTMLElement>('.link-pop-edit')!;
  const lpInput  = linkPop.querySelector<HTMLInputElement>('.link-pop-input')!;

  let lpRange: { from: number; to: number } | null = null;
  let lpHideTimer: ReturnType<typeof setTimeout> | null = null;
  let lpEl: HTMLElement | null = null; // current link element being shown
  let lpPlacement: PlacementHandle | null = null;

  function findLinkRange(domPos: number): { from: number; to: number; href: string } | null {
    const $pos = editor.state.doc.resolve(domPos);
    const linkType = editor.state.schema.marks.link;
    if (!linkType) return null;
    // Find the link mark covering this position
    const parent = $pos.parent;
    const offsetInParent = $pos.parentOffset;
    let cursor = 0;
    for (let i = 0; i < parent.childCount; i++) {
      const child = parent.child(i);
      const childEnd = cursor + child.nodeSize;
      if (offsetInParent >= cursor && offsetInParent <= childEnd) {
        const linkMark = child.marks.find((m) => m.type === linkType);
        if (!linkMark) return null;
        // Expand left/right while same link mark continues
        let leftIdx = i, rightIdx = i;
        let s = cursor, e = childEnd;
        while (leftIdx > 0) {
          const prev = parent.child(leftIdx - 1);
          if (prev.marks.some((m) => m.type === linkType && m.attrs.href === linkMark.attrs.href)) {
            s -= prev.nodeSize;
            leftIdx--;
          } else break;
        }
        while (rightIdx < parent.childCount - 1) {
          const next = parent.child(rightIdx + 1);
          if (next.marks.some((m) => m.type === linkType && m.attrs.href === linkMark.attrs.href)) {
            e += next.nodeSize;
            rightIdx++;
          } else break;
        }
        const parentStart = $pos.start();
        return { from: parentStart + s, to: parentStart + e, href: linkMark.attrs.href as string };
      }
      cursor = childEnd;
    }
    return null;
  }

  function showLinkPop(anchor: HTMLElement, href: string): void {
    if (lpHideTimer) { clearTimeout(lpHideTimer); lpHideTimer = null; }
    lpEl = anchor;
    lpHref.textContent = href;
    lpHref.href = href;
    lpView.style.display = 'flex';
    lpEdit.style.display = 'none';
    linkPop.style.display = 'block';
    // Destroy any previous placement handle before creating a new one
    lpPlacement?.destroy();
    lpPlacement = placeFloating(linkPop, anchor);
  }

  function isEditing(): boolean {
    return lpEdit.style.display !== 'none' && linkPop.style.display !== 'none';
  }

  function scheduleHideLinkPop(): void {
    // While editing the URL the popover must stay open until the user
    // explicitly applies, cancels, or clicks outside.
    if (isEditing()) return;
    if (lpHideTimer) clearTimeout(lpHideTimer);
    lpHideTimer = setTimeout(() => {
      lpPlacement?.destroy(); lpPlacement = null;
      linkPop.style.display = 'none';
      lpEl = null;
      lpRange = null;
    }, 220);
  }

  function cancelHide(): void {
    if (lpHideTimer) { clearTimeout(lpHideTimer); lpHideTimer = null; }
  }

  function closeLinkPopHard(): void {
    if (lpHideTimer) { clearTimeout(lpHideTimer); lpHideTimer = null; }
    lpPlacement?.destroy(); lpPlacement = null;
    linkPop.style.display = 'none';
    lpView.style.display = 'flex';
    lpEdit.style.display = 'none';
    lpEl = null;
    lpRange = null;
  }

  // While editing, click anywhere outside the popover closes it.
  document.addEventListener('mousedown', (e) => {
    if (!isEditing()) return;
    const t = e.target as Node;
    if (linkPop.contains(t)) return;
    closeLinkPopHard();
  });

  // Hover detection on links inside the editor
  editor.view.dom.addEventListener('mouseover', (e) => {
    const t = e.target as HTMLElement;
    const a = t.closest?.('a') as HTMLElement | null;
    if (!a || !editor.view.dom.contains(a)) return;
    const href = a.getAttribute('href') ?? '';
    if (!href) return;
    // Locate the link's PM range so edit/remove operate on the right span
    const pos = editor.view.posAtDOM(a, 0);
    if (pos != null) {
      const range = findLinkRange(pos);
      lpRange = range ? { from: range.from, to: range.to } : null;
    }
    showLinkPop(a, href);
  });
  editor.view.dom.addEventListener('mouseout', (e) => {
    const t = e.target as HTMLElement;
    const a = t.closest?.('a');
    if (!a) return;
    // Only schedule hide if the relatedTarget is not the popover itself
    const next = (e as MouseEvent).relatedTarget as Node | null;
    if (next && linkPop.contains(next)) return;
    scheduleHideLinkPop();
  });
  // Mouse over the popover keeps it open
  linkPop.addEventListener('mouseenter', cancelHide);
  linkPop.addEventListener('mouseleave', scheduleHideLinkPop);

  // Suppress default click-navigation on links — we drive it via the popover
  editor.view.dom.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest?.('a');
    if (a && editor.view.dom.contains(a)) e.preventDefault();
  });

  // Popover button actions
  linkPop.addEventListener('mousedown', (e) => {
    const t = e.target as HTMLElement;
    const btn = t.closest<HTMLElement>('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action!;
    if (action === 'open') {
      e.preventDefault();
      e.stopPropagation();
      const vs = (window as unknown as {
        __mdViewerVscode?: { postMessage: (m: unknown) => void };
      }).__mdViewerVscode;
      if (vs && lpHref.href) {
        vs.postMessage({ type: 'openExternal', url: lpHref.href });
      }
      return;
    }
    if (action === 'edit') {
      e.preventDefault();
      e.stopPropagation();
      // Switch popover to edit mode in place
      lpInput.value = lpHref.href;
      lpView.style.display = 'none';
      lpEdit.style.display = 'flex';
      setTimeout(() => { lpInput.focus(); lpInput.select(); }, 0);
      return;
    }
    if (action === 'remove') {
      e.preventDefault();
      e.stopPropagation();
      if (lpRange) {
        editor.chain()
          .setTextSelection(lpRange)
          .unsetMark('link')
          .run();
      }
      closeLinkPopHard();
      return;
    }
    if (action === 'cancel') {
      e.preventDefault();
      e.stopPropagation();
      lpView.style.display = 'flex';
      lpEdit.style.display = 'none';
      return;
    }
    if (action === 'apply') {
      e.preventDefault();
      e.stopPropagation();
      applyLinkEdit();
      return;
    }
  }, true);

  function applyLinkEdit(): void {
    const url = lpInput.value.trim();
    if (!url || !lpRange) { closeLinkPopHard(); return; }
    // Replace the existing link mark with one that has the new href.
    // unsetMark + setMark is the bulletproof way; setLink alone sometimes
    // doesn't refresh attrs when the mark already exists on the selection.
    editor.chain()
      .focus()
      .setTextSelection(lpRange)
      .unsetMark('link')
      .setLink({ href: url })
      .setTextSelection(lpRange.to)
      .run();
    closeLinkPopHard();
  }

  lpInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyLinkEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      lpView.style.display = 'flex';
      lpEdit.style.display = 'none';
    }
  });

  function updateActive(): void {
    const map: Record<string, boolean> = {
      bold:      editor.isActive('bold'),
      italic:    editor.isActive('italic'),
      underline: editor.isActive('underline'),
      strike:    editor.isActive('strike'),
      code:      editor.isActive('code'),
      link:      editor.isActive('link'),
    };
    for (const [action, active] of Object.entries(map)) {
      el.querySelector<HTMLElement>(`[data-action="${action}"]`)
        ?.classList.toggle('active', active);
    }
    if (colorBar) {
      const attrs = editor.getAttributes('textStyle');
      colorBar.setAttribute('fill', (attrs.color as string | undefined) ?? '#e55757');
    }
    // Mark the active "Turn into" option for the current block
    for (const opt of TURN_INTO) {
      el.querySelector<HTMLElement>(`[data-into="${opt.id}"]`)
        ?.classList.toggle('active', opt.isActive(editor));
    }
  }

  el.addEventListener('click', e => {
    const target = e.target as HTMLElement;

    // ⋯ menu row clicked?
    const menuItem = target.closest<HTMLElement>('[data-menu]');
    if (menuItem) {
      e.stopPropagation();
      runMoreMenuAction(menuItem.dataset.menu!, {
        openTurnInto:   openInto,
        openTurnIntoAi: openAi,
        copyRich:  () => { void copySelectionRich(editor, postToHost); closeMenu(); },
        copyPlain: () => { copySelectionAsPlainText(editor, postToHost); closeMenu(); },
      });
      return;
    }

    // AI turn-into item clicked? (from either the ✨ panel or the "Using AI" group)
    const aiItem = target.closest<HTMLElement>('[data-ai], [data-ai-into]');
    if (aiItem) {
      e.stopPropagation();
      const tgt = (aiItem.dataset.ai ?? aiItem.dataset.aiInto) as AiTarget;
      const def = AI_TRANSFORMS.find(t => t.id === tgt);
      if (def) openAiPanel(def.id, def.label);
      return;
    }

    // Turn-into item clicked?
    const intoItem = target.closest<HTMLElement>('[data-into]');
    if (intoItem) {
      e.stopPropagation();
      const id = intoItem.dataset.into!;
      const opt = TURN_INTO.find(o => o.id === id);
      if (opt) {
        unhighlightBlock();  // Remove highlight before transforming
        opt.apply(editor);
        closeInto();
        updateActive();
      }
      return;
    }

    const btn = target.closest<HTMLElement>('[data-action]');
    if (!btn) { closeSwatch(); return; }
    e.stopPropagation();

    switch (btn.dataset.action) {
      case 'bold':      editor.chain().focus().toggleBold().run();      break;
      case 'italic':    editor.chain().focus().toggleItalic().run();    break;
      case 'underline': editor.chain().focus().toggleUnderline().run(); break;
      case 'strike':    editor.chain().focus().toggleStrike().run();    break;
      case 'code':      editor.chain().focus().toggleCode().run();      break;
      case 'link': {
        if (editor.isActive('link')) {
          editor.chain().focus().unsetLink().run();
        } else {
          openLinkRow();
        }
        break;
      }
      case 'color':     colorSwatch.classList.toggle('open'); hlSwatch.classList.remove('open'); emojiSwatch.classList.remove('open'); closeInto(); closeAi(); closeMenu(); break;
      case 'highlight': hlSwatch.classList.toggle('open');    colorSwatch.classList.remove('open'); emojiSwatch.classList.remove('open'); closeInto(); closeAi(); closeMenu(); break;
      case 'emoji':     emojiSwatch.classList.toggle('open'); colorSwatch.classList.remove('open'); hlSwatch.classList.remove('open'); closeInto(); closeAi(); closeMenu(); break;
      case 'more': {
        closeSwatch();
        closeInto();
        closeAi();
        const isOpen = !menuPanel.classList.contains('hidden');
        if (!isOpen) { menuPanel.classList.remove('hidden'); moreBtn.classList.add('active'); }
        else closeMenu();
        break;
      }
    }
    updateActive();
  });

  // Search filter
  intoInput.addEventListener('input', () => filterInto(intoInput.value));

  intoInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeInto();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const visible = Array.from(el.querySelectorAll<HTMLElement>('[data-into]'))
        .find(item => item.style.display !== 'none');
      if (visible) {
        const id = visible.dataset.into!;
        const opt = TURN_INTO.find(o => o.id === id);
        if (opt) {
          opt.apply(editor);
          closeInto();
          updateActive();
        }
      }
    }
  });

  colorSwatch.addEventListener('click', e => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('[data-color]');
    if (!item) return;
    const c = item.dataset.color;
    if (c) editor.chain().focus().setColor(c).run();
    else   editor.chain().focus().unsetColor().run();
    colorSwatch.classList.remove('open');
    updateActive();
  });

  hlSwatch.addEventListener('click', e => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('[data-hl]');
    if (!item) return;
    const c = item.dataset.hl;
    if (c) editor.chain().focus().toggleHighlight({ color: c }).run();
    else   editor.chain().focus().unsetHighlight().run();
    hlSwatch.classList.remove('open');
    updateActive();
  });

  emojiSwatch.addEventListener('click', e => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('[data-emoji]');
    if (!item) return;
    const emoji = item.dataset.emoji!;
    editor.chain().focus().insertContent(emoji).run();
    emojiSwatch.classList.remove('open');
    updateActive();
  });

  // Reset menus when the bubble menu hides (selection becomes empty)
  editor.on('transaction', ({ editor: e }) => {
    updateActive();
    if (e.state.selection.empty) {
      closeSwatch();
      closeInto();
      closeAi();
      closeMenu();
    }
  });

  document.addEventListener('click', () => { closeSwatch(); });
  updateActive();
}
