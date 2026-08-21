/**
 * Session-scoped web opens. Not permanent trust. Not authority for other hosts.
 */

export type WebGrantScope = 'ALLOW_THIS_URL_ONCE' | 'ALLOW_THIS_DOMAIN_FOR_SESSION';

export class SessionWebGrantStore {
  private readonly urls = new Set<string>();
  private readonly hosts = new Set<string>();

  public grant(url: string, scope: WebGrantScope): void {
    const normalized = normalizeUrl(url);
    if (!normalized) return;
    if (scope === 'ALLOW_THIS_URL_ONCE' || scope === 'ALLOW_THIS_DOMAIN_FOR_SESSION') {
      this.urls.add(normalized);
    }
    if (scope === 'ALLOW_THIS_DOMAIN_FOR_SESSION') {
      const host = hostOf(normalized);
      if (host) this.hosts.add(host);
    }
  }

  public allows(url: string): boolean {
    const normalized = normalizeUrl(url);
    if (!normalized) return false;
    if (this.urls.has(normalized)) return true;
    const host = hostOf(normalized);
    return Boolean(host && this.hosts.has(host));
  }

  public clear(): void {
    this.urls.clear();
    this.hosts.clear();
  }
}

function normalizeUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
    parsed.hash = '';
    return parsed.href;
  } catch {
    return undefined;
  }
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./iu, '');
  } catch {
    return undefined;
  }
}
