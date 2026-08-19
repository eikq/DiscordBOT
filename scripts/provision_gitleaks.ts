import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RELEASE = {
  version: '8.30.1',
  zipUrl: 'https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_windows_x64.zip',
  checksumUrl: 'https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_checksums.txt',
  sha256: 'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e',
  zipName: 'gitleaks_8.30.1_windows_x64.zip',
};

const destDir = path.join(process.cwd(), '.runtime', 'tools', 'gitleaks');

async function main(): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  const zip = path.join(destDir, RELEASE.zipName);
  if (!(await fileHasHash(zip, RELEASE.sha256))) {
    console.log(`Downloading official Gitleaks ${RELEASE.version} from GitHub releases ...`);
    await download(RELEASE.zipUrl, zip);
  }
  const digest = await sha256File(zip);
  if (digest !== RELEASE.sha256) {
    throw new Error(`Gitleaks SHA256 mismatch. expected=${RELEASE.sha256} actual=${digest}`);
  }
  console.log(`SHA256 OK ${digest}`);
  await execFileAsync('tar', ['-xf', zip, '-C', destDir]);
  const exe = path.join(destDir, 'gitleaks.exe');
  const { stdout } = await execFileAsync(exe, ['version'], { windowsHide: true });
  console.log(stdout.trim());
}

async function download(url: string, file: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status} ${url}`);
  await pipeline(response.body as unknown as NodeJS.ReadableStream, createWriteStream(file));
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await fs.readFile(file));
  return hash.digest('hex');
}

async function fileHasHash(file: string, expected: string): Promise<boolean> {
  try {
    return (await sha256File(file)) === expected;
  } catch {
    return false;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
