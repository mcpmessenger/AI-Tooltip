import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');
const distDir = resolve(rootDir, 'dist');

async function ensureDist() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
}

async function copyEntry(entry) {
  const source = resolve(rootDir, entry);
  if (!existsSync(source)) {
    console.warn(`[build] Skipping missing entry: ${entry}`);
    return;
  }
  const destination = resolve(distDir, entry);
  await cp(source, destination, { recursive: true });
}

async function buildScripts() {
  console.log('[build] Bundling TypeScript sources...');
  await esbuild.build({
    entryPoints: [resolve(rootDir, 'src/content.ts')],
    bundle: false,
    outfile: resolve(distDir, 'content.js'),
    target: 'es2021',
    platform: 'browser',
    format: 'iife',
    sourcemap: false
  });
}

async function main() {
  console.log('[build] Preparing dist directory...');
  await ensureDist();

  const staticEntries = [
    'manifest.json',
    'background.js',
    'config.sample.js',
    'config.js',
    'content.css',
    'icons',
    'lib',
    'offscreen.html',
    'offscreen.js',
    'popup.html',
    'popup.js'
  ];

  for (const entry of staticEntries) {
    await copyEntry(entry);
  }

  await buildScripts();
  console.log('[build] Build finished.');
}

main().catch((error) => {
  console.error('[build] Build failed:', error);
  process.exitCode = 1;
});
