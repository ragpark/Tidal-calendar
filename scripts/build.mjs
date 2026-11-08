import { mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'public', 'assets');

await mkdir(outDir, { recursive: true });

const define = {
  'process.env.VITE_STRIPE_PUBLISHABLE_KEY': JSON.stringify(process.env.VITE_STRIPE_PUBLISHABLE_KEY || ''),
  'process.env.VITE_STRIPE_PRICING_TABLE_ID': JSON.stringify(process.env.VITE_STRIPE_PRICING_TABLE_ID || ''),
};

await build({
  // bundle.js: the React app. analytics.js: HeyCatch init for server-rendered pages that do not
  // mount the app (see src/seo/render.js). Code splitting keeps the SDK in one shared chunk.
  entryPoints: {
    bundle: path.join(rootDir, 'src', 'main.jsx'),
    analytics: path.join(rootDir, 'src', 'analytics', 'static.js'),
  },
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'transform',
  sourcemap: true,
  outdir: outDir,
  chunkNames: 'chunks/[name]-[hash]',
  define,
});
