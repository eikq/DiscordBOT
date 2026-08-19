export type MutationGuardInput = {
  method?: string;
  host?: string;
  origin?: string;
  referer?: string;
  secFetchSite?: string;
  contentType?: string;
  contentLength?: number;
  url?: string;
};

export type MutationGuardOptions = {
  bindHost: string;
  port: number;
  maxBodyBytes?: number;
  allowedOrigins?: string[];
};

export type MutationGuardResult =
  | { ok: true }
  | { ok: false; status: number; reasonCode: string; error: string };

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function isLoopbackBindHost(host: string): boolean {
  const normalized = stripBrackets(host).toLowerCase();
  return LOOPBACK_HOSTS.has(normalized);
}

export function enforceLoopbackBindHost(host: string, standalone: boolean): string {
  const candidate = host?.trim() || '127.0.0.1';
  if (!standalone) return candidate;
  if (isLoopbackBindHost(candidate)) return candidate === 'localhost' ? '127.0.0.1' : candidate;
  return '127.0.0.1';
}

export function defaultMutationOrigins(port: number): string[] {
  return [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
  ];
}

export function assertLocalMutationRequest(
  input: MutationGuardInput,
  options: MutationGuardOptions,
): MutationGuardResult {
  const parsedHost = parseHostHeader(input.host);
  if (!parsedHost || !isLoopbackBindHost(parsedHost.hostname)) {
    return fail(403, 'INVALID_HOST', 'Jarvis mutations are restricted to loopback.');
  }
  if (parsedHost.port !== undefined && parsedHost.port !== options.port) {
    return fail(403, 'INVALID_HOST', 'Jarvis mutations are restricted to loopback.');
  }

  const secFetchSite = input.secFetchSite?.trim().toLowerCase();
  if (secFetchSite === 'cross-site') {
    return fail(403, 'INVALID_ORIGIN', 'Cross-origin Jarvis mutations are not allowed.');
  }

  const allowed = options.allowedOrigins ?? defaultMutationOrigins(options.port);
  const origin = input.origin?.trim();
  if (origin) {
    const parsedOrigin = originOf(origin);
    if (!parsedOrigin || !allowed.includes(parsedOrigin)) {
      return fail(403, 'INVALID_ORIGIN', 'Cross-origin Jarvis mutations are not allowed.');
    }
  } else if (input.referer?.trim()) {
    const refererOrigin = originOf(input.referer);
    if (!refererOrigin || !allowed.includes(refererOrigin)) {
      return fail(403, 'INVALID_ORIGIN', 'Cross-origin Jarvis mutations are not allowed.');
    }
  }

  const method = (input.method || 'POST').toUpperCase();
  if (method !== 'POST') {
    return fail(405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed.');
  }

  const contentType = (input.contentType || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return fail(415, 'UNSUPPORTED_MEDIA_TYPE', 'application/json is required.');
  }

  const maxBodyBytes = options.maxBodyBytes ?? 16_384;
  if (typeof input.contentLength === 'number' && Number.isFinite(input.contentLength) && input.contentLength > maxBodyBytes) {
    return fail(413, 'BODY_TOO_LARGE', 'Request body is too large.');
  }

  if (input.url && /[?&](?:token|confirmationToken|confirmToken)=/iu.test(input.url)) {
    return fail(400, 'TOKEN_IN_QUERY', 'Confirmation tokens cannot be sent in the query string.');
  }

  return { ok: true };
}

function parseHostHeader(raw?: string): { hostname: string; port?: number } | undefined {
  const value = (raw || '').split(',')[0].trim();
  if (!value) return undefined;
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end < 0) return undefined;
    const hostname = stripBrackets(value.slice(0, end + 1));
    const rest = value.slice(end + 1);
    const port = rest.startsWith(':') ? Number(rest.slice(1)) : undefined;
    if (port !== undefined && !Number.isInteger(port)) return undefined;
    return { hostname, port };
  }
  const parts = value.split(':');
  if (parts.length === 2) {
    const port = Number(parts[1]);
    if (!Number.isInteger(port)) return undefined;
    return { hostname: parts[0], port };
  }
  if (parts.length !== 1) return undefined;
  return { hostname: value };
}

function stripBrackets(host: string): string {
  return host.replace(/^\[|\]$/g, '');
}

function originOf(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function fail(status: number, reasonCode: string, error: string): MutationGuardResult {
  return { ok: false, status, reasonCode, error };
}
