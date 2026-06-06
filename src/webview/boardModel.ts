export type ColorToken =
  | 'gray' | 'blue' | 'amber' | 'emerald' | 'red' | 'purple'
  | 'orange' | 'teal' | 'indigo' | 'pink';

export type FieldType = 'text' | 'status' | 'date' | 'person' | 'tags';

export interface FieldDef {
  name: string;
  type: FieldType;
  visibleOnCard: boolean;
  options?: ColumnDef[];   // states for status fields other than the built-in "Status"
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

export interface ViewDef {
  name: string;
  // table-only (kanban ignores):
  columns?:  string[];
  hidden?:   string[];
  sort?:     { field: string; dir: 'asc' | 'desc' };
  groupBy?:  string;
  widths?:   Record<string, number>;
  // Unknown attributes preserved verbatim on round-trip.
  extras?:   Record<string, string>;
}

export interface Board {
  id: string;
  name: string;
  columns: ColumnDef[];
  fields: FieldDef[];
  cards: Card[];
  orphanBodies: { id: string; body: string }[];  // preserved verbatim on round-trip
  views: ViewDef[];
  activeView: string;
}

/** Read the option list (states) for any status field. */
export function getStatusOptions(board: Board, fieldName: string): ColumnDef[] {
  if (fieldName === 'Status') return board.columns;
  return board.fields.find((f) => f.name === fieldName)?.options ?? [];
}

/** Return a new Board with the option list for a status field replaced. */
export function setStatusOptions(board: Board, fieldName: string, options: ColumnDef[]): Board {
  if (fieldName === 'Status') {
    return { ...board, columns: options };
  }
  return {
    ...board,
    fields: board.fields.map((f) => (f.name === fieldName ? { ...f, options } : f)),
  };
}

/** Rename a status option and migrate every card value holding the old name. */
export function renameStatusOption(
  board: Board, fieldName: string, oldName: string, newName: string,
): Board {
  const opts = getStatusOptions(board, fieldName).map(
    (o) => (o.name === oldName ? { ...o, name: newName } : o),
  );
  const b = setStatusOptions(board, fieldName, opts);
  return {
    ...b,
    cards: b.cards.map((c) =>
      c.values[fieldName] === oldName
        ? { ...c, values: { ...c.values, [fieldName]: newName } }
        : c,
    ),
  };
}

/** Delete a status option and clear it from any card that held it. */
export function deleteStatusOption(board: Board, fieldName: string, name: string): Board {
  const opts = getStatusOptions(board, fieldName).filter((o) => o.name !== name);
  const b = setStatusOptions(board, fieldName, opts);
  return {
    ...b,
    cards: b.cards.map((c) =>
      c.values[fieldName] === name
        ? { ...c, values: { ...c.values, [fieldName]: '' } }
        : c,
    ),
  };
}

/** Append a status option, auto-picking a color not already used. */
export function addStatusOption(board: Board, fieldName: string, name: string): Board {
  const opts = getStatusOptions(board, fieldName);
  const used = opts.map((o) => o.color);
  const color = COLOR_TOKENS.find((t) => !used.includes(t)) ?? autoColor(name);
  return setStatusOptions(board, fieldName, [...opts, { name, color }]);
}

/** Change the color of one status option. */
export function recolorStatusOption(
  board: Board, fieldName: string, name: string, color: ColorToken,
): Board {
  const opts = getStatusOptions(board, fieldName).map(
    (o) => (o.name === name ? { ...o, color } : o),
  );
  return setStatusOptions(board, fieldName, opts);
}

// ---------------------------------------------------------------------------
// Tag-list helpers
// A "tags" field stores its option palette in field.options (same as status),
// but card values are comma-separated strings, e.g. "backend, urgent".
// ---------------------------------------------------------------------------

function splitTags(v: string): string[] {
  return v.split(',').map(s => s.trim()).filter(Boolean);
}
function joinTags(tags: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) { if (t && !seen.has(t)) { seen.add(t); out.push(t); } }
  return out.join(', ');
}

/** Strip characters that would corrupt tag serialization / list-splitting. */
export function sanitizeTagName(name: string): string {
  return name.replace(/[|;,]/g, '').trim();
}

/** Append a tag option (auto-colored by name); no-op if it already exists. */
export function addTagOption(board: Board, field: string, name: string): Board {
  const clean = sanitizeTagName(name);
  if (!clean) return board;
  const opts = getStatusOptions(board, field);
  if (opts.some(o => o.name === clean)) return board;
  return setStatusOptions(board, field, [...opts, { name: clean, color: autoColor(clean) }]);
}

/** Rename a tag option and remap it inside every card's comma-list.
 *  If the sanitized new name already exists as an option, MERGE: drop the old
 *  option and remap cards to the existing target (joinTags dedupes). */
