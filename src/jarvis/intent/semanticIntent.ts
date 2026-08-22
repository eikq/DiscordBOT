/**
 * Language interpretation only. Output is bounded structured data.
 * Not capability authority and not a brand phrase switch.
 */

import { parseDisplaySelector, type DisplaySelector } from '../desktop/monitorTopology';
import type { InteractionContext } from './types';

export const SEMANTIC_ACTIONS = [
  'OPEN',
  'PLACE',
  'FOCUS',
  'MOVE_BACK',
  'RESEARCH',
  'RESEARCH_FOLLOWUP',
  'TEACH_ALIAS',
  'FORGET_ALIAS',
  'ASK_MEMORY',
  'REMEMBER_PREFERENCE',
  'LIST_DISPLAYS',
  'INSPECT_CONTAINMENT',
  'CLEAR_CONTAINMENT',
  'BUILD_WEBSITE',
  'BUILD_SOFTWARE',
  'APPLY_BUILD',
  'APPROVE_PLAN',
  'CLICK',
  'TYPE',
  'SUBMIT',
  'CONTINUE',
  'CANCEL',
  'UNKNOWN',
] as const;

export type SemanticAction = (typeof SEMANTIC_ACTIONS)[number];

export const SEMANTIC_OBJECT_TYPES = [
  'WEBSITE',
  'APPLICATION',
  'PROJECT',
  'DISPLAY',
  'DOCUMENT',
  'SOURCE',
  'WINDOW',
  'UNKNOWN',
] as const;

export type SemanticObjectType = (typeof SEMANTIC_OBJECT_TYPES)[number];

export type SemanticReference =
  | 'it'
  | 'that'
  | 'this'
  | 'the-other'
  | 'same'
  | 'back'
  | 'official'
  | 'second-source'
  | 'there';

export type SemanticIntent = {
  action: SemanticAction;
  objectType: SemanticObjectType;
  entity?: string;
  target?: string;
  display?: DisplaySelector | null;
  temporalConstraint?: string;
  scope?: string;
  modifiers: string[];
  references: SemanticReference[];
  aliasPhrase?: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  mixedLanguage: boolean;
};

const ADDRESS = /^\s*((?:hey\s+)?jarvis[,.!?]*\s*|จาร์วิส[,.!?]*\s*)+/iu;
const DISPLAY_PHRASE = /(?:\b(?:on|in|to|at|onto|into)\b|\bที่\b|\bบน\b|\bไป\b)?\s*(?:my\s+|the\s+)?(?:notebook|note\s*book|laptop|built-?\s*in|internal|main|primary|second(?:ary)?|left|right|upper|lower|gaming|other|โน้ตบุ๊ก|เครื่อง)?\s*(?:monitor|display|screen|moniter|จอ)(?:\s*(?:โน้ตบุ๊ก|เครื่อง|หลัก|ขวา|ซ้าย|ที่สอง|2|two))?/giu;
const WEBSITE_MARK = /website|web\s*site|\bsite\b|homepage|official\s+site|เว็บ(?:ไซต์)?/iu;
const PROJECT_MARK = /\bproject\b|โปรเจกต์|โปรเจค/iu;
const OPEN_VERB = /\b(open|launch|start|put|show|bring|move)\b|เปิด|เอา|วาง|ย้าย/iu;
const CLICK_VERB = /\b(click|type|submit|drag|fill this in)\b|คลิก|พิมพ์|ส่งฟอร์ม/iu;

export function normalizeDisplayText(text: string): string {
  return text
    .replace(/\bnote\s*book\b/giu, 'notebook')
    .replace(/\bmoniter\b/giu, 'monitor')
    .replace(/\bbuilt\s*in\b/giu, 'built-in');
}

