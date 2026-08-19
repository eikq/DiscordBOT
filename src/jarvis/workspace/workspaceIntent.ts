import type { ActionIntent } from '../capabilities/actions/actionIntent';
import {
  WORKSPACE_COMPARE,
  WORKSPACE_CURRENT,
  WORKSPACE_SEARCH,
  WORKSPACE_SYMBOL,
} from './constants';

const FILE_CUES = [
  'หาไฟล์',
  'ดูไฟล์',
  'เปิดไฟล์',
  'ค้นไฟล์',
  'ดู code',
  'ดูโค้ด',
  'หา code',
  'หาโค้ด',
  'เอกสาร',
  'สรุปเอกสาร',
  'สรุปไฟล์',
  'อยู่ตรงไหน',
  'อยู่ไฟล์ไหน',
  'พูดถึง',
  'find file',
  'search files',
  'where is',
  'look at the code',
  'look at code',
];

const WRITE_CUES = [
  'แก้ไฟล์',
  'แก้ไขไฟล์',
  'เขียนไฟล์',
  'ลบไฟล์',
  'ย้ายไฟล์',
  'เปลี่ยนชื่อไฟล์',
  'edit file',
  'write file',
  'delete file',
  'rename file',
  'move file',
];

const EXPAND_CUES = [
  'ขยาย workspace',
  'เพิ่ม root',
  'add root',
  'index c:',
  'workspace เป็น c:',
  'broaden include',
];

export function inferWorkspaceIntent(text: string): ActionIntent {
  const raw = text.trim();
  if (!raw) return { kind: 'none' };
  if (isOpenProjectFolder(raw)) return { kind: 'none' };
  if (isAmbiguousJarvisFile(raw)) return { kind: 'none' };

  if (EXPAND_CUES.some(cue => includesCue(raw, cue)) || /ขยาย workspace|index\s+[a-zA-Z]:\\/iu.test(raw)) {
    return {
      kind: 'blocked',
      reasonCode: 'WORKSPACE_MUTATION',
      userMessage: 'Workspace roots are host configuration. I cannot add or broaden them.',
    };
  }

  if (WRITE_CUES.some(cue => includesCue(raw, cue)) || /^(แก้|แก้ไข|ลบ|write|edit|delete|rename)\s+/iu.test(raw) && hasFileTarget(raw)) {
    const deleting = /ลบ|delete/iu.test(raw);
    return {
      kind: 'unsupported',
      reasonCode: deleting ? 'WRITE_UNSUPPORTED' : 'WRITE_UNSUPPORTED',
      userMessage: deleting
        ? 'JF-014 is read-only. I cannot delete files.'
        : 'JF-014 is read-only. I cannot edit or write owner documents.',
    };
  }

  if (isSensitiveRead(raw) || isAbsoluteRead(raw)) {
    return {
      kind: 'blocked',
      reasonCode: isSensitiveRead(raw) ? 'SENSITIVE_PATH' : 'BLOCKED_ARBITRARY_PATH',
      userMessage: 'That file is not available through the approved workspace.',
    };
  }

  if (!hasWorkspaceCue(raw)) return { kind: 'none' };

  const query = extractQuery(raw);
  if (/เทียบ|compare|vs\b/iu.test(raw) && splitCompare(query).length === 2) {
    const [leftQuery, rightQuery] = splitCompare(query);
    return {
      kind: 'action',
      consumed: true,
      calls: [{ id: WORKSPACE_COMPARE, input: { leftQuery, rightQuery } }],
    };
  }

  if (/อยู่ตรงไหน|อยู่ไฟล์ไหน|where is|find symbol/iu.test(raw) || looksLikeSymbol(query)) {
    return {
      kind: 'action',
      consumed: true,
      calls: [{ id: WORKSPACE_SYMBOL, input: { query: extractSymbol(query) || query || raw } }],
    };
  }

  if (/สรุป|summarize/iu.test(raw)) {
    return {
      kind: 'action',
      consumed: Boolean(query),
      calls: [{
        id: WORKSPACE_CURRENT,
        input: { query: query || raw, mode: 'summarize' },
      }],
    };
  }

  if (!query) return { kind: 'none' };

  return {
    kind: 'action',
    consumed: true,
    calls: [{
      id: /หาไฟล์|search files|find file|เอกสารไหน|ดู code|ดูโค้ด/iu.test(raw) ? WORKSPACE_SEARCH : WORKSPACE_CURRENT,
      input: { query },
    }],
  };
}

