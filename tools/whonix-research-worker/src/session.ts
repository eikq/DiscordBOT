const OWNER_CHANNELS = new Set(['chrome', 'msedge', 'chrome-beta', 'msedge-beta', 'msedge-dev', 'chrome-dev']);
const BLOCKED_DOWNLOADS = ['.exe', '.msi', '.ps1', '.bat', '.cmd', '.scr', '.dll', '.jar'];

export function assertWorkerLaunch(options: {
  channel?: string;
  userDataDir?: string;
  persistent?: boolean;
} = {}): void {
  if (options.persistent || options.userDataDir) {
    throw Object.assign(new Error('Ephemeral context required.'), { reasonCode: 'BROWSER_PERSISTENCE_BLOCKED' });
  }
  if (options.channel && OWNER_CHANNELS.has(options.channel)) {
    throw Object.assign(new Error('Owner browser is forbidden.'), { reasonCode: 'OWNER_BROWSER_FORBIDDEN' });
  }
}

export function denyDownload(filename: string): never {
  const lower = filename.toLowerCase();
  const reason = BLOCKED_DOWNLOADS.some(ext => lower.endsWith(ext)) ? 'BLOCKED_DOWNLOAD' : 'DOWNLOAD_DENIED';
  throw Object.assign(new Error('Browser download is denied by default.'), { reasonCode: reason });
}

export function ephemeralContextOptions() {
  return {
    acceptDownloads: false,
    viewport: { width: 1280, height: 720 },
    permissions: [],
  };
}