export function interpretSemanticIntent(
  text: string,
  options: { context?: InteractionContext | null } = {},
): SemanticIntent {
  const mixedLanguage = /[A-Za-z]/.test(text) && /[\u0E00-\u0E7F]/.test(text);
  const raw = normalizeDisplayText(text.replace(ADDRESS, '').trim());
  const display = parseDisplaySelector(raw);
  const references = extractReferences(raw);
  const base = emptyIntent(mixedLanguage, display, references);

  const listed = matchListDisplays(raw);
  if (listed) return { ...base, ...listed, confidence: 'HIGH' };
  const containment = matchContainment(raw, options.context);
  if (containment) return { ...base, ...containment, confidence: 'HIGH' };
  const working = matchWorkingProject(raw);
  if (working) return { ...base, ...working, confidence: 'HIGH' };
  const taught = matchTeachAlias(raw);
  if (taught) return { ...base, ...taught, confidence: 'HIGH' };
  const forgotten = matchForgetAlias(raw);
  if (forgotten) return { ...base, ...forgotten, confidence: 'HIGH' };
  const asked = matchAskMemory(raw);
  if (asked) return { ...base, ...asked, confidence: 'HIGH' };
  const preference = matchPreference(raw);
  if (preference) return { ...base, ...preference, confidence: 'HIGH' };
  const build = matchBuild(raw);
  if (build) return { ...base, ...build, confidence: 'HIGH' };
  const apply = matchApplyBuild(raw);
  if (apply) return { ...base, ...apply, confidence: 'HIGH' };
  const approve = matchApprovePlan(raw);
  if (approve) return { ...base, ...approve, confidence: 'HIGH' };

  if (CLICK_VERB.test(raw) && !OPEN_VERB.test(raw)) {
    return {
      ...base,
      action: /type|พิมพ์/iu.test(raw) ? 'TYPE' : /submit|ส่งฟอร์ม/iu.test(raw) ? 'SUBMIT' : 'CLICK',
      objectType: 'UNKNOWN',
      entity: leftoverEntity(raw),
      confidence: 'HIGH',
    };
  }

  if (/\bfocus\b|to the front|โฟกัส|ดึงมาหน้า/iu.test(raw)) {
    return {
      ...base,
      action: 'FOCUS',
      objectType: options.context?.lastOpenedResource ? objectTypeFromKind(options.context.lastOpenedResource.kind) : guessObjectType(leftoverEntity(raw) || ''),
      entity: leftoverEntity(raw) || options.context?.lastOpenedResource?.label,
      confidence: options.context?.lastOpenedResource?.windowHandle || leftoverEntity(raw) ? 'HIGH' : 'MEDIUM',
    };
  }

  if (references.includes('back') && (references.includes('it') || OPEN_VERB.test(raw) || /bring|ย้ายกลับ|กลับ/iu.test(raw))) {
    return {
      ...base,
      action: 'MOVE_BACK',
      objectType: options.context?.lastOpenedResource ? objectTypeFromKind(options.context.lastOpenedResource.kind) : 'WINDOW',
      entity: options.context?.lastOpenedResource?.label,
      references,
      confidence: options.context?.lastOpenedResource && options.context.previousDisplay ? 'HIGH' : 'MEDIUM',
    };
  }

  if ((references.includes('it') || references.includes('that')) && (/\b(move|put|bring)\b/iu.test(raw) || /ย้าย|เอา/u.test(raw))) {
    return {
      ...base,
      action: 'PLACE',
      objectType: options.context?.lastOpenedResource ? objectTypeFromKind(options.context.lastOpenedResource.kind) : 'WINDOW',
      entity: leftoverEntity(raw) || options.context?.lastOpenedResource?.label,
      confidence: options.context?.lastOpenedResource ? 'HIGH' : 'MEDIUM',
    };
  }

  if (
    /\bthat source\b|which source|official source|แหล่งนั้น|แหล่งทางการ/iu.test(raw)
    || (/\bsource\b|แหล่ง/iu.test(raw) && Boolean(options.context?.lastResearchSources?.length) && OPEN_VERB.test(raw))
  ) {
    return {
      ...base,
      action: OPEN_VERB.test(raw) ? 'OPEN' : 'RESEARCH_FOLLOWUP',
      objectType: 'SOURCE',
      references: [...new Set([...references, 'that' as const, 'official' as const])],
      entity: leftoverEntity(raw) || options.context?.currentSource,
      confidence: options.context?.lastResearchSources?.length ? 'HIGH' : 'MEDIUM',
    };
  }

  if (/\bresearch\b|\blook into\b|\bfind (?:the )?(?:latest|official)\b|รีเสิร์ช|หาข้อมูล|ค้น(?:เว็บ|เอกสาร|ข้อมูล)/iu.test(raw)) {
    const topic = leftoverEntity(raw);
    if (topic && !/^(this|that|it|อันนี้|อันนั้น)$/iu.test(topic)) {
      return {
        ...base,
        action: /source|official|สรุป|ขัดแย้ง/iu.test(raw) ? 'RESEARCH_FOLLOWUP' : 'RESEARCH',
        objectType: 'DOCUMENT',
        entity: topic,
        modifiers: /official|ทางการ/iu.test(raw) ? ['official-only'] : [],
        confidence: 'HIGH',
      };
    }
  }

  if (OPEN_VERB.test(raw) || WEBSITE_MARK.test(raw)) {
    const objectType = WEBSITE_MARK.test(raw)
      ? 'WEBSITE'
      : PROJECT_MARK.test(raw) || /\bthe project\b|โปรเจกต์นี้/iu.test(raw)
        ? 'PROJECT'
        : /\b(move|ย้าย|put .+ on|เอา .+ ไป)\b/iu.test(raw)
          ? 'WINDOW'
          : 'UNKNOWN';
    const entity = leftoverEntity(raw);
    return {
      ...base,
      action: /\b(move|ย้าย)\b/iu.test(raw) ? 'PLACE' : 'OPEN',
      objectType: objectType === 'UNKNOWN' && entity ? guessObjectType(entity) : objectType,
      entity: /\bthe project\b|โปรเจกต์นี้/iu.test(raw)
        ? (options.context?.currentWorkspace || options.context?.recentWorkspaceId || leftoverEntity(raw) || 'the project')
        : leftoverEntity(raw),
      confidence: entity ? 'HIGH' : 'MEDIUM',
    };
  }

  if (references.length && options.context?.lastOpenedResource) {
    return {
      ...base,
      action: 'OPEN',
      objectType: objectTypeFromKind(options.context.lastOpenedResource.kind),
      entity: options.context.lastOpenedResource.label,
      confidence: 'MEDIUM',
    };
  }

  return { ...base, action: 'UNKNOWN', entity: leftoverEntity(raw), confidence: 'LOW' };
}

