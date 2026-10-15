import * as vscode from 'vscode';
import * as path from 'path';
import { FspProcess } from '../ltsa/ltsaRunner';

export class GraphPanel {
    public static currentPanel: GraphPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _processes: FspProcess[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._panel.onDidDispose(() => this.dispose(), null);

        this._panel.webview.onDidReceiveMessage(message => {
            if (message.command === 'ready') {
                this._panel.webview.postMessage({
                    command: 'loadProcesses',
                    processes: this._processes
                });
            }
        });
    }

    public static createOrShow(extensionUri: vscode.Uri, processes: FspProcess[], title?: string) {
        const column = vscode.window.activeTextEditor
            ? vscode.ViewColumn.Beside
            : vscode.ViewColumn.One;

        if (GraphPanel.currentPanel) {
            GraphPanel.currentPanel._panel.reveal(column);
            GraphPanel.currentPanel._panel.title = title ? `FSP Graph: ${title}` : 'FSP Graph';
            GraphPanel.currentPanel.updateProcesses(processes);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'fspGraph',
            title ? `FSP Graph: ${title}` : 'FSP Graph',
            column,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.file(path.join(extensionUri.fsPath, 'media'))],
                retainContextWhenHidden: true
            }
        );

        GraphPanel.currentPanel = new GraphPanel(panel, extensionUri);
        GraphPanel.currentPanel.updateProcesses(processes);
    }

    public updateProcesses(processes: FspProcess[]) {
        this._processes = processes;
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
        
        // Also send message in case webview is already running
        this._panel.webview.postMessage({
            command: 'loadProcesses',
            processes: this._processes
        });
    }

    public dispose() {
        GraphPanel.currentPanel = undefined;
        this._panel.dispose();
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(this._extensionUri.fsPath, 'media', 'graph.js')));
        const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(this._extensionUri.fsPath, 'media', 'graph.css')));
        const cytoscapeUri = webview.asWebviewUri(vscode.Uri.file(path.join(this._extensionUri.fsPath, 'media', 'cytoscape.min.js')));
        const dagreUri = webview.asWebviewUri(vscode.Uri.file(path.join(this._extensionUri.fsPath, 'media', 'dagre.min.js')));
        const cytoscapeDagreUri = webview.asWebviewUri(vscode.Uri.file(path.join(this._extensionUri.fsPath, 'media', 'cytoscape-dagre.js')));

        const nonce = getNonce();
        const processesJson = JSON.stringify(this._processes).replace(/</g, '\\u003c');

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>FSP Graph</title>
            <link href="${styleUri}" rel="stylesheet">
        </head>
        <body>
            <div id="toolbar">
                <div class="toolbar-group">
                    <span class="toolbar-label">Process:</span>
                    <select id="processSelect"></select>
                </div>
                <div class="toolbar-group">
                    <span class="toolbar-label">Layout:</span>
                    <select id="layoutSelect">
                        <option value="dagre-lr">Orizzontale (Left → Right)</option>
                        <option value="dagre-tb">Verticale (Top → Bottom)</option>
                        <option value="breadthfirst">Gerarchico ad Albero</option>
                        <option value="concentric">Concentrico</option>
                        <option value="cose">Organico (Force-Directed)</option>
                    </select>
                </div>
                <div class="toolbar-group">
                    <button id="btnFit" title="Centra la vista sul grafo">🎯 Centra</button>
                    <button id="btnZoomIn" title="Ingrandisci (Zoom in)">+</button>
                    <button id="btnZoomOut" title="Rimpicciolisci (Zoom out)">−</button>
                </div>
                <span id="stateCount"></span>
            </div>
            <div id="cy"></div>

            <script nonce="${nonce}">
                window.__INITIAL_PROCESSES__ = ${processesJson};
            </script>
            <script nonce="${nonce}" src="${cytoscapeUri}"></script>
            <script nonce="${nonce}" src="${dagreUri}"></script>
            <script nonce="${nonce}" src="${cytoscapeDagreUri}"></script>
            <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
        </html>`;
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