export function hasWorkspaceCue(text: string): boolean {
  return FILE_CUES.some(cue => includesCue(text, cue))
    || /\b(project_context|jf-?012|jf-?013|jf-?014|capabilityhost|permissionpolicy)\b/iu.test(text)
    || /หาไฟล์|ดูไฟล์|เอกสาร|อยู่ตรงไหน|อยู่ไฟล์ไหน|ดู code|ดูโค้ด/iu.test(text)
    || ((/เทียบ|compare/iu.test(text)) && /\b(jf-?012|jf-?013|เอกสาร|ไฟล์|\.md)\b/iu.test(text));
}

function isOpenProjectFolder(text: string): boolean {
  return /เปิด|open/iu.test(text) && /โปรเจกต์|project|โฟลเดอร์|folder/iu.test(text) && /jarvis/iu.test(text);
}

function isAmbiguousJarvisFile(text: string): boolean {
  return /^(เปิดไฟล์ jarvis|open (?:the )?jarvis file)$/iu.test(text.trim());
}

function hasFileTarget(text: string): boolean {
  return /ไฟล์|\.md|\.ts|project_context|document/iu.test(text);
}

function isSensitiveRead(text: string): boolean {
  const fileLike = /(\.env(?:\.\w+)?|id_rsa|id_ed25519|credentials\.\w+|jarvis\.db|memory\.db|automation\.db|research\.db|workspace\.db)/iu;
  const read = /อ่าน|read\s+|เปิดไฟล์|ดูไฟล์/iu;
  const thaiCreds = /อ่าน\s+credentials/iu;
  const skillRead = /skill.{0,80}(credentials|secrets?|\.env|id_rsa|id_ed25519)/iu;
  return (read.test(text) && fileLike.test(text)) || thaiCreds.test(text) || skillRead.test(text);
}

function isAbsoluteRead(text: string): boolean {
  return /[A-Za-z]:\\/u.test(text) || /\\\\/u.test(text) || /อ่าน\s+\.\.\//u.test(text) || /read\s+\.\.\//iu.test(text);
}

function looksLikeSymbol(query: string): boolean {
  return /^[A-Z][A-Za-z0-9]{2,}$/u.test(query.trim());
}

function extractSymbol(query: string): string {
  return query.match(/\b([A-Z][A-Za-z0-9]{2,})\b/u)?.[1] ?? query;
}

function extractQuery(text: string): string {
  let leftover = text;
  const strip = [
    ...FILE_CUES,
    'jarvis',
    'please',
    'ช่วย',
    'ให้หน่อย',
    'ให้ที',
    'หน่อย',
    'ครับ',
    'นะ',
    'ดู',
    'หา',
    'ลอง',
    'เกี่ยวกับ',
    'เรื่อง',
    'ตรงไหน',
    'ไฟล์ไหน',
    'can you',
    'please',
    'about',
    'the code',
    'code',
  ];
  for (const cue of strip) {
    leftover = leftover.replace(new RegExp(escapeRegExp(cue), 'ig'), ' ');
  }
  return leftover.replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

function splitCompare(query: string): string[] {
  return query.split(/\s*(?:กับ|and|vs\.?|versus)\s*/iu).map(item => item.trim()).filter(Boolean);
}

function includesCue(text: string, cue: string): boolean {
  return text.toLocaleLowerCase().includes(cue.toLocaleLowerCase());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
