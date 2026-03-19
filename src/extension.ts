import { ExtensionContext, Diagnostic, Range, DiagnosticSeverity, Uri, commands, workspace, window, languages } from "vscode";
import * as ts from "typescript";
import { mkdtemp, cp } from "fs/promises";
import { join, relative, dirname, basename } from "path";
import { tmpdir } from "os";
import { transform } from "./common/transform";
import { SourceMapConsumer } from "source-map";

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

			await cp(folder.uri.fsPath, staging, {
				recursive: true, filter: (src, _) => !src.includes("node_modules")
			});

			let maps: Map<string, any>;
			try {
				maps = await transform(staging);
			} catch (err) {
				console.error("transform failed:", err);
				window.showErrorMessage("Code transform failed. See extension console.");
				return;
			}
			console.log(staging);

			const config = ts.getParsedCommandLineOfConfigFile(join(staging, "tsconfig.json"), {}, {
				...ts.sys,
				onUnRecoverableConfigFileDiagnostic(diag) {
					console.error('Unrecoverable tsconfig diagnostic:', ts.flattenDiagnosticMessageText(diag.messageText, '\n'));
				}
			});

			const host = ts.createCompilerHost(config!.options);
			host.getDefaultLibFileName = (options) => {
				return join(folder.uri.fsPath, "node_modules/typescript/lib", basename(ts.getDefaultLibFileName(options)));
			};
			host.getDefaultLibLocation = () => join(folder.uri.fsPath, "node_modules/typescript/lib");

			const program = ts.createProgram(config!.fileNames, config!.options, host);
			const diags = ts.getPreEmitDiagnostics(program);

			console.log("GOT DIAGS:", diags);

			const diagnostics = new Map<string, Diagnostic[]>();

			// cache consumers per transformed file
			const consumerCache = new Map<string, SourceMapConsumer>();

			for (const { start, file, length, messageText, category } of diags) {
				if (!file || start === undefined) continue;

				const stagedPath = file.fileName;
				const startPos = file.getLineAndCharacterOfPosition(start);
				const endPos = file.getLineAndCharacterOfPosition(start + (length ?? 0));

				// default mapped values point to the staged file
				let mappedStartLine = startPos.line;
				let mappedStartChar = startPos.character;
				let mappedEndLine = endPos.line;
				let mappedEndChar = endPos.character;
				let mappedSourcePath: string | undefined;

				const rawMap = maps.get(stagedPath);
				if (rawMap) {
					let consumer = consumerCache.get(stagedPath);
					if (!consumer) {
						consumer = await new SourceMapConsumer(rawMap);
						consumerCache.set(stagedPath, consumer);
					}
					const origStart = consumer.originalPositionFor({ line: startPos.line + 1, column: startPos.character });
					const origEnd = consumer.originalPositionFor({ line: endPos.line + 1, column: endPos.character });

					if (origStart && origStart.source) {
						// Map original source (which is typically a basename) to the workspace file path.
						// Use the staged file's relative directory as base so nested directories map correctly.
						const rel = relative(staging, stagedPath);
						const baseDir = dirname(rel);
						mappedSourcePath = join(folder.uri.fsPath, baseDir, origStart.source);
						mappedStartLine = (origStart.line ?? 1) - 1;
						mappedStartChar = origStart.column ?? 0;
					}
					if (origEnd && origEnd.source) {
						const rel = relative(staging, stagedPath);
						const baseDir = dirname(rel);
						// prefer origEnd.source if different; otherwise reuse mappedSourcePath
						mappedSourcePath = join(folder.uri.fsPath, baseDir, origEnd.source);
						mappedEndLine = (origEnd.line ?? (mappedStartLine + 1)) - 1;
						mappedEndChar = origEnd.column ?? mappedStartChar;
					}
				}

				// fallback: if no mapping found, map staged path back to workspace using relative path
				const targetFile = mappedSourcePath ?? join(folder.uri.fsPath, relative(staging, stagedPath));
				const range = new Range(mappedStartLine, mappedStartChar, mappedEndLine, mappedEndChar);
				const msg = ts.flattenDiagnosticMessageText(messageText, "\n");
				const sev = category === ts.DiagnosticCategory.Error ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning;

				diagnostics.set(targetFile, [
					...(diagnostics.get(targetFile) ?? []),
					new Diagnostic(range, msg, sev)
				]);
			}

			// set diagnostics
			for (const [origFile, arr] of diagnostics) {
				col.set(Uri.file(origFile), arr);
			}

			// destroy consumers
			for (const c of consumerCache.values()) c.destroy();
		}
	}));
}