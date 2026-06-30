// src/diffPaneView.ts
import * as vscode from 'vscode';

function nonce(): string {
  let s = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

function html(webview: vscode.Webview, extensionUri: vscode.Uri, title: string): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'diffPane.js'));
  const n = nonce();
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
           style-src ${webview.cspSource} 'unsafe-inline';
           script-src 'nonce-${n}';
           img-src ${webview.cspSource} data: https:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
</head><body>
  <div id="diff-rail"></div>
  <div id="diff-panes">
    <div class="diff-pane">
      <div class="diff-pane-hd"><span id="diff-left-label">Base</span></div>
      <div id="diff-left" class="diff-pane-body"></div>
    </div>
    <div class="diff-pane">
      <div class="diff-pane-hd">Current</div>
      <div id="diff-right" class="diff-pane-body"></div>
    </div>
  </div>
  <script nonce="${n}" src="${scriptUri}"></script>
</body></html>`;
}

export async function openRenderedDiff(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  base: { content: string; label: string },
  current: string,
): Promise<void> {
  const fileName = document.uri.path.split('/').pop() ?? 'document.md';
  const panel = vscode.window.createWebviewPanel(
    'mdEditorPlusDiff',
    `${fileName} — changes since ${base.label}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
      retainContextWhenHidden: true,
    },
  );
  // Post init only after the pane is listening (VS Code drops messages sent to a
  // not-yet-ready webview — same lesson as the main editor's 'ready' handshake).
  const sub = panel.webview.onDidReceiveMessage((msg) => {
    if (msg?.type === 'ready') {
      panel.webview.postMessage({ type: 'init', base: base.content, baseLabel: base.label, current });
    }
  });
  panel.onDidDispose(() => sub.dispose());
  panel.webview.html = html(panel.webview, context.extensionUri, fileName);
}
