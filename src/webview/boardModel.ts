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

const START_RE = /<!--\s*board:start([\s\S]*?)-->/i;

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w[\w-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) out[m[1]] = m[2];
  return out;
}

const TABLE_LINE = /^\s*\|(.+)\|\s*$/;
const SEPARATOR_LINE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;

const COLOR_TOKENS: ColorToken[] =
  ['gray', 'blue', 'amber', 'emerald', 'red', 'purple'];

function autoColor(name: string): ColorToken {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return COLOR_TOKENS[Math.abs(h) % COLOR_TOKENS.length];
}

function splitCells(line: string): string[] {
  // Split on '|' but respect escaped '\|'.
  const cells: string[] = [];
  let buf = '';
  let i = 0;
  // Strip leading/trailing pipes.
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === '\\' && inner[i + 1] === '|') {
      buf += '|';
      i += 2;
      continue;
    }
    if (ch === '|') {
      cells.push(buf);
      buf = '';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  cells.push(buf);
  return cells.map((c) => c.trim().replace(/<br\s*\/?>(?!\n)/gi, '\n'));
}

function findTableSlice(body: string): { header: string[]; rows: string[][] } | null {
  const lines = body.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (TABLE_LINE.test(lines[i]) && SEPARATOR_LINE.test(lines[i + 1])) {
      const header = splitCells(lines[i]);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && TABLE_LINE.test(lines[j])) {
        rows.push(splitCells(lines[j]));
        j++;
      }
      return { header, rows };
    }
  }
  return null;
}

function parseFieldTypes(raw: string): Map<string, FieldType> {
  const out = new Map<string, FieldType>();
  for (const pair of raw.split(',')) {
    const [n, t] = pair.split('=').map((s) => s.trim());
    if (n && t && ['text', 'status', 'date', 'person', 'tags'].includes(t)) {
      out.set(n, t as FieldType);
    }
  }
  return out;
}

export function parseBoardSource(source: string): Board {
  const startMatch = source.match(START_RE);
  const attrs = startMatch ? parseAttrs(startMatch[1]) : {};

  const columnNames = attrs.columns ? attrs.columns.split('|') : [];
  const colorTokens = attrs['column-colors']
    ? attrs['column-colors'].split('|')
    : [];
  const columns: ColumnDef[] = columnNames.map((name, i) => {
    const candidate = colorTokens[i] as ColorToken | undefined;
    const color = candidate && COLOR_TOKENS.includes(candidate)
      ? candidate
      : autoColor(name);
    return { name, color };
  });

  const types = parseFieldTypes(attrs['field-types'] ?? '');
  const hidden = new Set(
    (attrs['hidden-fields'] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  );
  const hasFieldTypes = attrs['field-types'] !== undefined;

  // Build fields: Title + Status always first, then any others in `field-types`.
  const fields: FieldDef[] = [
    { name: 'Title',  type: 'text',   visibleOnCard: !hidden.has('Title') },
    { name: 'Status', type: 'status', visibleOnCard: !hidden.has('Status') },
  ];
  for (const [name, type] of types) {
    if (name === 'Title' || name === 'Status') continue;
    fields.push({ name, type, visibleOnCard: !hidden.has(name) });
  }
  // Only include hidden-only fields if field-types was NOT specified.
  if (!hasFieldTypes) {
    for (const name of hidden) {
      if (!fields.find((f) => f.name === name)) {
        fields.push({ name, type: 'text', visibleOnCard: false });
      }
    }
  }

  const innerStart = source.indexOf('-->', startMatch?.index ?? 0);
  const endIdx = source.search(/<!--\s*board:end\s*-->/i);
  const body = source.slice(
    innerStart >= 0 ? innerStart + 3 : 0,
    endIdx >= 0 ? endIdx : source.length,
  );

  const table = findTableSlice(body);
  const cards: Card[] = [];
  if (table) {
    for (const row of table.rows) {
      const values: Record<string, string> = {};
      table.header.forEach((h, idx) => {
        values[h] = row[idx] ?? '';
      });
      const id = values.id || '';
      cards.push({ id, values, body: '' });
    }
  }

  return {
    id: attrs.id ?? '',
    name: attrs.name ?? '',
    columns,
    fields,
    cards,
  };
}
