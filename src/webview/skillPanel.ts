import { BLOCK_IDS, BLOCK_REFERENCES, type BlockId } from './blockFormatReference';
import { buildSkill } from './skillBuilder';

interface Bridge { postMessage: (m: unknown) => void; }

function bridge(): Bridge | undefined {
  return (window as unknown as { __mdViewerVscode?: Bridge }).__mdViewerVscode;
}

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
    <div class="ai-panel-summary">A Claude skill that teaches your AI MD Editor Plus's exact block grammar.</div>
    <div class="skill-blocks">${checks}</div>
    <div class="ai-panel-foot skill-foot">
      <button class="ai-panel-btn" data-skill-act="download">Download…</button>
      <button class="ai-panel-btn" data-skill-act="install-global">Install globally</button>
      <button class="ai-panel-btn ai-panel-btn-primary" data-skill-act="install-project">Install in project</button>
    </div>
  `;
  document.body.appendChild(el);

  function selected(): BlockId[] {
    return Array.from(el.querySelectorAll<HTMLInputElement>('input[data-block]:checked'))
      .map((c) => c.dataset.block as BlockId);
  }
  function close(): void { el.style.display = 'none'; }

  el.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-skill-act]');
    if (!btn) return;
    const act = btn.dataset.skillAct;
    if (act === 'close') { close(); return; }
    const blocks = selected();
    if (blocks.length === 0) return;
    const { skillMd } = buildSkill(blocks);
    const vs = bridge();
    if (act === 'download') vs?.postMessage({ type: 'downloadSkill', skillMd });
    else if (act === 'install-global') vs?.postMessage({ type: 'installSkill', scope: 'global', skillMd });
    else if (act === 'install-project') vs?.postMessage({ type: 'installSkill', scope: 'project', skillMd });
    close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.style.display !== 'none') close();
  });

  return { open(): void { el.style.display = 'block'; } };
}
