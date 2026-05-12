import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..', '..');
const artifactDir = join(repoRoot, 'artifacts');
const buildDir = join(repoRoot, '.build', 'alexa-lambda');
const zipPath = join(artifactDir, 'alexa-voice-backend.zip');

rmSync(buildDir, { force: true, recursive: true });
mkdirSync(buildDir, { recursive: true });
mkdirSync(artifactDir, { recursive: true });

if (!existsSync(join(repoRoot, 'dist-voice'))) {
  throw new Error('dist-voice folder not found. Run `npm run build --prefix voice` first.');
}

cpSync(join(repoRoot, 'dist-voice'), join(buildDir, 'dist-voice'), { recursive: true });

const packageJson = {
  name: 'tidal-calendar-alexa-lambda',
  private: true,
  type: 'module',
  version: '1.0.0',
  main: 'dist-voice/alexaLambda.js'
};
writeFileSync(join(buildDir, 'package.json'), JSON.stringify(packageJson, null, 2));
rmSync(zipPath, { force: true });
execSync(`cd "${buildDir}" && zip -rq "${zipPath}" .`);

console.log(`Created ${zipPath}`);
console.log('Lambda handler: dist-voice/alexaLambda.handler');
