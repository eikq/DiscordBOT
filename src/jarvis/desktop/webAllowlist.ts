/** Owner-approved web hosts for scoped OPEN. Not a general browser. */

export const DEFAULT_ALLOWLISTED_WEB_HOSTS = [
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'www.youtu.be',
] as const;

export function normalizeHost(host: string): string {
  return host.trim().toLocaleLowerCase().replace(/\.$/, '');
}

export function hostAllowed(host: string, allowlisted: readonly string[] = DEFAULT_ALLOWLISTED_WEB_HOSTS): boolean {
  const normalized = normalizeHost(host);
  return allowlisted.some(item => {
    const allowed = normalizeHost(item);
    return normalized === allowed || normalized.endsWith(`.${allowed}`);
  });
}

export function urlHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
