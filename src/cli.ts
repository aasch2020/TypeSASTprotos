#!/usr/bin/env node
import { transformProject } from './transformer.js';
import { mapTscErrors } from './errorMapper.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';


const execAsync = promisify(exec);

async function main() {
    const sourceDir = process.argv[2];
    if (!sourceDir) {
        console.error('Usage: typesast <source-directory>');
        process.exit(1);
    }

    // Create temp directory for output
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'typesast-'));
    const outDir = path.join(tmpDir, 'out');
    await fs.mkdir(outDir, { recursive: true });
    await fs.cp("")

    console.log(`Transforming ${sourceDir} → ${outDir}`);
    await transformProject(sourceDir, outDir);
    console.log('Running tsc...');
    try {
        await execAsync('tsc --noEmit', { cwd: outDir });
    } catch (error: any) {
        if (error.stderr) {
            const mapped = await mapTscErrors(error.stderr, sourceDir, outDir);
            if (mapped.length === 0) {
                console.error('Unmappable errors:\n', error.stderr);
            } else {
                for (const err of mapped) {
                    console.error(`${err.originalFile}(${err.line},${err.column}): ${err.message}`);
                }
            }
        } else {
            console.error(error.message);
        }
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
}

if (require.main === module) {
    main().catch(console.error);
}