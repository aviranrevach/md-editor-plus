// Pure prompt-builder for "Turn selection into… (using AI)".
// No editor/DOM imports — must stay unit-testable in the node jest env.

import { BLOCK_REFERENCES } from './blockFormatReference';

export type AiTarget =
  // Open-ended discussion — a free-text request, not a format conversion.
  | 'ask'
  | 'table'
  | 'kanban'
  | 'board-table'
  | 'mermaid'
  // Phase 2 — "thinking" targets: plain markdown, no proprietary grammar.
  | 'summary'
  | 'action-items'
  | 'outline'
  | 'timeline';
export type AiInsertMode = 'replace' | 'add' | 'custom';

export interface AiPromptContext {
  /** Workspace-relative path of the file being edited. */
  filePath: string;
  target: AiTarget;
  mode: AiInsertMode;
  /** 1-based source line of the first selected line; null when unknown. */
  startLine: number | null;
  /** 1-based source line of the last selected line; null when unknown. */
  endLine: number | null;
  /** Plain text of the first selected line (the primary locator). */
  startText: string;
  /** Plain text of the last selected line. */
  endText: string;
  /** Freestyle request — only used by the 'ask' target. */
  request?: string;
}

export interface AiTransform {
  id: AiTarget;
  label: string;
  iconHtml: string;
}

// A simple 4-point sparkle (viewBox 0 0 256 256), fill currentColor.
const SPARKLE =
  '<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor">' +
  '<path d="M128 24 L150 106 L232 128 L150 150 L128 232 L106 150 L24 128 L106 106 Z"/></svg>';
// A chat bubble — the open-ended "Ask AI" target.
const ASK_ICON =
  '<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor">' +
  '<path d="M128 32C70.6 32 24 72.2 24 122c0 21.7 8.8 41.5 23.4 57L36 207a12 12 0 0 0 13.7 16.6L92 213a116 116 0 0 0 36 6c57.4 0 104-40.2 104-90S185.4 32 128 32Zm-40 102a14 14 0 1 1 14-14 14 14 0 0 1-14 14Zm40 0a14 14 0 1 1 14-14 14 14 0 0 1-14 14Zm40 0a14 14 0 1 1 14-14 14 14 0 0 1-14 14Z"/></svg>';
const TABLE_ICON =
  '<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor">' +
  '<path d="M216 40H40a16 16 0 0 0-16 16v144a16 16 0 0 0 16 16h176a16 16 0 0 0 16-16V56a16 16 0 0 0-16-16ZM40 56h64v40H40Zm80 0h96v40h-96ZM40 112h64v40H40Zm0 88v-32h64v32Zm80 0v-32h96v32Zm96-48h-96v-40h96Z"/></svg>';
// Three columns — the Kanban board view.
const KANBAN_ICON =
  '<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor">' +
  '<rect x="32" y="48" width="44" height="160" rx="8"/><rect x="106" y="48" width="44" height="112" rx="8"/><rect x="180" y="48" width="44" height="136" rx="8"/></svg>';
// A header bar over rows — the database / table board view.
const BOARD_TABLE_ICON =
  '<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor">' +
  '<rect x="32" y="48" width="192" height="40" rx="8"/>' +
  '<rect x="32" y="104" width="192" height="28" rx="6" opacity="0.55"/>' +
  '<rect x="32" y="148" width="192" height="28" rx="6" opacity="0.55"/>' +
  '<rect x="32" y="192" width="192" height="28" rx="6" opacity="0.55"/></svg>';
// Lines of decreasing width — a summary / prose block.
const SUMMARY_ICON =
  '<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor">' +
  '<rect x="40" y="72" width="176" height="20" rx="6"/>' +
  '<rect x="40" y="118" width="176" height="20" rx="6"/>' +
  '<rect x="40" y="164" width="110" height="20" rx="6"/></svg>';
// Checkbox rows — an action-item checklist.
const ACTION_ICON =
  '<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor">' +
  '<rect x="36" y="52" width="56" height="56" rx="12"/><rect x="116" y="68" width="104" height="22" rx="6" opacity="0.55"/>' +
  '<rect x="36" y="148" width="56" height="56" rx="12" opacity="0.55"/><rect x="116" y="164" width="104" height="22" rx="6" opacity="0.55"/></svg>';
// Dots + indented lines — a nested outline.
const OUTLINE_ICON =
  '<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor">' +
  '<circle cx="52" cy="72" r="12"/><rect x="80" y="62" width="136" height="20" rx="6"/>' +
  '<circle cx="96" cy="128" r="9" opacity="0.7"/><rect x="120" y="119" width="96" height="18" rx="6" opacity="0.7"/>' +
  '<circle cx="96" cy="184" r="9" opacity="0.7"/><rect x="120" y="175" width="96" height="18" rx="6" opacity="0.7"/></svg>';