function emptyIntent(
  mixedLanguage: boolean,
  display: DisplaySelector | null,
  references: SemanticReference[],
): SemanticIntent {
  return {
    action: 'UNKNOWN',
    objectType: 'UNKNOWN',
    display,
    modifiers: [],
    references,
    confidence: 'LOW',
    mixedLanguage,
  };
}

function extractReferences(text: string): SemanticReference[] {
  const found: SemanticReference[] = [];
  if (/\bit\b|มัน|อันนี้|อันนั้น/iu.test(text)) found.push('it');
  if (/\bthat\b|อันนั้น/iu.test(text)) found.push('that');
  if (/\bthis\b|อันนี้/iu.test(text)) found.push('this');
  if (/\bthe other\b|อีก(?:จอ|อัน)|จออื่น/iu.test(text)) found.push('the-other');
  if (/\bthere\b|ตรงนั้น|ที่นั่น|จอนั้น/iu.test(text)) found.push('there');
  if (/\bsame\b|อันเดิม/iu.test(text)) found.push('same');
  if (/\bback\b|กลับ(?:มา)?/iu.test(text)) found.push('back');
  if (/\bofficial\b|ทางการ/iu.test(text)) found.push('official');
  if (/\bsecond source\b|source ที่สอง/iu.test(text)) found.push('second-source');
  return [...new Set(found)];
}

