import { BLOCK_IDS, BLOCK_REFERENCES, type BlockId } from './blockFormatReference';
import { buildSkill } from './skillBuilder';
import { getWorkspaceName } from './docContext';

interface Bridge { postMessage: (m: unknown) => void; }

function bridge(): Bridge | undefined {
  return (window as unknown as { __mdViewerVscode?: Bridge }).__mdViewerVscode;
}

type Dest = 'project' | 'global' | 'download';

export interface SkillPanel { open(): void; }

const EYE = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="currentColor" viewBox="0 0 256 256"><path d="M251,123.13c-.37-.81-9.13-20.26-28.48-39.61C196.63,57.67,164,44,128,44S59.37,57.67,33.51,83.52C14.16,102.87,5.4,122.32,5,123.13a12.08,12.08,0,0,0,0,9.75c.37.82,9.13,20.26,28.49,39.61C59.37,198.34,92,212,128,212s68.63-13.66,94.48-39.51c19.36-19.35,28.12-38.79,28.49-39.61A12.08,12.08,0,0,0,251,123.13ZM128,84a44,44,0,1,0,44,44A44.05,44.05,0,0,0,128,84Zm0,64a20,20,0,1,1,20-20A20,20,0,0,1,128,148Z"/></svg>`;
const EYE_SLASH = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="currentColor" viewBox="0 0 256 256"><path d="M56.88,31.93A12,12,0,1,0,39.12,48.07l16,17.65C20.67,88.66,5.72,121.58,5,123.13a12.08,12.08,0,0,0,0,9.75c.37.82,9.13,20.26,28.49,39.61C59.37,198.34,92,212,128,212a131.34,131.34,0,0,0,51-10l20.09,22.1a12,12,0,0,0,17.76-16.14ZM251,132.88c-.36.81-9,20-28,39.16a12,12,0,1,1-17-16.9A130.48,130.48,0,0,0,226.48,128a130.36,130.36,0,0,0-21.57-28.12C183.46,78.73,157.59,68,128,68c-3.35,0-6.7.14-10,.42a12,12,0,1,1-2-23.91c3.93-.34,8-.51,12-.51,36,0,68.63,13.67,94.49,39.52,19.35,19.35,28.11,38.8,28.48,39.61A12.08,12.08,0,0,1,251,132.88Z"/></svg>`;

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
    <div class="skill-preview" hidden>
      <div class="skill-preview-head">SKILL.md preview · live</div>
      <pre class="skill-preview-body"></pre>
    </div>
    <div class="skill-dest">
      <button class="skill-dest-seg" data-dest="project">In project</button>
      <button class="skill-dest-seg" data-dest="global">Global</button>
      <button class="skill-dest-seg" data-dest="download">Download</button>
    </div>
    <div class="skill-dest-info"></div>
    <div class="ai-panel-foot">
      <button class="ai-panel-btn ai-panel-btn-secondary" data-skill-act="preview">${EYE}<span class="skill-preview-label">Preview</span></button>
      <button class="ai-panel-btn ai-panel-btn-primary" data-skill-act="create">Create skill</button>
    </div>
  `;
  document.body.appendChild(el);

  const segs = Array.from(el.querySelectorAll<HTMLButtonElement>('.skill-dest-seg'));
  const projectSeg = el.querySelector<HTMLButtonElement>('[data-dest="project"]')!;
  const info = el.querySelector<HTMLElement>('.skill-dest-info')!;
  const previewBox = el.querySelector<HTMLElement>('.skill-preview')!;
  const previewBody = el.querySelector<HTMLElement>('.skill-preview-body')!;
  const previewBtn = el.querySelector<HTMLButtonElement>('[data-skill-act="preview"]')!;
  const previewLabel = el.querySelector<HTMLElement>('.skill-preview-label')!;

  let dest: Dest = 'project';
  let previewOpen = false;

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

  // Fill the preview with the exact SKILL.md that "Create skill" would write for
  // the current block selection. textContent (not innerHTML) keeps it literal.
  function renderPreview(): void {
    if (!previewOpen) return;
    previewBody.textContent = buildSkill(selected()).skillMd;
  }

  function setPreviewOpen(open: boolean): void {
    previewOpen = open;
    previewBox.hidden = !open;
    previewBtn.classList.toggle('active', open);
    previewLabel.textContent = open ? 'Hide preview' : 'Preview';
    previewBtn.querySelector('svg')?.remove();
    previewBtn.insertAdjacentHTML('afterbegin', open ? EYE_SLASH : EYE);
    renderPreview();
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
    if (btn.dataset.skillAct === 'preview') { setPreviewOpen(!previewOpen); return; }
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

  // Keep the live preview in sync as blocks are ticked/unticked.
  el.addEventListener('change', (e) => {
    if ((e.target as HTMLElement).matches('input[data-block]')) renderPreview();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.style.display !== 'none') close();
  });

  return {
    open(): void {
      dest = getWorkspaceName() === null ? 'global' : 'project';
      setPreviewOpen(false); // always start collapsed on a fresh open
      render();
      el.style.display = 'block';
    },
  };
}