export function renameTagOption(board: Board, field: string, oldName: string, newName: string): Board {
  const clean = sanitizeTagName(newName);
  if (!clean || clean === oldName) return board;
  const cur = getStatusOptions(board, field);
  const exists = cur.some(o => o.name === clean);
  const opts = exists
    ? cur.filter(o => o.name !== oldName)                         // merge into existing target
    : cur.map(o => (o.name === oldName ? { ...o, name: clean } : o));
  const b = setStatusOptions(board, field, opts);
  return {
    ...b,
    cards: b.cards.map(c => {
      const tags = splitTags(c.values[field] ?? '');
      if (!tags.includes(oldName)) return c;
      return { ...c, values: { ...c.values, [field]: joinTags(tags.map(t => (t === oldName ? clean : t))) } };
    }),
  };
}

/** Delete a tag option and strip it from every card's comma-list. */
export function deleteTagOption(board: Board, field: string, name: string): Board {
  const opts = getStatusOptions(board, field).filter(o => o.name !== name);
  const b = setStatusOptions(board, field, opts);
  return {
    ...b,
    cards: b.cards.map(c => {
      const tags = splitTags(c.values[field] ?? '');
      if (!tags.includes(name)) return c;
      return { ...c, values: { ...c.values, [field]: joinTags(tags.filter(t => t !== name)) } };
    }),
  };
}

/** Toggle a tag on/off for a single card. */
export function toggleTagOnCard(board: Board, field: string, cardId: string, name: string): Board {
  return {
    ...board,
    cards: board.cards.map(c => {
      if (c.id !== cardId) return c;
      const tags = splitTags(c.values[field] ?? '');
      const next = tags.includes(name) ? tags.filter(t => t !== name) : [...tags, name];
      return { ...c, values: { ...c.values, [field]: joinTags(next) } };
    }),
  };
}

const START_RE = /<!--\s*board:start([\s\S]*?)-->/i;
const VIEW_RE = /<!--\s*board:view([\s\S]*?)-->/gi;
const BODY_RE = /<!--\s*board:body\s+id="([^"]+)"\s*-->/gi;

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
  ['gray', 'blue', 'amber', 'emerald', 'red', 'purple', 'orange', 'teal', 'indigo', 'pink'];

/** Public, ordered palette for color pickers. Frozen to prevent accidental mutation. */
export const COLOR_TOKENS_PUBLIC: readonly ColorToken[] = Object.freeze([...COLOR_TOKENS]);

function autoColor(name: string): ColorToken {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return COLOR_TOKENS[Math.abs(h) % COLOR_TOKENS.length];
}

