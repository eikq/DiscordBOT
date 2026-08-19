import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PRODUCTION_HINTS = [
  `${path.sep}src${path.sep}`,
  `${path.sep}config${path.sep}`,
  `${path.sep}.env`,
  `${path.sep}data${path.sep}brain${path.sep}`,
  `${path.sep}data${path.sep}memory${path.sep}`,
];

export function createCandidateSandbox(root = os.tmpdir()): string {
  const dir = fs.mkdtempSync(path.join(root, 'jarvis-evo-sandbox-'));
  assertIsolated(dir);
  return dir;
}

export function assertIsolated(candidatePath: string, productionRoot = process.cwd()): void {
  const resolved = path.resolve(candidatePath);
  const production = path.resolve(productionRoot);
  if (resolved === production) {
    throw Object.assign(new Error('Candidate sandbox cannot be the production root.'), { reasonCode: 'SANDBOX_ISOLATION' });
  }
  if (PRODUCTION_HINTS.some(hint => resolved.toLowerCase().includes(hint.toLowerCase()) && resolved.startsWith(production))) {
    throw Object.assign(new Error('Candidate sandbox cannot write production source, config, secrets, or memory.'), { reasonCode: 'SANDBOX_ISOLATION' });
  }
}

export function rejectProductionWrite(targetPath: string, productionRoot = process.cwd()): void {
  const resolved = path.resolve(targetPath);
  const production = path.resolve(productionRoot);
  if (resolved.startsWith(production + path.sep) || resolved === production) {
    throw Object.assign(new Error('Evolution candidates must not modify production.'), { reasonCode: 'PRODUCTION_WRITE_FORBIDDEN' });
  }
}
