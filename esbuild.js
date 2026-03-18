import * as esbuild from "esbuild";
import { copyFile } from "fs/promises";

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		sourcesContent: false,
		platform: 'node',
		sourcemap: true,
		outfile: 'dist/extension.cjs',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			esbuildProblemMatcherPlugin,
		],
	});

	const ctx2 = await esbuild.context({
		entryPoints: [
			'src/cli.ts'
		],
		bundle: true,
		format: "cjs",
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/cli.cjs',
		logLevel: 'silent',
		plugins: [
			esbuildProblemMatcherPlugin
		],
	});

	await ctx.rebuild();
	await ctx2.rebuild();

	await copyFile("node_modules/source-map/lib/mappings.wasm", "dist/mappings.wasm");
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
