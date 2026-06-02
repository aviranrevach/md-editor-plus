import { buildPrompt, AI_TRANSFORMS, type AiPromptContext } from '../../src/webview/aiTransforms';
import { BLOCK_REFERENCES } from '../../src/webview/blockFormatReference';

const base: AiPromptContext = {
  filePath: 'notes/q2-launch.md',
  target: 'table',
  mode: 'replace',
  startLine: 20,
  endLine: 23,
  startText: 'Draft press release — Maya, Fri',
  endText: 'Set up analytics — Dev, Thu',
};

const ALL_TARGETS = ['ask', 'table', 'kanban', 'board-table', 'mermaid', 'summary', 'action-items', 'outline', 'timeline'];

describe('AI_TRANSFORMS registry', () => {
  it('registers Ask AI first, then the structural and thinking targets', () => {
    expect(AI_TRANSFORMS.map(t => t.id)).toEqual(ALL_TARGETS);
  });
  it('every entry has a label, iconHtml and id', () => {
    for (const t of AI_TRANSFORMS) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.iconHtml).toContain('<svg');
      expect(ALL_TARGETS).toContain(t.id);
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
  it('replace mode → complete replace instruction as the last line', () => {
    const p = buildPrompt(base);
    expect(p).toMatch(/Now, replace that entire section/i);
    expect(p.trimEnd().endsWith('built from its content.')).toBe(true);
  });
  it('add mode → complete add-below instruction', () => {
    expect(buildPrompt({ ...base, mode: 'add' })).toMatch(/Now, add .+ right below it, leaving the original/i);
  });
  it('custom mode → open trailing action, no fixed replace/add and no perform rule', () => {
    const p = buildPrompt({ ...base, mode: 'custom' });
    expect(p).toMatch(/Now, build .+ from that section — *$/);
    expect(p).not.toMatch(/replace that entire section/i);
    expect(p).not.toMatch(/right below it, leaving the original/i);
    expect(p).not.toMatch(/reply with only an acknowledgement/i);
  });
  it('carries the content-handling rule and forbids a bare acknowledgement', () => {
    const p = buildPrompt(base);
    expect(p).toMatch(/Never silently drop content/i);
    // Must instruct the agent to actually do the work, with a paste-back
    // fallback, and explicitly forbid replying with only "done".
    expect(p).toMatch(/Actually perform the change/i);
    expect(p).toMatch(/if you cannot edit files, output the complete/i);
    expect(p).toMatch(/Do NOT reply with only an acknowledgement/i);
  });
});

describe('buildPrompt — per-target format spec', () => {
  it('table → GFM pipe table spec', () => {
    const p = buildPrompt({ ...base, target: 'table' });
    expect(p).toContain('| Title | Status |');
    expect(p).toContain('|---|');
  });
  it('kanban → board markers, kanban view, and allowed values', () => {
    const p = buildPrompt({ ...base, target: 'kanban' });
    expect(p).toContain('<!-- board:start');
    expect(p).toContain('<!-- board:end -->');
    expect(p).toContain('<!-- board:body id=');
    expect(p).not.toContain('active-view="table"');
    expect(p).toContain('text, status, date, person, tags');
    expect(p).toContain('gray, blue, amber, emerald, red, purple');
  });
  it('board-table → same board block but the table view (not a plain markdown table)', () => {
    const p = buildPrompt({ ...base, target: 'board-table' });
    expect(p).toContain('<!-- board:start');
    expect(p).toContain('<!-- board:end -->');
    expect(p).toContain('active-view="table"');
    expect(p).toMatch(/NOT a plain markdown table/i);
  });
  it('mermaid → fenced mermaid block', () => {
    const p = buildPrompt({ ...base, target: 'mermaid' });
    expect(p).toContain('```mermaid');
    expect(p).toContain('flowchart');
  });
  it('summary → concise plain-markdown summary spec', () => {
    const p = buildPrompt({ ...base, target: 'summary' });
    expect(p).toMatch(/concise summary/i);
    expect(p).toMatch(/bullet points/i);
  });
  it('action-items → markdown task list spec', () => {
    const p = buildPrompt({ ...base, target: 'action-items' });
    expect(p).toContain('- [ ]');
    expect(p).toMatch(/action item/i);
  });
  it('outline → nested headings/bullets spec', () => {
    const p = buildPrompt({ ...base, target: 'outline' });
    expect(p).toMatch(/structured (markdown )?outline/i);
    expect(p).toContain('## Section');
  });
  it('timeline → chronological list spec', () => {
    const p = buildPrompt({ ...base, target: 'timeline' });
    expect(p).toMatch(/chronological/i);
    expect(p).toContain('**YYYY-MM-DD**');
  });
});

describe('buildPrompt — ask (custom prompt)', () => {
  it('opens a discussion referencing the file + anchors', () => {
    const p = buildPrompt({ ...base, target: 'ask' });
    expect(p).toMatch(/Let's talk about a section/i);
    expect(p).toContain('notes/q2-launch.md');
    expect(p).toContain('Draft press release — Maya, Fri');
  });
  it('includes the freestyle request when provided', () => {
    const p = buildPrompt({ ...base, target: 'ask', request: 'find the riskiest assumption here' });
    expect(p).toContain('find the riskiest assumption here');
  });
  it('ends with an open cue when no request is given', () => {
    const p = buildPrompt({ ...base, target: 'ask', request: '   ' });
    expect(p).toMatch(/What I'd like you to do with this section: *$/);
  });
  it('reflects the replace/add choice in the ask prompt', () => {
    expect(buildPrompt({ ...base, target: 'ask', mode: 'replace' })).toMatch(/replace the section with your result/i);
    expect(buildPrompt({ ...base, target: 'ask', mode: 'add' })).toMatch(/add your result right below the original/i);
  });
  it('does NOT carry the edit-the-file / no-acknowledgement rule', () => {
    const p = buildPrompt({ ...base, target: 'ask', request: 'explain this' });
    expect(p).not.toMatch(/reply with only an acknowledgement/i);
    expect(p).not.toMatch(/Replace that entire section/i);
    // but the content-handling rule still applies
    expect(p).toMatch(/Never silently drop content/i);
  });
});

describe('prompt grammar stays in sync with blockFormatReference', () => {
  it('kanban prompt embeds the reference board example', () => {
    const p = buildPrompt({ ...base, target: 'kanban' });
    expect(p).toContain('| Write the spec | Doing | @maya | 2026-06-10 | c1 |');
  });
  it('mermaid prompt embeds the reference mermaid example', () => {
    const p = buildPrompt({ ...base, target: 'mermaid' });
    expect(p).toContain(BLOCK_REFERENCES.mermaid.example);
  });
});
