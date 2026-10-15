import * as vscode from 'vscode';
import { updateDiagnostics } from './diagnostics';
import { ltsaJarProvider } from './ltsa/ltsaProvider';
import { LtsaRunner, FspTarget } from './ltsa/ltsaRunner';

const KEYWORD_DOCS: Record<string, string> = {
    'const': '**const identifier = expression**\n\nDefines an integer constant in FSP.',
    'range': '**range RangeName = Low..High**\n\nDefines a contiguous integer range type.',
    'set': '**set SetName = {a, b, c}**\n\nDefines a named set of action labels.',
    'property': '**property P = (action -> P).**\n\nDefines a safety property process. Any transition not allowed by the property transitions into the error state `ERROR`.',
    'minimal': '**minimal ||C = (...)**\n\nApplies trace equivalence minimization during composition.',
    'deterministic': '**deterministic ||C = (...)**\n\nConverts non-deterministic transitions into a deterministic transition system.',
    'when': '**when (condition) action -> PROCESS**\n\nGuards an action transition with a boolean condition.',
    'fluent': '**fluent F = <{start_actions}, {end_actions}> initially bool**\n\nDefines a proposition (fluent) for Linear Temporal Logic (LTL) analysis.',
    'assert': '**assert FormulaName = LTL_Formula**\n\nSpecifies a Linear Temporal Logic assertion to be checked by LTSA.',
    'forall': '**forall [i:Range] ...**\n\nReplicates processes or parallel compositions over a range.',
    'STOP': '**STOP**\n\nPrimitive terminal state with no outgoing transitions (deadlock / completion).',
    'ERROR': '**ERROR**\n\nPrimitive error state (state -1 in LTSA). Safety properties flag violations if this state is reached.'
};

export class FspIntelliSense {
    private static instance: FspIntelliSense;
    private targetsCache = new Map<string, FspTarget[]>();
    private debounceTimers = new Map<string, NodeJS.Timeout>();
    private runner: LtsaRunner | undefined;

    constructor(
        private context: vscode.ExtensionContext,
        private diagnosticCollection: vscode.DiagnosticCollection
    ) {}

    public static register(context: vscode.ExtensionContext, diagnosticCollection: vscode.DiagnosticCollection): FspIntelliSense {
        const intellisense = new FspIntelliSense(context, diagnosticCollection);
        this.instance = intellisense;
        intellisense.setupListeners();
        intellisense.setupProviders();
        return intellisense;
    }

    private isFsp(document: vscode.TextDocument): boolean {
        const ext = document.fileName.toLowerCase();
        return document.languageId === 'fsp' || ext.endsWith('.lts') || ext.endsWith('.fsp');
    }

    private setupListeners() {
        // Run live check on active editor
        if (vscode.window.activeTextEditor && this.isFsp(vscode.window.activeTextEditor.document)) {
            this.scheduleLint(vscode.window.activeTextEditor.document, 100);
        }

        // On document open
        this.context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument((doc) => {
                if (this.isFsp(doc)) {
                    this.scheduleLint(doc, 100);
                }
            })
        );

