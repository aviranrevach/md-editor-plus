export type ColorToken =
  | 'gray' | 'blue' | 'amber' | 'emerald' | 'red' | 'purple';

export type FieldType = 'text' | 'status' | 'date' | 'person' | 'tags';

export interface FieldDef {
  name: string;
  type: FieldType;
  visibleOnCard: boolean;
}

export interface ColumnDef {
  name: string;
  color: ColorToken;
}

export interface Card {
  id: string;
  values: Record<string, string>;
  body: string;
}

export interface Board {
  id: string;
  name: string;
  columns: ColumnDef[];
  fields: FieldDef[];
  cards: Card[];
}

const DEFAULT_FIELDS: FieldDef[] = [
  { name: 'Title', type: 'text', visibleOnCard: true },
  { name: 'Status', type: 'status', visibleOnCard: true },
];

const START_RE = /<!--\s*board:start([\s\S]*?)-->/i;

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w[\w-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) out[m[1]] = m[2];
  return out;
}

export function parseBoardSource(source: string): Board {
  const startMatch = source.match(START_RE);
  const attrs = startMatch ? parseAttrs(startMatch[1]) : {};
  return {
    id: attrs.id ?? '',
    name: attrs.name ?? '',
    columns: [],
    fields: DEFAULT_FIELDS.map((f) => ({ ...f })),
    cards: [],
  };
}
