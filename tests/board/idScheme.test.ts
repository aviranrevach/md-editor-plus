import { idNumber, normalizeLegacyId, mintCardId } from '../../src/webview/boardModel';

describe('idNumber', () => {
  it('extracts the trailing integer from C<n> and legacy c<n>', () => {
    expect(idNumber('C7')).toBe(7);
    expect(idNumber('c7')).toBe(7);
    expect(idNumber('C103')).toBe(103);
  });
  it('returns null for non-matching ids', () => {
    expect(idNumber('')).toBeNull();
    expect(idNumber('c-ab12')).toBeNull();
    expect(idNumber('task-3')).toBeNull();
    expect(idNumber('C7x')).toBeNull();
  });
});

describe('normalizeLegacyId', () => {
  it('uppercases legacy lowercase c<n>', () => {
    expect(normalizeLegacyId('c8')).toBe('C8');
    expect(normalizeLegacyId('c17')).toBe('C17');
  });
  it('leaves already-canonical and non-matching ids untouched', () => {
    expect(normalizeLegacyId('C8')).toBe('C8');
    expect(normalizeLegacyId('c-ab12')).toBe('c-ab12');
    expect(normalizeLegacyId('')).toBe('');
  });
});

describe('mintCardId', () => {
  it('continues from the highest existing number, uppercase C', () => {
    expect(mintCardId(['C1', 'C17', 'C3'])).toBe('C18');
  });
  it('accounts for legacy lowercase numbers when scanning', () => {
    expect(mintCardId(['c8', 'C2'])).toBe('C9');
  });
  it('starts at C1 when there are no numeric ids', () => {
    expect(mintCardId([])).toBe('C1');
    expect(mintCardId(['c-ab12'])).toBe('C1');
  });
  it('skips a number already taken at the computed slot', () => {
    // max is 5 -> tries C6; if C6 already present, advances
    expect(mintCardId(['C5', 'C6'])).toBe('C7');
  });
});
