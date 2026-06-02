import { BLOCK_IDS, BLOCK_REFERENCES, type BlockId } from './blockFormatReference';

export interface BuiltSkill {
  folderName: string;
  skillMd: string;
}

const FOLDER_NAME = 'md-editor-blocks';
const DESCRIPTION =
  'Use when creating or editing Kanban/Table boards, Mermaid diagrams, callouts, ' +
  'or toggles in markdown files for MD Editor Plus. Provides the exact block ' +
  'grammar so they render correctly instead of as raw text.';

// A block example is itself fenced markdown; wrap it in a ```markdown fence,
// and bump any inner ``` to ~~~~ so the outer fence isn't broken by mermaid's
// triple-backticks.
function fenceExample(example: string): string {
  const inner = example.replace(/```/g, '~~~~');
  return '```markdown\n' + inner + '\n```';
}

function section(id: BlockId): string {
  const r = BLOCK_REFERENCES[id];
  const rules = r.rules.map((x) => `- ${x}`).join('\n');
  return [
    `## ${r.title}`,
    ``,
    r.whatItIs,
    ``,
    `**Example:**`,
    ``,
    fenceExample(r.example),
    ``,
    `**Rules:**`,
    ``,
    rules,
  ].join('\n');
}

export function buildSkill(blockIds: BlockId[]): BuiltSkill {
  // Normalise: dedupe + restore canonical order, ignore anything unknown.
  const selected = BLOCK_IDS.filter((id) => blockIds.includes(id));
  const body = selected.map(section).join('\n\n');
  const skillMd =
    `---\n` +
    `name: ${FOLDER_NAME}\n` +
    `description: ${DESCRIPTION}\n` +
    `---\n\n` +
    `# MD Editor Plus — block formats\n\n` +
    `These are the exact on-disk formats MD Editor Plus needs so each block ` +
    `renders instead of showing as raw text. Reproduce them precisely.\n\n` +
    body +
    `\n`;
  return { folderName: FOLDER_NAME, skillMd };
}
