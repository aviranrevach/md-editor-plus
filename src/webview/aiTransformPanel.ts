import {
  buildPrompt,
  type AiTarget,
  type AiInsertMode,
  type AiPromptContext,
} from './aiTransforms';
import { formatSummary, type SelectionSummary, type AiPanelInput } from './aiSelection';
import { copyToClipboard } from './docContext';

export type { AiPanelInput } from './aiSelection';

export interface AiTransformPanel {
  open(input: AiPanelInput): void;
}

type Step = [num: string, title: string, sub: string];

const STEPS_TRANSFORM: Step[] = [
  ['1', 'Copy', 'the prompt below'],
  ['2', 'Paste into your AI', 'Claude Code, Cursor, VS Code AI'],
  ['3', 'It renders', 'the AI edits the file'],
];
const STEPS_ASK: Step[] = [
  ['1', 'Copy', 'the prompt below'],
  ['2', 'Paste into your AI', 'starts the conversation'],
  ['3', 'Ask away', 'follow up, or tell it to edit'],
];

function stepsHtml(steps: Step[]): string {
  return steps
    .map(
      ([n, t, s]) =>
        `<div class="ai-step-box"><div class="ai-step-num">${n}</div>` +
        `<div class="ai-step-title">${t}</div><div class="ai-step-sub">${s}</div></div>`,
    )
    .join('');
}

export function createAiTransformPanel(): AiTransformPanel {
  const el = document.createElement('div');
  el.className = 'ai-panel';
  el.style.display = 'none';
  el.innerHTML = `
    <div class="ai-panel-head">
      <span class="ai-panel-title"></span>
      <button class="ai-panel-close" data-ai-act="close" aria-label="Close">✕</button>
    </div>
    <div class="ai-panel-summary"></div>
    <div class="ai-panel-mode">
      <button class="ai-mode-btn" data-ai-mode="add" data-tip="Keeps your selection and puts the AI's result right after it.">＋ Add below</button>
      <button class="ai-mode-btn" data-ai-mode="replace" data-tip="The AI's result replaces the section you selected.">↻ Replace</button>
      <button class="ai-mode-btn" data-ai-mode="custom" data-tip="Leaves placement open — you tell the AI what to do with the result in the chat.">⌥ Custom</button>
    </div>
    <div class="ai-panel-steps"></div>
    <details class="ai-panel-prompt-wrap">
      <summary>Preview prompt</summary>
      <textarea class="ai-panel-prompt" spellcheck="false" readonly></textarea>
    </details>
    <div class="ai-panel-foot">
      <button class="ai-panel-btn ai-panel-btn-primary" data-ai-act="copy">📋 Copy prompt</button>
    </div>
  `;
  document.body.appendChild(el);

  const titleEl   = el.querySelector<HTMLElement>('.ai-panel-title')!;
  const summaryEl = el.querySelector<HTMLElement>('.ai-panel-summary')!;
  const modeRow   = el.querySelector<HTMLElement>('.ai-panel-mode')!;
  const stepsEl   = el.querySelector<HTMLElement>('.ai-panel-steps')!;
  const promptEl  = el.querySelector<HTMLTextAreaElement>('.ai-panel-prompt')!;
  const copyBtn   = el.querySelector<HTMLElement>('[data-ai-act="copy"]')!;
  const modeBtns  = Array.from(el.querySelectorAll<HTMLElement>('[data-ai-mode]'));

  let current: AiPanelInput | null = null;
  let mode: AiInsertMode = 'add';

  function isAsk(): boolean {
    return current?.target === 'ask';
  }

  function ctx(): AiPromptContext {
    return {
      filePath: current!.filePath,
      target:   current!.target,
      mode,
      startLine: current!.startLine,
      endLine:   current!.endLine,
      startText: current!.startText,
      endText:   current!.endText,
    };
  }

  function render(): void {
    if (!current) return;
    const ask = isAsk();
    titleEl.textContent = ask
      ? '✨ Ask AI about this section'
      : `✨ Turn selection into ${current.targetLabel} — using AI`;
    summaryEl.textContent = formatSummary(current.summary);
    stepsEl.innerHTML = stepsHtml(ask ? STEPS_ASK : STEPS_TRANSFORM);
    promptEl.value = buildPrompt(ctx());
    modeBtns.forEach(b =>
      b.classList.toggle('active', b.dataset.aiMode === mode),
    );
  }

  function close(): void {
    el.style.display = 'none';
    current = null;
  }

  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const modeBtn = target.closest<HTMLElement>('[data-ai-mode]');
    if (modeBtn) {
      mode = modeBtn.dataset.aiMode as AiInsertMode;
      render();
      return;
    }
    const actBtn = target.closest<HTMLElement>('[data-ai-act]');
    if (!actBtn) return;
    switch (actBtn.dataset.aiAct) {
      case 'close': close(); break;
      case 'copy': {
        copyToClipboard(promptEl.value);
        const prev = copyBtn.textContent;
        copyBtn.textContent = '✓ Copied';
        setTimeout(() => { copyBtn.textContent = prev; }, 1500);
        break;
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.style.display !== 'none') close();
  });

  return {
    open(input: AiPanelInput): void {
      current = input;
      mode = 'add';
      render();
      el.style.display = 'block';
    },
  };
}
