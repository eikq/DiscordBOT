import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupFn } from './types';

export type UrlPolicyResult =
  | { ok: true; url: URL; hostname: string }
  | { ok: false; reasonCode: string; userMessage: string };

const BLOCKED_SCHEMES = new Set([
  'file:',
  'javascript:',
  'data:',
  'vbscript:',
  'about:',
  'blob:',
  'ftp:',
  'ws:',
  'wss:',
]);

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.google.com',
  'metadata',
  'metadata.internal',
  'instance-data',
  'kubernetes.default.svc',
]);

export function classifyResearchUrl(raw: string): UrlPolicyResult {
  if (typeof raw !== 'string') {
    return { ok: false, reasonCode: 'MALFORMED_URL', userMessage: 'That URL is not valid.' };
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048 || /[\u0000-\u001F\u007F]/.test(trimmed)) {
    return { ok: false, reasonCode: 'MALFORMED_URL', userMessage: 'That URL is not valid.' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reasonCode: 'MALFORMED_URL', userMessage: 'That URL is not valid.' };
  }
  const scheme = parsed.protocol.toLowerCase();
  if (BLOCKED_SCHEMES.has(scheme)) {
    return { ok: false, reasonCode: 'BLOCKED_URL_SCHEME', userMessage: 'Only public http(s) URLs can be fetched.' };
  }
  if (scheme !== 'http:' && scheme !== 'https:') {
    return { ok: false, reasonCode: 'BLOCKED_URL_SCHEME', userMessage: 'Only public http(s) URLs can be fetched.' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reasonCode: 'BLOCKED_URL_CREDENTIALS', userMessage: 'URLs with credentials are not allowed.' };
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname) {
    return { ok: false, reasonCode: 'MALFORMED_URL', userMessage: 'That URL is not valid.' };
  }
  if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith('.local') || hostname.endsWith('.localhost')) {
    return { ok: false, reasonCode: 'BLOCKED_PRIVATE_NETWORK', userMessage: 'Private or local destinations are blocked.' };
  }
  if (isBlockedIpLiteral(hostname)) {
    return { ok: false, reasonCode: reasonForIp(hostname), userMessage: 'Private or local destinations are blocked.' };
  }
  return { ok: true, url: parsed, hostname };
}

export async function assertPublicDestination(
  raw: string,
  lookup: LookupFn = defaultLookup,
): Promise<UrlPolicyResult> {
  const classified = classifyResearchUrl(raw);
  if (!classified.ok) return classified;
  if (isBlockedIpLiteral(classified.hostname)) {
    return { ok: false, reasonCode: reasonForIp(classified.hostname), userMessage: 'Private or local destinations are blocked.' };
  }
  let addresses: string[];
  try {
    addresses = await lookup(classified.hostname);
  } catch {
    return { ok: false, reasonCode: 'DNS_FAILED', userMessage: 'That host could not be resolved.' };
  }
  if (!addresses.length) {
    return { ok: false, reasonCode: 'DNS_FAILED', userMessage: 'That host could not be resolved.' };
  }
  for (const address of addresses) {
    if (isBlockedIpLiteral(address)) {
      return { ok: false, reasonCode: reasonForIp(address), userMessage: 'Private or local destinations are blocked.' };
    }
  }
  return classified;
}

export function resolveRedirect(current: string, location: string): UrlPolicyResult {
  try {
    return classifyResearchUrl(new URL(location, current).href);
  } catch {
    return { ok: false, reasonCode: 'MALFORMED_URL', userMessage: 'Redirect target is not valid.' };
  }
}

export function canonicalizeUrl(raw: string): string {
  const classified = classifyResearchUrl(raw);
  if (!classified.ok) return raw.trim();
  const url = classified.url;
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_|fbclid|gclid|mc_cid|mc_eid/iu.test(key)) url.searchParams.delete(key);
  }
  let host = url.hostname.toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);
  url.hostname = host;
  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
    url.port = '';
  }
  let path = url.pathname || '/';
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  url.pathname = path;
  return url.href;
}

export function domainOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./iu, '').toLowerCase();
  } catch {
    return '';
  }
}

export function isBlockedIpLiteral(value: string): boolean {
  const ip = value.replace(/^\[|\]$/g, '');
  if (/^\d+\.\d+\.\d+\.\d+$/u.test(ip)) return isBlockedIpv4(ip);
  if (!ip.includes(':')) return false;
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu);
  if (mapped) return isBlockedIpv4(mapped[1]);
  const first = ip.split(':')[0]?.toLowerCase() ?? '';
  if (first === 'fe80') return true;
  if (first.startsWith('fc') || first.startsWith('fd')) return true;
  return false;
}

export function reasonForIp(ip: string): string {
  const value = ip.replace(/^\[|\]$/g, '');
  if (value === '::1' || value === '127.0.0.1' || value.startsWith('127.')) return 'BLOCKED_LOOPBACK';
  if (value === '169.254.169.254' || value.startsWith('169.254.')) return 'BLOCKED_METADATA';
  if (value.startsWith('fe80:') || value.startsWith('169.254.')) return 'BLOCKED_LINK_LOCAL';
  return 'BLOCKED_PRIVATE_NETWORK';
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

async function defaultLookup(hostname: string): Promise<string[]> {
  if (isBlockedIpLiteral(hostname)) return [hostname];
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map(item => item.address);
}
