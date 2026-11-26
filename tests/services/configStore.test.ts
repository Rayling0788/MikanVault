import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

const run = promisify(execFile);

it('preserves all successful metadata mutations from concurrent processes', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mikanvault-store-test-'));
  try {
    const worker = path.join(tempDir, 'worker.cjs');
    const repo = fileURLToPath(new URL('../../', import.meta.url));
    await build({
      stdin: {
        contents: [
          "import path from 'node:path';",
          "import { setWatchedRecord } from './electron/services/configStore';",
          'const writer = process.argv[2];',
          'for (let index = 0; index < 20; index += 1) {',
          '  setWatchedRecord(path.join(process.env.MIKANVAULT_DATA_DIR, writer + "-" + index), true);',
          '}',
        ].join('\n'),
        loader: 'ts',
        resolveDir: repo,
      },
      outfile: worker,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
    });
    const env = { ...process.env, MIKANVAULT_DATA_DIR: tempDir };
    const writers = await Promise.allSettled(
      ['desktop', 'mcp', 'second-mcp'].map((writer) => run(process.execPath, [worker, writer], { env })),
    );
    for (const writer of writers) {
      if (writer.status === 'rejected') throw writer.reason;
    }
    const saved = JSON.parse(await fs.readFile(path.join(tempDir, 'metadata.json'), 'utf8'));
    expect(Object.keys(saved.watchedMap)).toHaveLength(60);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}, 15_000);
