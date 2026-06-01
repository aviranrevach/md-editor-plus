// Pure prompt-builder for "Turn selection into… (using AI)".
// No editor/DOM imports — must stay unit-testable in the node jest env.

export type AiTarget = 'table' | 'kanban' | 'board-table' | 'mermaid';
export type AiInsertMode = 'replace' | 'add';

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

export const AI_TRANSFORMS: AiTransform[] = [
  { id: 'table',       label: 'Table',           iconHtml: TABLE_ICON },
  { id: 'kanban',      label: 'Board: Kanban',   iconHtml: KANBAN_ICON },
  { id: 'board-table', label: 'Board: Table',    iconHtml: BOARD_TABLE_ICON },
  { id: 'mermaid',     label: 'Mermaid diagram', iconHtml: SPARKLE },
];

const TARGET_PHRASE: Record<AiTarget, string> = {
  table:         'a markdown table',
  kanban:        'a Kanban board',
  'board-table': 'a table-view board (a database-style table)',
  mermaid:       'a Mermaid diagram',
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
// differ only by `active-view` and the framing. This generator keeps them in
// lockstep so the grammar can never drift between the two views.
function boardSpec(view: 'kanban' | 'table'): string {
  const intro = view === 'kanban'
    ? 'Use EXACTLY this custom board block, displayed as a Kanban board (cards grouped into columns by their Status).'
    : 'Use EXACTLY this custom board block, displayed as a table / database view (one row per card, with typed fields as columns). This is NOT a plain markdown table — it is the same board block, just shown as a grid.';
  return `${intro} The app parses it — do not deviate. The whole region from <!-- board:start --> through <!-- board:end --> is one block:

<!-- board:start id="b-XXXX" name="Board name" columns="Todo|Doing|Done" column-colors="blue|amber|emerald" field-types="Title=text,Status=status,Owner=person,Due=date,id=text" hidden-fields="id" active-view="${view}" -->

| Title | Status | Owner | Due | id |
|---|---|---|---|---|
| Card title | Doing | @name | 2026-06-01 | c1 |

<!-- board:body id="c1" -->

Optional longer notes for this card.

<!-- board:end -->

Constraints:
- columns="..." are the board's Status values (pipe-separated)${view === 'kanban' ? ', shown as the Kanban lanes' : ''}. Each card's Status must be EXACTLY one of those column names.
- column-colors: one token per column, same order, from: gray, blue, amber, emerald, red, purple.
- field-types values allowed: text, status, date, person, tags. Keep the hidden id field. Add whatever fields the content implies (Owner, Due, Tags, …) as columns of the table.
- Every card needs a unique id (c1, c2, …) used in BOTH its table row and its <!-- board:body id="..."  --> block.
- Dates as YYYY-MM-DD; people as @name. In cells escape pipes as \\| and use <br> for newlines.`;
}

const MERMAID_SPEC = `Use a fenced code block whose language is mermaid — it renders as a live diagram:

\`\`\`mermaid
flowchart TB
    A[Start] --> B[Process]
    B --> C[End]
\`\`\`

Pick the diagram type that best fits the content (flowchart, sequenceDiagram, stateDiagram-v2, gantt, etc.).`;

const FORMAT_SPECS: Record<AiTarget, string> = {
  table:         TABLE_SPEC,
  kanban:        boardSpec('kanban'),
  'board-table': boardSpec('table'),
  mermaid:       MERMAID_SPEC,
};

function buildWhere(ctx: AiPromptContext): string {
  const anchor = (line: number | null, text: string, edge: 'starts' | 'ends') =>
    line != null
      ? `${edge} at about line ${line} (\`${text}\`)`
      : `${edge} at the line \`${text}\``;
  return (
    `You are editing the file \`${ctx.filePath}\` in this workspace.\n` +
    `In that file, find the section that ${anchor(ctx.startLine, ctx.startText, 'starts')} ` +
    `and ${anchor(ctx.endLine, ctx.endText, 'ends')}.`
  );
}

function buildInstruction(ctx: AiPromptContext): string {
  const phrase = TARGET_PHRASE[ctx.target];
  return ctx.mode === 'replace'
    ? `Replace that entire section with ${phrase} built from its content.`
    : `Insert ${phrase} built from that section's content immediately after it, leaving the original text in place.`;
}

export function buildPrompt(ctx: AiPromptContext): string {
  return [
    buildWhere(ctx),
    buildInstruction(ctx),
    FORMAT_SPECS[ctx.target],
    `Rules:\n- ${CONTENT_RULE}\n- Actually perform the change now: edit \`${ctx.filePath}\` in place and save it. If you cannot edit files, output the complete new block as your entire reply so it can be pasted in. Do NOT reply with only an acknowledgement such as "done", "ok", or "sure" — either make the edit or output the block.`,
  ].join('\n\n');
}
