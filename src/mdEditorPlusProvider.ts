import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

const CHROME_PATHS: Record<NodeJS.Platform, string[]> = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Arc.app/Contents/MacOS/Arc',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/usr/bin/brave-browser',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  ],
  aix: [], freebsd: [], openbsd: [], sunos: [], android: [], haiku: [], cygwin: [], netbsd: [],
};

function findChromiumBinary(): string | null {
  const candidates = CHROME_PATHS[os.platform()] ?? [];
  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch { /* try next */ }
  }
  return null;
}

function renderHtmlToPdf(chromePath: string, htmlPath: string, pdfPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(chromePath, [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--no-pdf-header-footer',
      '--virtual-time-budget=2000',
      `--print-to-pdf=${pdfPath}`,
      `file://${htmlPath}`,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Chrome exited with code ${code}: ${stderr.slice(0, 400)}`));
    });
  });
}

export class MdEditorPlusProvider implements vscode.CustomTextEditorProvider {
  private static readonly viewType = 'md-editor-plus.editor';
  private _isApplyingEdit = false;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new MdEditorPlusProvider(context.extensionUri);
    return vscode.window.registerCustomEditorProvider(
      MdEditorPlusProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    );
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const docDir = vscode.Uri.joinPath(document.uri, '..');
    const wsFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const localResourceRoots: vscode.Uri[] = [
      vscode.Uri.joinPath(this._extensionUri, 'dist'),
      docDir,
    ];
    if (wsFolder) localResourceRoots.push(wsFolder.uri);

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots,
    };

    webviewPanel.webview.html = this._getHtml(webviewPanel.webview, document);

    const mediaBaseUri = webviewPanel.webview.asWebviewUri(docDir).toString().replace(/\/?$/, '/');

    const sendInit = () => {
      const cfg = vscode.workspace.getConfiguration('mdEditorPlus');
      webviewPanel.webview.postMessage({
        type: 'init',
        markdown: document.getText(),
        mediaBaseUri,
        documentPath: vscode.workspace.asRelativePath(document.uri),
        defaults: {
          theme:               cfg.get<string>('theme', 'light'),
          font:                cfg.get<string>('font', 'sans'),
          textSize:            cfg.get<string>('textSize', 'm'),
          pageWidth:           cfg.get<number>('pageWidth', 800),
          fullWidth:           cfg.get<boolean>('fullWidth', false),
          alwaysDarkCode:      cfg.get<boolean>('alwaysDarkCode', false),
          alwaysDarkDiagram:   cfg.get<boolean>('alwaysDarkDiagram', false),
          alwaysDarkSource:    cfg.get<boolean>('alwaysDarkSource', false),
          sourceFullWidth:     cfg.get<boolean>('sourceFullWidth', false),
          shortenCodeSnippets: cfg.get<boolean>('shortenCodeSnippets', false),
          outlineVisible:      cfg.get<boolean>('outlineVisible', false),
          readOnly:            cfg.get<boolean>('readOnly', false),
          sourceWordWrap:      cfg.get<boolean>('sourceWordWrap', false),
        },
      });
    };

    const onDocChange = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      if (this._isApplyingEdit) return;
      webviewPanel.webview.postMessage({
        type: 'update',
        markdown: document.getText(),
      });
    });

    webviewPanel.webview.onDidReceiveMessage(async (msg: {
      type: string;
      markdown?: string;
      defaults?: {
        theme?: string;
        font?: string;
        textSize?: string;
        pageWidth?: number;
        fullWidth?: boolean;
        alwaysDarkCode?: boolean;
        alwaysDarkDiagram?: boolean;
        alwaysDarkSource?: boolean;
        sourceFullWidth?: boolean;
        shortenCodeSnippets?: boolean;
      };
    }) => {
      if (msg.type === 'edit' && msg.markdown !== undefined) {
        await this._applyEdit(document, msg.markdown);
      }
      if (msg.type === 'saveDefaults' && msg.defaults) {
        const cfg = vscode.workspace.getConfiguration('mdEditorPlus');
        const target = vscode.ConfigurationTarget.Global;
        const d = msg.defaults;
        await Promise.all([
          cfg.update('theme',               d.theme,               target),
          cfg.update('font',                d.font,                target),
          cfg.update('textSize',            d.textSize,            target),
          cfg.update('pageWidth',           d.pageWidth,           target),
          cfg.update('fullWidth',           d.fullWidth,           target),
          cfg.update('alwaysDarkCode',      d.alwaysDarkCode,      target),
          cfg.update('alwaysDarkDiagram',   d.alwaysDarkDiagram,   target),
          cfg.update('alwaysDarkSource',    d.alwaysDarkSource,    target),
          cfg.update('sourceFullWidth',     d.sourceFullWidth,     target),
          cfg.update('shortenCodeSnippets', d.shortenCodeSnippets, target),
        ]);
        await vscode.window.showInformationMessage('MD Editor Plus: current view saved as default');
      }
      if (msg.type === 'resetDefaults') {
        const cfg = vscode.workspace.getConfiguration('mdEditorPlus');
        const keys = ['theme','font','textSize','pageWidth','fullWidth','alwaysDarkCode','alwaysDarkDiagram','alwaysDarkSource','sourceFullWidth','shortenCodeSnippets'];
        for (const k of keys) {
          // Clear at all scopes so the package.json defaults take over.
          await cfg.update(k, undefined, vscode.ConfigurationTarget.Global).then(() => {}, () => {});
          await cfg.update(k, undefined, vscode.ConfigurationTarget.Workspace).then(() => {}, () => {});
          await cfg.update(k, undefined, vscode.ConfigurationTarget.WorkspaceFolder).then(() => {}, () => {});
        }
        await vscode.window.showInformationMessage('MD Editor Plus: defaults reset');
      }
      if (msg.type === 'openInFinder') {
        await vscode.commands.executeCommand('revealFileInOS', document.uri);
      }
      if (msg.type === 'openExternal') {
        const url = (msg as unknown as { url?: unknown }).url;
        if (typeof url === 'string') {
          try { await vscode.env.openExternal(vscode.Uri.parse(url)); } catch { /* ignore */ }
        }
      }
      if (msg.type === 'copyContent') {
        await vscode.env.clipboard.writeText(document.getText());
        await vscode.window.showInformationMessage('Page content copied to clipboard');
      }
      if (msg.type === 'copyFilePath') {
        await vscode.env.clipboard.writeText(document.uri.fsPath);
        await vscode.window.showInformationMessage('File path copied to clipboard');
      }
      if (msg.type === 'copyText') {
        const text = (msg as unknown as { text?: unknown }).text;
        if (typeof text !== 'string') return;
        await vscode.env.clipboard.writeText(text);
        await vscode.window.showInformationMessage('AI prompt copied to clipboard');
        return;
      }
      if (msg.type === 'installSkill') {
        const m = msg as unknown as { scope?: unknown; skillMd?: unknown };
        const skillMd = m.skillMd;
        if (typeof skillMd !== 'string') return;
        const scope = m.scope === 'global' ? 'global' : 'project';
        let baseDir: vscode.Uri;
        if (scope === 'global') {
          baseDir = vscode.Uri.file(path.join(os.homedir(), '.claude', 'skills'));
        } else {
          const ws = vscode.workspace.getWorkspaceFolder(document.uri);
          if (!ws) {
            await vscode.window.showErrorMessage('MD Editor Plus: no workspace folder for a project skill. Use Global or Download.');
            return;
          }
          baseDir = vscode.Uri.joinPath(ws.uri, '.claude', 'skills');
        }
        const skillDir = vscode.Uri.joinPath(baseDir, 'md-editor-blocks');
        const target = vscode.Uri.joinPath(skillDir, 'SKILL.md');
        try {
          await vscode.workspace.fs.stat(target);
          const overwrite = 'Overwrite';
          const choice = await vscode.window.showWarningMessage(
            `A blocks skill already exists at ${target.fsPath}. Replace it?`,
            { modal: true },
            overwrite,
          );
          if (choice !== overwrite) return;
        } catch { /* doesn't exist — proceed */ }
        try {
          await vscode.workspace.fs.createDirectory(skillDir);
          await vscode.workspace.fs.writeFile(target, Buffer.from(skillMd, 'utf8'));
        } catch (err) {
          await vscode.window.showErrorMessage(`MD Editor Plus: skill install failed — ${(err as Error).message}`);
          return;
        }
        const reveal = 'Reveal';
        const choice = await vscode.window.showInformationMessage(
          `Blocks skill installed → ${target.fsPath}`,
          reveal,
        );
        if (choice === reveal) {
          await vscode.commands.executeCommand('revealFileInOS', target);
        }
        return;
      }
      if (msg.type === 'downloadSkill') {
        const skillMd = (msg as unknown as { skillMd?: unknown }).skillMd;
        if (typeof skillMd !== 'string') return;
        const dir = vscode.Uri.joinPath(document.uri, '..');
        const defaultUri = vscode.Uri.joinPath(dir, 'SKILL.md');
        const target = await vscode.window.showSaveDialog({
          defaultUri,
          filters: { Markdown: ['md'] },
          saveLabel: 'Save skill',
          title: 'Download blocks skill (place it in a md-editor-blocks/ folder in your skills dir)',
        });
        if (!target) return;
        try {
          await vscode.workspace.fs.writeFile(target, Buffer.from(skillMd, 'utf8'));
        } catch (err) {
          await vscode.window.showErrorMessage(`MD Editor Plus: save failed — ${(err as Error).message}`);
          return;
        }
        await vscode.window.showInformationMessage(`Saved ${path.basename(target.fsPath)}`);
        return;
      }
      if (msg.type === 'saveOutlineVisible') {
        const value = (msg as unknown as { value?: unknown }).value;
        if (typeof value !== 'boolean') return;
        const cfg = vscode.workspace.getConfiguration('mdEditorPlus');
        await cfg.update('outlineVisible', value, vscode.ConfigurationTarget.Global);
        return;
      }
      if (msg.type === 'saveReadOnly') {
        const value = (msg as unknown as { value?: unknown }).value;
        if (typeof value !== 'boolean') return;
        const cfg = vscode.workspace.getConfiguration('mdEditorPlus');
        await cfg.update('readOnly', value, vscode.ConfigurationTarget.Global);
        return;
      }
      if (msg.type === 'saveSourceWordWrap') {
        const value = (msg as unknown as { value?: unknown }).value;
        if (typeof value !== 'boolean') return;
        const cfg = vscode.workspace.getConfiguration('mdEditorPlus');
        await cfg.update('sourceWordWrap', value, vscode.ConfigurationTarget.Global);
        return;
      }
      if (msg.type === 'refresh') {
        // Re-send the current TextDocument content to the webview. The file
        // watcher already keeps the TextDocument in sync with disk for clean
        // docs; this forces a resync if the webview suspects it has drifted.
        webviewPanel.webview.postMessage({
          type: 'update',
          markdown: document.getText(),
          source: 'refresh',
        });
        return;
      }
      if (msg.type === 'exportPdf') {
        const html = (msg as unknown as { html?: unknown }).html;
        const fname = (msg as unknown as { filename?: unknown }).filename;
        if (typeof html !== 'string' || !html) return;
        const base = (typeof fname === 'string' ? fname : 'document.md')
          .replace(/\.[^.]+$/, '')
          .replace(/[^a-zA-Z0-9_.\-]+/g, '_') || 'document';
        const docDir = vscode.Uri.joinPath(document.uri, '..');

        const chromePath = findChromiumBinary();
        if (chromePath) {
          // Direct headless PDF — one click, no print dialog.
          const target = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.joinPath(docDir, `${base}.pdf`),
            filters: { 'PDF': ['pdf'] },
            saveLabel: 'Export',
            title: 'Export as PDF',
          });
          if (!target) return;
          const tmpHtml = path.join(os.tmpdir(), `md-editor-plus-${Date.now()}-${base}.html`);
          try {
            fs.writeFileSync(tmpHtml, html, 'utf8');
            await renderHtmlToPdf(chromePath, tmpHtml, target.fsPath);
          } catch (err) {
            await vscode.window.showErrorMessage(`MD Editor Plus: PDF export failed — ${(err as Error).message}`);
            return;
          } finally {
            try { fs.unlinkSync(tmpHtml); } catch { /* ignore */ }
          }
          const open = 'Open';
          const choice = await vscode.window.showInformationMessage(
            `Exported to ${target.fsPath.split(/[\\/]/).pop()}`,
            open,
          );
          if (choice === open) await vscode.env.openExternal(target);
          return;
        }

        // Fallback: open in default browser with an auto-print script so the
        // system print dialog appears immediately.
        const autoPrintHtml = html.replace(
          '</body>',
          `<script>window.addEventListener('load', () => setTimeout(window.print, 250));</script></body>`,
        );
        const tmpPath = path.join(os.tmpdir(), `md-editor-plus-${Date.now()}-${base}.html`);
        const tmpUri = vscode.Uri.file(tmpPath);
        try {
          await vscode.workspace.fs.writeFile(tmpUri, Buffer.from(autoPrintHtml, 'utf8'));
        } catch (err) {
          await vscode.window.showErrorMessage(`MD Editor Plus: PDF export failed — ${(err as Error).message}`);
          return;
        }
        await vscode.env.openExternal(tmpUri);
        await vscode.window.showInformationMessage(
          'No Chromium browser found for direct export — opened in your browser. Pick "Save as PDF" in the print dialog.',
        );
      }
      if (msg.type === 'exportHtml') {
        const html = (msg as unknown as { html?: unknown }).html;
        if (typeof html !== 'string' || !html) return;
        const base = (document.uri.path.split('/').pop() ?? 'document.md').replace(/\.[^.]+$/, '');
        const dir = vscode.Uri.joinPath(document.uri, '..');
        const defaultUri = vscode.Uri.joinPath(dir, `${base}.html`);
        const target = await vscode.window.showSaveDialog({
          defaultUri,
          filters: { 'HTML': ['html', 'htm'] },
          saveLabel: 'Export',
          title: 'Export as HTML',
        });
        if (!target) return;
        try {
          await vscode.workspace.fs.writeFile(target, Buffer.from(html, 'utf8'));
        } catch (err) {
          await vscode.window.showErrorMessage(`MD Editor Plus: export failed — ${(err as Error).message}`);
          return;
        }
        const open = 'Open';
        const choice = await vscode.window.showInformationMessage(
          `Exported to ${target.fsPath.split('/').pop()}`,
          open,
        );
        if (choice === open) {
          await vscode.env.openExternal(target);
        }
      }
      if (msg.type === 'duplicate') {
        const dir = vscode.Uri.joinPath(document.uri, '..');
        const base = document.uri.path.split('/').pop() ?? 'document.md';
        const name = base.replace(/(\.md)$/i, '') + ' copy.md';
        const newUri = vscode.Uri.joinPath(dir, name);
        await vscode.workspace.fs.writeFile(newUri, Buffer.from(document.getText(), 'utf8'));
        await vscode.commands.executeCommand('vscode.openWith', newUri, 'md-editor-plus.editor');
      }
    });

    webviewPanel.onDidDispose(() => {
      onDocChange.dispose();
    });

    sendInit();
  }

  private async _applyEdit(document: vscode.TextDocument, markdown: string): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, document.lineCount, 0),
      markdown
    );
    this._isApplyingEdit = true;
    await vscode.workspace.applyEdit(edit);
    this._isApplyingEdit = false;
  }

  private _getHtml(webview: vscode.Webview, document: vscode.TextDocument): string {
    const fileNameRaw = document.uri.path.split('/').pop() ?? 'untitled.md';
    const fileName = fileNameRaw.replace(/[&<>"']/g, c => (
      c === '&' ? '&amp;' :
      c === '<' ? '&lt;' :
      c === '>' ? '&gt;' :
      c === '"' ? '&quot;' :
      '&#39;'
    ));
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js')
    );
    const nonce = this._nonce();

    const iEye  = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M251,123.13c-.37-.81-9.13-20.26-28.48-39.61C196.63,57.67,164,44,128,44S59.37,57.67,33.51,83.52C14.16,102.87,5.4,122.32,5,123.13a12.08,12.08,0,0,0,0,9.75c.37.82,9.13,20.26,28.49,39.61C59.37,198.34,92,212,128,212s68.63-13.66,94.48-39.51c19.36-19.35,28.12-38.79,28.49-39.61A12.08,12.08,0,0,0,251,123.13Zm-46.06,33C183.47,177.27,157.59,188,128,188s-55.47-10.73-76.91-31.88A130.36,130.36,0,0,1,29.52,128,130.45,130.45,0,0,1,51.09,99.89C72.54,78.73,98.41,68,128,68s55.46,10.73,76.91,31.89A130.36,130.36,0,0,1,226.48,128,130.45,130.45,0,0,1,204.91,156.12ZM128,84a44,44,0,1,0,44,44A44.05,44.05,0,0,0,128,84Zm0,64a20,20,0,1,1,20-20A20,20,0,0,1,128,148Z"/></svg>`;
    const iCode = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M96,73,34.06,128,96,183A12,12,0,1,1,80,201L8,137A12,12,0,0,1,8,119L80,55A12,12,0,0,1,96,73ZM248,119,176,55A12,12,0,1,0,160,73l61.91,55L160,183A12,12,0,1,0,176,201l72-64A12,12,0,0,0,248,119Z"/></svg>`;
    const iSun  = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M116,36V20a12,12,0,0,1,24,0V36a12,12,0,0,1-24,0Zm80,92a68,68,0,1,1-68-68A68.07,68.07,0,0,1,196,128Zm-24,0a44,44,0,1,0-44,44A44.05,44.05,0,0,0,172,128ZM51.51,68.49a12,12,0,1,0,17-17l-12-12a12,12,0,0,0-17,17Zm0,119-12,12a12,12,0,0,0,17,17l12-12a12,12,0,1,0-17-17ZM196,72a12,12,0,0,0,8.49-3.51l12-12a12,12,0,0,0-17-17l-12,12A12,12,0,0,0,196,72Zm8.49,115.51a12,12,0,0,0-17,17l12,12a12,12,0,0,0,17-17ZM48,128a12,12,0,0,0-12-12H20a12,12,0,0,0,0,24H36A12,12,0,0,0,48,128Zm80,80a12,12,0,0,0-12,12v16a12,12,0,0,0,24,0V220A12,12,0,0,0,128,208Zm108-92H220a12,12,0,0,0,0,24h16a12,12,0,0,0,0-24Z"/></svg>`;
    const iAuto = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M128,20A108,108,0,1,0,236,128,108.12,108.12,0,0,0,128,20Zm12,24.87a83.53,83.53,0,0,1,24,7.25V203.88a83.53,83.53,0,0,1-24,7.25ZM44,128a84.12,84.12,0,0,1,72-83.13V211.13A84.12,84.12,0,0,1,44,128Zm144,58.71V69.29a83.81,83.81,0,0,1,0,117.42Z"/></svg>`;
    const iMoon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M236.37,139.4a12,12,0,0,0-12-3A84.07,84.07,0,0,1,119.6,31.59a12,12,0,0,0-15-15A108.86,108.86,0,0,0,49.69,55.07,108,108,0,0,0,136,228a107.09,107.09,0,0,0,64.93-21.69,108.86,108.86,0,0,0,38.44-54.94A12,12,0,0,0,236.37,139.4Zm-49.88,47.74A84,84,0,0,1,68.86,69.51,84.93,84.93,0,0,1,92.27,48.29Q92,52.13,92,56A108.12,108.12,0,0,0,200,164q3.87,0,7.71-.27A84.79,84.79,0,0,1,186.49,187.14Z"/></svg>`;
    const iSepia = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M232,44H160a43.86,43.86,0,0,0-32,13.85A43.86,43.86,0,0,0,96,44H24A12,12,0,0,0,12,56V200a12,12,0,0,0,12,12H96a20,20,0,0,1,20,20,12,12,0,0,0,24,0,20,20,0,0,1,20-20h72a12,12,0,0,0,12-12V56A12,12,0,0,0,232,44ZM96,188H36V68H96a20,20,0,0,1,20,20V192.81A43.79,43.79,0,0,0,96,188Zm124,0H160a43.71,43.71,0,0,0-20,4.83V88a20,20,0,0,1,20-20h60Z"/></svg>`;
    const iAa = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M90.86,50.89a12,12,0,0,0-21.72,0l-64,136a12,12,0,0,0,21.71,10.22L42.44,164h75.12l15.58,33.11a12,12,0,0,0,21.72-10.22ZM53.74,140,80,84.18,106.27,140ZM200,84c-13.85,0-24.77,3.86-32.45,11.48a12,12,0,1,0,16.9,17c3-3,8.26-4.52,15.55-4.52,11,0,20,7.18,20,16v4.39A47.28,47.28,0,0,0,200,124c-24.26,0-44,17.94-44,40s19.74,40,44,40a47.18,47.18,0,0,0,22-5.38A12,12,0,0,0,244,192V124C244,101.94,224.26,84,200,84Zm0,96c-11,0-20-7.18-20-16s9-16,20-16,20,7.18,20,16S211,180,200,180Z"/></svg>`;
    const iFolder = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M228,104a12,12,0,0,1-24,0V69l-59.51,59.51a12,12,0,0,1-17-17L187,52H152a12,12,0,0,1,0-24h64a12,12,0,0,1,12,12Zm-44,24a12,12,0,0,0-12,12v64H52V84h64a12,12,0,0,0,0-24H48A20,20,0,0,0,28,80V208a20,20,0,0,0,20,20H176a20,20,0,0,0,20-20V140A12,12,0,0,0,184,128Z"/></svg>`;
    const iDownload = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M228,148v56a12,12,0,0,1-12,12H40a12,12,0,0,1-12-12V148a12,12,0,0,1,24,0v44H204V148a12,12,0,0,1,24,0ZM119.51,156.49a12,12,0,0,0,17,0l40-40a12,12,0,0,0-17-17L140,123V40a12,12,0,0,0-24,0v83L96.49,99.51a12,12,0,0,0-17,17Z"/></svg>`;
    const iOutline = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" stroke-width="22" stroke-linecap="round" viewBox="0 0 256 256"><line x1="40" y1="64" x2="60" y2="64"/><line x1="100" y1="64" x2="216" y2="64"/><line x1="80" y1="128" x2="100" y2="128"/><line x1="140" y1="128" x2="216" y2="128"/><line x1="80" y1="192" x2="100" y2="192"/><line x1="140" y1="192" x2="216" y2="192"/></svg>`;
    const iRefresh = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>`;
    const iLock = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M208,80H176V56a48,48,0,0,0-96,0V80H48A16,16,0,0,0,32,96V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V96A16,16,0,0,0,208,80ZM96,56a32,32,0,0,1,64,0V80H96Zm112,152H48V96H208V208Z"/></svg>`;
    const iPdf = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M48,28A20,20,0,0,0,28,48V208a20,20,0,0,0,20,20H208a20,20,0,0,0,20-20V96a12,12,0,0,0-3.51-8.49l-56-56A12,12,0,0,0,160,28Zm4,24h96V96a12,12,0,0,0,12,12h44V204H52ZM168,57l27,27H168ZM112,160v8h8a12,12,0,0,1,0,24h-8v8a12,12,0,0,1-24,0V148a12,12,0,0,1,12-12h20a12,12,0,0,1,0,24Zm68,12a40,40,0,0,1-40,40h-4a12,12,0,0,1-12-12V148a12,12,0,0,1,12-12h4A40,40,0,0,1,180,176Zm-24-4a16,16,0,0,0-8-13.86V178a16,16,0,0,0,8-6Z"/></svg>`;
    const iDevices = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M224,72H212V64a28,28,0,0,0-28-28H40A28,28,0,0,0,12,64v88a28,28,0,0,0,28,28h96v12a28,28,0,0,0,28,28h60a28,28,0,0,0,28-28V100A28,28,0,0,0,224,72ZM40,156a4,4,0,0,1-4-4V64a4,4,0,0,1,4-4H184a4,4,0,0,1,4,4v8H164a28,28,0,0,0-28,28v56Zm188,36a4,4,0,0,1-4,4H164a4,4,0,0,1-4-4V100a4,4,0,0,1,4-4h60a4,4,0,0,1,4,4ZM124,208a12,12,0,0,1-12,12H88a12,12,0,0,1,0-24h24A12,12,0,0,1,124,208Zm88-84a12,12,0,0,1-12,12H188a12,12,0,0,1,0-24h12A12,12,0,0,1,212,124Z"/></svg>`;
    const iArrowsH = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M240.49,136.49l-32,32a12,12,0,0,1-17-17L203,140H53l11.52,11.51a12,12,0,0,1-17,17l-32-32a12,12,0,0,1,0-17l32-32a12,12,0,1,1,17,17L53,116H203l-11.52-11.51a12,12,0,0,1,17-17l32,32A12,12,0,0,1,240.49,136.49Z"/></svg>`;
    const iSliders = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M40,92H70.06a36,36,0,0,0,67.88,0H216a12,12,0,0,0,0-24H137.94a36,36,0,0,0-67.88,0H40a12,12,0,0,0,0,24Zm64-24A12,12,0,1,1,92,80,12,12,0,0,1,104,68Zm112,96H201.94a36,36,0,0,0-67.88,0H40a12,12,0,0,0,0,24h94.06a36,36,0,0,0,67.88,0H216a12,12,0,0,0,0-24Zm-48,24a12,12,0,1,1,12-12A12,12,0,0,1,168,188Z"/></svg>`;
    const iPageWidth = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 256 256"><line x1="36" y1="48" x2="36" y2="208"/><line x1="220" y1="48" x2="220" y2="208"/><line x1="80" y1="128" x2="176" y2="128"/><polyline points="102,108 80,128 102,148"/><polyline points="154,108 176,128 154,148"/></svg>`;
    const iClaude = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M4.42425 0.00409016C4.68032 -0.0174914 5.17337 0.0433963 5.3406 0.257065C5.48995 0.447879 5.59795 0.750296 5.69766 0.978039L6.17421 2.04545C6.51705 2.80807 6.8836 3.52985 7.27004 4.26933C7.53979 4.78551 7.83236 5.27908 7.9714 5.84346C7.99095 5.92284 8.03208 6.11085 8.13215 6.09669C8.16118 6.06118 8.16871 5.92556 8.17123 5.87465C8.21736 4.94079 8.35678 4.0197 8.43703 3.08943L8.53205 1.96782C8.56839 1.54151 8.56715 1.2738 8.72877 0.865158C8.90799 0.412004 8.98895 0.488606 9.35843 0.221255C9.45273 0.270795 9.55958 0.309379 9.65092 0.363488C9.82904 0.469011 9.9517 0.695877 10.0708 0.864026C10.0126 1.25819 9.95112 1.6529 9.88916 2.04654C9.7002 3.24702 9.41382 4.4399 9.22315 5.6396C9.30343 5.63007 9.38087 5.62503 9.436 5.55658C10.1861 4.62514 10.8865 3.64584 11.6926 2.75921C12.0118 2.40816 12.3097 2.06364 12.7008 1.78981C12.885 1.77246 13.2115 1.78358 13.403 1.78603C13.4692 1.92499 13.7924 2.37933 13.8983 2.53384C13.8576 2.66319 13.7166 3.21366 13.6685 3.28995C13.5216 3.52263 13.2222 3.87983 13.0442 4.10667C12.6943 4.55074 12.3511 5.00002 12.0147 5.45438C11.862 5.65963 10.984 6.86075 11.0272 7.06171C11.1178 7.11754 11.9994 6.90137 12.1703 6.86495C12.7203 6.74279 13.273 6.63317 13.8281 6.5362L14.8011 6.36845C14.9538 6.34249 15.1848 6.31074 15.3247 6.27287C15.5156 6.35446 15.7042 6.4415 15.8902 6.53391C16.0015 6.84264 15.8643 7.0374 15.7349 7.33452C14.3417 7.71201 12.9083 7.93289 11.5104 8.29459C11.3456 8.33722 10.6973 8.46109 10.5813 8.52891L10.5759 8.54973C10.6502 8.60073 11.9683 8.69467 12.0973 8.69219C12.8636 8.67744 13.6099 8.71173 14.3742 8.784C14.4872 8.79468 14.6131 8.80044 14.7274 8.80879C15.3368 8.78307 15.6667 9.15117 16 9.60175C15.9937 9.71968 15.9766 9.82401 15.9565 9.93992C15.7493 10.0462 15.3419 10.2694 15.1325 10.3506C14.0894 10.0906 13.0187 9.84743 11.9709 9.59955C11.7383 9.54509 11.5061 9.48838 11.2746 9.42942C11.0238 9.36617 10.7144 9.26871 10.463 9.27234C10.5749 9.43255 10.7515 9.58571 10.8922 9.72591C11.1929 10.0255 11.5094 10.3056 11.8245 10.5899C12.4012 11.1068 12.9715 11.6306 13.5355 12.1612C13.7511 12.3613 14.0401 12.6034 14.229 12.8243C14.2678 12.8697 14.3111 13.1242 14.3275 13.2034C14.2579 13.2909 14.1771 13.4126 14.1115 13.5064C14.0375 13.4959 13.913 13.4848 13.8517 13.4426C13.553 13.2372 13.2706 12.9978 12.9743 12.7881C12.3265 12.3293 11.7599 11.7767 11.1443 11.2781C11.0254 11.1817 10.631 10.8201 10.5141 10.7861L10.4919 10.8004C10.4693 10.867 10.4827 10.9081 10.5211 10.9645C10.6158 11.1037 10.7109 11.2433 10.8044 11.3833L11.8063 12.8887C11.9508 13.1069 12.2574 13.5137 12.3369 13.7402C12.3688 13.831 12.4254 14.3562 12.3896 14.4578C12.3733 14.5043 12.3369 14.5729 12.3098 14.6209C11.9794 14.8175 11.797 14.7704 11.4526 14.6958C10.9397 14.0029 10.4493 13.2936 9.98213 12.5691C9.67098 12.0929 9.37499 11.6204 9.09503 11.1248C9.01453 10.9823 8.92148 10.821 8.82582 10.6901L8.79481 10.6858C8.70631 10.7423 8.69411 11.1654 8.68365 11.2816L8.61244 12.066L8.36257 14.7297C8.34159 14.9411 8.32691 15.1602 8.31066 15.3724C8.27815 15.7966 7.92731 15.8777 7.58421 15.9975C7.48064 15.911 7.32407 15.8167 7.23432 15.7229C7.11975 15.6031 7.03735 15.3512 6.96779 15.1946C7.12351 14.5012 7.26992 13.8057 7.40698 13.1084C7.48936 12.7067 7.57645 12.3039 7.65224 11.9012C7.7298 11.4738 7.76735 11.0393 7.85639 10.6144C7.87263 10.5369 7.96919 10.2347 7.92638 10.1833C7.82039 10.1984 7.25679 11.0239 7.15824 11.1588L6.09187 12.6044C5.89661 12.8683 5.68366 13.1691 5.48086 13.4248C5.24076 13.7029 4.98578 13.9723 4.73179 14.2378C4.4675 14.514 4.38513 14.7051 4.0058 14.8123C3.88739 14.7425 3.65988 14.6279 3.53585 14.5714C3.5567 14.4495 3.55906 14.1944 3.61311 14.101C3.81942 13.745 4.14557 13.3612 4.40023 13.0383L6.34198 10.5385C6.54346 10.2797 6.78348 10.0278 6.98733 9.76899C7.0189 9.7289 7.03103 9.69316 7.02099 9.64305C6.98071 9.61909 6.93998 9.65521 6.89582 9.68371L3.94261 11.6002L3.18791 12.09C3.10273 12.1453 2.8363 12.326 2.76234 12.3508C2.54944 12.422 2.23497 12.4288 2.00258 12.471C1.91141 12.3766 1.77805 12.2592 1.67847 12.1695C1.6849 12.0085 1.70203 11.8382 1.71565 11.6769C1.8562 11.4879 2.03055 11.3994 2.21523 11.2645C3.49354 10.3309 4.93504 9.6739 6.29064 8.86174C6.31527 8.79917 6.34572 8.73812 6.31918 8.67412C6.29544 8.64866 6.26736 8.6342 6.23231 8.63168C5.69463 8.59304 5.15629 8.58511 4.61776 8.57001C3.64916 8.54388 2.68096 8.50501 1.71339 8.45343C1.26786 8.42853 0.768872 8.43572 0.346149 8.31053C0.244292 8.16552 0.108595 7.99508 0 7.84909C0.0128298 7.76967 0.0206058 7.69985 0.0285705 7.62031L0.355151 7.39815C0.791607 7.44506 1.23769 7.46738 1.67587 7.49897C2.60622 7.56603 3.53627 7.62488 4.46717 7.68323C4.85285 7.7143 5.2394 7.76611 5.62415 7.80245C5.76201 7.81548 6.29004 7.89707 6.36741 7.80039C6.3548 7.66966 5.94943 7.43052 5.82502 7.34607L5.06542 6.83238C4.02061 6.12831 2.95656 5.45735 1.94543 4.70406C1.75787 4.56432 1.5159 4.43375 1.38995 4.22553C1.26793 4.02381 1.26653 3.70113 1.21786 3.46524C1.34165 3.34913 1.54261 3.11515 1.66341 2.98259C1.80368 3.00212 2.28372 3.00846 2.38145 3.06597C2.49299 3.13159 2.7933 3.37124 2.90915 3.45957C3.35106 3.79654 3.78754 4.14401 4.22993 4.47985C4.63469 4.78712 5.05338 5.0822 5.45979 5.38706C5.67557 5.54893 5.97853 5.75515 6.17087 5.93888L6.29122 5.83531C6.13234 5.5935 5.91031 5.16484 5.76505 4.90252C5.48218 4.3822 5.19079 3.86655 4.89099 3.35581C4.56744 2.79462 4.21556 2.21186 3.88621 1.65368C3.78748 1.48634 3.70034 0.964373 3.68838 0.758935C3.81921 0.571042 3.96056 0.381142 4.09861 0.19812C4.1918 0.0745733 4.27846 0.0377186 4.42425 0.00409016Z"/></svg>`;
    const iCopy = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M180,64H40A12,12,0,0,0,28,76V216a12,12,0,0,0,12,12H180a12,12,0,0,0,12-12V76A12,12,0,0,0,180,64ZM168,204H52V88H168ZM228,40V180a12,12,0,0,1-24,0V52H76a12,12,0,0,1,0-24H216A12,12,0,0,1,228,40Z"/></svg>`;
    const iDuplicate = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M216,28H88A12,12,0,0,0,76,40V76H40A12,12,0,0,0,28,88V216a12,12,0,0,0,12,12H168a12,12,0,0,0,12-12V180h36a12,12,0,0,0,12-12V40A12,12,0,0,0,216,28ZM156,204H52V100H156Zm48-48H180V88a12,12,0,0,0-12-12H100V52H204Z"/></svg>`;
    const iDots = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M156,128a28,28,0,1,1-28-28A28,28,0,0,1,156,128ZM48,100a28,28,0,1,0,28,28A28,28,0,0,0,48,100Zm160,0a28,28,0,1,0,28,28A28,28,0,0,0,208,100Z"/></svg>`;
    const iLink = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M137.54,186.36a8,8,0,0,1,0,11.31l-9.94,9.94a56,56,0,0,1-79.22-79.22l24.12-24.12a56,56,0,0,1,76.81-2.26,8,8,0,0,1-10.64,12,40,40,0,0,0-54.85,1.61L59.7,139.72a40,40,0,0,0,56.58,56.58l9.94-9.94A8,8,0,0,1,137.54,186.36Zm70.08-138a56.08,56.08,0,0,0-79.22,0l-9.94,9.94a8,8,0,0,0,11.32,11.32l9.94-9.94a40,40,0,0,1,56.58,56.58L172.18,140.4A40,40,0,0,1,117.34,142a8,8,0,0,0-10.66,12,56,56,0,0,0,76.81-2.26l24.12-24.12A56.08,56.08,0,0,0,207.62,48.38Z"/></svg>`;
    const iAppLogo = `<svg xmlns="http://www.w3.org/2000/svg" height="22" viewBox="0 0 136 112" fill="none"><rect width="136" height="112" rx="15" fill="white"/><path fill-rule="evenodd" clip-rule="evenodd" d="M92.8551 9.16156L15.2656 12.417C10.8752 12.7966 9.34784 15.6655 9.34784 19.1038V78.7631C9.34784 81.4412 10.2989 83.7328 12.5934 86.7954L25.3858 103.429C27.4876 106.107 29.3985 106.682 33.4112 106.491L119.777 103.429C125.121 103.049 126.652 100.56 126.652 96.355V29.2378C126.652 27.0643 125.794 26.4378 123.266 24.5829L105.461 12.0295C101.258 8.97371 99.5399 8.5872 92.8551 9.16058V9.16156ZM34.8402 27.3751C29.6798 27.7223 28.5094 27.8009 25.5786 25.4179L18.1276 19.4913C17.3703 18.7242 17.7509 17.7672 19.6589 17.5764L95.1437 14.5177C99.537 14.1342 101.825 15.6655 103.543 17.003L112.515 23.504C112.899 23.6977 113.853 24.8415 112.705 24.8415L35.509 27.3298L34.8402 27.3751ZM28.8241 95.0175V38.0402C28.8241 35.5519 29.5883 34.4041 31.876 34.2114L117.098 31.3425C119.203 31.1527 120.154 32.4903 120.154 34.9746V91.5722C120.154 94.0605 119.771 96.1652 116.335 96.355L33.7849 99.0331C30.3496 99.2229 28.8251 98.0791 28.8251 95.0175H28.8241Z" fill="black"/><path d="M35.8799 89.8194V85.739L40.7432 84.7229V48.7065L35.8799 48.0301V47.3043C35.8799 45.4349 37.3945 43.8665 39.2628 43.8013L56.0897 43.2137L66.3819 70.7292L76.2676 44.262C76.6669 43.193 77.6768 42.4599 78.8043 42.4205L91.0074 41.9943V43.0579C91.0074 44.8188 89.7407 46.3683 88.0067 46.7287L86.1139 47.1222V83.1385L91.0074 83.8139V85.1802C91.0074 86.6792 89.793 87.9368 88.2949 87.9891L74.1477 88.4831V84.4027L79.3131 83.376V52.5062L79.162 52.4812L65.6941 87.3879L61.2537 87.543L47.8015 54.6033L47.6504 54.6388L47.8015 72.3561V84.4764L52.1312 85.1715V87.4425C52.1312 88.4418 51.3216 89.2802 50.3229 89.3151L47.3625 89.4185L35.8799 89.8194Z" fill="black"/><path d="M109.09 71.7366L115.401 71.5163C116.18 71.4893 116.594 72.3958 116.077 72.9975L104.333 86.6654C103.974 87.0839 103.341 87.1059 102.981 86.7127L91.237 73.865C90.7199 73.2993 91.1338 72.3637 91.9133 72.3365L98.2142 72.1164V42.1496L109.09 41.7698V71.7366Z" fill="black"/></svg>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}';
             img-src ${webview.cspSource} data: https:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MD Editor Plus</title>
</head>
<body>
  <div id="toolbar">
    <span class="toolbar-logo" data-tip="MD Editor Plus">${iAppLogo}</span>
    <div class="segmented" id="view-seg">
      <button class="seg-btn active" data-view="preview" data-tip="Notion view — rich rendering">${iEye}<span class="seg-label">Preview</span></button>
      <button class="seg-btn" data-view="source" data-tip="Source view — raw markdown">${iCode}<span class="seg-label">Code</span><span class="fm-badge hidden" id="fm-badge" aria-hidden="true"></span></button>
    </div>
    <button class="toolbar-icon" id="outline-btn" data-tip="Outline (⌘⇧O)">${iOutline}</button>
    <span class="toolbar-filename" id="toolbar-filename" title="${fileName}">${fileName}</span>
    <span class="toolbar-spacer"></span>
    <button class="toolbar-icon" id="refresh-btn" data-tip="Reload from disk">${iRefresh}</button>
    <button class="toolbar-icon" id="settings-btn" data-tip="Display settings">${iAa}</button>
    <button class="toolbar-icon" id="actions-btn" data-tip="More actions">${iDots}</button>
  </div>
  <div class="settings-panel hidden" id="settings-panel">
    <div class="settings-section">
      <div class="settings-label">Theme</div>
      <div class="segmented full-width" id="theme-seg">
        <button class="seg-btn active" data-theme="light" data-tip-html="<span class='tip-title'>Light</span><span class='tip-sub'>Notion's classic white background</span><div class='tip-swatches'><span class='tip-swatch' style='background:#ffffff'></span><span class='tip-swatch' style='background:#f7f6f3'></span><span class='tip-swatch' style='background:#37352f'></span></div>">${iSun}</button>
        <button class="seg-btn" data-theme="claude" data-tip-html="<span class='tip-title'>Claude</span><span class='tip-sub'>Soft warm theme inspired by Claude.ai</span><div class='tip-swatches'><span class='tip-swatch' style='background:#faf9f5'></span><span class='tip-swatch' style='background:#efe9dc'></span><span class='tip-swatch' style='background:#3d3929'></span></div>">${iClaude}</button>
        <button class="seg-btn" data-theme="sepia" data-tip-html="<span class='tip-title'>Sepia</span><span class='tip-sub'>Warm paper tones, easy on the eyes</span><div class='tip-swatches'><span class='tip-swatch' style='background:#f4ecd8'></span><span class='tip-swatch' style='background:#e9dcc0'></span><span class='tip-swatch' style='background:#5b4636'></span></div>">${iSepia}</button>
        <button class="seg-btn" data-theme="dark" data-tip-html="<span class='tip-title'>Dark</span><span class='tip-sub'>Deep dark background</span><div class='tip-swatches'><span class='tip-swatch' style='background:#191919'></span><span class='tip-swatch' style='background:#2f2f2f'></span><span class='tip-swatch' style='background:#e7e7e7'></span></div>">${iMoon}</button>
      </div>
      <div class="settings-row settings-row-sub" data-tip="Follow your OS's or IDE's light/dark mode automatically">
        <span class="settings-row-icon">${iDevices}</span>
        <span class="settings-row-label">Sync with</span>
        <div class="segmented compact" id="sync-seg">
          <button class="seg-btn active" data-sync="off" data-tip="Use the manually selected theme">Off</button>
          <button class="seg-btn" data-sync="os"  data-tip="Follow your operating system's light/dark mode">OS</button>
          <button class="seg-btn" data-sync="ide" data-tip="Follow your editor's color theme">IDE</button>
        </div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-label">Page width</div>
      <div class="settings-row" id="page-width-row" data-tip="Maximum content width in pixels">
        <span class="settings-row-icon">${iPageWidth}</span>
        <span class="settings-row-label">Page width:</span>
        <span class="width-pill" id="width-value">800</span>
      </div>
      <div class="settings-custom-slider" id="custom-slider-row">
        <div class="slider-wrap">
          <div class="slider-stops" aria-hidden="true">
            <span class="slider-stop" style="left:0%" data-stop="600" data-tip="600 px — Narrow"></span>
            <span class="slider-stop" style="left:25%" data-stop="800" data-tip="800 px — Default"></span>
            <span class="slider-stop" style="left:50%" data-stop="1000" data-tip="1000 px — Comfortable"></span>
            <span class="slider-stop" style="left:75%" data-stop="1200" data-tip="1200 px — Wide"></span>
            <span class="slider-stop" style="left:100%" data-stop="1400" data-tip="1400 px — Extra wide"></span>
          </div>
          <input type="range" min="600" max="1400" value="800" step="1" class="width-slider" id="width-slider" data-tip="Drag to set page width. Snaps to dots near them." />
        </div>
      </div>
      <div class="settings-row" data-tip="Use the entire window width (overrides the slider)">
        <span class="settings-row-icon">${iArrowsH}</span>
        <span class="settings-row-label">Full width</span>
        <button class="toggle-switch" id="full-width-toggle" role="switch" aria-checked="false"></button>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-label">Text size</div>
      <div class="segmented full-width" id="text-seg">
        <button class="seg-btn" data-text="s" data-tip-html="<span class='tip-title'>Small</span><span class='tip-preview' style='font-size:14px'>The quick brown fox</span>"><span style="font-size:14px">S</span></button>
        <button class="seg-btn active" data-text="m" data-tip-html="<span class='tip-title'>Medium (default)</span><span class='tip-preview' style='font-size:16px'>The quick brown fox</span>"><span style="font-size:16px">M</span></button>
        <button class="seg-btn" data-text="l" data-tip-html="<span class='tip-title'>Large</span><span class='tip-preview' style='font-size:18px'>The quick brown fox</span>"><span style="font-size:18px">L</span></button>
        <button class="seg-btn" data-text="xl" data-tip-html="<span class='tip-title'>Extra large</span><span class='tip-preview' style='font-size:20px'>The quick brown fox</span>"><span style="font-size:20px">XL</span></button>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-label">Font</div>
      <div class="segmented full-width" id="font-seg">
        <button class="seg-btn active" data-font="sans" data-tip-html="<span class='tip-title'>Sans-serif</span><span class='tip-preview' style=&quot;font-family:ui-sans-serif,Inter,sans-serif&quot;>The quick brown fox</span>"><span style="font-family:ui-sans-serif,'Inter',sans-serif;font-weight:600">Aa</span> Sans</button>
        <button class="seg-btn" data-font="serif" data-tip-html="<span class='tip-title'>Serif</span><span class='tip-preview' style=&quot;font-family:ui-serif,Georgia,serif&quot;>The quick brown fox</span>"><span style="font-family:ui-serif,'Georgia',serif;font-weight:700">Aa</span> Serif</button>
        <button class="seg-btn" data-font="mono" data-tip-html="<span class='tip-title'>Monospace</span><span class='tip-preview' style=&quot;font-family:ui-monospace,JetBrains Mono,monospace&quot;>The quick brown fox</span>"><span style="font-family:ui-monospace,'JetBrains Mono',monospace;font-weight:600">Aa</span> Mono</button>
      </div>
    </div>
    <div class="settings-divider"></div>
    <div class="settings-section">
      <div class="settings-label">Code &amp; diagrams</div>
      <div class="settings-row" data-tip="Force fenced code blocks to use a dark theme even on light pages">
        <span class="settings-row-icon">${iCode}</span>
        <span class="settings-row-label">Always dark: Code Snippets</span>
        <button class="toggle-switch" id="always-dark-code-toggle" role="switch" aria-checked="false"></button>
      </div>
      <div class="settings-row" data-tip="Force mermaid diagrams to use a dark theme regardless of the page theme">
        <span class="settings-row-icon">${iCode}</span>
        <span class="settings-row-label">Always dark: Mermaid diagrams</span>
        <button class="toggle-switch" id="always-dark-diagram-toggle" role="switch" aria-checked="false"></button>
      </div>
      <div class="settings-row" data-tip="Force the raw source view to use a dark theme even on light pages">
        <span class="settings-row-icon">${iCode}</span>
        <span class="settings-row-label">Always dark: Code view</span>
        <button class="toggle-switch" id="always-dark-source-toggle" role="switch" aria-checked="false"></button>
      </div>
      <div class="settings-row" data-tip="Render the source view at full window width — leaves the rendered view alone">
        <span class="settings-row-icon">${iArrowsH}</span>
        <span class="settings-row-label">Full width: Only in Code view</span>
        <button class="toggle-switch" id="source-full-width-toggle" role="switch" aria-checked="false"></button>
      </div>
      <div class="settings-row" data-tip="Wrap long lines in Code view instead of horizontal scrolling">
        <span class="settings-row-icon">${iCode}</span>
        <span class="settings-row-label">Word wrap: Only in Code view</span>
        <button class="toggle-switch" id="source-word-wrap-toggle" role="switch" aria-checked="false"></button>
      </div>
      <div class="settings-row" data-tip="Long code snippets collapse to a preview with a Show more button">
        <span class="settings-row-icon">${iCode}</span>
        <span class="settings-row-label">Shorten Code Snippets</span>
        <button class="toggle-switch" id="shorten-snippets-toggle" role="switch" aria-checked="false"></button>
      </div>
    </div>
    <div class="settings-divider"></div>
    <div class="settings-defaults-row">
      <button class="settings-defaults-btn primary" id="save-defaults-btn" data-tip="Persist the current view as your default for every Markdown file">Save view as default</button>
      <button class="settings-defaults-btn link" id="reset-defaults-btn" data-tip="Clear saved defaults and restore the built-in ones">Reset</button>
    </div>
  </div>
  <div class="actions-panel hidden" id="actions-panel-filename" data-anchor="filename">
    <button class="settings-action act-copy" data-tip="Copy the entire markdown to clipboard">${iCopy}<span class="settings-action-label">Copy page content</span></button>
    <button class="settings-action act-copy-path" data-tip="Copy the absolute file path to clipboard">${iLink}<span class="settings-action-label">Copy file path</span></button>
    <button class="settings-action act-duplicate" data-tip="Save a copy of this file in the same folder">${iDuplicate}<span class="settings-action-label">Duplicate</span></button>
    <button class="settings-action act-finder" data-tip="Reveal this file in your OS file browser">${iFolder}<span class="settings-action-label">Open in Finder</span></button>
    <button class="settings-action act-export-menu" data-submenu="export">${iDownload}<span class="settings-action-label">Export</span><span class="settings-action-caret">›</span></button>
    <button class="settings-action act-blocks-skill" data-tip="Generate a Claude skill that teaches your AI this app's block grammar">${iDownload}<span class="settings-action-label">Create blocks skill…</span></button>
  </div>
  <div class="actions-panel hidden" id="actions-panel-dots" data-anchor="dots">
    <button class="settings-action act-toggle-readonly" id="act-toggle-readonly" data-tip="Toggle read-only mode — when on, typing and structural edits are blocked">${iLock}<span class="settings-action-label">Read only</span></button>
    <button class="settings-action act-refresh" data-tip="Reload the file from disk — discards unsaved in-editor changes">${iRefresh}<span class="settings-action-label">Reload from disk</span></button>
    <button class="settings-action act-copy" data-tip="Copy the entire markdown to clipboard">${iCopy}<span class="settings-action-label">Copy page content</span></button>
    <button class="settings-action act-copy-path" data-tip="Copy the absolute file path to clipboard">${iLink}<span class="settings-action-label">Copy file path</span></button>
    <button class="settings-action act-duplicate" data-tip="Save a copy of this file in the same folder">${iDuplicate}<span class="settings-action-label">Duplicate</span></button>
    <button class="settings-action act-finder" data-tip="Reveal this file in your OS file browser">${iFolder}<span class="settings-action-label">Open in Finder</span></button>
    <button class="settings-action act-export-menu" data-submenu="export">${iDownload}<span class="settings-action-label">Export</span><span class="settings-action-caret">›</span></button>
    <button class="settings-action act-blocks-skill" data-tip="Generate a Claude skill that teaches your AI this app's block grammar">${iDownload}<span class="settings-action-label">Create blocks skill…</span></button>
  </div>
  <div class="outline-panel hidden" id="outline-panel"></div>
  <div class="actions-submenu hidden" id="actions-submenu-export" role="menu">
    <button class="settings-action act-export-html" data-tip="Save the rendered view as a standalone HTML file">${iDownload}<span class="settings-action-label">Export to HTML</span></button>
    <button class="settings-action act-export-pdf" data-tip="Render to PDF — uses headless Chrome/Edge if installed, otherwise opens the system print dialog">${iPdf}<span class="settings-action-label">Export to PDF</span></button>
  </div>
  <div id="editor"></div>
  <div id="source-view">
    <div id="source-editor"></div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private _nonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 32 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
  }
}
