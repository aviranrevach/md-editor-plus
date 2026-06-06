// Image compression: pure decision helpers (unit-tested) + an async canvas
// re-encode (DOM, verified manually). Used by the body toolbar and board manager.

// Decide the output mime for a compress pass. null => don't canvas-compress
// (vector/animated/unknown): keep the original bytes untouched.
export function outputMimeForCompress(inputMime: string): string | null {
  const m = inputMime.toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return 'image/jpeg';
  if (m === 'image/webp') return 'image/webp';
  if (m === 'image/png') return 'image/webp'; // PNG screenshots shrink far better as WebP
  return null;
}

// Scale (w,h) down to fit maxDim on the longest side, preserving aspect ratio.
// No upscaling. maxDim <= 0 means "no cap".
export function scaleToFit(w: number, h: number, maxDim: number): { w: number; h: number } {
  if (maxDim <= 0 || w <= 0 || h <= 0) return { w, h };
  const longest = Math.max(w, h);
  if (longest <= maxDim) return { w, h };
  const ratio = maxDim / longest;
  return { w: Math.max(1, Math.round(w * ratio)), h: Math.max(1, Math.round(h * ratio)) };
}