function leftoverEntity(text: string): string | undefined {
  const cleaned = text
    .replace(DISPLAY_PHRASE, ' ')
    .replace(ADDRESS, ' ')
    .replace(/\b(please|could you|can you|jarvis|จาร์วิส|หน่อย|ให้ที|ให้หน่อย|too|ด้วย)\b/giu, ' ')
    .replace(/\b(open|launch|start|put|show|bring|move|focus|maximize|minimize|research|look into|look up|find out)\b|to the front|โฟกัส|ดึงมาหน้า|เปิด|เอา|วาง|ย้าย|รีเสิร์ช|หาข้อมูล/giu, ' ')
    .replace(WEBSITE_MARK, ' ')
    .replace(PROJECT_MARK, ' ')
    .replace(/\b(on|in|to|at|onto|into|the|my|a|an|ที่|บน|ไป|ใน)\b/giu, ' ')
    .replace(/[.!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || undefined;
}

function guessObjectType(entity: string): SemanticObjectType {
  if (WEBSITE_MARK.test(entity) || /\.(com|org|net|io)\b/iu.test(entity)) return 'WEBSITE';
  if (PROJECT_MARK.test(entity)) return 'PROJECT';
  return 'UNKNOWN';
}

function objectTypeFromKind(kind: 'application' | 'url'): SemanticObjectType {
  return kind === 'url' ? 'WEBSITE' : 'APPLICATION';
}

function matchTeachAlias(text: string): Partial<SemanticIntent> | null {
  const ordinal = text.match(/^(?:no,?\s*)?(?:monitor|display|screen|จอ)\s*(\d+)\s+is\s+(?:my\s+)?(.+)$/iu);
  if (ordinal) {
    return {
      action: 'TEACH_ALIAS',
      objectType: 'DISPLAY',
      aliasPhrase: ordinal[2]!.trim().replace(/[.!?]+$/u, ''),
      target: `ordinal:${ordinal[1]}`,
      entity: ordinal[2]!.trim().replace(/[.!?]+$/u, ''),
    };
  }
  const thisOne = text.match(/remember this one as\s+(.+)/iu)
    || text.match(/the screen showing jarvis(?: right now)? is (?:the\s+)?(.+)/iu);
  if (thisOne) {
    return {
      action: 'TEACH_ALIAS',
      objectType: 'DISPLAY',
      aliasPhrase: thisOne[1]!.trim(),
      target: 'display.current',
      entity: thisOne[1]!.trim(),
    };
  }
  const when = text.match(/when i say\s+(.+?)\s*,?\s*i mean\s+(.+)/iu)
    || text.match(/(?:no,\s*)?when i say\s+(.+?)\s*,?\s*i mean\s+(.+)/iu)
    || text.match(/call (?:this|that) (?:screen|monitor|display)\s+(?:the\s+)?(.+)/iu)
    || text.match(/remember (?:the )?(.+?)\s+as\s+(.+)/iu)
    || text.match(/จอโน้ตบุ๊ก(?:คือ|หมายถึง)\s*(.+)/iu);
  if (!when) return null;
  const phrase = (when[1] || '').trim();
  const target = (when[2] || 'display.internal').trim();
  return {
    action: 'TEACH_ALIAS',
    objectType: 'DISPLAY',
    aliasPhrase: phrase,
    target,
    entity: phrase,
  };
}

function matchListDisplays(text: string): Partial<SemanticIntent> | null {
  if (!/what monitors|which displays|what screens|จออะไรบ้าง|มีจออะไร/iu.test(text)) return null;
  return { action: 'LIST_DISPLAYS', objectType: 'DISPLAY', entity: 'displays' };
}

function matchContainment(text: string, context?: InteractionContext | null): Partial<SemanticIntent> | null {
  if (/clear (?:this )?(?:placement )?containment|clear this scope/iu.test(text)) {
    return { action: 'CLEAR_CONTAINMENT', objectType: 'WINDOW', entity: 'containment' };
  }
  if (
    context?.pendingContainmentId
    && !context.pendingProposalId
    && /^(yes|y|ok|okay|clear it|ใช่|ล้าง)\.?$/iu.test(text.trim())
  ) {
    return { action: 'CLEAR_CONTAINMENT', objectType: 'WINDOW', entity: 'containment' };
  }
  if (/check (?:it|the (?:containment|placement|window))|inspect (?:the )?containment|why can'?t you move/iu.test(text)) {
    return { action: 'INSPECT_CONTAINMENT', objectType: 'WINDOW', entity: 'containment' };
  }
  return null;
}

function matchWorkingProject(text: string): Partial<SemanticIntent> | null {
  const working = text.match(/we(?:'re| are) working on (?:the )?(.+?)(?: project)?\.?$/iu)
    || text.match(/โปรเจกต์(?:นี้)?คือ\s*(.+)/iu);
  if (!working) return null;
  return {
    action: 'REMEMBER_PREFERENCE',
    objectType: 'PROJECT',
    target: `workspace.current=${working[1]!.trim()}`,
    entity: working[1]!.trim(),
  };
}

function matchForgetAlias(text: string): Partial<SemanticIntent> | null {
  if (!/forget|don't call|อย่าเรียก|ลืม.*alias|ลืม.*จอ/iu.test(text)) return null;
  const phrase = leftoverEntity(text.replace(/forget|don't call it that anymore|the alias|alias/giu, ' '));
  return {
    action: 'FORGET_ALIAS',
    objectType: 'DISPLAY',
    aliasPhrase: phrase,
    entity: phrase,
  };
}

function matchAskMemory(text: string): Partial<SemanticIntent> | null {
  if (!/what do you remember|what do you call|which screen|จำอะไร|จอโน้ตบุ๊กคือจอไหน|ผมชอบให้ตอบ|how do i like|reply style|ตอบแบบไหน/iu.test(text)) return null;
  return {
    action: 'ASK_MEMORY',
    objectType: /monitor|screen|จอ/iu.test(text) ? 'DISPLAY' : /project|โปรเจกต์/iu.test(text) ? 'PROJECT' : 'UNKNOWN',
    entity: leftoverEntity(text),
  };
}

function matchPreference(text: string): Partial<SemanticIntent> | null {
  if (!/i prefer|จำไว้ว่าผม|จำไว้ว่าฉัน|พูดไทย|speak thai unless|remember that i/iu.test(text)) return null;
  return {
    action: 'REMEMBER_PREFERENCE',
    objectType: 'UNKNOWN',
    target: /thai|ไทย/iu.test(text) ? 'speech.language=th' : leftoverEntity(text),
  };
}

function matchBuild(text: string): Partial<SemanticIntent> | null {
  if (/สร้างเว็บ|ทำเว็บ|เว็บไซต์|build (?:a |an )?(?:web(?:site)?|portfolio)|create (?:a |an )?(?:web(?:site)?|portfolio)|portfolio/iu.test(text)
    && /สร้าง|ทำ|build|create|ช่วย/iu.test(text)) {
    return { action: 'BUILD_WEBSITE', objectType: 'WEBSITE', entity: leftoverEntity(text) };
  }
  if (/สร้างแอป|สร้างแอพ|build (?:a |an )?(?:app|todo|dashboard)|create (?:a |an )?(?:app|todo|dashboard)|todo สำหรับมือถือ|dashboard ดูสถานะ/iu.test(text)) {
    return { action: 'BUILD_SOFTWARE', objectType: 'UNKNOWN', entity: leftoverEntity(text) };
  }
  return null;
}

function matchApplyBuild(text: string): Partial<SemanticIntent> | null {
  if (/วางแผน/.test(text) && /สร้างเว็บ|สร้างแอป|todo|portfolio|website/iu.test(text)) return null;
  if (!/เขียนโค้ด|write code|สร้างไฟล์|create (?:project )?files|รัน\s*(?:unit\s*)?tests?|run (?:the |unit )?tests?/iu.test(text)) {
    return null;
  }
  return { action: 'APPLY_BUILD', objectType: 'PROJECT', entity: leftoverEntity(text) };
}

function matchApprovePlan(text: string): Partial<SemanticIntent> | null {
  if (!/เอาตามแผนนี้|ตามแผนนี้|เริ่มได้|เริ่มเลย|approve (?:the )?plan|use this plan|go with this plan/iu.test(text.trim())) return null;
  return { action: 'APPROVE_PLAN', objectType: 'UNKNOWN', entity: 'plan' };
}
