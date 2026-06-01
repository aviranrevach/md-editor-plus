import { buildPrompt, AI_TRANSFORMS, type AiPromptContext } from '../../src/webview/aiTransforms';

const base: AiPromptContext = {
  filePath: 'notes/q2-launch.md',
  target: 'table',
  mode: 'replace',
  startLine: 20,
  endLine: 23,
  startText: 'Draft press release — Maya, Fri',
  endText: 'Set up analytics — Dev, Thu',
};

describe('AI_TRANSFORMS registry', () => {
  it('registers exactly the three phase-1 targets', () => {
    expect(AI_TRANSFORMS.map(t => t.id)).toEqual(['table', 'kanban', 'mermaid']);
  });
  it('every entry has a label, iconHtml and id', () => {
    for (const t of AI_TRANSFORMS) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.iconHtml).toContain('<svg');
      expect(['table', 'kanban', 'mermaid']).toContain(t.id);
    }
  });
});

describe('buildPrompt — shared parts', () => {
  it('names the file', () => {
    expect(buildPrompt(base)).toContain('notes/q2-launch.md');
  });
  it('includes both anchors with line hints and text', () => {
    const p = buildPrompt(base);
    expect(p).toContain('line 20');
    expect(p).toContain('Draft press release — Maya, Fri');
    expect(p).toContain('line 23');
    expect(p).toContain('Set up analytics — Dev, Thu');
  });
  it('omits the line number when it is null but keeps the text anchor', () => {
    const p = buildPrompt({ ...base, startLine: null });
    expect(p).toContain('Draft press release — Maya, Fri');
    expect(p).not.toMatch(/about line null/);
  });
  it('uses replace wording for replace mode', () => {
    expect(buildPrompt(base)).toMatch(/Replace that entire section/i);
  });
  it('uses add wording for add mode', () => {
    expect(buildPrompt({ ...base, mode: 'add' })).toMatch(/immediately after it, leaving the original/i);
  });
  it('always carries the content-handling rule and the no-chatter rule', () => {
    const p = buildPrompt(base);
    expect(p).toMatch(/Never silently drop content/i);
    expect(p).toMatch(/reply with nothing else/i);
  });
});

describe('buildPrompt — per-target format spec', () => {
  it('table → GFM pipe table spec', () => {
    const p = buildPrompt({ ...base, target: 'table' });
    expect(p).toContain('| Title | Status |');
    expect(p).toContain('|---|');
  });
  it('kanban → board markers and allowed values', () => {
    const p = buildPrompt({ ...base, target: 'kanban' });
    expect(p).toContain('<!-- board:start');
    expect(p).toContain('<!-- board:end -->');
    expect(p).toContain('<!-- board:body id=');
    expect(p).toContain('text, status, date, person, tags');
    expect(p).toContain('gray, blue, amber, emerald, red, purple');
  });
  it('mermaid → fenced mermaid block', () => {
    const p = buildPrompt({ ...base, target: 'mermaid' });
    expect(p).toContain('```mermaid');
    expect(p).toContain('flowchart');
  });
});
