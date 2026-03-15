import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { transformProject } from './transformer.js';
import { mapTscErrors } from './errorMapper.js';

const execAsync = promisify(exec);

export function activate(context: vscode.ExtensionContext) {
    const typecheck = vscode.commands.registerCommand('typesast.typecheck', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        // Create temporary directories
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'typesast-'));
        const sourceCopyDir = path.join(tmpDir, 'src');
        const outDir = path.join(tmpDir, 'out');
        await fs.mkdir(sourceCopyDir, { recursive: true });
        await fs.mkdir(outDir, { recursive: true });

        // Copy all TypeScript files from workspace to sourceCopyDir
        const tsFiles = await vscode.workspace.findFiles('**/*.ts', '**/node_modules/**');
        for (const file of tsFiles) {
            const relative = path.relative(workspaceRoot, file.fsPath);
            const target = path.join(sourceCopyDir, relative);
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.copyFile(file.fsPath, target);
        }

        // Transform the copied files, writing annotated files + maps to outDir
        await transformProject(sourceCopyDir, outDir);

        // Run tsc on the transformed files
        const diagnosticCollection = vscode.languages.createDiagnosticCollection('typesast');
        diagnosticCollection.clear();

        try {
            await execAsync('npx tsc --noEmit', { cwd: outDir });
            vscode.window.showInformationMessage('No type errors found.');
        } catch (error: any) {
            if (error.stderr) {
                const mappedErrors = await mapTscErrors(error.stderr, sourceCopyDir, outDir);
                // Group errors by original workspace file
                const diagMap = new Map<string, vscode.Diagnostic[]>();
                for (const err of mappedErrors) {
                    const workspacePath = path.join(workspaceRoot, err.originalFile);
                    const uri = vscode.Uri.file(workspacePath);
                    const range = new vscode.Range(
                        err.line - 1, err.column - 1,
                        err.line - 1, err.column - 1
                    );
                    const diag = new vscode.Diagnostic(range, err.message, vscode.DiagnosticSeverity.Error);
                    if (!diagMap.has(uri.toString())) {
                        diagMap.set(uri.toString(), []);
                    }
                    diagMap.get(uri.toString())!.push(diag);
                }
                // Set diagnostics for each file
                for (const [uriStr, diags] of diagMap) {
                    diagnosticCollection.set(vscode.Uri.parse(uriStr), diags);
                }
            } else {
                vscode.window.showErrorMessage(`Type check failed: ${error.message}`);
            }
        } finally {
            // Clean up temp directory (optional)
            // await fs.rm(tmpDir, { recursive: true, force: true });
        }
    });

    context.subscriptions.push(typecheck);
}

export function deactivate() {}