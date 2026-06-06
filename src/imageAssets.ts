// Pure, dependency-free helpers for the image-ingestion pipeline.
// Imported by BOTH the extension (./imageAssets) and the webview bundle
// (../imageAssets), so it must not import node `path`, `fs`, vscode, or DOM.

export const IMAGE_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico',
] as const;

// "TODO.md" -> "TODO.assets". Strips only the final extension.
export function assetsFolderName(docFileName: string): string {
  const base = docFileName.replace(/\.[^.]+$/, '');
  return `${base}.assets`;
}

// Reduce an arbitrary (possibly path-laden) name to a safe single filename.
export function sanitizeImageFileName(raw: string): string {
  // Drop any directory portion (handles both / and \ separators).
  const baseOnly = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = baseOnly
    .replace(/[\\/:*?"<>|\s]+/g, '-')          // unsafe + whitespace runs -> dash
    .replace(/-{2,}/g, '-')                    // collapse dash runs
    .replace(/^-+/, '');                        // no leading dash
  return cleaned.length ? cleaned : 'image.png';
}

// If `name` collides with an existing entry, insert -2, -3, ... before the ext.
export function dedupeFileName(name: string, existing: string[]): string {
  const taken = new Set(existing);
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext  = dot > 0 ? name.slice(dot) : '';
  let n = 2;
  let candidate = `${stem}-${n}${ext}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${stem}-${n}${ext}`;
  }
  return candidate;
}

// Build the relative markdown link the editor will store.
export function relativeAssetPath(folderName: string, fileName: string): string {
  return `./${folderName}/${fileName}`;
}

export function isImageFileName(name: string): boolean {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  if (!m) return false;
  return (IMAGE_EXTENSIONS as readonly string[]).includes(m[1].toLowerCase());
}
