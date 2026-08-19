import { MAX_CHUNK_CHARS } from './constants';
import { newChunkId } from './documentId';
import type { DocumentChunk } from './types';

const CODE_BOUNDARY = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:function|class|interface|type|enum|const|let|var)\b/u;
const PY_BOUNDARY = /^(?:async\s+)?(?:def|class)\b/u;
const HEADING = /^(#{1,6})\s+(.+)$/u;

export function chunkDocument(input: {
  documentId: string;
  workspaceId: string;
  relativePath: string;
  text: string;
  modifiedAt?: string;
  contentHash?: string;
}): DocumentChunk[] {
  const ext = input.relativePath.toLowerCase();
  const lines = input.text.replace(/\r\n/gu, '\n').split('\n');
  const ranges = ext.endsWith('.md') || ext.endsWith('.txt')
    ? headingRanges(lines)
    : codeRanges(lines, ext.endsWith('.py'));
  return ranges.map(range => {
    const body = lines.slice(range.start - 1, range.end).join('\n').slice(0, MAX_CHUNK_CHARS);
    return {
      chunkId: newChunkId(input.documentId, range.start, range.heading),
      documentId: input.documentId,
      workspaceId: input.workspaceId,
      relativePath: input.relativePath,
      lineStart: range.start,
      lineEnd: range.end,
      heading: range.heading || undefined,
      body,
      modifiedAt: input.modifiedAt,
      contentHash: input.contentHash,
    };
  }).filter(chunk => chunk.body.trim());
}

function headingRanges(lines: string[]): Array<{ start: number; end: number; heading: string }> {
  const starts: Array<{ line: number; heading: string }> = [];
  lines.forEach((line, index) => {
    const match = line.match(HEADING);
    if (match) starts.push({ line: index + 1, heading: match[2]?.trim() || match[1] || '' });
  });
  if (starts.length === 0) return windowRanges(lines, 'document');
  const ranges: Array<{ start: number; end: number; heading: string }> = [];
  if (starts[0] && starts[0].line > 1) {
    ranges.push({ start: 1, end: starts[0].line - 1, heading: 'preamble' });
  }
  starts.forEach((item, index) => {
    const end = starts[index + 1] ? starts[index + 1]!.line - 1 : lines.length;
    ranges.push(...splitLong({ start: item.line, end, heading: item.heading }, lines));
  });
  return ranges;
}

function codeRanges(lines: string[], python: boolean): Array<{ start: number; end: number; heading: string }> {
  const starts: Array<{ line: number; heading: string }> = [];
  lines.forEach((line, index) => {
    if (python ? PY_BOUNDARY.test(line) : CODE_BOUNDARY.test(line)) {
      starts.push({ line: index + 1, heading: line.trim().slice(0, 80) });
    }
  });
  if (starts.length === 0) return windowRanges(lines, 'module');
  const ranges: Array<{ start: number; end: number; heading: string }> = [];
  if (starts[0] && starts[0].line > 1) {
    ranges.push({ start: 1, end: starts[0].line - 1, heading: 'module preamble' });
  }
  starts.forEach((item, index) => {
    const end = starts[index + 1] ? starts[index + 1]!.line - 1 : lines.length;
    ranges.push(...splitLong({ start: item.line, end, heading: item.heading }, lines));
  });
  return ranges;
}

function windowRanges(lines: string[], heading: string): Array<{ start: number; end: number; heading: string }> {
  const size = 80;
  const ranges: Array<{ start: number; end: number; heading: string }> = [];
  for (let start = 1; start <= lines.length; start += size) {
    ranges.push({ start, end: Math.min(lines.length, start + size - 1), heading });
  }
  return ranges;
}

function splitLong(
  range: { start: number; end: number; heading: string },
  lines: string[],
): Array<{ start: number; end: number; heading: string }> {
  const body = lines.slice(range.start - 1, range.end).join('\n');
  if (body.length <= MAX_CHUNK_CHARS) return [range];
  const out: Array<{ start: number; end: number; heading: string }> = [];
  let start = range.start;
  while (start <= range.end) {
    let end = start;
    let chars = 0;
    while (end <= range.end && chars + (lines[end - 1]?.length ?? 0) + 1 <= MAX_CHUNK_CHARS) {
      chars += (lines[end - 1]?.length ?? 0) + 1;
      end += 1;
    }
    if (end === start) end = start + 1;
    out.push({ start, end: Math.min(range.end, end - 1 || start), heading: range.heading });
    start = (end - 1 || start) + 1;
  }
  return out;
}

export function extractSymbols(relativePath: string, text: string): Array<{
  name: string;
  kind: 'class' | 'interface' | 'function' | 'constant' | 'type' | 'enum' | 'reference';
  lineStart: number;
}> {
  const lines = text.replace(/\r\n/gu, '\n').split('\n');
  const symbols: Array<{ name: string; kind: 'class' | 'interface' | 'function' | 'constant' | 'type' | 'enum' | 'reference'; lineStart: number }> = [];
  const patterns: Array<[RegExp, 'class' | 'interface' | 'function' | 'constant' | 'type' | 'enum']> = [
    [/(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_][\w]*)/u, 'class'],
    [/(?:export\s+)?interface\s+([A-Za-z_][\w]*)/u, 'interface'],
    [/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][\w]*)/u, 'function'],
    [/(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][\w]*)/u, 'constant'],
    [/(?:export\s+)?type\s+([A-Za-z_][\w]*)/u, 'type'],
    [/(?:export\s+)?enum\s+([A-Za-z_][\w]*)/u, 'enum'],
    [/^(?:async\s+)?def\s+([A-Za-z_][\w]*)/u, 'function'],
    [/^class\s+([A-Za-z_][\w]*)/u, 'class'],
  ];
  lines.forEach((line, index) => {
    for (const [pattern, kind] of patterns) {
      const match = line.match(pattern);
      if (match?.[1]) {
        symbols.push({ name: match[1], kind, lineStart: index + 1 });
        break;
      }
    }
    const imported = line.match(/\b(?:import|from)\s+.*\b([A-Z][A-Za-z0-9_]+)/u);
    if (imported?.[1] && !symbols.some(item => item.name === imported[1] && item.lineStart === index + 1)) {
      symbols.push({ name: imported[1], kind: 'reference', lineStart: index + 1 });
    }
  });
  return symbols;
}
