import * as vscode from 'vscode';
import * as path from 'path';
import { FspSymbolType, ParsedFspSymbol, parseFspSymbolsFromText } from './fspParser';

export { FspSymbolType, ParsedFspSymbol, parseFspSymbolsFromText };

export interface VerificationStatus {
    mode: 'check' | 'progress';
    verdict: 'ok' | 'violation';
    trace: string[];
    timestamp: number;
}

export type FspNodeCategory = 'composites' | 'processes' | 'definitions';

export class FspTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly itemType: 'category' | FspSymbolType | 'empty',
        public readonly symbol?: ParsedFspSymbol,
        public readonly documentUri?: vscode.Uri,
        public readonly verification?: VerificationStatus
    ) {
        super(label, collapsibleState);

        if (itemType === 'category') {
            this.contextValue = 'fspCategory';
        } else if (itemType === 'empty') {
            this.contextValue = 'fspEmpty';
            this.iconPath = new vscode.ThemeIcon('info');
        } else if (symbol && documentUri) {
            this.tooltip = this.buildTooltip(symbol, verification);
            this.description = this.buildDescription(symbol, verification);
            this.iconPath = this.getIcon(symbol, verification);

            // Clicking the item jumps to the line in the editor
            this.command = {
                command: 'fspModern.revealLine',
                title: 'Vai alla definizione',
                arguments: [documentUri, symbol.line]
            };

            if (symbol.kind === 'composite' || symbol.kind === 'process' || symbol.kind === 'property') {
                this.contextValue = 'fspTarget';
            } else {
                this.contextValue = 'fspDefinition';
            }
        }
    }

    private buildDescription(sym: ParsedFspSymbol, ver?: VerificationStatus): string {
        const parts: string[] = [];
        if (sym.detail) {
            parts.push(sym.detail);
        }
        if (ver) {
            const label = ver.mode === 'check' ? 'Safety' : 'Progress';
            parts.push(ver.verdict === 'ok' ? `✓ ${label} OK` : `✗ ${label} Violazione`);
        }
        return parts.join(' • ');
    }

    private buildTooltip(sym: ParsedFspSymbol, ver?: VerificationStatus): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        const kindLabel: Record<FspSymbolType, string> = {
            composite: 'Composizione Concorrente (`||`)',
            process: 'Processo FSP',
            property: 'Proprietà di Safety (`property`)',
            const: 'Costante (`const`)',
            range: 'Intervallo (`range`)',
            set: 'Insieme di Azioni (`set`)'
        };
        md.appendMarkdown(`**${sym.name}** — *${kindLabel[sym.kind]}*\n\n`);
        md.appendMarkdown(`Riga ${sym.line + 1}\n`);
        if (ver) {
            md.appendMarkdown(`\n---\n`);
            const modeStr = ver.mode === 'check' ? 'Safety & Deadlock' : 'Progress';
            if (ver.verdict === 'ok') {
                md.appendMarkdown(`✅ **${modeStr}**: Nessuna violazione rilevata.`);
            } else {
                md.appendMarkdown(`❌ **${modeStr}**: Violazione rilevata!\n\n`);
                if (ver.trace.length > 0) {
                    md.appendMarkdown(`**Traccia:** \`${ver.trace.join(' → ')}\``);
                }
            }
        }
        return md;
    }

    private getIcon(sym: ParsedFspSymbol, ver?: VerificationStatus): vscode.ThemeIcon {
        if (ver) {
            if (ver.verdict === 'ok') {
                return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
            } else {
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
            }
        }
        switch (sym.kind) {
            case 'composite':
                return new vscode.ThemeIcon('symbol-namespace', new vscode.ThemeColor('symbolIcon.namespaceForeground'));
            case 'property':
                return new vscode.ThemeIcon('shield', new vscode.ThemeColor('symbolIcon.booleanForeground'));
            case 'process':
                return new vscode.ThemeIcon('symbol-class', new vscode.ThemeColor('symbolIcon.classForeground'));
            case 'const':
                return new vscode.ThemeIcon('symbol-constant');
            case 'range':
                return new vscode.ThemeIcon('symbol-enum');
            case 'set':
                return new vscode.ThemeIcon('symbol-array');
        }
    }
}

