// c27 — shared inline-markdown renderer for board views (table + kanban).
//
// Board cell values and card bodies are raw markdown strings, but the board
// views used to paint them as plain text (only ![](…) became a thumbnail), so
// **bold**, *italic*, `code`, ==highlight==, links and color/underline spans the
// editor itself produces showed up as literal characters.
//
// This renders the supported INLINE set into DOM nodes — never innerHTML, so no
// markup from document content can execute. It is display-only; board editing
// still works on the raw markdown text.
import { resolveImageSrc } from './mediaResolve';

// Style props we allow through from inline `<span style="…">` (the editor emits
// these for text color / highlight). Everything else is dropped.
const ALLOWED_STYLE_PROPS = new Set(['color', 'background-color']);
// A conservative value charset: hex, rgb()/rgba()/hsl(), named colors, %, etc.
const SAFE_STYLE_VALUE = /^[a-z0-9#(),.%\s/-]+$/i;

// Inline HTML tags we map straight to a same-named element. `code` is included
// here but its inner text is NOT re-parsed (handled below).
const HTML_TAGS = ['u', 'mark', 's', 'strong', 'em', 'b', 'i', 'code'];

// URL schemes allowed on a rendered href. Relative paths, anchors and
// scheme-less values pass; javascript:/data:/vbscript: are dropped (the link
// text still renders, just not as a live link).
const SAFE_HREF_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (!href) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href);
  if (scheme && !SAFE_HREF_SCHEMES.has(scheme[1].toLowerCase())) return null;
  return href;
}

interface Token {
  index: number;
  length: number;
  build: () => Node;
}

