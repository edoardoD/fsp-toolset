import * as vscode from 'vscode';
import * as path from 'path';
import { ltsaJarProvider } from './ltsa/ltsaProvider';
import { LtsaRunner, BridgeMode, BridgeResult, FspTarget } from './ltsa/ltsaRunner';
import { GraphPanel } from './webview/graphPanel';
import { updateDiagnostics } from './diagnostics';
import { FspIntelliSense } from './intellisense';

let diagnosticCollection: vscode.DiagnosticCollection;
let output: vscode.OutputChannel;
const lastTarget = new Map<string, string>();

function isFspDocument(doc: vscode.TextDocument): boolean {
    const ext = path.extname(doc.fileName).toLowerCase();
    return doc.languageId === 'fsp' || ext === '.lts' || ext === '.fsp';
}

async function runBridge(
    context: vscode.ExtensionContext,
    doc: vscode.TextDocument,
    mode: BridgeMode,
    target: string | undefined,
    title: string
): Promise<BridgeResult | undefined> {
    try {
        return await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title, cancellable: true },
            async (_progress, token) => {
                const jarPath = await ltsaJarProvider.getJar(context);
                const runner = new LtsaRunner(jarPath, context.globalStorageUri);
                const result = await runner.run(doc, mode, target, token);
                updateDiagnostics(doc, diagnosticCollection, result.errors);
                return result;
            }
        );
    } catch (err: any) {
        if (err && err.message === 'Cancelled') {
            return undefined;
        }
        output.appendLine(`[error] ${err && err.message ? err.message : err}`);
        vscode.window.showErrorMessage('FSP: ' + (err && err.message ? err.message : String(err)));
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
        vscode.window.showWarningMessage('FSP: no process or composite found in this file.');
        return undefined;
    }
    const composites = targets.filter(t => t.kind === 'composite');
    // A file with one composite (or none and one process) needs no question.
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
    // Put the previously used target first.
    items.sort((a, b) => Number(!!b.picked) - Number(!!a.picked));
    const pick = await vscode.window.showQuickPick(items, { placeHolder, matchOnDescription: true });
    if (!pick) {
        return undefined;
    }
    const name = pick.label.replace(/^\$\([^)]*\)\s*/, '');
    lastTarget.set(doc.uri.toString(), name);
    return name;
}

async function activeFspDocument(): Promise<vscode.TextDocument | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isFspDocument(editor.document)) {
        vscode.window.showErrorMessage('Please open an FSP (.lts or .fsp) file first.');
        return undefined;
    }
    if (editor.document.languageId !== 'fsp') {
        await vscode.languages.setTextDocumentLanguage(editor.document, 'fsp');
    }
    return editor.document;
}

async function checkCommand(context: vscode.ExtensionContext, mode: 'check' | 'progress') {
    const doc = await activeFspDocument();
    if (!doc) { return; }
    const list = await runBridge(context, doc, 'list', undefined, 'Parsing FSP...');
    if (!list || reportErrors(list)) { return; }
    const label = mode === 'check' ? 'Safety / deadlock check' : 'Progress check';
    const target = await pickTarget(doc, list.targets, `${label}: choose a target`);
    if (!target) { return; }
    const res = await runBridge(context, doc, mode, target, `${label} on ${target}...`);
    if (!res || reportErrors(res)) { return; }
    output.appendLine(`=== ${label}: ${target} (${path.basename(doc.fileName)}) ===`);
    output.appendLine(res.log.trimEnd());
    output.appendLine('');
    output.show(true);
    if (res.verdict === 'ok') {
        vscode.window.showInformationMessage(`FSP ${label}: ${target} - no violations.`);
    } else {
        const tr = res.trace.length ? ` Trace: ${res.trace.join(' → ')}` : '';
        vscode.window.showWarningMessage(`FSP ${label}: violation in ${target}.${tr}`);
    }
}

export function activate(context: vscode.ExtensionContext) {
    diagnosticCollection = vscode.languages.createDiagnosticCollection('fsp');
    output = vscode.window.createOutputChannel('FSP');
    context.subscriptions.push(diagnosticCollection, output);

    // Initialize IntelliSense (live error checking, autocompletions, hovers, outline)
    FspIntelliSense.register(context, diagnosticCollection);

    context.subscriptions.push(
        vscode.commands.registerCommand('fspModern.compile', async () => {
            const doc = await activeFspDocument();
            if (!doc) { return; }
            const res = await runBridge(context, doc, 'list', undefined, 'Compiling FSP...');
            if (!res) { return; }
            if (reportErrors(res)) { return; }
            const comps = res.targets.filter(t => t.kind === 'composite').length;
            const procs = res.targets.filter(t => t.kind === 'process').length;
            output.appendLine(`Compilation OK: ${procs} process(es), ${comps} composition(s).`);
            vscode.window.showInformationMessage(`FSP: compilation successful (${procs} processes, ${comps} compositions).`);
        }),

        vscode.commands.registerCommand('fspModern.showGraph', async () => {
            const doc = await activeFspDocument();
            if (!doc) { return; }
            const list = await runBridge(context, doc, 'list', undefined, 'Parsing FSP...');
            if (!list || reportErrors(list)) { return; }
            const target = await pickTarget(doc, list.targets, 'Show graph of...');
            if (!target) { return; }
            const res = await runBridge(context, doc, 'graph', target, `Building LTS of ${target}...`);
            if (!res || reportErrors(res)) { return; }
            if (res.log) {
                output.appendLine(`=== Graph: ${target} ===`);
                output.appendLine(res.log.trimEnd());
            }
            if (res.machines.length === 0) {
                vscode.window.showWarningMessage(`FSP: nothing to draw for ${target}.`);
                return;
            }
            GraphPanel.createOrShow(context.extensionUri, res.machines, target);
        }),

        vscode.commands.registerCommand('fspModern.checkSafety', () => checkCommand(context, 'check')),
        vscode.commands.registerCommand('fspModern.checkProgress', () => checkCommand(context, 'progress')),

        vscode.workspace.onDidCloseTextDocument(d => diagnosticCollection.delete(d.uri))
    );
}

export function deactivate() {}
