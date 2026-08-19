import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const OFFICIAL = {
  version: '7.2.16',
  build: '174877',
  url: 'https://download.virtualbox.org/virtualbox/7.2.16/VirtualBox-7.2.16-174877-Win.exe',
  sha256: '9383a42bffa5c0ac4bc5f1c7d820478d84380d3a17b65aa9b43e6778cbdb615a',
  source: 'https://www.virtualbox.org/wiki/Downloads + https://download.virtualbox.org/virtualbox/7.2.16/SHA256SUMS',
  publisherNeedles: ['Oracle Corporation', 'Oracle America'],
};

const destDir = path.join(process.cwd(), '.runtime', 'provisioning');
const dest = path.join(destDir, `VirtualBox-${OFFICIAL.version}-${OFFICIAL.build}-Win.exe`);

async function main(): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  if (!(await fileHasHash(dest, OFFICIAL.sha256))) {
    console.log(`Downloading official VirtualBox ${OFFICIAL.version} from virtualbox.org ...`);
    await download(OFFICIAL.url, dest);
  }
  const digest = await sha256File(dest);
  if (digest !== OFFICIAL.sha256) {
    throw new Error(`SHA256 mismatch. expected=${OFFICIAL.sha256} actual=${digest}`);
  }
  console.log(`SHA256 OK ${digest}`);
  const signature = await authenticode(dest);
  console.log(`Authenticode status=${signature.status} signer=${signature.signer}`);
  if (signature.status !== 'Valid' || !OFFICIAL.publisherNeedles.some(item => signature.signer.includes(item))) {
    throw new Error('Authenticode verification failed. Installer was not launched.');
  }
  console.log('Launching official installer. Windows UAC may appear. Jarvis will not bypass UAC.');
  const child = await execFileAsync('cmd', ['/c', 'start', '', dest], { windowsHide: false });
  console.log(child.stdout || 'Installer launched.');
  console.log('OWNER_ACTION_REQUIRED: approve the VirtualBox UAC prompt if it appears, then finish the official installer.');
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

async function authenticode(file: string): Promise<{ status: string; signer: string }> {
  const script = [
    `$s = Get-AuthenticodeSignature -FilePath '${file.replace(/'/g, "''")}'`,
    '$signer = $s.SignerCertificate.Subject',
    'Write-Output ("STATUS=" + $s.Status)',
    'Write-Output ("SIGNER=" + $signer)',
  ].join('; ');
  const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', script], { windowsHide: true });
  return {
    status: stdout.match(/STATUS=(.+)/)?.[1]?.trim() ?? 'Unknown',
    signer: stdout.match(/SIGNER=(.+)/)?.[1]?.trim() ?? '',
  };
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