/** Public, stable name→token mapping for color pickers and tag group bands. */
export function autoColorPublic(name: string): ColorToken {
  return autoColor(name);
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

function parseViewDef(raw: string): ViewDef {
  const attrs = parseAttrs(raw);
  const known = new Set(['name', 'columns', 'hidden', 'sort', 'group', 'widths']);

  const view: ViewDef = { name: attrs.name?.trim() || 'kanban' };

  if (attrs.columns) {
    view.columns = attrs.columns.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (attrs.hidden) {
    view.hidden = attrs.hidden.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (attrs.sort) {
    const parts = attrs.sort.split(',');
    const field = parts[0]?.trim();
    const dir = parts[1]?.trim();
    if (field && (dir === 'asc' || dir === 'desc')) {
      view.sort = { field, dir };
    }
  }
  if (attrs.group) {
    view.groupBy = attrs.group.trim();
  }
  if (attrs.widths) {
    const widths: Record<string, number> = {};
    for (const pair of attrs.widths.split(',')) {
      const [k, v] = pair.split('=');
      const name = k?.trim();
      const num = parseInt(v?.trim() ?? '', 10);
      if (name && isFinite(num)) {
        widths[name] = num;
      }
    }
    if (Object.keys(widths).length > 0) {
      view.widths = widths;
    }
  }

  const extras: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (!known.has(k)) {
      extras[k] = v;
    }
  }
  if (Object.keys(extras).length > 0) {
    view.extras = extras;
  }

  return view;
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

function parseFieldOptions(raw: string): Map<string, ColumnDef[]> {
  const out = new Map<string, ColumnDef[]>();
  if (!raw) return out;
  for (const chunk of raw.split(';')) {
    const eq = chunk.indexOf('=');
    if (eq < 0) continue;
    const fieldName = chunk.slice(0, eq).trim();
    if (!fieldName) continue;
    const opts: ColumnDef[] = [];
    for (const optChunk of chunk.slice(eq + 1).split('|')) {
      if (!optChunk) continue;
      const colon = optChunk.lastIndexOf(':');
      const name = (colon >= 0 ? optChunk.slice(0, colon) : optChunk).trim();
      const tok = colon >= 0 ? optChunk.slice(colon + 1).trim() : '';
      if (!name) continue;
      const color = COLOR_TOKENS.includes(tok as ColorToken)
        ? (tok as ColorToken)
        : autoColor(name);
      opts.push({ name, color });
    }
    out.set(fieldName, opts);
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

  const fieldOptions = parseFieldOptions(attrs['field-options'] ?? '');
  for (const f of fields) {
    if ((f.type === 'status' && f.name !== 'Status') || f.type === 'tags') {
      const opts = fieldOptions.get(f.name);
      if (opts) f.options = opts;
    }
  }

  const innerStart = source.indexOf('-->', startMatch?.index ?? 0);
  const endIdx = source.search(/<!--\s*board:end\s*-->/i);
  const rawBody = source.slice(
    innerStart >= 0 ? innerStart + 3 : 0,
    endIdx >= 0 ? endIdx : source.length,
  );

  // Extract board:view markers before handing the body to the table parser.
  const views: ViewDef[] = [];
  VIEW_RE.lastIndex = 0;
  const body = rawBody.replace(VIEW_RE, (_match, attrRaw: string) => {
    views.push(parseViewDef(attrRaw));
    return '';
  });

  const table = findTableSlice(body);

  // Parse board:body blocks and map them by card id.
  const bodyById = new Map<string, string>();
  const matches: { id: string; index: number; end: number }[] = [];
  let bm: RegExpExecArray | null;
  BODY_RE.lastIndex = 0;
  while ((bm = BODY_RE.exec(body)) !== null) {
    matches.push({ id: bm[1], index: bm.index, end: bm.index + bm[0].length });
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].end;
    const stop = i + 1 < matches.length ? matches[i + 1].index : body.length;
    bodyById.set(normalizeLegacyId(matches[i].id), body.slice(start, stop).replace(/^\n+/, '').replace(/\n+$/, '\n'));
  }

  const cards: Card[] = [];
  if (table) {
    for (const row of table.rows) {
      const values: Record<string, string> = {};
      table.header.forEach((h, idx) => {
        values[h] = row[idx] ?? '';
      });
      const id = normalizeLegacyId(values.id || '');
      values.id = id;
      cards.push({ id, values, body: bodyById.get(id) ?? '' });
    }
  }

  const cardIds = new Set(cards.map((c) => c.id));
  const orphanBodies: { id: string; body: string }[] = [];
  for (const [bid, bodyText] of bodyById.entries()) {
    if (!cardIds.has(bid)) {
      orphanBodies.push({ id: bid, body: bodyText });
      // eslint-disable-next-line no-console
      console.warn(`[board] orphan board:body id="${bid}" (no matching card row)`);
    }
  }

  // Tags fields: ensure every tag present in a card is in the field's option set
  // (auto-colored), so existing boards are immediately colored + managed.
  for (const f of fields) {
    if (f.type !== 'tags') continue;
    const opts = [...(f.options ?? [])];
    const seen = new Set(opts.map(o => o.name));
    for (const c of cards) {
      for (const t of (c.values[f.name] ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
        if (!seen.has(t)) { seen.add(t); opts.push({ name: t, color: autoColor(t) }); }
      }
    }
    if (opts.length) f.options = opts;
  }

  return {
    id: attrs.id ?? '',
    name: attrs.name ?? '',
    columns,
    fields,
    cards,
    orphanBodies,
    views,
    activeView: attrs['active-view']?.trim() || 'kanban',
  };
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function serializeStartMarker(board: Board): string {
  const fieldNames = board.fields.map((f) => f.name);
  const hidden = board.fields.filter((f) => !f.visibleOnCard).map((f) => f.name);
  const colors = board.columns.map((c) => c.color).join('|');
  const fieldTypes = board.fields.map((f) => `${f.name}=${f.type}`).join(',');

  const fieldOptionsParts: string[] = [];
  for (const f of board.fields) {
    if (((f.type === 'status' && f.name !== 'Status') || f.type === 'tags') && f.options && f.options.length) {
      const opts = f.options.map((o) => `${o.name}:${o.color}`).join('|');
      fieldOptionsParts.push(`${f.name}=${opts}`);
    }
  }

  const attrs: string[] = [`id="${board.id}"`];
  if (board.name) attrs.push(`name="${board.name}"`);
  if (board.columns.length) {
    attrs.push(`columns="${board.columns.map((c) => c.name).join('|')}"`);
    attrs.push(`column-colors="${colors}"`);
  }
  if (fieldNames.length) attrs.push(`field-types="${fieldTypes}"`);
  if (fieldOptionsParts.length) {
    attrs.push(`field-options="${fieldOptionsParts.join(';')}"`);
  }
  if (hidden.length) attrs.push(`hidden-fields="${hidden.join(',')}"`);
  if (board.activeView && board.activeView !== 'kanban') {
    attrs.push(`active-view="${board.activeView}"`);
  }

  return `<!-- board:start ${attrs.join(' ')} -->`;
}

function serializeView(v: ViewDef): string {
  const parts: string[] = [`name="${v.name}"`];
  if (v.columns && v.columns.length > 0) parts.push(`columns="${v.columns.join(',')}"`);
  if (v.hidden  && v.hidden.length  > 0) parts.push(`hidden="${v.hidden.join(',')}"`);
  if (v.sort)    parts.push(`sort="${v.sort.field},${v.sort.dir}"`);
  if (v.groupBy) parts.push(`group="${v.groupBy}"`);
  if (v.widths && Object.keys(v.widths).length > 0) {
    const widthStr = Object.entries(v.widths)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, n]) => `${k}=${n}`)
      .join(',');
    parts.push(`widths="${widthStr}"`);
  }
  if (v.extras) {
    for (const [k, val] of Object.entries(v.extras)) parts.push(`${k}="${val}"`);
  }
  return `<!-- board:view ${parts.join(' ')} -->`;
}

function serializeTable(board: Board): string {
  const headers = board.fields.map((f) => f.name);
  const header = `| ${headers.join(' | ')} |`;
  const sep = `|${headers.map(() => '---').join('|')}|`;
  const rows = board.cards.map((card) => {
    const cells = headers.map((h) => escapeCell(card.values[h] ?? ''));
    return `| ${cells.join(' | ')} |`;
  });
  return [header, sep, ...rows].join('\n');
}

function serializeBodies(board: Board): string {
  const parts: string[] = [];
  for (const card of board.cards) {
    const body = card.body.trim();
    if (!body) continue;
    parts.push(`<!-- board:body id="${card.id}" -->`);
    parts.push('');
    parts.push(body);
    parts.push('');
  }
  for (const orphan of board.orphanBodies) {
    const body = orphan.body.trim();
    if (!body) continue;
    parts.push(`<!-- board:body id="${orphan.id}" -->`);
    parts.push('');
    parts.push(body);
    parts.push('');
  }
  return parts.join('\n');
}

/** Extract the trailing integer from a canonical `C<n>` or legacy `c<n>` id; null otherwise. */
export function idNumber(id: string): number | null {
  const m = /^[cC](\d+)$/.exec(id);
  return m ? parseInt(m[1], 10) : null;
}

/** Normalize a legacy lowercase `c<n>` id to the canonical uppercase `C<n>`. Idempotent. */
export function normalizeLegacyId(id: string): string {
  const m = /^c(\d+)$/.exec(id);
  return m ? `C${parseInt(m[1], 10)}` : id;
}

/** Next free id in the canonical `C<n>` scheme, continuing from the highest existing number. */
export function mintCardId(existingIds: Iterable<string>): string {
  const used = new Set<string>();
  let max = 0;
  for (const id of existingIds) {
    used.add(id);
    const n = idNumber(id);
    if (n !== null && n > max) max = n;
  }
  let n = max + 1;
  while (used.has(`C${n}`)) n++;
  return `C${n}`;
}

export function serializeBoard(board: Board): string {
  // De-duplicate card ids: first occurrence wins; later occurrences get -N suffix.
  // Empty ids are minted in the canonical C<n> scheme, continuing from the highest.
  let maxN = 0;
  for (const c of board.cards) {
    const n = idNumber(c.id);
    if (n !== null && n > maxN) maxN = n;
  }
  const seen = new Set<string>();
  const normalizedCards = board.cards.map((c) => {
    let id = c.id || `C${++maxN}`;
    if (!seen.has(id)) {
      seen.add(id);
      return { ...c, id, values: { ...c.values, id } };
    }
    let n = 2;
    while (seen.has(`${id}-${n}`)) n++;
    const next = `${id}-${n}`;
    seen.add(next);
    return { ...c, id: next, values: { ...c.values, id: next } };
  });
  const normalized: Board = { ...board, cards: normalizedCards };

  const sections: string[] = [
    serializeStartMarker(normalized),
  ];
  for (const view of normalized.views) {
    sections.push(serializeView(view));
  }
  sections.push('');
  sections.push(serializeTable(normalized));
  sections.push('');
  const bodies = serializeBodies(normalized);
  if (bodies) {
    sections.push(bodies);
  }
  sections.push('<!-- board:end -->');
  return sections.join('\n');
}
