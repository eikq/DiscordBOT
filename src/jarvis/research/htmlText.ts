import { MAX_EXCERPT_CHARS, MAX_TITLE_CHARS } from './constants';

export function webpageTextAsData(value: string, max = MAX_EXCERPT_CHARS): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style[\s\S]*?<\/style>/giu, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/giu, ' ')
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&#39;|&quot;/giu, "'");
}

export function extractTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/iu)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/iu);
  if (og?.[1]) return webpageTextAsData(decodeBasic(og[1]), MAX_TITLE_CHARS);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu);
  if (title?.[1]) return webpageTextAsData(stripHtml(title[1]), MAX_TITLE_CHARS);
  return '';
}

export function extractPublishedAt(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)/iu,
    /<meta[^>]+name=["'](?:pubdate|publishdate|date|dc\.date)["'][^>]+content=["']([^"']+)/iu,
    /<time[^>]+datetime=["']([^"']+)/iu,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    const parsed = Date.parse(match[1]);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

export function extractUpdatedAt(html: string): string | null {
  const match = html.match(/<meta[^>]+property=["']article:modified_time["'][^>]+content=["']([^"']+)/iu);
  if (!match?.[1]) return null;
  const parsed = Date.parse(match[1]);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function firstParagraphs(text: string, max = MAX_EXCERPT_CHARS): string {
  return webpageTextAsData(text, max);
}

function decodeBasic(value: string): string {
  return value.replace(/&amp;/giu, '&').replace(/&quot;/giu, '"');
}
