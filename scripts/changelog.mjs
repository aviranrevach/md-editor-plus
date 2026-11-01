// Usage:
//   node scripts/changelog.mjs roll <version> <yyyy-mm-dd>   move [Unreleased] into a new version section
//   node scripts/changelog.mjs notes <version>               print that version's section body
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../CHANGELOG.md', import.meta.url);
const REPO = 'https://github.com/aviranrevach/md-editor-plus';
const [cmd, version, date] = process.argv.slice(2);
const text = readFileSync(FILE, 'utf8');

function section(v) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## [${v}]`));
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && (l.startsWith('## [') || /^\[[^\]]+\]: /.test(l)));
  if (end === -1) end = lines.length;
  return lines.slice(start + 1, end).join('\n').trim();
}

if (cmd === 'notes') {
  process.stdout.write(section(version) ?? '');
} else if (cmd === 'roll') {
  if (!section('Unreleased')) {
    console.log('[Unreleased] is empty, changelog left as is');
    process.exit(0);
  }
  const prev = text.match(/^## \[(\d+\.\d+\.\d+)\]/m)?.[1];
  let out = text.replace('## [Unreleased]', `## [Unreleased]\n\n## [${version}] - ${date}`);
  out = out.replace(/^\[Unreleased\]: .*$/m, `[Unreleased]: ${REPO}/compare/v${version}...HEAD`);
  if (prev) {
    out = out.replace(/^(\[Unreleased\]: .*)$/m, `$1\n[${version}]: ${REPO}/compare/v${prev}...v${version}`);
  }
  writeFileSync(FILE, out);
  console.log(`rolled [Unreleased] into ${version}`);
} else {
  console.error('usage: changelog.mjs roll <version> <date> | notes <version>');
  process.exit(1);
}
