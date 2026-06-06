import { imageFilesFrom } from '../src/webview/extensions/imagePasteDrop';

// Minimal duck-typed DataTransfer mocks (jsdom's DataTransfer is incomplete).
function fakeFile(name: string, type: string): File {
  return { name, type } as unknown as File;
}
function dtWithItems(items: Array<{ kind: string; type: string; file: File | null }>): DataTransfer {
  return {
    items: items.map((i) => ({ kind: i.kind, type: i.type, getAsFile: () => i.file })),
    files: [],
  } as unknown as DataTransfer;
}
function dtWithFiles(files: File[]): DataTransfer {
  return { items: [], files } as unknown as DataTransfer;
}

describe('imageFilesFrom', () => {
  it('returns nothing for a null DataTransfer', () => {
    expect(imageFilesFrom(null)).toEqual([]);
  });

  it('picks image files out of clipboard items, naming unnamed ones pasted-<date>', () => {
    const f = fakeFile('', 'image/png');
    const result = imageFilesFrom(dtWithItems([
      { kind: 'string', type: 'text/plain', file: null },
      { kind: 'file', type: 'image/png', file: f },
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe(f);
    expect(result[0].name).toMatch(/^pasted-\d{4}-\d{2}-\d{2}\.png$/);
  });

  it('keeps a real filename when the file has one', () => {
    const f = fakeFile('diagram.png', 'image/png');
    const result = imageFilesFrom(dtWithItems([{ kind: 'file', type: 'image/png', file: f }]));
    expect(result[0].name).toBe('diagram.png');
  });

  it('ignores non-image items', () => {
    const result = imageFilesFrom(dtWithItems([
      { kind: 'file', type: 'application/pdf', file: fakeFile('a.pdf', 'application/pdf') },
    ]));
    expect(result).toEqual([]);
  });

  it('falls back to DataTransfer.files (drop) when there are no items', () => {
    const f = fakeFile('photo.jpg', 'image/jpeg');
    const result = imageFilesFrom(dtWithFiles([f, fakeFile('notes.txt', 'text/plain')]));
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('photo.jpg');
  });
});
