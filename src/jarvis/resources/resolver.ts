/**
 * Generic resource resolution. Never fabricates a URL.
 */

import { loadDesktopAllowlists } from '../capabilities/actions/allowlists';
import type { WebResourceRecord } from './catalog';
import { loadWebResourceCatalog } from './catalog';
import type { SemanticIntent } from '../intent/semanticIntent';

export type ResolvedResource =
  | {
      ok: true;
      kind: 'website';
      id: string;
      label: string;
      url: string;
      evidence: WebResourceRecord['evidence'] | 'literal-url' | 'owner-alias';
      correction?: string;
    }
  | {
      ok: true;
      kind: 'application';
      id: string;
      label: string;
      applicationId: string;
    }
  | {
      ok: true;
      kind: 'project';
      id: string;
      label: string;
      projectId: string;
    }
  | {
      ok: false;
      reasonCode:
        | 'RESOURCE_UNRESOLVED'
        | 'OFFICIAL_URL_UNKNOWN'
        | 'AMBIGUOUS_RESOURCE'
        | 'DID_YOU_MEAN';
      message: string;
      entity?: string;
      suggestion?: string;
    };

export type ResourceResolverOptions = {
  webResources?: WebResourceRecord[];
  applicationIds?: string[];
  applicationNames?: Array<{ id: string; names: string[] }>;
  projectIds?: string[];
};

export function resolveResource(intent: SemanticIntent, options: ResourceResolverOptions = {}): ResolvedResource {
  const entity = (intent.entity || '').trim();
  const literal = entity.match(/https?:\/\/[^\s]+/iu)?.[0];
  if (literal) {
    try {
      const url = new URL(literal);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        return { ok: false, reasonCode: 'OFFICIAL_URL_UNKNOWN', message: 'That is not a URL I can open.', entity };
      }
      return { ok: true, kind: 'website', id: url.hostname, label: url.hostname, url: url.href, evidence: 'literal-url' };
    } catch {
      return { ok: false, reasonCode: 'OFFICIAL_URL_UNKNOWN', message: 'That is not a valid URL.', entity };
    }
  }

  if (intent.objectType === 'PROJECT' || /jarvis/iu.test(entity)) {
    const projectIds = options.projectIds ?? loadDesktopAllowlists().projects.map(item => item.id);
    const hit = projectIds.find(id => entity.toLocaleLowerCase().includes(id.replace(/-/g, ' ')) || entity.toLocaleLowerCase().includes('jarvis'));
    if (hit) return { ok: true, kind: 'project', id: hit, label: hit, projectId: hit };
  }

  const apps = options.applicationNames ?? defaultApplicationNames(options.applicationIds);
  const app = matchNamed(entity, apps);
  if (app.kind === 'exact') {
    return { ok: true, kind: 'application', id: app.id, label: app.id, applicationId: app.id };
  }

  const sites = options.webResources ?? loadWebResourceCatalog().resources;
  const site = matchNamed(entity, sites.map(item => ({ id: item.id, names: item.names, url: item.officialUrl, evidence: item.evidence })));
  const near = sites.find(item => (item.nearNames ?? []).some(name => collapse(name) === collapse(entity) || collapse(entity).includes(collapse(name))));
  if (near && site.kind !== 'exact') {
    return {
      ok: false,
      reasonCode: 'DID_YOU_MEAN',
      message: `Did you mean ${near.id}?`,
      entity,
      suggestion: near.id,
    };
  }
  if (site.kind === 'exact') {
    const record = sites.find(item => item.id === site.id);
    if (!record) {
      return { ok: false, reasonCode: 'OFFICIAL_URL_UNKNOWN', message: `I do not have a verified official site for ${entity}.`, entity };
    }
    return {
      ok: true,
      kind: 'website',
      id: record.id,
      label: record.id,
      url: record.officialUrl,
      evidence: record.evidence,
    };
  }
  if (site.kind === 'close' && (intent.objectType === 'WEBSITE' || intent.action === 'OPEN')) {
    return {
      ok: false,
      reasonCode: 'DID_YOU_MEAN',
      message: `Did you mean ${site.id}?`,
      entity,
      suggestion: site.id,
    };
  }

  if (intent.objectType === 'WEBSITE' || WEBSITE_HINT.test(entity)) {
    return {
      ok: false,
      reasonCode: 'OFFICIAL_URL_UNKNOWN',
      message: `I understand you want the official ${entity || 'site'}, but I do not have a verified official URL yet. What is the exact site, or should I research official documentation first?`,
      entity,
    };
  }

  if (app.kind === 'close') {
    return {
      ok: false,
      reasonCode: 'DID_YOU_MEAN',
      message: `Did you mean ${app.id}?`,
      entity,
      suggestion: app.id,
    };
  }

  return {
    ok: false,
    reasonCode: 'RESOURCE_UNRESOLVED',
    message: entity
      ? `I understand the request, but I do not have a verified resource for “${entity}”.`
      : 'Which app, site, or project should I use?',
    entity,
  };
}

const WEBSITE_HINT = /web|site|เว็บ|\.com/iu;

function defaultApplicationNames(ids?: string[]): Array<{ id: string; names: string[] }> {
  const lists = loadDesktopAllowlists();
  return lists.applications
    .filter(item => !ids || ids.includes(item.id))
    .map(item => ({ id: item.id, names: [item.id, item.displayName] }));
}

function matchNamed(
  entity: string,
  records: Array<{ id: string; names: string[] }>,
): { kind: 'exact' | 'close' | 'none'; id: string } {
  const needle = collapse(entity);
  if (!needle) return { kind: 'none', id: '' };
  for (const record of records) {
    const names = [record.id, ...record.names].map(collapse);
    if (names.some(name => name && (needle === name || needle.includes(name) || name.includes(needle)))) {
      return { kind: 'exact', id: record.id };
    }
  }
  let best: { id: string; distance: number } | undefined;
  for (const record of records) {
    for (const name of [record.id, ...record.names].map(collapse)) {
      if (!name || Math.abs(name.length - needle.length) > 3) continue;
      const distance = levenshtein(needle, name);
      if (distance <= 2 && (!best || distance < best.distance)) best = { id: record.id, distance };
    }
  }
  if (best) return { kind: 'close', id: best.id };
  return { kind: 'none', id: '' };
}

function collapse(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]+/giu, '');
}

function levenshtein(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const grid = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) grid[i]![0] = i;
  for (let j = 0; j < cols; j += 1) grid[0]![j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      grid[i]![j] = Math.min(
        (grid[i - 1]![j] ?? 0) + 1,
        (grid[i]![j - 1] ?? 0) + 1,
        (grid[i - 1]![j - 1] ?? 0) + cost,
      );
    }
  }
  return grid[left.length]![right.length] ?? 99;
}
