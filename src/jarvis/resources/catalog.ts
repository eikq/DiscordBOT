import fs from 'node:fs';
import path from 'node:path';

export type WebResourceRecord = {
  id: string;
  kind: 'website' | 'documentation';
  names: string[];
  officialUrl: string;
  evidence: 'allowlisted-web' | 'owner-catalog' | 'owner-stated';
};

export type WebResourceCatalog = {
  version: number;
  resources: WebResourceRecord[];
};

const DEFAULT_CATALOG: WebResourceCatalog = { version: 1, resources: [] };

export function loadWebResourceCatalog(root = process.cwd()): WebResourceCatalog {
  const file = path.join(root, 'config', 'jarvis', 'web-resources.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as WebResourceCatalog;
    if (!Array.isArray(parsed.resources)) return DEFAULT_CATALOG;
    return {
      version: Number(parsed.version) || 1,
      resources: parsed.resources.filter(item => item
        && typeof item.id === 'string'
        && typeof item.officialUrl === 'string'
        && Array.isArray(item.names)
        && item.officialUrl.startsWith('https://')),
    };
  } catch {
    return DEFAULT_CATALOG;
  }
}
