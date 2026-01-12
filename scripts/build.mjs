import { mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'public', 'assets');

await mkdir(outDir, { recursive: true });

await build({
  entryPoints: [path.join(rootDir, 'src', 'main.jsx')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2017'],
  jsx: 'transform',
  sourcemap: true,
  outfile: path.join(outDir, 'bundle.js'),
});
