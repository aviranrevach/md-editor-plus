/** @jest-environment jsdom */
import { buildHtmlExport } from '../src/webview/exportHtml';

const CTX = {
  filename: 'demo.md',
  themeClasses: [] as string[],
  editorClasses: [] as string[],
  pageWidthPx: 800,
  fullWidth: false,
};

function exportOf(inner: string): string {
  const ed = document.createElement('div');
  ed.id = 'editor';
  ed.innerHTML = inner;
  document.body.appendChild(ed);
  return buildHtmlExport(ed, CTX);
}

describe('buildHtmlExport — board chrome stripping (c15)', () => {
  const boardHtml = `
    <div class="board-block">
      <div class="board-chrome">
        <span class="board-name">My Board</span>
        <div class="bd-view-seg"><button class="bd-view-seg-btn">Table</button></div>
        <div class="bd-more"><button class="bd-more-btn">MOREDOTS</button></div>
      </div>
      <div class="board-body">
        <span class="board-column-chip color-blue">Todo</span>
        <div class="bd-cell">Real card text</div>
        <button class="board-add-card">ADDCARD</button>
        <div class="board-add-card board-add-column-spacer" aria-hidden="true">MIRRORCARD</div>
        <div class="bd-row-grip">GRIP</div>
      </div>
    </div>`;

  it('keeps real content: card text, status pill, board name', () => {
    const out = exportOf(boardHtml);
    expect(out).toContain('Real card text');
    expect(out).toContain('Todo');
    expect(out).toContain('My Board');
  });

  it('removes every button and its label', () => {
    const out = exportOf(boardHtml);
    expect(out).not.toContain('<button');
    expect(out).not.toContain('ADDCARD');
    expect(out).not.toContain('MOREDOTS');
  });

  it('removes aria-hidden layout mirrors (the duplicate-text source)', () => {
    const out = exportOf(boardHtml);
    expect(out).not.toContain('MIRRORCARD');
  });

  it('removes drag handles and the view switcher', () => {
    const out = exportOf(boardHtml);
    expect(out).not.toContain('GRIP');
    expect(out).not.toContain('bd-view-seg');
  });

  it('leaves non-board buttons elsewhere untouched only inside boards', () => {
    // A button outside any .board-block is not the board cleaner's concern.
    const out = exportOf('<p>text</p><div class="board-block"><button>X</button></div>');
    expect(out).not.toContain('>X<');
  });
});
