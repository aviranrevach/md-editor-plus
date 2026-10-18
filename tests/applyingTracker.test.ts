import { ApplyingTracker } from '../src/applyingTracker';

// Regression guard for the empty-on-open data loss: edit-application state must
// be tracked PER DOCUMENT. The original code used one shared boolean, so with
// two files open, one document finishing its applyEdit cleared the flag while
// another's was still in flight — leaking an echo update that could carry empty
// content into the still-applying document.
describe('ApplyingTracker', () => {
  it('reports not-applying for an unknown key', () => {
    const t = new ApplyingTracker();
    expect(t.isApplying('file:///a.md')).toBe(false);
  });

  it('marks a key applying between begin and end', () => {
    const t = new ApplyingTracker();
    t.begin('file:///a.md');
    expect(t.isApplying('file:///a.md')).toBe(true);
    t.end('file:///a.md');
    expect(t.isApplying('file:///a.md')).toBe(false);
  });

  // THE BUG: with the old shared boolean this isolation did not hold.
  it('keeps documents independent — ending one does not clear another', () => {
    const t = new ApplyingTracker();
    const A = 'file:///a.md';
    const B = 'file:///b.md';
    t.begin(A);
    t.begin(B);
    t.end(A);
    expect(t.isApplying(A)).toBe(false);
    expect(t.isApplying(B)).toBe(true); // B is still mid-apply — must stay suppressed
    t.end(B);
    expect(t.isApplying(B)).toBe(false);
  });

  // Overlapping applies to the SAME document must stay suppressed until the
  // last one finishes (a plain Set would drop suppression after the first end).
  it('handles overlapping applies to the same document via reference counting', () => {
    const t = new ApplyingTracker();
    const A = 'file:///a.md';
    t.begin(A);
    t.begin(A);
    t.end(A);
    expect(t.isApplying(A)).toBe(true); // one apply still outstanding
    t.end(A);
    expect(t.isApplying(A)).toBe(false);
  });

  it('does not go negative if end is called more than begin', () => {
    const t = new ApplyingTracker();
    const A = 'file:///a.md';
    t.begin(A);
    t.end(A);
    t.end(A); // extra end — should be a harmless no-op
    expect(t.isApplying(A)).toBe(false);
    t.begin(A);
    expect(t.isApplying(A)).toBe(true);
  });
});