export class FspTreeDataProvider implements vscode.TreeDataProvider<FspTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<FspTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private activeDocument: vscode.TextDocument | undefined;
    // Key: `${docUri}::${targetName}`
    private verificationCache = new Map<string, VerificationStatus>();

    constructor() {
        if (vscode.window.activeTextEditor && this.isFspDoc(vscode.window.activeTextEditor.document)) {
            this.activeDocument = vscode.window.activeTextEditor.document;
        }
    }

    public isFspDoc(doc: vscode.TextDocument | undefined): boolean {
        if (!doc) return false;
        const ext = path.extname(doc.fileName).toLowerCase();
        return doc.languageId === 'fsp' || ext === '.lts' || ext === '.fsp';
    }

    public setActiveDocument(doc: vscode.TextDocument | undefined) {
        if (doc && this.isFspDoc(doc)) {
            this.activeDocument = doc;
            this.refresh();
        } else if (!vscode.window.visibleTextEditors?.some(e => this.isFspDoc(e.document))) {
            this.refresh();
        }
    }

    public getActiveDocument(): vscode.TextDocument | undefined {
        if (vscode.window.activeTextEditor && this.isFspDoc(vscode.window.activeTextEditor.document)) {
            this.activeDocument = vscode.window.activeTextEditor.document;
        }
        return this.activeDocument;
    }

    public recordVerification(docUri: vscode.Uri, target: string, status: VerificationStatus) {
        this.verificationCache.set(`${docUri.toString()}::${target}`, status);
        this.refresh();
    }

    public clearVerificationsForDoc(docUri: vscode.Uri) {
        const prefix = `${docUri.toString()}::`;
        for (const key of this.verificationCache.keys()) {
            if (key.startsWith(prefix)) {
                this.verificationCache.delete(key);
            }
        }
    }

    public refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    public getTreeItem(element: FspTreeItem): vscode.TreeItem {
        return element;
    }

    public getChildren(element?: FspTreeItem): vscode.ProviderResult<FspTreeItem[]> {
        const doc = this.getActiveDocument();
        if (!doc) {
            return [
                new FspTreeItem(
                    'Apri un file .lts o .fsp per iniziare',
                    vscode.TreeItemCollapsibleState.None,
                    'empty'
                )
            ];
        }

        const symbols = FspTreeDataProvider.parseDocumentSymbols(doc);

        if (!element) {
            const composites = symbols.filter(s => s.kind === 'composite');
            const processes = symbols.filter(s => s.kind === 'process' || s.kind === 'property');
            const defs = symbols.filter(s => s.kind === 'const' || s.kind === 'range' || s.kind === 'set');

            const categories: FspTreeItem[] = [];

            const compCat = new FspTreeItem(
                `Composizioni (${composites.length})`,
                vscode.TreeItemCollapsibleState.Expanded,
                'category',
                undefined,
                doc.uri
            );
            compCat.iconPath = new vscode.ThemeIcon('layers');
            compCat.id = 'cat-composites';
            categories.push(compCat);

            const procCat = new FspTreeItem(
                `Processi e Proprietà (${processes.length})`,
                vscode.TreeItemCollapsibleState.Expanded,
                'category',
                undefined,
                doc.uri
            );
            procCat.iconPath = new vscode.ThemeIcon('symbol-structure');
            procCat.id = 'cat-processes';
            categories.push(procCat);

            if (defs.length > 0) {
                const defCat = new FspTreeItem(
                    `Costanti, Range e Set (${defs.length})`,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'category',
                    undefined,
                    doc.uri
                );
                defCat.iconPath = new vscode.ThemeIcon('symbol-Misc');
                defCat.id = 'cat-defs';
                categories.push(defCat);
            }

            return categories;
        }

        if (element.id === 'cat-composites') {
            const composites = symbols.filter(s => s.kind === 'composite');
            if (composites.length === 0) {
                return [new FspTreeItem('Nessuna composizione (||) definita', vscode.TreeItemCollapsibleState.None, 'empty')];
            }
            return composites.map(s => {
                const ver = this.verificationCache.get(`${doc.uri.toString()}::${s.name}`);
                return new FspTreeItem(s.name, vscode.TreeItemCollapsibleState.None, s.kind, s, doc.uri, ver);
            });
        }

        if (element.id === 'cat-processes') {
            const processes = symbols.filter(s => s.kind === 'process' || s.kind === 'property');
            if (processes.length === 0) {
                return [new FspTreeItem('Nessun processo definito', vscode.TreeItemCollapsibleState.None, 'empty')];
            }
            return processes.map(s => {
                const ver = this.verificationCache.get(`${doc.uri.toString()}::${s.name}`);
                return new FspTreeItem(s.name, vscode.TreeItemCollapsibleState.None, s.kind, s, doc.uri, ver);
            });
        }

        if (element.id === 'cat-defs') {
            const defs = symbols.filter(s => s.kind === 'const' || s.kind === 'range' || s.kind === 'set');
            return defs.map(s => new FspTreeItem(s.name, vscode.TreeItemCollapsibleState.None, s.kind, s, doc.uri));
        }

        return [];
    }

    public static parseDocumentSymbols(document: vscode.TextDocument): ParsedFspSymbol[] {
        return parseFspSymbolsFromText(document.getText());
    }
}
