// Smart typography: Notion-style replacements as you type.
//
// Rule order matters. ProseMirror runs input rules in array order and applies
// the FIRST match, so any multi-character trigger that ends in the same
// character as a shorter trigger must come first:
//   - `<=>` before `=>`  (both complete on `>`)
//   - `<->` before `->`  (literal "<->" ends in "->")
// `<-` auto-converts to ← the instant `-` is typed, before the closing `>` can
// be entered. So `<->` typed live arrives as "←>" — the `←>` rule completes it
// to ↔. (The literal `<->` rule is kept as a belt-and-suspenders for buffers
// that arrive whole, e.g. programmatic input.)
export interface SmartTypographyRule {
  find: RegExp;
  replace: string;
}

export const SMART_TYPOGRAPHY_RULES: SmartTypographyRule[] = [
  { find: /<=>$/, replace: '⇔' },
  { find: /<->$/, replace: '↔' },
  { find: /←>$/,  replace: '↔' },
  { find: /->$/,  replace: '→' },
  { find: /<-$/,  replace: '←' },
  { find: /=>$/,  replace: '⇒' },
  { find: /--$/,  replace: '—' },
  { find: /\.\.\.$/, replace: '…' },
  { find: /\(c\)$/i,  replace: '©' },
  { find: /\(r\)$/i,  replace: '®' },
  { find: /\(tm\)$/i, replace: '™' },
];

export interface SmartTypographyMatch {
  matchLength: number;
  replacement: string;
}

/**
 * Given the text immediately before the cursor, return the first matching
 * smart-typography replacement, or null. Pure — no editor/DOM dependency.
 */
export function findSmartTypographyMatch(textBefore: string): SmartTypographyMatch | null {
  for (const rule of SMART_TYPOGRAPHY_RULES) {
    const m = rule.find.exec(textBefore);
    if (m) return { matchLength: m[0].length, replacement: rule.replace };
  }
  return null;
}
