// Tracks, per document, whether the provider is currently applying its own
// WorkspaceEdit. The webview's onDidChangeTextDocument handler uses this to skip
// the echo of an edit it just made — but the suppression MUST be per document.
//
// The previous implementation used a single shared boolean on the singleton
// provider. With two markdown editors open, their applyEdit calls interleave on
// their awaits, so one document finishing reset the shared flag while another
// was still applying. The second document's echo then leaked through as an
// external 'update' — a key contributor to the empty-on-open data-loss bug.
//
// Reference-counted so overlapping applies to the same document stay suppressed
// until the last one completes.
export class ApplyingTracker {
  private readonly counts = new Map<string, number>();

  begin(key: string): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  end(key: string): void {
    const next = (this.counts.get(key) ?? 0) - 1;
    if (next > 0) {
      this.counts.set(key, next);
    } else {
      this.counts.delete(key); // clamp at zero — extra end() is a harmless no-op
    }
  }

  isApplying(key: string): boolean {
    return (this.counts.get(key) ?? 0) > 0;
  }
}
