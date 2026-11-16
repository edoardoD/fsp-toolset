import * as vscode from 'vscode';
import * as path from 'path';
import { ltsaJarProvider } from './ltsa/ltsaProvider';
import { LtsaRunner, BridgeMode, BridgeResult, FspTarget } from './ltsa/ltsaRunner';
import { GraphPanel, GraphPanelCallbacks } from './webview/graphPanel';
import { updateDiagnostics } from './diagnostics';
import { FspIntelliSense } from './intellisense';
import { FspTreeDataProvider, FspTreeItem } from './sidebar/fspTreeProvider';

let diagnosticCollection: vscode.DiagnosticCollection;
let output: vscode.OutputChannel;
let treeProvider: FspTreeDataProvider;
const lastTarget = new Map<string, string>();
let liveUpdateInProgress = false;

function isFspDocument(doc: vscode.TextDocument): boolean {
    const ext = path.extname(doc.fileName).toLowerCase();
    return doc.languageId === 'fsp' || ext === '.lts' || ext === '.fsp';
}

async function runBridge(
    context: vscode.ExtensionContext,
    doc: vscode.TextDocument,
    mode: BridgeMode,
    target: string | undefined,
    title: string,
    silent = false
): Promise<BridgeResult | undefined> {
    const execute = async (token: vscode.CancellationToken) => {
        const jarPath = await ltsaJarProvider.getJar(context);
        const runner = new LtsaRunner(jarPath, context.globalStorageUri);
        const result = await runner.run(doc, mode, target, token);
        updateDiagnostics(doc, diagnosticCollection, result.errors);
        return result;
    };

    try {
        if (silent) {
            const cts = new vscode.CancellationTokenSource();
            return await execute(cts.token);
        }
        return await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title, cancellable: true },
            async (_progress, token) => execute(token)
        );
    } catch (err: any) {
        if (err && err.message === 'Cancelled') {
            return undefined;
        }
        if (!silent) {
            output.appendLine(`[error] ${err && err.message ? err.message : err}`);
            vscode.window.showErrorMessage('FSP: ' + (err && err.message ? err.message : String(err)));
        }
        return undefined;
    }
}

function reportErrors(result: BridgeResult): boolean {
    if (result.errors.length === 0) {
        return false;
    }
    output.appendLine(`--- ${result.errors.length} error(s) ---`);
    for (const e of result.errors) {
        output.appendLine(`  line ${e.line}:${e.col}  ${e.message}`);
    }
    output.show(true);
    vscode.window.showErrorMessage(`FSP: ${result.errors.length} error(s) found. See Problems / Output.`);
    return true;
}

/** Ask which composite/process to analyse; composites first, remembering the last choice. */
async function pickTarget(doc: vscode.TextDocument, targets: FspTarget[], placeHolder: string): Promise<string | undefined> {
    if (targets.length === 0) {
        vscode.window.showWarningMessage('FSP: nessun processo o composizione trovato nel file.');
        return undefined;
    }
    const composites = targets.filter(t => t.kind === 'composite');
    if (composites.length === 1 && targets.length === 1) {
        return composites[0].name;
    }
    if (composites.length === 0 && targets.length === 1) {
        return targets[0].name;
    }
    const last = lastTarget.get(doc.uri.toString());
    const items: vscode.QuickPickItem[] = [];
    const ordered = [...composites, ...targets.filter(t => t.kind === 'process')];
    for (const t of ordered) {
        items.push({
            label: (t.kind === 'composite' ? '$(symbol-namespace) ' : '$(symbol-method) ') + t.name,
            description: t.kind === 'composite' ? 'composition (||)' : 'process',
            picked: t.name === last
        });
    }
    items.sort((a, b) => Number(!!b.picked) - Number(!!a.picked));
    const pick = await vscode.window.showQuickPick(items, { placeHolder, matchOnDescription: true });
    if (!pick) {
        return undefined;
    }
    const name = pick.label.replace(/^\$\([^)]*\)\s*/, '');
    lastTarget.set(doc.uri.toString(), name);
    return name;
}