// Matchers run against `text` and, on a hit, return the match index, consumed
// length, and a builder for the resulting node. Ordered by precedence: earlier
// entries win ties on `index`, so `**` is read as bold before `*` italic, image
// before link, `__` bold before `_` italic, etc.
function firstToken(text: string): Token | null {
  const matchers: Array<() => Token | null> = [
    // Inline code — content is literal, not re-parsed.
    () => {
      const m = /`([^`]+)`/.exec(text);
      return m && { index: m.index, length: m[0].length, build: () => el('code', m[1]) };
    },
    // Image — small inline thumbnail (parity with the old renderer).
    () => {
      const m = /!\[([^\]]*)\]\(((?:[^()]|\([^()]*\))*)\)/.exec(text);
      return m && {
        index: m.index, length: m[0].length,
        build: () => {
          const img = document.createElement('img');
          img.className = 'bd-inline-thumb';
          img.src = resolveImageSrc(m[2].trim());
          img.alt = m[1];
          return img;
        },
      };
    },
    // Image from inline HTML. The editor emits `<img src="…" width="N" />` for a
    // resized image (imageMarkdown.ts), so a description holding one used to
    // show the raw tag. Only `src`/`alt` are read — never onerror & co.
    () => {
      const m = /<img\b([^>]*?)\/?>/i.exec(text);
      if (!m) return null;
      const src = /src\s*=\s*"([^"]*)"/i.exec(m[1]);
      if (!src) return null;
      const alt = /alt\s*=\s*"([^"]*)"/i.exec(m[1]);
      return {
        index: m.index, length: m[0].length,
        build: () => {
          const img = document.createElement('img');
          img.className = 'bd-inline-thumb';
          img.src = resolveImageSrc(src[1].trim());
          img.alt = alt ? alt[1] : '';
          return img;
        },
      };
    },
    // Link — inner text is re-parsed for marks.
    () => {
      const m = /\[([^\]]*)\]\(((?:[^()]|\([^()]*\))*)\)/.exec(text);
      return m && {
        index: m.index, length: m[0].length,
        build: () => buildAnchor(m[2], m[1]),
      };
    },
    // Anchor from inline HTML (a pasted link keeps its <a> tag). As with <span>,
    // only the `href` attribute is ever read.
    () => {
      const m = /<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(text);
      if (!m) return null;
      const href = /href\s*=\s*"([^"]*)"/i.exec(m[1]);
      return {
        index: m.index, length: m[0].length,
        build: () => buildAnchor(href ? href[1] : '', m[2]),
      };
    },
    // Color / highlight span from inline HTML. We match any <span …> but only
    // ever read its `style` attribute — other attributes (e.g. onclick) are
    // ignored, never applied.
    () => {
      const m = /<span\b([^>]*)>([\s\S]*?)<\/span>/i.exec(text);
      return m && {
        index: m.index, length: m[0].length,
        build: () => {
          const span = document.createElement('span');
          const style = /style\s*=\s*"([^"]*)"/i.exec(m[1]);
          if (style) applySafeStyle(span, style[1]);
          parseInto(span, m[2]);
          return span;
        },
      };
    },
    // Whitelisted inline HTML tags.
    () => {
      const m = new RegExp(`<(${HTML_TAGS.join('|')})>([\\s\\S]*?)</\\1>`, 'i').exec(text);
      if (!m) return null;
      const tag = m[1].toLowerCase();
      return {
        index: m.index, length: m[0].length,
        build: () => {
          if (tag === 'code') return el('code', m[2]);
          const node = document.createElement(tag);
          parseInto(node, m[2]);
          return node;
        },
      };
    },
    markMatcher(text, /\*\*([\s\S]+?)\*\*/, 'strong'),
    // `__`/`_` must not be intra-word (CommonMark) so snake_case identifiers in
    // a cell don't get italicized.
    markMatcher(text, /(?<![A-Za-z0-9])__([\s\S]+?)__(?![A-Za-z0-9])/, 'strong'),
    markMatcher(text, /~~([\s\S]+?)~~/, 's'),
    markMatcher(text, /==([\s\S]+?)==/, 'mark'),
    markMatcher(text, /\*([\s\S]+?)\*/, 'em'),
    markMatcher(text, /(?<![A-Za-z0-9])_([\s\S]+?)_(?![A-Za-z0-9])/, 'em'),
  ];

  let best: Token | null = null;
  for (const run of matchers) {
    const t = run();
    if (t && (best === null || t.index < best.index)) best = t;
  }
  return best;
}

function markMatcher(text: string, re: RegExp, tag: string): () => Token | null {
  return () => {
    const m = re.exec(text);
    return m && {
      index: m.index, length: m[0].length,
      build: () => {
        const node = document.createElement(tag);
        parseInto(node, m[1]);
        return node;
      },
    };
  };
}

function el(tag: string, text: string): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

// An <a> whose href is dropped when the scheme isn't trusted — the label still
// renders, so no text is ever lost to a rejected URL.
function buildAnchor(rawHref: string, label: string): HTMLElement {
  const a = document.createElement('a');
  const href = safeHref(rawHref);
  if (href) a.setAttribute('href', href);
  parseInto(a, label);
  return a;
}

function applySafeStyle(node: HTMLElement, style: string): void {
  for (const decl of style.split(';')) {
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (!ALLOWED_STYLE_PROPS.has(prop)) continue;
    if (!SAFE_STYLE_VALUE.test(value)) continue;
    node.style.setProperty(prop, value);
  }
}

function parseInto(parent: Node, text: string): void {
  let rest = text;
  while (rest.length > 0) {
    const tok = firstToken(rest);
    if (!tok) {
      parent.appendChild(document.createTextNode(rest));
      return;
    }
    if (tok.index > 0) parent.appendChild(document.createTextNode(rest.slice(0, tok.index)));
    parent.appendChild(tok.build());
    rest = rest.slice(tok.index + tok.length);
  }
}

/**
 * Render `value` (raw inline markdown) into `host` as styled DOM. Clears host
 * first. Safe against arbitrary document content (no innerHTML).
 */
export function renderInlineMarkdown(host: HTMLElement, value: string): void {
  host.textContent = '';
  parseInto(host, value);
}
