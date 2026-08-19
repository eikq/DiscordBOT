import fs from 'node:fs';
import path from 'node:path';
import { SAFE_ID_PATTERN } from './constants';

export type SettingsRecord = {
  id: string;
  displayName: string;
  uri: string;
};

const ALLOWED_SETTINGS_URIS = new Set([
  'ms-settings:bluetooth',
  'ms-settings:display',
  'ms-settings:sound',
  'ms-settings:network',
  'ms-settings:windowsupdate',
]);

export function loadSettingsAllowlist(workspaceRoot = process.cwd()): SettingsRecord[] {
  const file = path.join(workspaceRoot, 'config', 'jarvis', 'settings.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { settings?: Array<Partial<SettingsRecord>> };
    return (raw.settings ?? []).flatMap(entry => {
      const id = typeof entry.id === 'string' ? entry.id : '';
      const uri = typeof entry.uri === 'string' ? entry.uri.trim().toLowerCase() : '';
      if (!SAFE_ID_PATTERN.test(id) || !ALLOWED_SETTINGS_URIS.has(uri)) return [];
      return [{
        id,
        displayName: typeof entry.displayName === 'string' ? entry.displayName : id,
        uri,
      }];
    });
  } catch {
    return [];
  }
}

export function settingsById(list: SettingsRecord[], id: string): SettingsRecord | undefined {
  return list.find(item => item.id === id);
}

export function configuredSettingsIds(list: SettingsRecord[]): string[] {
  return list.map(item => item.id);
}