async function resolveFspDocument(uriArg?: vscode.Uri): Promise<vscode.TextDocument | undefined> {
    if (uriArg) {
        const openDoc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uriArg.toString());
        if (openDoc) return openDoc;
        try {
            return await vscode.workspace.openTextDocument(uriArg);
        } catch {
            // fallback to active editor
        }
    }
    const editor = vscode.window.activeTextEditor;
    if (editor && isFspDocument(editor.document)) {
        if (editor.document.languageId !== 'fsp') {
            await vscode.languages.setTextDocumentLanguage(editor.document, 'fsp');
        }
        return editor.document;
    }
    const treeDoc = treeProvider?.getActiveDocument();
    if (treeDoc) {
        return treeDoc;
    }
    vscode.window.showErrorMessage('Apri prima un file FSP (.lts o .fsp).');
    return undefined;
}

function extractTargetAndUri(arg1?: string | FspTreeItem, arg2?: vscode.Uri): { target?: string; uri?: vscode.Uri } {
    if (!arg1) {
        return { target: undefined, uri: arg2 };
    }
    if (typeof arg1 === 'string') {
        return { target: arg1, uri: arg2 };
    }
    if (arg1 instanceof FspTreeItem && arg1.symbol) {
        return { target: arg1.symbol.name, uri: arg1.documentUri };
    }
    return { target: undefined, uri: arg2 };
}

