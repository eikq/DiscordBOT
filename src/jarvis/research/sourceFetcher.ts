import { FETCH_TIMEOUT_MS, MAX_BODY_BYTES, MAX_REDIRECTS } from './constants';
import {
  assertPublicDestination,
  classifyResearchUrl,
  resolveRedirect,
  type UrlPolicyResult,
} from './networkPolicy';
import type { FetchSuccess, LookupFn, ResearchHttpGet } from './types';

const ALLOWED_TYPES = [
  'text/html',
  'text/plain',
  'application/json',
  'application/xhtml+xml',
  'application/xml',
  'text/xml',
];

export class SourceFetcher {
  constructor(
    private readonly get: ResearchHttpGet,
    private readonly lookup: LookupFn,
  ) {}

  public async fetchPublic(url: string): Promise<FetchSuccess> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const allowed = await assertPublicDestination(current, this.lookup);
      if (allowed.ok === false) {
        throw Object.assign(new Error(allowed.userMessage), { reasonCode: allowed.reasonCode });
      }
      const response = await this.get(allowed.url.href, {
        timeoutMs: FETCH_TIMEOUT_MS,
        headers: {
          accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9',
          'user-agent': 'JarvisResearch/1.0 (read-only local assistant)',
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.location || response.headers.Location;
        if (!location) {
          throw Object.assign(new Error('Redirect was missing a Location header.'), { reasonCode: 'REDIRECT_INVALID' });
        }
        if (hop === MAX_REDIRECTS) {
          throw Object.assign(new Error('Too many redirects.'), { reasonCode: 'TOO_MANY_REDIRECTS' });
        }
        const next = resolveRedirect(allowed.url.href, location);
        await this.guardRedirect(next);
        if (next.ok === false) {
          throw Object.assign(new Error(next.userMessage), { reasonCode: next.reasonCode });
        }
        current = next.url.href;
        continue;
      }
      if (response.status >= 400) {
        throw Object.assign(new Error(`Source returned HTTP ${response.status}.`), { reasonCode: 'FETCH_FAILED' });
      }
      if (response.body.byteLength > MAX_BODY_BYTES) {
        throw Object.assign(new Error('Source response is too large.'), { reasonCode: 'RESPONSE_TOO_LARGE' });
      }
      const contentType = (response.headers['content-type'] || response.headers['Content-Type'] || '').split(';')[0].trim().toLowerCase();
      if (contentType && !ALLOWED_TYPES.some(type => contentType.startsWith(type))) {
        throw Object.assign(new Error('Unsupported content type.'), { reasonCode: 'UNSUPPORTED_CONTENT_TYPE' });
      }
      return {
        url,
        finalUrl: allowed.url.href,
        contentType: contentType || 'text/html',
        bodyText: new TextDecoder('utf-8', { fatal: false }).decode(response.body),
        status: response.status,
      };
    }
    throw Object.assign(new Error('Too many redirects.'), { reasonCode: 'TOO_MANY_REDIRECTS' });
  }

  private async guardRedirect(next: UrlPolicyResult): Promise<void> {
    if (next.ok === false) {
      throw Object.assign(new Error(next.userMessage), { reasonCode: next.reasonCode });
    }
    const hop = await assertPublicDestination(next.url.href, this.lookup);
    if (hop.ok === false) {
      throw Object.assign(new Error(hop.userMessage), { reasonCode: hop.reasonCode });
    }
  }
}

export async function nodeResearchGet(url: string, init: {
  timeoutMs: number;
  headers: Record<string, string>;
}): Promise<{ status: number; headers: Record<string, string>; body: Uint8Array }> {
  const classified = classifyResearchUrl(url);
  if (classified.ok === false) {
    throw Object.assign(new Error(classified.userMessage), { reasonCode: classified.reasonCode });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs);
  try {
    const reply = await fetch(classified.url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: init.headers,
    });
    const headers: Record<string, string> = {};
    reply.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const declared = Number(headers['content-length'] || 0);
    if (declared > MAX_BODY_BYTES) {
      throw Object.assign(new Error('Source response is too large.'), { reasonCode: 'RESPONSE_TOO_LARGE' });
    }
    const buffer = await readBoundedBody(reply);
    return { status: reply.status, headers, body: buffer };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw Object.assign(new Error('Source fetch timed out.'), { reasonCode: 'TIMEOUT' });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedBody(reply: Response): Promise<Uint8Array> {
  const stream = reply.body;
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw Object.assign(new Error('Source response is too large.'), { reasonCode: 'RESPONSE_TOO_LARGE' });
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
