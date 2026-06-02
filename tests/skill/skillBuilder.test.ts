import { buildSkill } from '../../src/webview/skillBuilder';

describe('buildSkill', () => {
  it('returns the fixed folder name', () => {
    expect(buildSkill(['kanban']).folderName).toBe('md-editor-blocks');
  });

  it('has frontmatter with name and an auto-trigger description', () => {
    const { skillMd } = buildSkill(['kanban', 'table', 'mermaid', 'callout', 'toggle']);
    expect(skillMd.startsWith('---\n')).toBe(true);
    expect(skillMd).toMatch(/^name: md-editor-blocks$/m);
    expect(skillMd).toMatch(/^description: .+/m);
  });

  it('includes a section only for each selected block', () => {
    const { skillMd } = buildSkill(['kanban', 'mermaid']);
    expect(skillMd).toContain('## Kanban board');
    expect(skillMd).toContain('## Mermaid diagram');
    expect(skillMd).not.toContain('## Table board');
    expect(skillMd).not.toContain('## Callout');
    expect(skillMd).not.toContain('## Toggle');
  });

  it('embeds each block example inside a fenced code block', () => {
    const { skillMd } = buildSkill(['kanban']);
    expect(skillMd).toContain('<!-- board:start');
    expect(skillMd).toMatch(/```markdown[\s\S]*<!-- board:end -->[\s\S]*```/);
  });

  it('preserves the order of BLOCK_IDS regardless of input order', () => {
    const { skillMd } = buildSkill(['toggle', 'kanban']);
    expect(skillMd.indexOf('## Kanban board')).toBeLessThan(skillMd.indexOf('## Toggle'));
  });

  it('ignores duplicates and is stable', () => {
    expect(buildSkill(['kanban', 'kanban']).skillMd).toBe(buildSkill(['kanban']).skillMd);
  });
});
