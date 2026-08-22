/**
 * Jarvis-managed windows. Management is tracking, not unrestricted control.
 */

import { randomUUID } from 'node:crypto';
import {
  diffWindows,
  titleHintsForResource,
  windowMatchesHints,
  type WindowSnapshot,
} from './perception';

export type RuntimeWindowIdentity = {
  windowHandle: string;
  processId?: number;
  processName?: string;
  title?: string;
  openOperationId?: string;
  resourceId?: string;
  expectedUrl?: string;
  displayFingerprint?: string;
};

export type ManagedWindowRecord = {
  managedWindowId: string;
  openOperationId: string;
  resourceId: string;
  resourceType: 'website' | 'application' | 'project';
  processId?: number;
  processName?: string;
  windowHandle: string;
  observedTitle?: string;
  expectedUrl?: string;
  applicationId?: string;
  currentDisplay?: string;
  previousDisplay?: string;
  dedicatedWindow: boolean;
  createdAt: number;
  lastVerifiedAt?: number;
  lastObservedAt: number;
};

export type DiscoverManagedWindowInput = {
  pre: WindowSnapshot[];
  post: WindowSnapshot[];
  expectedProcessNames: string[];
  url?: string;
  label?: string;
  applicationId?: string;
  now?: number;
};

export type DiscoverManagedWindowResult =
  | { ok: true; window: WindowSnapshot; dedicated: boolean }
  | { ok: false; reasonCode: 'WINDOW_IDENTITY_AMBIGUOUS' | 'WINDOW_NOT_FOUND'; candidates: WindowSnapshot[]; message: string };

const BROWSER_PROCESSES = new Set(['chrome', 'msedge', 'msedgewebview2']);

export function isBrowserProcess(name: string | undefined): boolean {
  return Boolean(name && BROWSER_PROCESSES.has(name.toLocaleLowerCase()));
}

export function discoverManagedWindow(input: DiscoverManagedWindowInput): DiscoverManagedWindowResult {
  const expected = new Set(input.expectedProcessNames.map(item => item.toLocaleLowerCase()));
  const hints = titleHintsForResource({
    url: input.url,
    label: input.label,
    applicationId: input.applicationId,
  });
  const pool = input.post.filter(item => (
    !item.processName
    || expected.has(item.processName.toLocaleLowerCase())
  ));
  const { appeared } = diffWindows(input.pre, input.post);
  const newExpected = appeared.filter(item => (
    !item.processName
    || expected.has(item.processName.toLocaleLowerCase())
  ));
  const strongNew = newExpected.filter(item => windowMatchesHints(item, hints));
  if (strongNew.length === 1) return { ok: true, window: strongNew[0]!, dedicated: true };
  if (strongNew.length > 1) {
    return {
      ok: false,
      reasonCode: 'WINDOW_IDENTITY_AMBIGUOUS',
      candidates: strongNew,
      message: 'More than one new window matches that resource. I will not guess.',
    };
  }
  if (newExpected.length === 1) return { ok: true, window: newExpected[0]!, dedicated: true };
  if (newExpected.length > 1) {
    return {
      ok: false,
      reasonCode: 'WINDOW_IDENTITY_AMBIGUOUS',
      candidates: newExpected,
      message: 'Several new browser windows appeared. I will not guess which one is yours.',
    };
  }
  if ([...expected].some(name => isBrowserProcess(name))) {
    return {
      ok: false,
      reasonCode: 'WINDOW_NOT_FOUND',
      candidates: pool,
      message: 'I opened the resource but did not see a new dedicated browser window. I will not take over an already-open owner browser window.',
    };
  }
  const titled = pool.filter(item => windowMatchesHints(item, hints));
  if (titled.length === 1) return { ok: true, window: titled[0]!, dedicated: false };
  if (titled.length > 1) {
    return {
      ok: false,
      reasonCode: 'WINDOW_IDENTITY_AMBIGUOUS',
      candidates: titled,
      message: 'More than one existing window matches that resource. I will not guess.',
    };
  }
  return {
    ok: false,
    reasonCode: 'WINDOW_NOT_FOUND',
    candidates: pool,
    message: 'I opened the resource but could not identify a distinct resulting window.',
  };
}

export function createManagedWindow(
  input: Omit<ManagedWindowRecord, 'managedWindowId' | 'createdAt' | 'lastObservedAt'> & {
    managedWindowId?: string;
    createdAt?: number;
    lastObservedAt?: number;
  },
): ManagedWindowRecord {
  const now = input.createdAt ?? Date.now();
  return {
    ...input,
    managedWindowId: input.managedWindowId ?? `mw_${randomUUID()}`,
    createdAt: now,
    lastObservedAt: input.lastObservedAt ?? now,
  };
}

export class ManagedWindowStore {
  private readonly records = new Map<string, ManagedWindowRecord>();

  public upsert(record: ManagedWindowRecord): ManagedWindowRecord {
    this.records.set(record.managedWindowId, record);
    return record;
  }

  public get(id: string): ManagedWindowRecord | undefined {
    return this.records.get(id);
  }

  public getByHandle(handle: string): ManagedWindowRecord | undefined {
    return [...this.records.values()].find(item => item.windowHandle === handle);
  }

  public findByResource(input: { url?: string; applicationId?: string; label?: string }): ManagedWindowRecord[] {
    return [...this.records.values()].filter(item => {
      if (input.url && item.expectedUrl) {
        return normalizeResource(item.expectedUrl) === normalizeResource(input.url);
      }
      if (input.applicationId && item.applicationId) {
        return item.applicationId === input.applicationId;
      }
      if (input.label && item.resourceId) {
        return item.resourceId.toLocaleLowerCase() === input.label.toLocaleLowerCase()
          || (item.observedTitle || '').toLocaleLowerCase().includes(input.label.toLocaleLowerCase());
      }
      return false;
    });
  }

  public resolveOne(input: { url?: string; applicationId?: string; label?: string; managedWindowId?: string; windowHandle?: string }): ManagedWindowRecord | undefined {
    if (input.managedWindowId) return this.get(input.managedWindowId);
    if (input.windowHandle) return this.getByHandle(input.windowHandle);
    const matches = this.findByResource(input);
    return matches.length === 1 ? matches[0] : undefined;
  }

  public list(): ManagedWindowRecord[] {
    return [...this.records.values()];
  }

  public forget(id: string): boolean {
    return this.records.delete(id);
  }

  public clear(): void {
    this.records.clear();
  }
}

let shared: ManagedWindowStore | undefined;

export function sharedManagedWindows(): ManagedWindowStore {
  if (!shared) shared = new ManagedWindowStore();
  return shared;
}

function normalizeResource(value: string): string {
  return value.replace(/\/$/u, '').toLocaleLowerCase();
}