// A spine with dots — a chronological timeline.
const TIMELINE_ICON =
  '<svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor">' +
  '<rect x="58" y="36" width="8" height="184" rx="4" opacity="0.5"/>' +
  '<circle cx="62" cy="72" r="16"/><circle cx="62" cy="128" r="16"/><circle cx="62" cy="184" r="16"/>' +
  '<rect x="96" y="62" width="120" height="20" rx="6" opacity="0.55"/>' +
  '<rect x="96" y="118" width="120" height="20" rx="6" opacity="0.55"/>' +
  '<rect x="96" y="174" width="120" height="20" rx="6" opacity="0.55"/></svg>';

export const AI_TRANSFORMS: AiTransform[] = [
  // Open-ended — a free-text request rather than a format conversion.
  { id: 'ask',          label: 'Ask AI…',         iconHtml: ASK_ICON },
  // Phase 1 — structural (proprietary grammar).
  { id: 'table',        label: 'Table',           iconHtml: TABLE_ICON },
  { id: 'kanban',       label: 'Board: Kanban',   iconHtml: KANBAN_ICON },
  { id: 'board-table',  label: 'Board: Table',    iconHtml: BOARD_TABLE_ICON },
  { id: 'mermaid',      label: 'Mermaid diagram', iconHtml: SPARKLE },
  // Phase 2 — "thinking" (plain markdown).
  { id: 'summary',      label: 'Summary',         iconHtml: SUMMARY_ICON },
  { id: 'action-items', label: 'Action items',    iconHtml: ACTION_ICON },
  { id: 'outline',      label: 'Outline',         iconHtml: OUTLINE_ICON },
  { id: 'timeline',     label: 'Timeline',        iconHtml: TIMELINE_ICON },
];

const TARGET_PHRASE: Record<Exclude<AiTarget, 'ask'>, string> = {
  table:         'a markdown table',
  kanban:        'a Kanban board',
  'board-table': 'a table-view board (a database-style table)',
  mermaid:       'a Mermaid diagram',
  summary:       'a concise summary',
  'action-items':'an action-item checklist',
  outline:       'a structured outline',
  timeline:      'a chronological timeline',
};

const CONTENT_RULE =
  'The selection may reference images (![alt](src)) and contain existing diagrams, ' +
  'tables, or boards. Read each one you can access — open referenced image files ' +
  '(paths are relative to this markdown file) and read diagram/table/board source — ' +
  'and use what they show as context or data when building the result. Represent items ' +
  'as cells or links where they belong; preserve anything you cannot fold in; if an ' +
  'image is unreadable, use its alt text and the link. Never silently drop content.';

const TABLE_SPEC = `Use a standard GitHub-flavored markdown pipe table — a header row, a \`|---|\` separator row, then one row per item:

| Title | Status | Due |
|---|---|---|
| Draft press release | Todo | 2026-06-05 |

In cells: escape literal pipes as \\| and use <br> instead of a newline.`;

// Both the Kanban and Table targets are the SAME custom board block — they
// differ only by `active-view` and the framing. The example + rules are pulled
// from the shared blockFormatReference so the ✨ prompts and the generated
// blocks skill share ONE grammar and can never drift.
function boardSpec(view: 'kanban' | 'table'): string {
  const ref = BLOCK_REFERENCES[view === 'table' ? 'table' : 'kanban'];
  const intro = view === 'kanban'
    ? 'Use EXACTLY this custom board block, displayed as a Kanban board (cards grouped into columns by their Status).'
    : 'Use EXACTLY this custom board block, displayed as a table / database view. This is NOT a plain markdown table — it is the same board block with active-view="table".';
  const rules = ref.rules.map((r) => `- ${r}`).join('\n');
  return `${intro} The app parses it — do not deviate.\n\n${ref.example}\n\nConstraints:\n${rules}`;
}

const MERMAID_SPEC = `Use a fenced code block whose language is mermaid — it renders as a live diagram:\n\n${BLOCK_REFERENCES.mermaid.example}\n\nPick the diagram type that best fits the content (flowchart, sequenceDiagram, stateDiagram-v2, gantt, etc.).`;

const SUMMARY_SPEC = `Write a concise summary in plain markdown — 3 to 6 bullet points (or a short paragraph if the content is already brief). Capture the key points, any decisions, and any open risks. Do not add information that is not in the source.`;

