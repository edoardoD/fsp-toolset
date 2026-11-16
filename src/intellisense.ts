import * as vscode from 'vscode';
import { updateDiagnostics } from './diagnostics';
import { ltsaJarProvider } from './ltsa/ltsaProvider';
import { LtsaRunner, FspTarget } from './ltsa/ltsaRunner';
import { FspTreeDataProvider } from './sidebar/fspTreeProvider';

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

export type LiveUpdateCallback = (document: vscode.TextDocument, targets: FspTarget[]) => void;

export class FspIntelliSense {
    private static instance: FspIntelliSense;
    private targetsCache = new Map<string, FspTarget[]>();
    private debounceTimers = new Map<string, NodeJS.Timeout>();
    private runner: LtsaRunner | undefined;
    private codeLensEmitter = new vscode.EventEmitter<void>();
    private onLiveUpdate?: LiveUpdateCallback;

    constructor(
        private context: vscode.ExtensionContext,
        private diagnosticCollection: vscode.DiagnosticCollection,
        onLiveUpdate?: LiveUpdateCallback
    ) {
        this.onLiveUpdate = onLiveUpdate;
    }

    public static register(
        context: vscode.ExtensionContext,
        diagnosticCollection: vscode.DiagnosticCollection,
        onLiveUpdate?: LiveUpdateCallback
    ): FspIntelliSense {
        const intellisense = new FspIntelliSense(context, diagnosticCollection, onLiveUpdate);
        this.instance = intellisense;
        intellisense.setupListeners();
        intellisense.setupProviders();
        return intellisense;
    }

    public refreshCodeLens() {
        this.codeLensEmitter.fire();
    }

    private isFsp(document: vscode.TextDocument): boolean {
        const ext = document.fileName.toLowerCase();
        return document.languageId === 'fsp' || ext.endsWith('.lts') || ext.endsWith('.fsp');
    }

    private setupListeners() {
        if (vscode.window.activeTextEditor && this.isFsp(vscode.window.activeTextEditor.document)) {
            this.scheduleLint(vscode.window.activeTextEditor.document, 100);
        }

        this.context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument((doc) => {
                if (this.isFsp(doc)) {
                    this.scheduleLint(doc, 100);
                }
            })
        );

        this.context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument((event) => {
                if (this.isFsp(event.document)) {
                    this.codeLensEmitter.fire();
                    this.scheduleLint(event.document, 450);
                }
            })
        );

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

            updateDiagnostics(document, this.diagnosticCollection, result.errors);

            if (result.targets && result.targets.length > 0) {
                this.targetsCache.set(document.uri.toString(), result.targets);
            }

            if (result.errors.length === 0 && this.onLiveUpdate) {
                this.onLiveUpdate(document, result.targets);
            }
        } catch {
            // Silently ignore background lint errors
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

        // 4. CodeLens Provider (Inline Actions above Processes & Composites)
        this.context.subscriptions.push(
            vscode.languages.registerCodeLensProvider(
                selector,
                {
                    onDidChangeCodeLenses: this.codeLensEmitter.event,
                    provideCodeLenses: (document) => {
                        return this.provideCodeLenses(document);
                    }
                }
            )
        );

        // 5. Go to Definition Provider (Cmd+Click on Processes, Constants, Ranges, Sets)
        this.context.subscriptions.push(
            vscode.languages.registerDefinitionProvider(
                selector,
                {
                    provideDefinition: (document, position) => {
                        return this.provideDefinition(document, position);
                    }
                }
            )
        );
    }

    private provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const enabled = vscode.workspace.getConfiguration('fspModern').get<boolean>('enableCodeLens', true);
        if (!enabled) {
            return [];
        }

        const lenses: vscode.CodeLens[] = [];
        const symbols = FspTreeDataProvider.parseDocumentSymbols(document);

        for (const sym of symbols) {
            if (sym.kind !== 'composite' && sym.kind !== 'process' && sym.kind !== 'property') {
                continue;
            }
            const range = new vscode.Range(sym.line, 0, sym.line, 0);

            // 1. Visualizza Grafo
            lenses.push(
                new vscode.CodeLens(range, {
                    title: '$(graph) Visualizza Grafo',
                    tooltip: `Mostra il grafo interattivo dell'automa ${sym.name}`,
                    command: 'fspModern.showGraphTarget',
                    arguments: [sym.name, document.uri]
                })
            );

            // 2. Simula Passo-Passo
            lenses.push(
                new vscode.CodeLens(range, {
                    title: '$(play) Simula',
                    tooltip: `Avvia il simulatore interattivo passo-passo per ${sym.name}`,
                    command: 'fspModern.simulateTarget',
                    arguments: [sym.name, document.uri]
                })
            );

            // 3. Verifica Safety & Deadlock
            lenses.push(
                new vscode.CodeLens(range, {
                    title: '$(shield) Safety & Deadlock',
                    tooltip: `Verifica proprietà di Safety e assenza di Deadlock su ${sym.name}`,
                    command: 'fspModern.checkSafetyTarget',
                    arguments: [sym.name, document.uri]
                })
            );

            // 4. Verifica Progress
            lenses.push(
                new vscode.CodeLens(range, {
                    title: '$(sync) Progress',
                    tooltip: `Verifica Liveness e Progress su ${sym.name}`,
                    command: 'fspModern.checkProgressTarget',
                    arguments: [sym.name, document.uri]
                })
            );
        }

        return lenses;
    }

    private provideDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.Location | undefined {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) return undefined;
        const word = document.getText(wordRange);

        const symbols = FspTreeDataProvider.parseDocumentSymbols(document);
        const targetSym = symbols.find(s => s.name === word);
        if (targetSym) {
            return new vscode.Location(document.uri, new vscode.Position(targetSym.line, 0));
        }

        // Also check local sub-states inside the file
        const lines = document.getText().split('\n');
        const localRegex = new RegExp(`^\\s*(${word})\\s*(?:\\[[^\\]]*\\])*\\s*=`);
        for (let i = 0; i < lines.length; i++) {
            if (localRegex.test(lines[i])) {
                return new vscode.Location(document.uri, new vscode.Position(i, 0));
            }
        }

        return undefined;
    }

    private provideCompletions(document: vscode.TextDocument, _position: vscode.Position): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];

        for (const [kw, doc] of Object.entries(KEYWORD_DOCS)) {
            const item = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
            item.detail = 'FSP Keyword';
            item.documentation = new vscode.MarkdownString(doc);
            items.push(item);
        }

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
        const parsed = FspTreeDataProvider.parseDocumentSymbols(document);
        const lines = document.getText().split('\n');

        for (const item of parsed) {
            const lineText = lines[item.line] || '';
            const range = new vscode.Range(item.line, 0, item.line, lineText.length);
            let kind = vscode.SymbolKind.Class;
            let detail = 'Process';

            if (item.kind === 'composite') {
                kind = vscode.SymbolKind.Module;
                detail = 'Composite Process (||)';
            } else if (item.kind === 'property') {
                kind = vscode.SymbolKind.Interface;
                detail = 'Safety Property';
            } else if (item.kind === 'const') {
                kind = vscode.SymbolKind.Constant;
                detail = item.detail || 'Constant';
            } else if (item.kind === 'range') {
                kind = vscode.SymbolKind.Enum;
                detail = item.detail || 'Range';
            } else if (item.kind === 'set') {
                kind = vscode.SymbolKind.Array;
                detail = item.detail || 'Action Set';
            }

            symbols.push(new vscode.DocumentSymbol(item.name, detail, kind, range, range));
        }

        return symbols;
    }
}
