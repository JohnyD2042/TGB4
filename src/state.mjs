import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');

const TRAMITE_STATE = 'tramite-state.json';

export function statePath() {
  const dir = process.env.STATE_DIR || resolve(root, 'data');
  return { dir, file: resolve(dir, TRAMITE_STATE) };
}

/**
 * @returns {{ rows: string[], estadoSegunExp: string } | null}
 */
export function readTramiteState() {
  const { file } = statePath();
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    return {
      rows: Array.isArray(raw.rows) ? raw.rows.map(String) : [],
      estadoSegunExp: typeof raw.estadoSegunExp === 'string' ? raw.estadoSegunExp : '',
    };
  } catch {
    return null;
  }
}

/**
 * @param {{ rows: string[], estadoSegunExp: string }} state
 */
export function writeTramiteState(state) {
  const { dir, file } = statePath();
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    file,
    JSON.stringify(
      {
        rows: state.rows,
        estadoSegunExp: state.estadoSegunExp ?? '',
      },
      null,
      0,
    ),
    'utf8',
  );
}
