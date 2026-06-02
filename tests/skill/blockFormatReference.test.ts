import { BLOCK_REFERENCES, BLOCK_IDS, type BlockId } from '../../src/webview/blockFormatReference';
import { parseBoardSource } from '../../src/webview/boardModel';

describe('BLOCK_REFERENCES', () => {
  it('covers exactly the five block types', () => {
    expect(BLOCK_IDS).toEqual(['kanban', 'table', 'mermaid', 'callout', 'toggle']);
    for (const id of BLOCK_IDS) {
      const r = BLOCK_REFERENCES[id];
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.whatItIs.length).toBeGreaterThan(0);
      expect(r.example.length).toBeGreaterThan(0);
      expect(r.rules.length).toBeGreaterThan(0);
    }
  });

  it('kanban + table examples are real boards that round-trip through the parser', () => {
    for (const id of ['kanban', 'table'] as BlockId[]) {
      const board = parseBoardSource(BLOCK_REFERENCES[id].example);
      expect(board.columns.length).toBeGreaterThanOrEqual(2);
      expect(board.cards.length).toBeGreaterThanOrEqual(2);
      const cols = board.columns.map(c => c.name);
      for (const card of board.cards) {
        expect(cols).toContain(card.values.Status);
      }
    }
  });

  it('table example declares the table view, kanban does not', () => {
    expect(BLOCK_REFERENCES.table.example).toContain('active-view="table"');
    expect(BLOCK_REFERENCES.kanban.example).not.toContain('active-view="table"');
  });

  it('board rules name the allowed colour and field-type tokens', () => {
    const rules = BLOCK_REFERENCES.kanban.rules.join(' ');
    expect(rules).toMatch(/gray, blue, amber, emerald, red, purple/);
    expect(rules).toMatch(/text, status, date, person, tags/);
  });

  it('mermaid example is a fenced mermaid block', () => {
    expect(BLOCK_REFERENCES.mermaid.example).toContain('```mermaid');
  });

  it('callout example uses a GFM callout header and the five+ types are documented', () => {
    expect(BLOCK_REFERENCES.callout.example).toMatch(/> \[!NOTE\]/);
    const rules = BLOCK_REFERENCES.callout.rules.join(' ');
    expect(rules).toMatch(/NOTE/);
    expect(rules).toMatch(/CAUTION/);
  });

  it('toggle example is a <details>/<summary> block', () => {
    expect(BLOCK_REFERENCES.toggle.example).toContain('<details>');
    expect(BLOCK_REFERENCES.toggle.example).toContain('<summary>');
  });
});
