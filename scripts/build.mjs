import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const watch = process.argv.includes('--watch');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(resolve(root, 'public'), dist, { recursive: true });

const inlineAssetPlugin = {
  name: 'inline-extension-asset',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /\.woff2\?inline$/ }, async (args) => {
      const request = args.path.slice(0, -'?inline'.length);
      const resolved = await pluginBuild.resolve(request, {
        resolveDir: args.resolveDir,
        kind: args.kind
      });
      if (resolved.errors.length) return { errors: resolved.errors };
      return { path: resolved.path, namespace: 'inline-extension-asset' };
    });

    pluginBuild.onLoad({ filter: /.*/, namespace: 'inline-extension-asset' }, async (args) => ({
      contents: await readFile(args.path),
      loader: 'dataurl'
    }));
  }
};

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
  loader: {
    '.woff': 'file',
    '.woff2': 'file'
  },
  assetNames: 'assets/[name]-[hash]',
  plugins: [inlineAssetPlugin],
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