const ACTION_ITEMS_SPEC = `Extract the actionable tasks as a markdown task list — one checkbox per line:

- [ ] Task description — owner (if stated) — due (if stated)

Include only real action items implied by the content. If a task has no clear owner, append "(owner: ?)". Plain markdown only.`;

const OUTLINE_SPEC = `Reorganize the content into a structured markdown outline using headings and nested bullet lists that reflect its hierarchy:

## Section
- point
  - sub-point

Group related items, preserve every piece of information, and keep it plain markdown.`;

const TIMELINE_SPEC = `Arrange the content as a chronological timeline, earliest first, as a markdown list:

- **YYYY-MM-DD** — what happened

Use the dates/times present in the content. If an item has no explicit date, place it where it best fits and append "(date?)". Plain markdown only.`;

const FORMAT_SPECS: Record<Exclude<AiTarget, 'ask'>, string> = {
  table:          TABLE_SPEC,
  kanban:         boardSpec('kanban'),
  'board-table':  boardSpec('table'),
  mermaid:        MERMAID_SPEC,
  summary:        SUMMARY_SPEC,
  'action-items': ACTION_ITEMS_SPEC,
  outline:        OUTLINE_SPEC,
  timeline:       TIMELINE_SPEC,
};

function anchorClause(ctx: AiPromptContext): string {
  const anchor = (line: number | null, text: string, edge: 'starts' | 'ends') =>
    line != null
      ? `${edge} at about line ${line} (\`${text}\`)`
      : `${edge} at the line \`${text}\``;
  return `${anchor(ctx.startLine, ctx.startText, 'starts')} and ${anchor(ctx.endLine, ctx.endText, 'ends')}`;
}

function buildWhere(ctx: AiPromptContext): string {
  return (
    `You are editing the file \`${ctx.filePath}\` in this workspace.\n` +
    `In that file, find the section that ${anchorClause(ctx)}.`
  );
}

const performRule = (filePath: string): string =>
  `Actually perform the change now: edit \`${filePath}\` in place and save it. If you cannot edit files, output the complete new block as your entire reply so it can be pasted in. Do NOT reply with only an acknowledgement such as "done", "ok", or "sure" — either make the edit or output the block.`;

// The action line — placed LAST so it's the final thing in the prompt (B). For
// replace/add it's a complete, send-ready instruction; for custom it's left
// open (trailing "— ") so the user finishes it in the chat.
function buildAction(ctx: AiPromptContext): string {
  const phrase = TARGET_PHRASE[ctx.target as Exclude<AiTarget, 'ask'>];
  if (ctx.mode === 'replace') {
    return `Now, replace that entire section with ${phrase} built from its content.`;
  }
  if (ctx.mode === 'add') {
    return `Now, add ${phrase} built from that section's content right below it, leaving the original text in place.`;
  }
  // custom — open trailing line; the user finishes it (placement, extra detail).
  return `———\nNow, build ${phrase} from that section — `;
}

// Open-ended discussion prompt — no Replace/Add, no "edit the file" rule. The
// request is optional: when empty, the prompt simply opens the conversation so
// the user can type their ask in the AI tool after pasting.
function buildAskPrompt(ctx: AiPromptContext): string {
  const lines = [
    `Let's talk about a section of the file \`${ctx.filePath}\` in this workspace — the section that ${anchorClause(ctx)}.`,
  ];
  lines.push(`Rules:\n- ${CONTENT_RULE}`);
  if (ctx.mode === 'replace') {
    lines.push('When you revise it, replace the section with your result.');
  } else if (ctx.mode === 'add') {
    lines.push('When you revise it, add your result right below the original (keep the original in place).');
  }
  // Ends open (B + A): the user's request is the last thing, cursor on it.
  const req = (ctx.request ?? '').trim();
  lines.push(req ? req : '———\nWhat I\'d like you to do with this section: ');
  return lines.join('\n\n');
}

export function buildPrompt(ctx: AiPromptContext): string {
  if (ctx.target === 'ask') return buildAskPrompt(ctx);
  // B ordering: context → format spec → rules → action (last). The perform
  // rule only applies when placement is fixed (replace/add); custom defers to
  // the user, so it's omitted there.
  const rules = ctx.mode === 'custom'
    ? `Rules:\n- ${CONTENT_RULE}`
    : `Rules:\n- ${CONTENT_RULE}\n- ${performRule(ctx.filePath)}`;
  return [
    buildWhere(ctx),
    FORMAT_SPECS[ctx.target],
    rules,
    buildAction(ctx),
  ].join('\n\n');
}
