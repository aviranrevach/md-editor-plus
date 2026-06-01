import {
  buildPrompt,
  type AiTarget,
  type AiInsertMode,
  type AiPromptContext,
} from './aiTransforms';
import { formatSummary, type SelectionSummary } from './aiSelection';
import { copyToClipboard } from './docContext';

export interface AiPanelInput {
  target: AiTarget;
  targetLabel: string;
  filePath: string;
  startText: string;
  endText: string;
  startLine: number | null;
  endLine: number | null;
  summary: SelectionSummary;
}

export interface AiTransformPanel {
  open(input: AiPanelInput): void;
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
      <button class="ai-mode-btn" data-ai-mode="replace">↻ Replace selection</button>
      <button class="ai-mode-btn" data-ai-mode="add">＋ Add below (keep original)</button>
    </div>
    <div class="ai-panel-ask" style="display:none">
      <label class="ai-panel-ask-label">What do you want to ask about this section? <span class="ai-panel-ask-hint">(optional — you can also continue in your AI after pasting)</span></label>
      <textarea class="ai-panel-ask-input" spellcheck="true" placeholder="e.g. explain this, find the risks, rewrite for clarity, suggest next steps…"></textarea>
    </div>
    <details class="ai-panel-prompt-wrap">
      <summary>Preview prompt</summary>
      <textarea class="ai-panel-prompt" spellcheck="false" readonly></textarea>
    </details>
    <ol class="ai-panel-steps"></ol>
    <div class="ai-panel-foot">
      <button class="ai-panel-btn ai-panel-btn-primary" data-ai-act="copy">📋 Copy prompt</button>
    </div>
  `;
  document.body.appendChild(el);

  const titleEl   = el.querySelector<HTMLElement>('.ai-panel-title')!;
  const summaryEl = el.querySelector<HTMLElement>('.ai-panel-summary')!;
  const modeRow   = el.querySelector<HTMLElement>('.ai-panel-mode')!;
  const askWrap   = el.querySelector<HTMLElement>('.ai-panel-ask')!;
  const askInput  = el.querySelector<HTMLTextAreaElement>('.ai-panel-ask-input')!;
  const stepsEl   = el.querySelector<HTMLElement>('.ai-panel-steps')!;
  const promptEl  = el.querySelector<HTMLTextAreaElement>('.ai-panel-prompt')!;
  const copyBtn   = el.querySelector<HTMLElement>('[data-ai-act="copy"]')!;
  const modeBtns  = Array.from(el.querySelectorAll<HTMLElement>('[data-ai-mode]'));

  const STEPS_TRANSFORM =
    '<li><b>Copy</b> the prompt.</li>' +
    '<li><b>Paste it into your file-aware AI</b> (Claude Code, Cursor, the VS Code AI).</li>' +
    '<li>It <b>edits the file</b> — your viewer re-renders with the result.</li>';
  const STEPS_ASK =
    '<li><b>Copy</b> the prompt.</li>' +
    '<li><b>Paste it into your AI</b> to start the conversation about this section.</li>' +
    '<li><b>Ask follow-ups there</b> — or tell it to edit the file if you want changes.</li>';

  let current: AiPanelInput | null = null;
  let mode: AiInsertMode = 'replace';

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
      request:   askInput.value,
    };
  }

  function render(): void {
    if (!current) return;
    const ask = isAsk();
    titleEl.textContent = ask
      ? '✨ Ask AI about this section'
      : `✨ Turn selection into ${current.targetLabel} — using AI`;
    summaryEl.textContent = formatSummary(current.summary);
    modeRow.style.display = ask ? 'none' : '';
    askWrap.style.display = ask ? '' : 'none';
    stepsEl.innerHTML = ask ? STEPS_ASK : STEPS_TRANSFORM;
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

  // Live-rebuild the prompt as the user types their custom request.
  askInput.addEventListener('input', () => { if (isAsk()) promptEl.value = buildPrompt(ctx()); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.style.display !== 'none') close();
  });

  return {
    open(input: AiPanelInput): void {
      current = input;
      mode = 'replace';
      askInput.value = '';
      render();
      el.style.display = 'block';
      if (input.target === 'ask') setTimeout(() => askInput.focus(), 0);
    },
  };
}
