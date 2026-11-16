import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FspProcess, FspTarget } from '../ltsa/ltsaRunner';
import { buildWebviewHtml, WebviewHtmlOptions } from './htmlBuilder';

export interface GraphPanelCallbacks {
    onSelectTarget?: (target: string) => Promise<void>;
    onRunCheck?: (mode: 'check' | 'progress', target: string) => Promise<void>;
}

export interface TraceHighlightPayload {
    trace: string[];
    verdict: string;
    mode: 'check' | 'progress';
    target: string;
}

export class GraphPanel {
    public static currentPanel: GraphPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _processes: FspProcess[] = [];
    private _allTargets: FspTarget[] = [];
    private _activeTarget: string | undefined;
    private _activeDocUri: vscode.Uri | undefined;
    private _liveSyncEnabled = true;
    private _isWebviewReady = false;
    private _pendingSimulation = false;
    private _pendingTrace: TraceHighlightPayload | undefined;
    private _callbacks: GraphPanelCallbacks = {};

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, callbacks?: GraphPanelCallbacks) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        if (callbacks) {
            this._callbacks = callbacks;
        }

        // Set HTML once to avoid full-page flicker on live updates
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

        this._panel.onDidDispose(() => this.dispose(), null);

        this._panel.webview.onDidReceiveMessage(async message => {
            if (!message) return;

            switch (message.command) {
                case 'ready':
                    this._isWebviewReady = true;
                    this._sendLoadMessage(false);
                    if (this._pendingSimulation) {
                        this._pendingSimulation = false;
                        this._panel.webview.postMessage({ command: 'startSimulation' });
                    }
                    if (this._pendingTrace) {
                        const tr = this._pendingTrace;
                        this._pendingTrace = undefined;
                        this._panel.webview.postMessage({
                            command: 'highlightTrace',
                            trace: tr.trace,
                            verdict: tr.verdict,
                            mode: tr.mode,
                            target: tr.target
                        });
                    }
                    break;

                case 'selectTarget':
                    if (message.target && this._callbacks.onSelectTarget) {
                        this._activeTarget = message.target;
                        await this._callbacks.onSelectTarget(message.target);
                    }
                    break;

                case 'runCheck':
                    if (message.mode && this._callbacks.onRunCheck) {
                        const targetToUse = message.target || this._activeTarget;
                        if (targetToUse) {
                            await this._callbacks.onRunCheck(message.mode, targetToUse);
                        }
                    }
                    break;

                case 'toggleLiveSync':
                    this._liveSyncEnabled = !!message.enabled;
                    break;

                case 'exportImage':
                    await this._handleExportImage(message.format, message.data, message.targetName);
                    break;
            }
        });
    }

    public static createOrShow(
        extensionUri: vscode.Uri,
        processes: FspProcess[],
        title?: string,
        allTargets?: FspTarget[],
        docUri?: vscode.Uri,
        callbacks?: GraphPanelCallbacks,
        preserveColumnFocus = false
    ): GraphPanel {
        const column = vscode.window.activeTextEditor
            ? vscode.ViewColumn.Beside
            : vscode.ViewColumn.Two;

        if (GraphPanel.currentPanel) {
            if (!preserveColumnFocus) {
                GraphPanel.currentPanel._panel.reveal( undefined, true );
            }
            if (callbacks) {
                GraphPanel.currentPanel._callbacks = callbacks;
            }
            if (docUri) {
                GraphPanel.currentPanel._activeDocUri = docUri;
            }
            GraphPanel.currentPanel._panel.title = title ? `FSP Studio: ${title}` : 'FSP Studio';
            GraphPanel.currentPanel.updateProcesses(processes, allTargets, title, false);
            return GraphPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            'fspGraph',
            title ? `FSP Studio: ${title}` : 'FSP Studio',
            { viewColumn: column, preserveFocus: true },
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.file(path.join(extensionUri.fsPath, 'media'))],
                retainContextWhenHidden: true
            }
        );

        GraphPanel.currentPanel = new GraphPanel(panel, extensionUri, callbacks);
        GraphPanel.currentPanel._activeDocUri = docUri;
        GraphPanel.currentPanel.updateProcesses(processes, allTargets, title, false);
        return GraphPanel.currentPanel;
    }

    public get activeTarget(): string | undefined {
        return this._activeTarget;
    }

    public get activeDocUri(): vscode.Uri | undefined {
        return this._activeDocUri;
    }

    public get isLiveSyncEnabled(): boolean {
        return this._liveSyncEnabled;
    }

    public setActiveDocUri(uri: vscode.Uri) {
        this._activeDocUri = uri;
    }

    public updateProcesses(
        processes: FspProcess[],
        allTargets?: FspTarget[],
        activeTarget?: string,
        preserveView = false
    ) {
        this._processes = processes;
        if (allTargets) {
            this._allTargets = allTargets;
        }
        if (activeTarget) {
            this._activeTarget = activeTarget;
            this._panel.title = `FSP Studio: ${activeTarget}`;
        }
        if (this._isWebviewReady) {
            this._sendLoadMessage(preserveView);
        }
    }

    public startSimulation() {
        if (this._isWebviewReady) {
            this._panel.webview.postMessage({ command: 'startSimulation' });
        } else {
            this._pendingSimulation = true;
        }
    }

    public highlightTrace(payload: TraceHighlightPayload) {
        if (this._isWebviewReady) {
            this._panel.webview.postMessage({
                command: 'highlightTrace',
                trace: payload.trace,
                verdict: payload.verdict,
                mode: payload.mode,
                target: payload.target
            });
        } else {
            this._pendingTrace = payload;
        }
    }

    private _sendLoadMessage(preserveView: boolean) {
        this._panel.webview.postMessage({
            command: 'loadProcesses',
            processes: this._processes,
            allTargets: this._allTargets,
            activeTarget: this._activeTarget,
            preserveView
        });
    }

    private async _handleExportImage(format: 'png' | 'svg', data: string, targetName?: string) {
        if (!data) return;
        const cleanTarget = (targetName || this._activeTarget || 'automaton').replace(/[^A-Za-z0-9_-]/g, '_');
        const ext = format === 'svg' ? 'svg' : 'png';
        const defaultName = `${cleanTarget}.${ext}`;

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const defaultUri = workspaceFolder
            ? vscode.Uri.file(path.join(workspaceFolder, defaultName))
            : vscode.Uri.file(defaultName);

        const saveUri = await vscode.window.showSaveDialog({
            defaultUri,
            filters: format === 'svg'
                ? { 'Immagine Vettoriale SVG': ['svg'] }
                : { 'Immagine PNG Alta Risoluzione': ['png'] },
            saveLabel: `Esporta ${ext.toUpperCase()}`
        });

        if (!saveUri) return;

        try {
            if (format === 'png') {
                const base64Data = data.replace(/^data:image\/png;base64,/, '');
                fs.writeFileSync(saveUri.fsPath, Buffer.from(base64Data, 'base64'));
            } else {
                fs.writeFileSync(saveUri.fsPath, data, 'utf8');
            }
            vscode.window.showInformationMessage(`Grafo esportato con successo: ${path.basename(saveUri.fsPath)}`);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Errore durante l'esportazione: ${err?.message || String(err)}`);
        }
    }

    public dispose() {
        GraphPanel.currentPanel = undefined;
        this._panel.dispose();
    }

    public static buildWebviewHtml(options: WebviewHtmlOptions): string {
        return buildWebviewHtml(options);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(this._extensionUri.fsPath, 'media', 'graph.js'))).toString();
        const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(this._extensionUri.fsPath, 'media', 'graph.css'))).toString();
        const cytoscapeUri = webview.asWebviewUri(vscode.Uri.file(path.join(this._extensionUri.fsPath, 'media', 'cytoscape.min.js'))).toString();
        const dagreUri = webview.asWebviewUri(vscode.Uri.file(path.join(this._extensionUri.fsPath, 'media', 'dagre.min.js'))).toString();
        const cytoscapeDagreUri = webview.asWebviewUri(vscode.Uri.file(path.join(this._extensionUri.fsPath, 'media', 'cytoscape-dagre.js'))).toString();

        const nonce = getNonce();
        const initialProcessesJson = JSON.stringify(this._processes).replace(/</g, '\\u003c');

        return GraphPanel.buildWebviewHtml({
            styleUri,
            cytoscapeUri,
            dagreUri,
            cytoscapeDagreUri,
            scriptUri,
            cspSource: webview.cspSource,
            nonce,
            initialProcessesJson
        });
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
