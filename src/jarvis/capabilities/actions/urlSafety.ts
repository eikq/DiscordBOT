import type { ActionRisk, DesktopAllowlists } from './types';

const BLOCKED_SCHEMES = new Set([
  'javascript:',
  'file:',
  'data:',
  'vbscript:',
  'about:',
  'blob:',
  'shell:',
]);

export type UrlClassification = {
  ok: boolean;
  risk?: ActionRisk;
  reasonCode?: string;
  normalized?: string;
  target?: string;
};

function isTrustedLocal(parsed: URL, lists: Pick<DesktopAllowlists, 'trustedOrigins' | 'trustedPathPrefixes'>): boolean {
  if (!lists.trustedOrigins.includes(parsed.origin)) return false;
  return lists.trustedPathPrefixes.some(prefix => {
    const normalized = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    return parsed.pathname === normalized || parsed.pathname.startsWith(`${normalized}/`);
  });
}

export function classifyOpenUrl(
  raw: string,
  lists: Pick<DesktopAllowlists, 'trustedOrigins' | 'trustedPathPrefixes'>,
): UrlClassification {
  if (typeof raw !== 'string') return { ok: false, reasonCode: 'INVALID_URL' };
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return { ok: false, reasonCode: 'INVALID_URL' };
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return { ok: false, reasonCode: 'INVALID_URL' };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reasonCode: 'INVALID_URL' };
  }
  const scheme = parsed.protocol.toLowerCase();
  if (BLOCKED_SCHEMES.has(scheme) || (!scheme.startsWith('http') && scheme !== 'https:')) {
    return { ok: false, reasonCode: 'BLOCKED_URL_SCHEME', risk: 'BLOCKED' };
  }
  if (scheme !== 'https:' && scheme !== 'http:') {
    return { ok: false, reasonCode: 'BLOCKED_URL_SCHEME', risk: 'BLOCKED' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reasonCode: 'BLOCKED_URL_CREDENTIALS', risk: 'BLOCKED' };
  }
  const trusted = isTrustedLocal(parsed, lists);
  if (scheme === 'http:') {
    if (!trusted) return { ok: false, reasonCode: 'BLOCKED_URL_SCHEME', risk: 'BLOCKED' };
    return { ok: true, risk: 'LOW_RISK_ACTION', normalized: parsed.href, target: parsed.href };
  }
  if (trusted) {
    return { ok: true, risk: 'LOW_RISK_ACTION', normalized: parsed.href, target: parsed.href };
  }
  return { ok: true, risk: 'CONFIRM_REQUIRED', normalized: parsed.href, target: parsed.href };
}

export function urlTargetClass(url: string, lists: Pick<DesktopAllowlists, 'trustedOrigins' | 'trustedPathPrefixes'>): string {
  const classified = classifyOpenUrl(url, lists);
  if (!classified.ok) return `url:${classified.reasonCode || 'invalid'}`;
  if (classified.risk === 'LOW_RISK_ACTION') return 'url:trusted-local';
  return 'url:https-external';
}
