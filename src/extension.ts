import { ExtensionContext, Diagnostic, Range, DiagnosticSeverity, Uri, commands, workspace, window, languages } from "vscode";
import * as ts from "typescript";
import { mkdtemp, cp } from "fs/promises";
import { join, relative } from "path";
import { tmpdir } from "os";

export function activate(ctx: ExtensionContext) {
	let col = languages.createDiagnosticCollection("ts-check");
	ctx.subscriptions.push(col, commands.registerCommand("typesast.check", async () => {
		if (!workspace.workspaceFolders) {
			window.showErrorMessage("No workspace folder bozo");
			return;
		}
		for (const folder of workspace.workspaceFolders) {
			const staging = await mkdtemp(join(tmpdir(), 'typesast-'));
			col.clear();

			await cp(folder.uri.fsPath, staging, { recursive: true });

			// Do the transmutation of the code


			const config = ts.getParsedCommandLineOfConfigFile(join(staging, "tsconfig.json"), {}, {
				...ts.sys, onUnRecoverableConfigFileDiagnostic(diag) {
					console.error('Unrecoverable tsconfig diagnostic:', ts.flattenDiagnosticMessageText(diag.messageText, '\n'));
				}
			});

			const program = ts.createProgram(config?.fileNames!, config?.options!);
			const diags = ts.getPreEmitDiagnostics(program);

			const diagnostics = new Map<string, Diagnostic[]>();
			for (const { start, file, length, messageText, category } of diags) {
				if (!file || start === undefined) continue;
				const startPos = file.getLineAndCharacterOfPosition(start);
				const endPos = file.getLineAndCharacterOfPosition(start + (length ?? 0));
				const range = new Range(startPos.line, startPos.character, endPos.line, endPos.character);
				const msg = ts.flattenDiagnosticMessageText(messageText, "\n");
				const sev = category === ts.DiagnosticCategory.Error ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning;

				diagnostics.set(file.fileName, [
					...(diagnostics.get(file.fileName) ?? []),
					new Diagnostic(range, msg, sev)
				]);
			}

			for (const [stagedFile, arr] of diagnostics) {
				col.set(Uri.file(join(folder.uri.fsPath, relative(staging, stagedFile))), arr);
			}
		}
	}));
}