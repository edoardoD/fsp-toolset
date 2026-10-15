import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as unzipper from 'unzipper';

class LtsaJarProvider {
    private readonly jarName = 'ltsa.jar';
    private readonly downloadUrl = 'http://www.doc.ic.ac.uk/~jnm/book/ltsa/ltsatool.zip';

    public async getJar(context: vscode.ExtensionContext): Promise<string> {
        // 1. Check user configuration first
        const configPath = vscode.workspace.getConfiguration('fspModern').get<string>('ltsaJarPath');
        if (configPath && fs.existsSync(configPath)) {
            return configPath;
        }

        // 2. Check bundled jar inside extension directory
        const bundledPath = path.join(context.extensionPath, 'lib', this.jarName);
        if (fs.existsSync(bundledPath)) {
            return bundledPath;
        }

        const bundledDistPath = path.join(context.extensionPath, 'dist', this.jarName);
        if (fs.existsSync(bundledDistPath)) {
            return bundledDistPath;
        }

        // 3. Check global storage (cache)
        const storageUri = context.globalStorageUri;
        const storagePath = storageUri.fsPath;
        
        if (!fs.existsSync(storagePath)) {
            fs.mkdirSync(storagePath, { recursive: true });
        }

        const jarPath = path.join(storagePath, this.jarName);
        if (fs.existsSync(jarPath)) {
            return jarPath;
        }

        // 4. Download and extract (fallback)
        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Downloading ltsa.jar (first time setup)...",
            cancellable: false
        }, async (progress) => {
            return new Promise<string>((resolve, reject) => {
                const zipPath = path.join(storagePath, 'LTSA.zip');
                const file = fs.createWriteStream(zipPath);
                
                // use curl via child_process as http.get might have issues with redirects
                const { exec } = require('child_process');
                exec(`curl -sL -o "${zipPath}" "${this.downloadUrl}"`, (error: any) => {
                    if (error) {
                        reject(new Error(`Failed to download LTSA: ${error.message}`));
                        return;
                    }
                    
                    // Extract jar
                    fs.createReadStream(zipPath)
                        .pipe(unzipper.Parse())
                        .on('entry', (entry: any) => {
                            const fileName = entry.path;
                            if (fileName.endsWith('ltsa.jar')) {
                                entry.pipe(fs.createWriteStream(jarPath));
                            } else {
                                entry.autodrain();
                            }
                        })
                        .on('close', () => {
                            fs.unlinkSync(zipPath); // cleanup
                            resolve(jarPath);
                        })
                        .on('error', (err: any) => {
                            reject(err);
                        });
                });
            });
        });
    }
}

export const ltsaJarProvider = new LtsaJarProvider();
