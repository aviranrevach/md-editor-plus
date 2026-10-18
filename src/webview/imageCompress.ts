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

export interface CompressResult {
  bytes: ArrayBuffer;
  mime: string;
  changed: boolean; // false => caller should keep the original asset as-is
}

// Re-encode image bytes through an offscreen canvas at `quality`, optionally
// capping the longest side to `maxDim`. Never inflates: if the result isn't
// smaller (and the format is unchanged), returns the original with changed=false.
export async function compressImage(
  bytes: ArrayBuffer,
  inputMime: string,
  opts: { quality?: number; maxDim?: number } = {},
): Promise<CompressResult> {
  const outMime = outputMimeForCompress(inputMime);
  if (!outMime) return { bytes, mime: inputMime, changed: false };
  const quality = opts.quality ?? 0.8;
  const maxDim = opts.maxDim ?? 0;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: inputMime }));
  } catch {
    return { bytes, mime: inputMime, changed: false };
  }
  const { w, h } = scaleToFit(bitmap.width, bitmap.height, maxDim);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close?.();
    return { bytes, mime: inputMime, changed: false };
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const outBlob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), outMime, quality),
  );
  if (!outBlob) return { bytes, mime: inputMime, changed: false };
  const outBytes = await outBlob.arrayBuffer();

  // Never inflate: if the re-encode didn't get smaller, keep the original.
  if (outBytes.byteLength >= bytes.byteLength) {
    return { bytes, mime: inputMime, changed: false };
  }
  return { bytes: outBytes, mime: outMime, changed: true };
}
