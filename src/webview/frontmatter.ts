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
