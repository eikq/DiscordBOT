import path from 'node:path';
import {
  ALLOWED_BROWSER_ACTIONS,
  BLOCKED_BROWSER_ACTIONS,
  BLOCKED_DOWNLOAD_EXTENSIONS,
  OWNER_BROWSER_CHANNELS,
} from './constants';
import type { BrowserActionDecision, BrowserLaunchOptions } from './types';

const OWNER_PROFILE_HINT = /(?:^|[\\/])(?:Google[\\/]Chrome|Microsoft[\\/]Edge|User Data)(?:[\\/]|$)/iu;

export function assertDedicatedChromium(options: BrowserLaunchOptions = {}): BrowserActionDecision {
  if (options.persistent) {
    return denied('BROWSER_PERSISTENCE_BLOCKED', 'Private browser sessions must be ephemeral.');
  }
  if (options.channel && (OWNER_BROWSER_CHANNELS as readonly string[]).includes(options.channel.toLowerCase())) {
    return denied('OWNER_BROWSER_FORBIDDEN', 'PRIVATE_BROWSER cannot use the owner Chrome or Edge profile.');
  }
  if (options.userDataDir) {
    const normalized = path.normalize(options.userDataDir);
    if (OWNER_PROFILE_HINT.test(normalized) || /AppData[\\/]Local[\\/](?:Google|Microsoft)/iu.test(normalized)) {
      return denied('OWNER_BROWSER_FORBIDDEN', 'PRIVATE_BROWSER cannot use the owner browser profile.');
    }
    return denied('BROWSER_PERSISTENCE_BLOCKED', 'Private browser sessions cannot reuse a user data directory.');
  }
  if (options.executablePath && /(?:chrome|msedge)\.exe$/iu.test(options.executablePath)) {
    return denied('OWNER_BROWSER_FORBIDDEN', 'PRIVATE_BROWSER cannot select the owner browser executable.');
  }
  return { ok: true, action: 'launch_dedicated_chromium' };
}

export function decideBrowserAction(action: string): BrowserActionDecision {
  const normalized = action.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if ((BLOCKED_BROWSER_ACTIONS as readonly string[]).includes(normalized)) {
    return denied(reasonForBlockedAction(normalized), `Browser action “${normalized}” is blocked by default.`);
  }
  if ((ALLOWED_BROWSER_ACTIONS as readonly string[]).includes(normalized)) {
    return { ok: true, action: normalized };
  }
  return denied('BROWSER_ACTION_DENIED', `Browser action “${normalized}” is not allowed.`);
}

export function decideDownload(filename: string): BrowserActionDecision {
  const lower = filename.trim().toLowerCase();
  if (!lower) return denied('DOWNLOAD_DENIED', 'Browser download is denied by default.');
  if (BLOCKED_DOWNLOAD_EXTENSIONS.some(ext => lower.endsWith(ext))) {
    return denied('BLOCKED_DOWNLOAD', 'Executable or script downloads are blocked.');
  }
  return denied('DOWNLOAD_DENIED', 'Browser download is denied by default.');
}

export function createEphemeralSessionPolicy(): {
  persistState: false;
  acceptDownloads: false;
  permissions: Record<string, 'deny'>;
} {
  return {
    persistState: false,
    acceptDownloads: false,
    permissions: {
      geolocation: 'deny',
      camera: 'deny',
      microphone: 'deny',
      clipboard: 'deny',
      notifications: 'deny',
    },
  };
}

function reasonForBlockedAction(action: string): string {
  if (action === 'login' || action === 'account_create' || action === 'save_password') return 'LOGIN_BLOCKED';
  if (action === 'download_executable') return 'BLOCKED_DOWNLOAD';
  return 'BROWSER_ACTION_DENIED';
}

function denied(reasonCode: string, userMessage: string): BrowserActionDecision {
  return { ok: false, reasonCode, userMessage };
}

export function isBrowserDenied(
  decision: BrowserActionDecision,
): decision is { ok: false; reasonCode: string; userMessage: string } {
  return decision.ok === false;
}
