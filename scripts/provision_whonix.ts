import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const OFFICIAL = {
  version: '18.2.1.9',
  edition: 'Whonix-LXQt Intel/AMD64',
  ova: 'https://download.whonix.org/ova/18.2.1.9/Whonix-LXQt-18.2.1.9.Intel_AMD64.ova',
  sha512sums: 'https://download.whonix.org/ova/18.2.1.9/Whonix-LXQt-18.2.1.9.Intel_AMD64.ova.sha512sums',
  sha512sumsAsc: 'https://download.whonix.org/ova/18.2.1.9/Whonix-LXQt-18.2.1.9.Intel_AMD64.ova.sha512sums.asc',
  sha512sumsSig: 'https://download.whonix.org/ova/18.2.1.9/Whonix-LXQt-18.2.1.9.Intel_AMD64.ova.sha512sums.sig',
  ovaAsc: 'https://download.whonix.org/ova/18.2.1.9/Whonix-LXQt-18.2.1.9.Intel_AMD64.ova.asc',
  listing: 'https://download.whonix.org/ova/18.2.1.9/',
};

const destDir = path.join(process.cwd(), '.runtime', 'provisioning', 'whonix');

async function main(): Promise<void> {
  const onlySums = process.argv.includes('--sums-only');
  await fs.mkdir(destDir, { recursive: true });
  const sumsPath = path.join(destDir, 'Whonix-LXQt-18.2.1.9.Intel_AMD64.ova.sha512sums');
  await download(OFFICIAL.sha512sums, sumsPath);
  await download(OFFICIAL.sha512sumsAsc, `${sumsPath}.asc`);
  await download(OFFICIAL.sha512sumsSig, `${sumsPath}.sig`);
  await download(OFFICIAL.ovaAsc, path.join(destDir, 'Whonix-LXQt-18.2.1.9.Intel_AMD64.ova.asc'));
  const sums = await fs.readFile(sumsPath, 'utf8');
  console.log('Downloaded official Whonix hash/signature sidecars from download.whonix.org');
  console.log(sums.trim());
  if (onlySums) {
    console.log('OVA download skipped (--sums-only). Import requires VirtualBox + hash verify.');
    return;
  }
  const ovaPath = path.join(destDir, 'Whonix-LXQt-18.2.1.9.Intel_AMD64.ova');
  if (!(await exists(ovaPath))) {
    console.log('Downloading official Whonix LXQt OVA (about 2.6 GiB) ...');
    await download(OFFICIAL.ova, ovaPath);
  }
  const digest = await sha512File(ovaPath);
  if (!sums.toLowerCase().includes(digest)) {
    throw new Error(`Whonix OVA SHA512 mismatch against official sha512sums. actual=${digest}`);
  }
  console.log(`SHA512 OK ${digest}`);
  console.log('OWNER_ACTION_REQUIRED before import: do not accept Whonix first-boot legal dialogs automatically.');
  console.log('Import only after VirtualBox is installed and VBoxManage is on PATH.');
}

async function download(url: string, file: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status} ${url}`);
  await pipeline(response.body as unknown as NodeJS.ReadableStream, createWriteStream(file));
}

async function sha512File(file: string): Promise<string> {
  const hash = createHash('sha512');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