        // On document change (live typing)
        this.context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument((event) => {
                if (this.isFsp(event.document)) {
                    this.scheduleLint(event.document, 400);
                }
            })
        );

        // On document close: clean up
        this.context.subscriptions.push(
            vscode.workspace.onDidCloseTextDocument((doc) => {
                const uriKey = doc.uri.toString();
                this.targetsCache.delete(uriKey);
                const timer = this.debounceTimers.get(uriKey);
                if (timer) {
                    clearTimeout(timer);
                    this.debounceTimers.delete(uriKey);
                }
                this.diagnosticCollection.delete(doc.uri);
            })
        );
    }

    public scheduleLint(document: vscode.TextDocument, delayMs: number) {
        const uriKey = document.uri.toString();
        const existingTimer = this.debounceTimers.get(uriKey);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        const timer = setTimeout(async () => {
            this.debounceTimers.delete(uriKey);
            await this.performLiveCheck(document);
        }, delayMs);

        this.debounceTimers.set(uriKey, timer);
    }

    private async performLiveCheck(document: vscode.TextDocument) {
        try {
            if (!this.runner) {
                const jarPath = await ltsaJarProvider.getJar(this.context);
                this.runner = new LtsaRunner(jarPath, this.context.globalStorageUri);
            }

            const tokenSource = new vscode.CancellationTokenSource();
            const result = await this.runner.run(document, 'list', undefined, tokenSource.token);

            // Update live diagnostics (red squiggles for errors)
            updateDiagnostics(document, this.diagnosticCollection, result.errors);

            // Update target symbol cache for autocompletion
            if (result.targets && result.targets.length > 0) {
                this.targetsCache.set(document.uri.toString(), result.targets);
            }
        } catch {
            // Silently ignore background lint errors (e.g. while java is starting)
        }
    }

    private setupProviders() {
        const selector: vscode.DocumentSelector = [
            { language: 'fsp' },
            { pattern: '**/*.lts' },
            { pattern: '**/*.fsp' }
        ];

        // 1. Completion Provider
        this.context.subscriptions.push(
            vscode.languages.registerCompletionItemProvider(
                selector,
                {
                    provideCompletionItems: (document, position) => {
                        return this.provideCompletions(document, position);
                    }
                },
                '.', ':', '=', '|', '-'
            )
        );

        // 2. Hover Provider
        this.context.subscriptions.push(
            vscode.languages.registerHoverProvider(
                selector,
                {
                    provideHover: (document, position) => {
                        return this.provideHover(document, position);
                    }
                }
            )
        );

        // 3. Document Symbols (Outline / Go to Symbol)
        this.context.subscriptions.push(
            vscode.languages.registerDocumentSymbolProvider(
                selector,
                {
                    provideDocumentSymbols: (document) => {
                        return this.provideDocumentSymbols(document);
                    }
                }
            )
        );
    }

    private provideCompletions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];

        // Keywords
        for (const [kw, doc] of Object.entries(KEYWORD_DOCS)) {
            const item = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
            item.detail = 'FSP Keyword';
            item.documentation = new vscode.MarkdownString(doc);
            items.push(item);
        }

        // Cached targets (processes & composites)
        const cached = this.targetsCache.get(document.uri.toString()) || [];
        for (const target of cached) {
            const isComp = target.kind === 'composite';
            const item = new vscode.CompletionItem(
                target.name,
                isComp ? vscode.CompletionItemKind.Module : vscode.CompletionItemKind.Class
            );
            item.detail = isComp ? `Composite Process ||${target.name}` : `Process ${target.name}`;
            items.push(item);
        }

        // Snippets
        const procSnippet = new vscode.CompletionItem('proc', vscode.CompletionItemKind.Snippet);
        procSnippet.detail = 'Process Definition';
        procSnippet.insertText = new vscode.SnippetString('${1:NAME} = (${2:action} -> ${1:NAME}).');
        items.push(procSnippet);

        const compSnippet = new vscode.CompletionItem('comp', vscode.CompletionItemKind.Snippet);
        compSnippet.detail = 'Parallel Composition';
        compSnippet.insertText = new vscode.SnippetString('||${1:SYSTEM} = (${2:P1} || ${3:P2}).');
        items.push(compSnippet);

        const choiceSnippet = new vscode.CompletionItem('choice', vscode.CompletionItemKind.Snippet);
        choiceSnippet.detail = 'Action Choice (|)';
        choiceSnippet.insertText = new vscode.SnippetString('(${1:action1} -> ${2:STATE1} | ${3:action2} -> ${4:STATE2})');
        items.push(choiceSnippet);

        const whenSnippet = new vscode.CompletionItem('when', vscode.CompletionItemKind.Snippet);
        whenSnippet.detail = 'Guarded Transition (when)';
        whenSnippet.insertText = new vscode.SnippetString('when (${1:cond}) ${2:action} -> ${3:PROCESS}');
        items.push(whenSnippet);

        const propSnippet = new vscode.CompletionItem('prop', vscode.CompletionItemKind.Snippet);
        propSnippet.detail = 'Safety Property';
        propSnippet.insertText = new vscode.SnippetString('property ${1:SAFE} = (${2:action} -> ${1:SAFE}).');
        items.push(propSnippet);

        return items;
    }

    private provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) return undefined;
        const word = document.getText(wordRange);

        if (KEYWORD_DOCS[word]) {
            return new vscode.Hover(new vscode.MarkdownString(KEYWORD_DOCS[word]));
        }

        // Check if word is a defined process or constant in the file
        const text = document.getText();
        const procRegex = new RegExp(`^\\s*(\\|\\|)?\\s*(${word})\\s*(\\[[^\\]]*\\])*\\s*=`, 'm');
        const match = text.match(procRegex);
        if (match) {
            const isComp = !!match[1];
            const typeStr = isComp ? 'Composite Process' : 'Process';
            const md = new vscode.MarkdownString();
            md.appendCodeblock(`${isComp ? '||' : ''}${word}`, 'fsp');
            md.appendMarkdown(`*FSP ${typeStr} defined in current file.*`);
            return new vscode.Hover(md);
        }

        const constRegex = new RegExp(`^\\s*const\\s+(${word})\\s*=\\s*([^\\n\\r]+)`, 'm');
        const constMatch = text.match(constRegex);
        if (constMatch) {
            const md = new vscode.MarkdownString();
            md.appendCodeblock(`const ${word} = ${constMatch[2].trim()}`, 'fsp');
            md.appendMarkdown(`*FSP Constant*`);
            return new vscode.Hover(md);
        }

        return undefined;
    }

    private provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
        const symbols: vscode.DocumentSymbol[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Match Composite: ||NAME =
            const compMatch = line.match(/^\s*\|\|\s*([A-Za-z0-9_]+)/);
            if (compMatch) {
                const name = compMatch[1];
                const range = new vscode.Range(i, 0, i, line.length);
                const sym = new vscode.DocumentSymbol(
                    name,
                    'Composite Process',
                    vscode.SymbolKind.Module,
                    range,
                    range
                );
                symbols.push(sym);
                continue;
            }

            // Match Process: NAME = or NAME[i] =
            const procMatch = line.match(/^\s*([A-Z][A-Za-z0-9_]*)\s*(\[[^\]]*\])*\s*=/);
            if (procMatch && !line.trim().startsWith('//') && !line.trim().startsWith('/*')) {
                const name = procMatch[1];
                const range = new vscode.Range(i, 0, i, line.length);
                const sym = new vscode.DocumentSymbol(
                    name,
                    'Process',
                    vscode.SymbolKind.Class,
                    range,
                    range
                );
                symbols.push(sym);
                continue;
            }

            // Match Constants: const NAME =
            const constMatch = line.match(/^\s*const\s+([A-Za-z0-9_]+)\s*=\s*(.*)/);
            if (constMatch) {
                const name = constMatch[1];
                const range = new vscode.Range(i, 0, i, line.length);
                const sym = new vscode.DocumentSymbol(
                    name,
                    `= ${constMatch[2].trim()}`,
                    vscode.SymbolKind.Constant,
                    range,
                    range
                );
                symbols.push(sym);
                continue;
            }

            // Match Ranges: range NAME =
            const rangeMatch = line.match(/^\s*range\s+([A-Za-z0-9_]+)\s*=\s*(.*)/);
            if (rangeMatch) {
                const name = rangeMatch[1];
                const range = new vscode.Range(i, 0, i, line.length);
                const sym = new vscode.DocumentSymbol(
                    name,
                    `= ${rangeMatch[2].trim()}`,
                    vscode.SymbolKind.Enum,
                    range,
                    range
                );
                symbols.push(sym);
                continue;
            }
        }

        return symbols;
    }
}
