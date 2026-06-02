// Single source of truth for MD Editor Plus block grammar. Consumed by BOTH
// the "blocks skill" generator (skillBuilder.ts) and the ✨ AI prompts
// (aiTransforms.ts), so the grammar can never drift between them.
// Pure — no DOM/editor imports (unit-testable in the node jest env).

export type BlockId = 'kanban' | 'table' | 'mermaid' | 'callout' | 'toggle';

export const BLOCK_IDS: BlockId[] = ['kanban', 'table', 'mermaid', 'callout', 'toggle'];

export interface BlockReference {
  id: BlockId;
  title: string;
  whatItIs: string;
  /** A complete, real on-disk example that round-trips through the parser. */
  example: string;
  /** The constraints that make an instance valid. */
  rules: string[];
}

// A board region that parses cleanly (verified by the round-trip test). The
// kanban and table views share the same grammar — only `active-view` differs.
function boardExample(view: 'kanban' | 'table'): string {
  const av = view === 'table' ? ` active-view="table"` : '';
  return [
    `<!-- board:start id="b1" name="My Board" columns="Todo|Doing|Done" column-colors="blue|amber|emerald" field-types="Title=text,Status=status,Owner=person,Due=date,id=text" hidden-fields="id"${av} -->`,
    ``,
    `| Title | Status | Owner | Due | id |`,
    `|---|---|---|---|---|`,
    `| Write the spec | Doing | @maya | 2026-06-10 | c1 |`,
    `| Review the PR | Todo |  |  | c2 |`,
    ``,
    `<!-- board:body id="c1" -->`,
    ``,
    `Longer notes for this card live here.`,
    ``,
    `<!-- board:end -->`,
  ].join('\n');
}

const BOARD_RULES = [
  'The whole region from `<!-- board:start … -->` through `<!-- board:end -->` is ONE block — do not split it.',
  'Start-marker attributes, in order: `id`, `name`, `columns` (pipe-separated), `column-colors`, `field-types`, `hidden-fields`, optional `active-view`.',
  'Allowed `column-colors` tokens (one per column, same order): gray, blue, amber, emerald, red, purple.',
  'Allowed `field-types` values: text, status, date, person, tags. Keep the hidden `id` field.',
  "Each card's Status MUST be exactly one of the `columns`.",
  'Every card needs a unique `id` (c1, c2, …) used in BOTH its table row and its `<!-- board:body id="…" -->` block.',
  'Dates as `YYYY-MM-DD`; people as `@name`. In table cells, escape pipes as `\\|` and use `<br>` for line breaks.',
];

export const BLOCK_REFERENCES: Record<BlockId, BlockReference> = {
  kanban: {
    id: 'kanban',
    title: 'Kanban board',
    whatItIs: 'A board shown as columns of cards, grouped by a Status field. A custom block the app parses — the exact format below is required.',
    example: boardExample('kanban'),
    rules: BOARD_RULES,
  },
  table: {
    id: 'table',
    title: 'Table board (database view)',
    whatItIs: 'The SAME custom board block as Kanban, shown as a table/database grid (typed fields as columns). It is NOT a plain markdown table — it is the board block with `active-view="table"`.',
    example: boardExample('table'),
    rules: BOARD_RULES,
  },
  mermaid: {
    id: 'mermaid',
    title: 'Mermaid diagram',
    whatItIs: 'A fenced code block with the `mermaid` language; renders as a live diagram.',
    example: [
      '```mermaid',
      'flowchart TB',
      '    A[Start] --> B[Process]',
      '    B --> C[End]',
      '```',
    ].join('\n'),
    rules: [
      'Use a fenced code block whose info string is exactly `mermaid`.',
      'Use standard Mermaid syntax; pick the diagram type that fits (flowchart, sequenceDiagram, stateDiagram-v2, gantt, …).',
      'Do NOT hand-author position/style sidecar comments (`%% mb-positions: …`); the app\'s visual editor manages those automatically.',
    ],
  },
  callout: {
    id: 'callout',
    title: 'Callout',
    whatItIs: 'A GFM-style admonition with a coloured background and an icon.',
    example: [
      '> [!NOTE] 💡',
      '> Body text here. Continuation lines are also prefixed with `>`.',
    ].join('\n'),
    rules: [
      'First line: `> [!TYPE] <emoji>` — TYPE uppercase; the emoji is optional (a sensible default is used per type).',
      'Allowed TYPEs: NOTE, TIP, IMPORTANT, WARNING, CAUTION, INFO.',
      'Every body line is prefixed with `> ` (like a blockquote).',
    ],
  },
  toggle: {
    id: 'toggle',
    title: 'Toggle (collapsible)',
    whatItIs: 'A collapsible section using HTML `<details>` / `<summary>`.',
    example: [
      '<details>',
      '<summary>Click to expand</summary>',
      '',
      'Hidden content goes here — any markdown is allowed.',
      '',
      '</details>',
    ].join('\n'),
    rules: [
      'Use `<details>` with a `<summary>` as the first child (the clickable label).',
      'Leave a blank line after `</summary>` and before `</details>` so the inner markdown parses.',
    ],
  },
};
