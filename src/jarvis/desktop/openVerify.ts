import { discoverManagedWindow, type DiscoverManagedWindowResult } from './managedWindows';
import type { DesktopPerceptionProvider, DesktopPerceptionSnapshot } from './perception';

export async function observeAfterOpen(input: {
  perception: DesktopPerceptionProvider;
  pre: DesktopPerceptionSnapshot;
  expectedProcessNames: string[];
  url?: string;
  label?: string;
  applicationId?: string;
  attempts?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<DiscoverManagedWindowResult & { post: DesktopPerceptionSnapshot }> {
  const attempts = input.attempts ?? 6;
  const delayMs = input.delayMs ?? 400;
  const sleep = input.sleep ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));
  let last = input.pre;
  let lastResult: DiscoverManagedWindowResult = {
    ok: false,
    reasonCode: 'WINDOW_NOT_FOUND',
    candidates: [],
    message: 'I opened the resource but could not identify a distinct resulting window.',
  };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(delayMs);
    last = await input.perception.snapshot();
    lastResult = discoverManagedWindow({
      pre: input.pre.windows,
      post: last.windows,
      expectedProcessNames: input.expectedProcessNames,
      url: input.url,
      label: input.label,
      applicationId: input.applicationId,
    });
    if (lastResult.ok) return { ...lastResult, post: last };
  }
  return { ...lastResult, post: last };
}
