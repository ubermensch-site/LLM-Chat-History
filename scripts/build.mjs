import { build, context } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const watch = process.argv.includes('--watch');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(resolve(root, 'public'), dist, { recursive: true });

const buildOptions = {
  absWorkingDir: root,
  entryPoints: {
    content: 'src/content/index.ts',
    background: 'src/background/index.ts',
    library: 'src/library/library-entry.ts'
  },
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  target: ['chrome120'],
  // Keep source mapping useful during local development without shipping source maps
  // in release/CI production artifacts.
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info'
};

if (watch) {
  const ctx = await context(buildOptions);
  await ctx.watch();
  console.log('LLM Chat History: watching extension sources...');
} else {
  await build(buildOptions);
}
