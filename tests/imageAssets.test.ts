import {
  assetsFolderName,
  sanitizeImageFileName,
  dedupeFileName,
  relativeAssetPath,
  isImageFileName,
  extensionForMime,
  pastedImageName,
} from '../src/imageAssets';

describe('assetsFolderName', () => {
  it('derives "<note>.assets" from a .md file name', () => {
    expect(assetsFolderName('TODO.md')).toBe('TODO.assets');
  });
  it('strips only the final extension', () => {
    expect(assetsFolderName('my.notes.md')).toBe('my.notes.assets');
  });
  it('handles a name with no extension', () => {
    expect(assetsFolderName('README')).toBe('README.assets');
  });
});

describe('sanitizeImageFileName', () => {
  it('keeps a clean name unchanged', () => {
    expect(sanitizeImageFileName('diagram.png')).toBe('diagram.png');
  });
  it('strips any directory parts', () => {
    expect(sanitizeImageFileName('/Users/me/Pictures/shot.png')).toBe('shot.png');
    expect(sanitizeImageFileName('C:\\pics\\shot.png')).toBe('shot.png');
  });
  it('replaces whitespace and unsafe chars with dashes and collapses runs', () => {
    expect(sanitizeImageFileName('my   cool*pic?.png')).toBe('my-cool-pic.png');
  });
  it('falls back to "image.png" for an empty result', () => {
    expect(sanitizeImageFileName('   ')).toBe('image.png');
  });
});

describe('dedupeFileName', () => {
  it('returns the name unchanged when it is unique', () => {
    expect(dedupeFileName('shot.png', ['other.png'])).toBe('shot.png');
  });
  it('inserts -2 before the extension on first collision', () => {
    expect(dedupeFileName('shot.png', ['shot.png'])).toBe('shot-2.png');
  });
  it('keeps incrementing until unique', () => {
    expect(dedupeFileName('shot.png', ['shot.png', 'shot-2.png'])).toBe('shot-3.png');
  });
  it('dedupes names without an extension', () => {
    expect(dedupeFileName('shot', ['shot'])).toBe('shot-2');
  });
});

describe('relativeAssetPath', () => {
  it('builds a ./folder/file relative link', () => {
    expect(relativeAssetPath('TODO.assets', 'shot.png')).toBe('./TODO.assets/shot.png');
  });
});

describe('isImageFileName', () => {
  it('accepts common image extensions case-insensitively', () => {
    expect(isImageFileName('a.PNG')).toBe(true);
    expect(isImageFileName('b.jpeg')).toBe(true);
    expect(isImageFileName('c.svg')).toBe(true);
  });
  it('rejects non-images', () => {
    expect(isImageFileName('notes.md')).toBe(false);
    expect(isImageFileName('noext')).toBe(false);
  });
});

describe('extensionForMime', () => {
  it('maps common image mime types to extensions', () => {
    expect(extensionForMime('image/png')).toBe('png');
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('image/gif')).toBe('gif');
    expect(extensionForMime('image/webp')).toBe('webp');
    expect(extensionForMime('image/svg+xml')).toBe('svg');
  });
  it('is case-insensitive', () => {
    expect(extensionForMime('IMAGE/PNG')).toBe('png');
  });
  it('falls back to png for unknown types', () => {
    expect(extensionForMime('image/heic')).toBe('png');
    expect(extensionForMime('application/octet-stream')).toBe('png');
  });
});

describe('pastedImageName', () => {
  it('builds a zero-padded pasted-<date>.<ext> name', () => {
    // Month is 0-indexed: 5 === June
    expect(pastedImageName('image/png', new Date(2026, 5, 6))).toBe('pasted-2026-06-06.png');
  });
  it('uses the mime-derived extension', () => {
    expect(pastedImageName('image/jpeg', new Date(2026, 0, 1))).toBe('pasted-2026-01-01.jpg');
  });
});
