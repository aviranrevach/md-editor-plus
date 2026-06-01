// Single owner of the mermaid library + theming + render queue + cache.
//
// Imported statically (not dynamically) because the webview's CSP disallows
// loading scripts at runtime without a nonce. esbuild bundles mermaid into the
// main webview bundle; the cost is a larger bundle, but cold open of a file
// with no mermaid blocks still pays nothing at runtime beyond the initial
// parse — and the cache avoids re-rendering on theme flips.

import mermaid from 'mermaid';
import { currentResolvedTheme, subscribeThemeChanges, Resolved } from './theme';

export type DiagramTheme = Resolved;

export type RenderOk     = { ok: true;  svg: string };
export type RenderErr    = { ok: false; message: string; line?: number };
export type RenderResult = RenderOk | RenderErr;

interface ThemeVarSet {
  background:       string;
  primaryColor:     string;
  primaryTextColor: string;
  primaryBorderColor: string;
  secondaryColor:   string;
  tertiaryColor:    string;
  lineColor:        string;
  textColor:        string;
  mainBkg:          string;
  clusterBkg:       string;
  noteBkgColor:     string;
  noteTextColor:    string;
}

export const THEME_VARS: Record<DiagramTheme, ThemeVarSet> = {
  light: {
    background:       '#ffffff',
    primaryColor:     '#dbeafe',
    primaryTextColor: '#1a1a1a',
    primaryBorderColor: '#6366f1',
    secondaryColor:   '#ecfeff',
    tertiaryColor:    '#f0fdf4',
    lineColor:        '#4b5563',
    textColor:        '#1a1a1a',
    mainBkg:          '#dbeafe',
    clusterBkg:       '#f5f5f7',
    noteBkgColor:     '#fff8c5',
    noteTextColor:    '#9a6700',
  },
  claude: {
    background:       '#fdf6e3',
    primaryColor:     '#fef3c7',
    primaryTextColor: '#451a03',
    primaryBorderColor: '#b45309',
    secondaryColor:   '#fee9c7',
    tertiaryColor:    '#fbe9d6',
    lineColor:        '#92400e',
    textColor:        '#451a03',
    mainBkg:          '#fef3c7',
    clusterBkg:       '#f8eccf',
    noteBkgColor:     '#fef7d6',
    noteTextColor:    '#7c3a04',
  },
  sepia: {
    background:       '#f7f1e3',
    primaryColor:     '#ede4cf',
    primaryTextColor: '#3b3a30',
    primaryBorderColor: '#9b6f46',
    secondaryColor:   '#e8ddc4',
    tertiaryColor:    '#e1d6b8',
    lineColor:        '#6b5a3e',
    textColor:        '#3b3a30',
    mainBkg:          '#ede4cf',
    clusterBkg:       '#e8ddc4',
    noteBkgColor:     '#f0e5cb',
    noteTextColor:    '#594a2e',
  },
  dark: {
    background:       '#1c1c1f',
    primaryColor:     '#27272a',
    primaryTextColor: '#f4f4f5',
    primaryBorderColor: '#a5b4fc',
    secondaryColor:   '#3f3f46',
    tertiaryColor:    '#52525b',
    lineColor:        '#9ca3af',
    textColor:        '#f4f4f5',
    mainBkg:          '#27272a',
    clusterBkg:       '#3f3f46',
    noteBkgColor:     '#3f2e15',
    noteTextColor:    '#fde68a',
  },
};

let _initialized = false;
let _alwaysDark = false;
const _cache = new Map<string, string>();
const MAX_CACHE = 64;

function initMermaid(theme: DiagramTheme): void {
  mermaid.initialize({
    startOnLoad:    false,
    securityLevel:  'strict',
    theme:          'base',
    themeVariables: THEME_VARS[theme],
    fontFamily:     'ui-sans-serif, Inter, -apple-system, sans-serif',
  });
  _initialized = true;
}

function effectiveTheme(): DiagramTheme {
  return _alwaysDark ? 'dark' : currentResolvedTheme();
}

/** Called by index.ts when the user flips the Aa-panel toggle. */
export function setAlwaysDarkDiagram(on: boolean): void {
  if (_alwaysDark === on) return;
  _alwaysDark = on;
  // Wipe the cache — the same source now belongs to a different theme key.
  _cache.clear();
  dispatchThemeChange();
}

export function isAlwaysDarkDiagram(): boolean {
  return _alwaysDark;
}

function dispatchThemeChange(): void {
  // Re-init mermaid with the new themeVariables, then let blocks re-render.
  initMermaid(effectiveTheme());
  document.dispatchEvent(new CustomEvent('mermaid-theme-changed', { detail: { theme: effectiveTheme() } }));
}

// One-time wiring: any time the editor theme flips, broadcast to blocks.
let _themeSubscribed = false;
function ensureThemeSubscription(): void {
  if (_themeSubscribed) return;
  _themeSubscribed = true;
  subscribeThemeChanges(() => dispatchThemeChange());
}

// Serialize renders — mermaid uses global state and can race.
let _queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = _queue.then(fn, fn);
  _queue = next.catch(() => undefined);
  return next as Promise<T>;
}

// Mermaid throws an Error subclass with a `.message` like
//   "Parse error on line 3:\n  Process --x Done??\n          ^\n..."
// We pluck the line number out for the error placeholder UX.
function extractLine(err: unknown): number | undefined {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/(?:Parse error on line|on line)\s+(\d+)/i)
         ?? msg.match(/line\s+(\d+)/i);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : undefined;
}

function cleanMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Mermaid messages are multi-line with the offending text + carets. The
  // first line is the human-readable bit; rest is debug.
  const first = msg.split('\n').find(l => l.trim().length > 0) ?? 'Parse error';
  return first.trim();
}

let _idCounter = 0;
function nextId(): string {
  _idCounter += 1;
  return `mmd-${Date.now().toString(36)}-${_idCounter}`;
}

/** Cheap stable hash for source strings. Used as part of the cache key. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function renderMermaid(source: string): Promise<RenderResult> {
  ensureThemeSubscription();
  const theme = effectiveTheme();
  const cacheKey = `${theme}::${hash(source)}`;
  const cached = _cache.get(cacheKey);
  if (cached) return Promise.resolve({ ok: true, svg: cached });

  return enqueue(async () => {
    if (!_initialized) initMermaid(theme);
    try {
      const { svg } = await mermaid.render(nextId(), source);
      // LRU-ish: evict the oldest entry if we hit capacity.
      if (_cache.size >= MAX_CACHE) {
        const first = _cache.keys().next().value;
        if (first !== undefined) _cache.delete(first);
      }
      _cache.set(cacheKey, svg);
      return { ok: true, svg } as RenderOk;
    } catch (err) {
      return { ok: false, message: cleanMessage(err), line: extractLine(err) } as RenderErr;
    }
  });
}

/** Attempt to detect the diagram kind (flowchart, sequenceDiagram, ...) from the source's first non-empty line. */
export function detectDiagramKind(source: string): string {
  const first = source.split('\n').map(l => l.trim()).find(l => l.length > 0) ?? '';
  const m = first.match(/^([a-zA-Z]+)/);
  return m ? m[1] : 'mermaid';
}
