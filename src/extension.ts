import * as vscode from 'vscode';
import { MdEditorPlusProvider } from './mdEditorPlusProvider';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(MdEditorPlusProvider.register(context));

  context.subscriptions.push(
    vscode.commands.registerCommand('mdEditorPlus.openSourceView', async () => {
      const activeTabInput = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      if (!activeTabInput || typeof activeTabInput !== 'object' || !('uri' in activeTabInput)) return;
      await vscode.commands.executeCommand(
        'vscode.openWith',
        (activeTabInput as { uri: vscode.Uri }).uri,
        'default'
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mdEditorPlus.openBlockView', async () => {
      const activeTabInput = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      if (!activeTabInput || typeof activeTabInput !== 'object' || !('uri' in activeTabInput)) return;
      await vscode.commands.executeCommand(
        'vscode.openWith',
        (activeTabInput as { uri: vscode.Uri }).uri,
        'md-editor-plus.editor'
      );
    })
  );
}

export function deactivate(): void {}
