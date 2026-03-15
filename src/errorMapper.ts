import * as fs from 'fs/promises';
import * as path from 'path';
import { NullableMappedPosition, SourceMapConsumer } from 'source-map';

export interface MappedError {
    originalFile: string;      // path relative to sourceDir
    line: number;              // 1‑based line in original file
    column: number;            // 1‑based column
    message: string;
}

/**
 * Parse tsc stderr, locate source maps in mapDir, and map each error back to its original source.
 */
export async function mapTscErrors(tscStderr: string, sourceDir: string, mapDir: string): Promise<MappedError[]> {
    const errorRegex = /^(.+)\((\d+),(\d+)\): error TS\d+: (.*)$/gm;
    const mapped: MappedError[] = [];
    let match;

    while ((match = errorRegex.exec(tscStderr)) !== null) {
        const [_, filePath, lineStr, colStr, message] = match;
        const line = parseInt(lineStr, 10);
        const col = parseInt(colStr, 10);
        const annotatedFilePath = path.resolve(mapDir, filePath);
        if (!annotatedFilePath.endsWith('.annotated.ts')) continue;

        const mapPath = annotatedFilePath + '.map';
        let originalPos: NullableMappedPosition;
        try {
            const mapContent = await fs.readFile(mapPath, 'utf8');
            const consumer = await new SourceMapConsumer(JSON.parse(mapContent));
            originalPos = consumer.originalPositionFor({ line, column: col });
            consumer.destroy();
        } catch (e) {
            console.warn(`Failed to load source map for ${annotatedFilePath}`, e);
            continue;
        }

        if (originalPos && originalPos.source && originalPos.line !== null) {
            mapped.push({
                originalFile: originalPos.source, // already relative to sourceDir
                line: originalPos.line,
                column: originalPos.column!,
                message,
            });
        }
    }
    return mapped;
}