export function activate(context: vscode.ExtensionContext) {
    diagnosticCollection = vscode.languages.createDiagnosticCollection('fsp');
    output = vscode.window.createOutputChannel('FSP');
    treeProvider = new FspTreeDataProvider();

    const treeView = vscode.window.createTreeView('fspExplorer', {
        treeDataProvider: treeProvider,
        showCollapseAll: true
    });

    context.subscriptions.push(diagnosticCollection, output, treeView);

    const getGraphCallbacks = (doc: vscode.TextDocument): GraphPanelCallbacks => ({
        onSelectTarget: async (newTarget: string) => {
            lastTarget.set(doc.uri.toString(), newTarget);
            await openGraphForTarget(context, doc, newTarget, false, true);
        },
        onRunCheck: async (mode: 'check' | 'progress', targetName: string) => {
            await executeCheckOnTarget(context, doc, mode, targetName, true);
        }
    });

    async function openGraphForTarget(
        ctx: vscode.ExtensionContext,
        doc: vscode.TextDocument,
        targetName?: string,
        startSim = false,
        preserveFocus = false
    ) {
        const list = await runBridge(ctx, doc, 'list', undefined, 'Parsing FSP...', preserveFocus);
        if (!list || reportErrors(list)) { return; }

        const target = targetName || await pickTarget(doc, list.targets, 'Mostra grafo di...');
        if (!target) { return; }

        lastTarget.set(doc.uri.toString(), target);
        const res = await runBridge(ctx, doc, 'graph', target, `Costruzione automa ${target}...`, preserveFocus);
        if (!res || reportErrors(res)) { return; }

        if (res.log) {
            output.appendLine(`=== Graph: ${target} ===`);
            output.appendLine(res.log.trimEnd());
        }
        if (res.machines.length === 0) {
            vscode.window.showWarningMessage(`FSP: nessun automa generabile per ${target}.`);
            return;
        }

        const panel = GraphPanel.createOrShow(
            ctx.extensionUri,
            res.machines,
            target,
            list.targets,
            doc.uri,
            getGraphCallbacks(doc),
            preserveFocus
        );

        if (startSim) {
            panel.startSimulation();
        }
    }

    async function executeCheckOnTarget(
        ctx: vscode.ExtensionContext,
        doc: vscode.TextDocument,
        mode: 'check' | 'progress',
        targetName?: string,
        alwaysShowInGraph = false
    ) {
        const list = await runBridge(ctx, doc, 'list', undefined, 'Parsing FSP...');
        if (!list || reportErrors(list)) { return; }

        const label = mode === 'check' ? 'Safety & Deadlock' : 'Progress';
        const target = targetName || await pickTarget(doc, list.targets, `${label}: scegli target`);
        if (!target) { return; }

        lastTarget.set(doc.uri.toString(), target);
        const res = await runBridge(ctx, doc, mode, target, `Verifica ${label} su ${target}...`);
        if (!res || reportErrors(res)) { return; }

        const verdictNorm: 'ok' | 'violation' = res.verdict === 'ok' ? 'ok' : 'violation';
        treeProvider.recordVerification(doc.uri, target, {
            mode,
            verdict: verdictNorm,
            trace: res.trace,
            timestamp: Date.now()
        });

        output.appendLine(`=== ${label}: ${target} (${path.basename(doc.fileName)}) ===`);
        output.appendLine(res.log.trimEnd());
        output.appendLine('');

        // If violation found OR GraphPanel is already open OR requested from Graph/CodeLens, show & highlight on graph
        const shouldOpenGraph = verdictNorm === 'violation' || alwaysShowInGraph || !!GraphPanel.currentPanel;
        if (shouldOpenGraph) {
            const graphRes = await runBridge(ctx, doc, 'graph', target, `Caricamento grafo ${target}...`, true);
            if (graphRes && graphRes.machines.length > 0) {
                const panel = GraphPanel.createOrShow(
                    ctx.extensionUri,
                    graphRes.machines,
                    target,
                    list.targets,
                    doc.uri,
                    getGraphCallbacks(doc),
                    true
                );
                panel.highlightTrace({
                    trace: res.trace,
                    verdict: verdictNorm,
                    mode,
                    target
                });
            }
        }

        if (verdictNorm === 'ok') {
            vscode.window.showInformationMessage(`✅ FSP ${label} (${target}): nessuna violazione rilevata.`);
        } else {
            output.show(true);
            const tr = res.trace.length ? ` Traccia: ${res.trace.join(' → ')}` : '';
            vscode.window.showWarningMessage(`❌ FSP ${label}: violazione in ${target}.${tr}`);
        }
    }

    // Handle Live Sync when user edits FSP code
    async function handleLiveDocumentUpdate(doc: vscode.TextDocument, targets: FspTarget[]) {
        treeProvider.setActiveDocument(doc);

        const panel = GraphPanel.currentPanel;
        if (!panel || !panel.isLiveSyncEnabled || liveUpdateInProgress) {
            return;
        }
        if (targets.length === 0) {
            return;
        }

        // Determine target to refresh
        let targetToRefresh = panel.activeTarget || lastTarget.get(doc.uri.toString());
        if (!targetToRefresh || !targets.some(t => t.name === targetToRefresh)) {
            const composites = targets.filter(t => t.kind === 'composite');
            targetToRefresh = composites.length > 0 ? composites[0].name : targets[0].name;
        }

        liveUpdateInProgress = true;
        try {
            const res = await runBridge(context, doc, 'graph', targetToRefresh, '', true);
            if (res && res.errors.length === 0 && res.machines.length > 0 && GraphPanel.currentPanel) {
                GraphPanel.currentPanel.setActiveDocUri(doc.uri);
                GraphPanel.currentPanel.updateProcesses(res.machines, targets, targetToRefresh, true);
            }
        } finally {
            liveUpdateInProgress = false;
        }
    }

    // Initialize IntelliSense (live error checking, CodeLens, Go-to-Definition, Autocomplete, Hover, Outline)
    FspIntelliSense.register(context, diagnosticCollection, handleLiveDocumentUpdate);

    // Track active editor changes for Sidebar Explorer
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && isFspDocument(editor.document)) {
                treeProvider.setActiveDocument(editor.document);
            }
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            if (isFspDocument(event.document)) {
                treeProvider.clearVerificationsForDoc(event.document.uri);
                treeProvider.refresh();
            }
        })
    );

    // Register Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('fspModern.compile', async () => {
            const doc = await resolveFspDocument();
            if (!doc) { return; }
            const res = await runBridge(context, doc, 'list', undefined, 'Compilazione FSP...');
            if (!res) { return; }
            if (reportErrors(res)) { return; }
            treeProvider.refresh();
            const comps = res.targets.filter(t => t.kind === 'composite').length;
            const procs = res.targets.filter(t => t.kind === 'process').length;
            output.appendLine(`Compilation OK: ${procs} process(es), ${comps} composition(s).`);
            vscode.window.showInformationMessage(`FSP: compilazione completata (${procs} processi, ${comps} composizioni).`);
        }),

        vscode.commands.registerCommand('fspModern.showGraph', async (arg1?: string | FspTreeItem, arg2?: vscode.Uri) => {
            const { target, uri } = extractTargetAndUri(arg1, arg2);
            const doc = await resolveFspDocument(uri);
            if (!doc) { return; }
            await openGraphForTarget(context, doc, target, false, false);
        }),

        vscode.commands.registerCommand('fspModern.showGraphTarget', async (arg1?: string | FspTreeItem, arg2?: vscode.Uri) => {
            const { target, uri } = extractTargetAndUri(arg1, arg2);
            const doc = await resolveFspDocument(uri);
            if (!doc) { return; }
            await openGraphForTarget(context, doc, target, false, false);
        }),

        vscode.commands.registerCommand('fspModern.simulateTarget', async (arg1?: string | FspTreeItem, arg2?: vscode.Uri) => {
            const { target, uri } = extractTargetAndUri(arg1, arg2);
            const doc = await resolveFspDocument(uri);
            if (!doc) { return; }
            await openGraphForTarget(context, doc, target, true, false);
        }),

        vscode.commands.registerCommand('fspModern.checkSafety', async (arg1?: string | FspTreeItem, arg2?: vscode.Uri) => {
            const { target, uri } = extractTargetAndUri(arg1, arg2);
            const doc = await resolveFspDocument(uri);
            if (!doc) { return; }
            await executeCheckOnTarget(context, doc, 'check', target, false);
        }),

        vscode.commands.registerCommand('fspModern.checkSafetyTarget', async (arg1?: string | FspTreeItem, arg2?: vscode.Uri) => {
            const { target, uri } = extractTargetAndUri(arg1, arg2);
            const doc = await resolveFspDocument(uri);
            if (!doc) { return; }
            await executeCheckOnTarget(context, doc, 'check', target, true);
        }),

        vscode.commands.registerCommand('fspModern.checkProgress', async (arg1?: string | FspTreeItem, arg2?: vscode.Uri) => {
            const { target, uri } = extractTargetAndUri(arg1, arg2);
            const doc = await resolveFspDocument(uri);
            if (!doc) { return; }
            await executeCheckOnTarget(context, doc, 'progress', target, false);
        }),

        vscode.commands.registerCommand('fspModern.checkProgressTarget', async (arg1?: string | FspTreeItem, arg2?: vscode.Uri) => {
            const { target, uri } = extractTargetAndUri(arg1, arg2);
            const doc = await resolveFspDocument(uri);
            if (!doc) { return; }
            await executeCheckOnTarget(context, doc, 'progress', target, true);
        }),

        vscode.commands.registerCommand('fspModern.revealLine', async (uri: vscode.Uri, line: number) => {
            const doc = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
            const pos = new vscode.Position(line, 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }),

        vscode.commands.registerCommand('fspModern.refreshExplorer', () => {
            treeProvider.refresh();
        }),

        vscode.workspace.onDidCloseTextDocument(d => diagnosticCollection.delete(d.uri))
    );
}

export function deactivate() {}
