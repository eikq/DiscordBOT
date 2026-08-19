import fs from 'node:fs';

const MAX_FRONTMATTER_CHARS = 4_096;
const MAX_METADATA_VALUE_CHARS = 1_024;

export type ParsedSkillDocument = {
  name: string;
  description: string;
  version?: string;
  instructions: string;
};

type ParsedHeader = Omit<ParsedSkillDocument, 'instructions'> & {
  bodyOffset: number;
};

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseHeader(text: string): ParsedHeader {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) {
    throw new Error('SKILL.md must start with YAML frontmatter.');
  }
  const normalized = text.replaceAll('\r\n', '\n');
  const closing = normalized.indexOf('\n---\n', 4);
  if (closing < 0 || closing > MAX_FRONTMATTER_CHARS) {
    throw new Error('SKILL.md frontmatter is missing or exceeds 4096 characters.');
  }
  const values = new Map<string, string>();
  const lines = normalized.slice(4, closing).split('\n');
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) throw new Error(`Unsupported frontmatter line: ${line.slice(0, 80)}`);
    const key = line.slice(0, colon).trim();
    if (!['name', 'description', 'version'].includes(key)) continue;
    if (values.has(key)) throw new Error(`Duplicate frontmatter key: ${key}`);
    const value = stripQuotes(line.slice(colon + 1));
    if (!value || value.length > MAX_METADATA_VALUE_CHARS) {
      throw new Error(`Invalid frontmatter value for ${key}.`);
    }
    values.set(key, value);
  }
  const name = values.get('name');
  const description = values.get('description');
  if (!name || !description) throw new Error('SKILL.md requires name and description frontmatter.');
  return {
    name,
    description,
    ...(values.get('version') ? { version: values.get('version') } : {}),
    bodyOffset: closing + '\n---\n'.length,
  };
}

export function readSkillMetadataPrefix(filePath: string): Omit<ParsedSkillDocument, 'instructions'> {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(MAX_FRONTMATTER_CHARS + 16);
    const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    const header = parseHeader(buffer.subarray(0, bytesRead).toString('utf8'));
    return {
      name: header.name,
      description: header.description,
      ...(header.version ? { version: header.version } : {}),
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

export function readSkillDocument(filePath: string, maxChars: number): ParsedSkillDocument {
  const size = fs.statSync(filePath).size;
  if (size > maxChars) throw new Error(`SKILL.md exceeds the ${maxChars}-character policy limit.`);
  const text = fs.readFileSync(filePath, 'utf8');
  const header = parseHeader(text);
  const normalized = text.replaceAll('\r\n', '\n');
  const instructions = normalized.slice(header.bodyOffset).trim();
  if (!instructions) throw new Error('SKILL.md instruction body is empty.');
  return {
    name: header.name,
    description: header.description,
    ...(header.version ? { version: header.version } : {}),
    instructions,
  };
}
