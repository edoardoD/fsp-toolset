import * as vscode from 'vscode';
import * as path from 'path';

// Use require for find-java-home as it doesn't have default exports correctly configured sometimes
const findJavaHome = require('find-java-home');

let cachedJavaPath: string | undefined;

export function getJavaExecutable(): Promise<string> {
    if (cachedJavaPath) {
        return Promise.resolve(cachedJavaPath);
    }

    return new Promise((resolve, reject) => {
        findJavaHome({ allowJre: true }, (err: any, home: string) => {
            if (err || !home) {
                // Return an error guiding the user to install Java
                reject(new Error("Java Runtime not found. Please install Java (e.g. Adoptium JRE) and try again."));
                return;
            }
            
            // On Windows, the executable is java.exe, on others it's java
            const isWin = process.platform === 'win32';
            const javaExe = isWin ? 'java.exe' : 'java';
            cachedJavaPath = path.join(home, 'bin', javaExe);
            resolve(cachedJavaPath);
        });
    });
}
