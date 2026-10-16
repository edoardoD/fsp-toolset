import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { getJavaExecutable } from '../java/javaLocator';

export interface CompilationError {
    line: number;
    col: number;
    message: string;
}

export interface FspProcess {
    name: string;
    states: number;
    transitions: { from: number; to: number; label: string }[];
    truncated?: boolean;
    stateNames?: { [id: string]: string };
}

export interface FspTarget {
    name: string;
    kind: 'composite' | 'process';
}

export type BridgeMode = 'list' | 'graph' | 'check' | 'progress';

export interface BridgeResult {
    errors: CompilationError[];
    targets: FspTarget[];
    machines: FspProcess[];
    verdict: string;
    trace: string[];
    log: string;
}

export class LtsaRunner {
    constructor(
        private jarPath: string,
        private globalStorageUri: vscode.Uri
    ) {}

    public async run(
        document: vscode.TextDocument,
        mode: BridgeMode,
        target: string | undefined,
        token: vscode.CancellationToken
    ): Promise<BridgeResult> {
        let filePath = document.uri.fsPath;
        let tempPath: string | undefined;

        // Unsaved / untitled buffers are analysed through a temp copy in the extension's
        // global storage, so it also works with no workspace folder open.
        if (document.isDirty || document.isUntitled) {
            const storagePath = this.globalStorageUri.fsPath;
            fs.mkdirSync(storagePath, { recursive: true });
            tempPath = path.join(storagePath, `buffer-${Date.now()}.lts`);
            fs.writeFileSync(tempPath, document.getText(), 'utf8');
            filePath = tempPath;
        }

        const cleanup = () => {
            if (tempPath && fs.existsSync(tempPath)) {
                try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
            }
        };

        try {
            const javaExe = await getJavaExecutable();
            let bridgeDir = __dirname;
            if (!fs.existsSync(path.join(bridgeDir, 'FspBridge.class'))) {
                bridgeDir = path.join(__dirname, '..', 'src', 'java');
            }
            const classPath = `${this.jarPath}${path.delimiter}${bridgeDir}`;
            const args = ['-Djava.awt.headless=true', '-Xss16m', '-cp', classPath, 'FspBridge', mode, filePath];
            if (target) {
                args.push(target);
            }

            return await new Promise<BridgeResult>((resolve, reject) => {
                const child = execFile(
                    javaExe,
                    args,
                    { timeout: 120000, maxBuffer: 128 * 1024 * 1024, encoding: 'utf8' },
                    (error, stdout, stderr) => {
                        cleanup();
                        if (token.isCancellationRequested) {
                            reject(new Error('Cancelled'));
                            return;
                        }
                        if (!stdout || stdout.trim() === '') {
                            const why = (error && error.killed) ? 'timed out (state space too large?)' : (stderr || (error && error.message) || 'no output');
                            reject(new Error(`LTSA bridge failed: ${why}`));
                            return;
                        }
                        try {
                            const r = JSON.parse(stdout);
                            resolve({
                                errors: r.errors || [],
                                targets: r.targets || [],
                                machines: r.machines || [],
                                verdict: r.verdict || '',
                                trace: r.trace || [],
                                log: r.log || ''
                            });
                        } catch {
                            reject(new Error(`Cannot parse bridge output: ${stdout.substring(0, 300)}`));
                        }
                    }
                );
                token.onCancellationRequested(() => child.kill());
            });
        } catch (err) {
            cleanup();
            throw err;
        }
    }
}
