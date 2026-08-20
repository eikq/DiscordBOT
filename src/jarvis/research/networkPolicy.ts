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
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata.google.com',
  'metadata.goog',
  'metadata',
  'metadata.internal',
  'instance-data',
  'kubernetes.default.svc',
]);

/** Azure IMDS / wireserver. Not RFC1918, but a cloud metadata hop. */
const BLOCKED_METADATA_IPV4 = new Set(['168.63.129.16']);

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
  if (hostnameEmbedsBlockedIpv4(hostname) || isBlockedIpLiteral(hostname)) {
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
  const ip = value.replace(/^\[|\]$/g, '').toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/u.test(ip)) return isBlockedIpv4(ip);
  if (!ip.includes(':')) return false;
  return isBlockedIpv6(ip);
}

export function reasonForIp(ip: string): string {
  const value = ip.replace(/^\[|\]$/g, '').toLowerCase();
  const mapped = ipv4FromIpv6Mapped(value);
  const v4 = /^\d+\.\d+\.\d+\.\d+$/u.test(value) ? value : mapped;
  if (value === '::1' || value === '0:0:0:0:0:0:0:1' || (v4 && (v4 === '127.0.0.1' || v4.startsWith('127.')))) {
    return 'BLOCKED_LOOPBACK';
  }
  if (v4 === '169.254.169.254' || (v4 && v4.startsWith('169.254.')) || (v4 && BLOCKED_METADATA_IPV4.has(v4))) {
    return 'BLOCKED_METADATA';
  }
  if (value === '::' || value.startsWith('fe80:') || value.startsWith('ff') || (v4 && v4.startsWith('169.254.'))) {
    return 'BLOCKED_LINK_LOCAL';
  }
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
  if (a >= 224) return true;
  if (BLOCKED_METADATA_IPV4.has(ip)) return true;
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  if (ip === '::' || ip === '::0' || ip === '0:0:0:0:0:0:0:0') return true;
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;
  const mapped = ipv4FromIpv6Mapped(ip);
  if (mapped) return isBlockedIpv4(mapped);
  const first = firstIpv6Hextet(ip);
  if (first === 'fe80') return true;
  if (first.startsWith('fc') || first.startsWith('fd')) return true;
  if (first.startsWith('ff')) return true;
  return false;
}

/** Node canonicalizes [::ffff:127.0.0.1] to [::ffff:7f00:1]. Decode both forms. */
function ipv4FromIpv6Mapped(ip: string): string | undefined {
  const dotted = ip.match(/^(?:0:){5}ffff:(\d+\.\d+\.\d+\.\d+)$/u)
    || ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u);
  if (dotted) return dotted[1];
  const hex = ip.match(/^(?:0:){5}ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u)
    || ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u);
  if (!hex) return undefined;
  const hi = Number.parseInt(hex[1], 16);
  const lo = Number.parseInt(hex[2], 16);
  if (!Number.isInteger(hi) || !Number.isInteger(lo) || hi < 0 || lo < 0 || hi > 0xffff || lo > 0xffff) {
    return undefined;
  }
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

function firstIpv6Hextet(ip: string): string {
  for (const part of ip.split(':')) {
    if (part) return part;
  }
  return '';
}

/** 127.0.0.1.nip.io / 10.0.0.1.example style embeddings. DNS rebinding still needs assertPublicDestination. */
function hostnameEmbedsBlockedIpv4(hostname: string): boolean {
  const labels = hostname.split('.');
  if (labels.length < 5) return false;
  const maybe = labels.slice(0, 4).join('.');
  if (!/^\d+\.\d+\.\d+\.\d+$/u.test(maybe)) return false;
  return isBlockedIpv4(maybe);
}

async function defaultLookup(hostname: string): Promise<string[]> {
  if (isBlockedIpLiteral(hostname)) return [hostname];
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map(item => item.address);
}
