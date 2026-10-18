import { outputMimeForCompress, scaleToFit } from '../src/webview/imageCompress';

describe('outputMimeForCompress', () => {
  it('keeps JPEG as JPEG and WebP as WebP', () => {
    expect(outputMimeForCompress('image/jpeg')).toBe('image/jpeg');
    expect(outputMimeForCompress('image/jpg')).toBe('image/jpeg');
    expect(outputMimeForCompress('image/webp')).toBe('image/webp');
  });
  it('re-encodes PNG to WebP', () => {
    expect(outputMimeForCompress('image/png')).toBe('image/webp');
  });
  it('returns null (skip) for vector/animated/other formats', () => {
    expect(outputMimeForCompress('image/svg+xml')).toBeNull();
    expect(outputMimeForCompress('image/gif')).toBeNull();
    expect(outputMimeForCompress('image/bmp')).toBeNull();
    expect(outputMimeForCompress('application/octet-stream')).toBeNull();
  });
});

describe('scaleToFit', () => {
  it('returns the same size when within the cap or cap disabled', () => {
    expect(scaleToFit(800, 600, 0)).toEqual({ w: 800, h: 600 });
    expect(scaleToFit(800, 600, 1000)).toEqual({ w: 800, h: 600 });
  });
  it('scales down proportionally to the longest side', () => {
    expect(scaleToFit(2000, 1000, 1000)).toEqual({ w: 1000, h: 500 });
    expect(scaleToFit(1000, 2000, 1000)).toEqual({ w: 500, h: 1000 });
  });
  it('never returns a zero dimension', () => {
    expect(scaleToFit(2000, 1, 1000)).toEqual({ w: 1000, h: 1 });
  });
});
