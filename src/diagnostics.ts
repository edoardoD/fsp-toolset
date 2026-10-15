import * as vscode from 'vscode';
import { CompilationError } from './ltsa/ltsaRunner';

export function updateDiagnostics(document: vscode.TextDocument, collection: vscode.DiagnosticCollection, errors: CompilationError[]): void {
    const diagnostics: vscode.Diagnostic[] = [];

    for (const error of errors) {
        // LTSA lines are 1-based, columns are sometimes available
        const line = Math.min(Math.max(0, (error.line || 1) - 1), Math.max(0, document.lineCount - 1));
        
        let range: vscode.Range;
        if (error.col && error.col > 0) {
            const lineEnd = document.lineAt(line).range.end.character;
            const startCol = Math.min(error.col - 1, lineEnd);
            range = new vscode.Range(line, startCol, line, Math.max(startCol + 1, lineEnd));
        } else {
            // Highlight the whole line if column is unknown
            const textLine = document.lineAt(line);
            range = textLine.range;
        }

        const diagnostic = new vscode.Diagnostic(range, error.message, vscode.DiagnosticSeverity.Error);
        diagnostic.source = 'FSP Compiler';
        diagnostics.push(diagnostic);
    }

    collection.set(document.uri, diagnostics);
}
