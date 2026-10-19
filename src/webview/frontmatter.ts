// Detect and split YAML or TOML frontmatter from a Markdown document so the
// editor view can hide it (frontmatter renders ugly in WYSIWYG) while the
// raw document is still preserved on save and editable from Source view.

const YAML_FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const TOML_FM = /^\+\+\+\r?\n([\s\S]*?)\r?\n\+\+\+\r?\n?/;

export interface FrontmatterSplit {
  frontmatter: string;
  body: string;
  kind: 'yaml' | 'toml' | 'none';
}

export function splitFrontmatter(md: string): FrontmatterSplit {
  const yaml = md.match(YAML_FM);
  if (yaml) return { frontmatter: yaml[0], body: md.slice(yaml[0].length), kind: 'yaml' };
  const toml = md.match(TOML_FM);
  if (toml) return { frontmatter: toml[0], body: md.slice(toml[0].length), kind: 'toml' };
  return { frontmatter: '', body: md, kind: 'none' };
}

export function countFrontmatterLines(fm: string): number {
  if (!fm) return 0;
  const inner = fm.replace(/^(?:---|\+\+\+)\r?\n/, '').replace(/\r?\n(?:---|\+\+\+)\r?\n?$/, '');
  return inner.split('\n').filter(line => line.length > 0).length;
}

export function frontmatterInfo(md: string): {
  lines: number;
  kind: 'yaml' | 'toml' | 'none';
} {
  const split = splitFrontmatter(md);
  return {
    kind: split.kind,
    lines: countFrontmatterLines(split.frontmatter),
  };
}

export interface FrontmatterField {
  key: string;
  value: string;
}

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

// Flat top-level key/value view of the frontmatter for display. Handles scalar
// values, inline lists and block lists / nested maps (shown compactly). It is
// display-only; the raw frontmatter string is what gets saved.
export function parseFrontmatterFields(fm: string): FrontmatterField[] {
  if (!fm) return [];
  const inner = fm.replace(/^(?:---|\+\+\+)\r?\n/, '').replace(/\r?\n(?:---|\+\+\+)\r?\n?$/, '');
  const fields: FrontmatterField[] = [];
  let current: { key: string; value: string; items: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const value = current.items.length
      ? current.items.join(', ')
      : current.value;
    fields.push({ key: current.key, value });
    current = null;
  };
  for (const line of inner.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const top = line.match(/^([A-Za-z0-9_][\w.\- ]*?)\s*[:=]\s*(.*)$/);
    if (top && !/^\s/.test(line)) {
      flush();
      let value = top[2].trim();
      const inlineList = value.match(/^\[(.*)\]$/);
      if (inlineList) value = inlineList[1].split(',').map(unquote).filter(Boolean).join(', ');
      else value = unquote(value);
      current = { key: top[1].trim(), value, items: [] };
      continue;
    }
    if (current) {
      const item = line.match(/^\s+-\s+(.*)$/);
      if (item) current.items.push(unquote(item[1]));
      else if (/^\s+\S/.test(line)) {
        const nested = line.trim();
        current.items.push(unquote(nested));
      }
    }
  }
  flush();
  return fields;
}
