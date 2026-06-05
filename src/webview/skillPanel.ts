import { BLOCK_IDS, BLOCK_REFERENCES, type BlockId } from './blockFormatReference';
import { buildSkill } from './skillBuilder';
import { getWorkspaceName } from './docContext';

interface Bridge { postMessage: (m: unknown) => void; }

function bridge(): Bridge | undefined {
  return (window as unknown as { __mdViewerVscode?: Bridge }).__mdViewerVscode;
}

type Dest = 'project' | 'global' | 'download';

export interface SkillPanel { open(): void; }

export function createSkillPanel(): SkillPanel {
  const el = document.createElement('div');
  el.className = 'ai-panel skill-panel';
  el.style.display = 'none';
  const checks = BLOCK_IDS
    .map(
      (id) =>
        `<label class="skill-block"><input type="checkbox" data-block="${id}" checked> ${BLOCK_REFERENCES[id].title}</label>`,
    )
    .join('');
  el.innerHTML = `
    <div class="ai-panel-head">
      <span class="ai-panel-title">✨ Create blocks skill</span>
      <button class="ai-panel-close" data-skill-act="close" aria-label="Close">✕</button>
    </div>
    <div class="ai-panel-summary">A reusable Claude skill: install it once and your AI knows the exact format MD Editor Plus needs for its boards, tables, and diagrams — so they render instead of landing as raw text.</div>
    <div class="skill-blocks">${checks}</div>
    <div class="skill-dest">
      <button class="skill-dest-seg" data-dest="project">In project</button>
      <button class="skill-dest-seg" data-dest="global">Global</button>
      <button class="skill-dest-seg" data-dest="download">Download</button>
    </div>
    <div class="skill-dest-info"></div>
    <div class="ai-panel-foot">
      <button class="ai-panel-btn ai-panel-btn-primary" data-skill-act="create">Create skill</button>
    </div>
  `;
  document.body.appendChild(el);

  const segs = Array.from(el.querySelectorAll<HTMLButtonElement>('.skill-dest-seg'));
  const projectSeg = el.querySelector<HTMLButtonElement>('[data-dest="project"]')!;
  const info = el.querySelector<HTMLElement>('.skill-dest-info')!;

  let dest: Dest = 'project';

  function destInfo(d: Dest, ws: string | null): string {
    if (d === 'project') {
      if (ws === null) {
        return `<span class="skill-path-muted">No folder is open — open a folder, or use Global / Download.</span>`;
      }
      return `<code>${ws}/.claude/skills/md-editor-blocks/SKILL.md</code><br>` +
        `<span class="skill-path-muted">Claude Code auto-loads it whenever you work in this project.</span>`;
    }
    if (d === 'global') {
      return `<code>~/.claude/skills/md-editor-blocks/SKILL.md</code><br>` +
        `<span class="skill-path-muted">Available in every project on this machine.</span>`;
    }
    return `<span class="skill-path-muted">Save a SKILL.md and drop it in a <code>md-editor-blocks/</code> folder in your skills dir.</span>`;
  }

  function render(): void {
    const ws = getWorkspaceName();
    const noWs = ws === null;
    projectSeg.disabled = noWs;
    projectSeg.classList.toggle('disabled', noWs);
    if (noWs && dest === 'project') dest = 'global';
    segs.forEach((s) => s.classList.toggle('active', s.dataset.dest === dest));
    info.innerHTML = destInfo(dest, ws);
  }

  function selected(): BlockId[] {
    return Array.from(el.querySelectorAll<HTMLInputElement>('input[data-block]:checked'))
      .map((c) => c.dataset.block as BlockId);
  }
  function close(): void { el.style.display = 'none'; }

  el.addEventListener('click', (e) => {
    const seg = (e.target as HTMLElement).closest<HTMLButtonElement>('.skill-dest-seg');
    if (seg) {
      if (!seg.disabled) { dest = seg.dataset.dest as Dest; render(); }
      return;
    }
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-skill-act]');
    if (!btn) return;
    if (btn.dataset.skillAct === 'close') { close(); return; }
    if (btn.dataset.skillAct === 'create') {
      const blocks = selected();
      if (blocks.length === 0) return;
      const { skillMd } = buildSkill(blocks);
      const vs = bridge();
      if (dest === 'download') vs?.postMessage({ type: 'downloadSkill', skillMd });
      else vs?.postMessage({ type: 'installSkill', scope: dest, skillMd });
      close();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.style.display !== 'none') close();
  });

  return {
    open(): void {
      dest = getWorkspaceName() === null ? 'global' : 'project';
      render();
      el.style.display = 'block';
    },
  };
}
