import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');

export function statePath() {
  const dir = process.env.STATE_DIR || resolve(root, 'data');
  return { dir, file: resolve(dir, 'last-fingerprint.txt') };
}

export function readLastFingerprint() {
  const { file } = statePath();
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf8').trim();
}

export function writeLastFingerprint(fp) {
  const { dir, file } = statePath();
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, fp, 'utf8');
}
