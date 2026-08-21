import { extractReminderTitle } from '../automation/parseSchedule';
import type { CapabilityHost } from '../capabilities/types';
import { cctvCapabilityContracts } from '../devices';
import { buildSelfKnowledgeSnapshot } from '../intelligence/selfKnowledge';
import { resolveCapabilityGoal } from '../intelligence/capabilityGraph';
import type { InteractionContext } from '../intent/types';
import { redactSecrets } from '../security/redaction';
import { classifyVoiceFamily } from '../intent/voiceFamilies';
import { createDefaultGoalCatalog, type GoalCatalog } from './catalog';
import { createDefaultInputAdapterRegistry, directCapabilityInput, type TrustedInputAdapterRegistry } from './inputAdapters';
import type {
  GoalDefinition,
  GoalResolution,
  GoalResolvedRoute,
  GoalSuggestion,
} from './types';

export type GoalResolverOptions = {
  host?: CapabilityHost;
  catalog?: GoalCatalog;
  adapters?: TrustedInputAdapterRegistry;
  context?: InteractionContext | null;
  suggestion?: GoalSuggestion;
  attempted?: number;
  maximumAttempts?: number;
};

type Match = {
  definition?: GoalDefinition;
  status?: Extract<GoalResolution['status'], 'CLARIFICATION' | 'NO_MATCH'>;
  confidence: number | null;
  source: GoalResolution['matchSource'];
  extracted: Record<string, unknown>;
  question?: string;
  evidence: string[];
};

const DEFAULT_CATALOG = createDefaultGoalCatalog();
const DEFAULT_ADAPTERS = createDefaultInputAdapterRegistry();

export async function resolveOwnerGoal(text: string, options: GoalResolverOptions = {}): Promise<GoalResolution> {
  const raw = text.trim();
  const maximum = Math.max(1, Math.min(options.maximumAttempts ?? 2, 4));
  const attempted = Math.max(0, options.attempted ?? 0);
  if (!raw) return noMatch(raw, attempted, maximum);
  const catalog = options.catalog ?? DEFAULT_CATALOG;
  const match = options.suggestion
    ? matchValidatedSuggestion(raw, options.suggestion, catalog)
    : deterministicMatch(raw, catalog, options.context);
  if (match.status === 'CLARIFICATION') {
    return {
      status: 'CLARIFICATION',
      matchedIntent: raw,
      matchSource: match.source,
      confidence: match.confidence,
      extractedInputs: safeInputs(match.extracted),
      missingInputs: [],
      smallestOwnerQuestion: match.question,
      routes: [],
      rejectedAlternatives: [],
      permissionRequired: [],
      verificationStrategy: [],
      evidence: match.evidence,
      boundedAttempts: { attempted, maximum },
    };
  }
  if (match.status === 'NO_MATCH' || !match.definition) return noMatch(raw, attempted, maximum, match.evidence);
  const definition = match.definition;
  const missing = missingInputs(definition, match.extracted);
  if (missing.length > 0) {
    const first = definition.requiredInputs.find(item => item.id === missing[0]);
    return baseResolution(definition, raw, match, attempted, maximum, {
      status: 'NEEDS_INPUT',
      missingInputs: missing,
      smallestOwnerQuestion: first?.smallestQuestion || `Please provide ${missing[0]}.`,
      routes: definition.routes.map(route => missingRoute(route, missing)),
      rejectedAlternatives: definition.routes.map(route => ({ routeId: route.id, reason: `Missing required input: ${missing.join(', ')}.` })),
    });
  }
  if (definition.handler === 'SELF_KNOWLEDGE') {
    return baseResolution(definition, raw, match, attempted, maximum, {
      status: 'RESOLVED',
      missingInputs: [],
      routes: [],
      selectedRouteId: 'structured-self-knowledge',
      rejectedAlternatives: [],
    });
  }
  if (!options.host) {
    return baseResolution(definition, raw, match, attempted, maximum, {
      status: 'BLOCKED',
      missingInputs: [],
      routes: definition.routes.map(route => unknownRoute(route, 'CapabilityHost evidence was not supplied.')),
      rejectedAlternatives: definition.routes.map(route => ({ routeId: route.id, reason: 'CapabilityHost evidence was not supplied.' })),
    });
  }

  const snapshot = await buildSelfKnowledgeSnapshot({
    host: options.host,
    declarations: cctvCapabilityContracts(),
  });
  const adapters = options.adapters ?? DEFAULT_ADAPTERS;
  const routes = definition.routes
    .map(route => resolveRoute(definition, route, match.extracted, options.host!, adapters, options.context, snapshot))
    .sort((left, right) => left.priority - right.priority);
  const safeReady = routes.find(route => route.available && route.inputCompatible && !route.ownerDecisionRequired);
  const ownerRoute = routes.find(route => route.available && route.inputCompatible && route.ownerDecisionRequired);
  const selected = safeReady ?? ownerRoute;
  const status: GoalResolution['status'] = safeReady
    ? 'RESOLVED'
    : ownerRoute
      ? 'NEEDS_OWNER_DECISION'
      : 'BLOCKED';
  return baseResolution(definition, raw, match, attempted, maximum, {
    status,
    missingInputs: [],
    routes,
    ...(selected ? { selectedRouteId: selected.id } : {}),
    rejectedAlternatives: routes
      .filter(route => route.id !== selected?.id)
      .map(route => ({ routeId: route.id, reason: route.reason })),
    ...(status === 'NEEDS_OWNER_DECISION'
      ? { smallestOwnerQuestion: `The remaining route is higher risk: ${ownerRoute!.title}. Do you want me to prepare that owner-approved route?` }
      : {}),
  });
}

export function validateGoalSuggestion(value: unknown, catalog: GoalCatalog = DEFAULT_CATALOG): GoalSuggestion | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.goalId !== 'string' || !catalog.get(raw.goalId)) return undefined;
  if (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) return undefined;
  if (raw.extractedFields !== undefined && (!raw.extractedFields || typeof raw.extractedFields !== 'object' || Array.isArray(raw.extractedFields))) return undefined;
  return {
    goalId: raw.goalId,
    confidence: raw.confidence,
    ...(raw.extractedFields ? { extractedFields: structuredClone(raw.extractedFields as Record<string, unknown>) } : {}),
  };
}

function deterministicMatch(text: string, catalog: GoalCatalog, context?: InteractionContext | null): Match {
  const fromCatalog = (id: string) => catalog.get(id);
  if (/after setup|once (?:set ?up|configured)|need(?:s)? setup|need(?:s)? configuration|require(?:s)? setup|currently unavailable|not currently available|require(?:s)? (?:my )?permission|need(?:s)? (?:my )?permission|what requires my permission|what can you do|what goals can you|what are your capabilities|ทำอะไรได้บ้าง|ความสามารถ.*อะไร|ต้องตั้งค่า|ต้องขออนุญาต/iu.test(text)) {
    return matched(fromCatalog('self.capabilities'), 1, {}, ['matcher:self.capabilities']);
  }
  if (/why can(?:'|’)?t|why can you not|what do you need|ทำไม.*ไม่ได้|ต้องการอะไร.*จาก.*ผม/iu.test(text)) {
    return matched(fromCatalog('self.explain-gap'), 0.98, {}, ['matcher:self.explain-gap']);
  }
  const voice = classifyVoiceFamily(text);
  if (voice.family === 'DESKTOP_OPEN' || voice.family === 'COMPOUND_OPEN') {
    const resource = voice.resources[0];
    return matched(fromCatalog('desktop.open-resource'), resource ? 0.96 : 0.8, {
      ...(resource ? {
        resource,
        kind: resource.kind,
        applicationId: resource.applicationId,
        url: resource.url,
        label: resource.label,
      } : {}),
      ...(voice.display ? { display: voice.display } : {}),
    }, ['matcher:desktop.open-resource']);
  }
  if (/\b(cctv|nvr|rtsp|onvif|camera|กล้อง)\b|กล้องวงจรปิด|กล้องบ้าน/iu.test(text) && /connect|open|view|show|check|เชื่อม|เปิด|ดู/iu.test(text)) {
    const deviceIdentity = extractAfter(text, /(?:cctv|nvr|camera|กล้องวงจรปิด|กล้องบ้าน)/iu);
    return matched(fromCatalog('devices.cctv.connect'), 0.96, deviceIdentity ? { deviceIdentity } : {}, ['matcher:devices.cctv.connect']);
  }
  if (/\bremind(?:er)?\b|set a reminder|create a reminder|เตือน/iu.test(text)) {
    const title = extractReminderTitle(text);
    const extracted: Record<string, unknown> = {};
    if (hasReminderTime(text)) extracted.whenText = text;
    if (title && title !== 'Reminder') {
      extracted.title = title;
      extracted.message = title;
    }
    return matched(fromCatalog('reminders.create'), 0.98, extracted, ['matcher:reminders.create']);
  }
  if (/is jarvis (?:okay|ok|healthy)|jarvis health|runtime status|system health|what services are running|check (?:jarvis|system) health|สถานะระบบ|jarvis.*เป็นไง|ระบบ.*ปกติ/iu.test(text)) {
    return matched(fromCatalog('system.health'), 0.97, {}, ['matcher:system.health']);
  }
  if (/tell me about (?:this|the) codebase|codebase overview|what is in my workspace|workspace overview|ภาพรวม.*(?:โปรเจกต์|workspace)/iu.test(text)) {
    return matched(fromCatalog('workspace.overview'), 0.94, {}, ['matcher:workspace.overview']);
  }
  if (/analy[sz]e (?:this|the) document|summari[sz]e (?:this|the|current) (?:document|file)|วิเคราะห์.*เอกสาร|สรุป.*(?:เอกสาร|ไฟล์)/iu.test(text)) {
    const documentId = text.match(/\bdoc_[a-f0-9]{24}\b/iu)?.[0] ?? context?.recentDocumentIds?.[0];
    const query = extractAfter(text, /(?:about|focus on|เกี่ยวกับ)/iu);
    return matched(fromCatalog('documents.analyze-basic'), 0.95, {
      ...(documentId ? { documentId } : {}),
      ...(query ? { query } : {}),
      mode: 'summarize',
    }, ['matcher:documents.analyze-basic']);
  }
  if (isWorkspaceIntent(text)) {
    const query = extractWorkspaceQuery(text);
    return matched(fromCatalog('workspace.search'), query ? 0.96 : 0.84, query ? { query } : {}, ['matcher:workspace.search', 'scope:workspace']);
  }
  if (isAmbiguousComparison(text)) {
    const query = extractResearchQuery(text);
    return matched(fromCatalog('information.compare'), 0.9, query ? { query } : {}, ['matcher:information.compare', 'scope:not-selected']);
  }
  if (isResearchIntent(text)) {
    const query = extractResearchQuery(text);
    return matched(fromCatalog('research.topic'), query ? 0.96 : 0.83, {
      ...(query ? { query } : {}),
      officialOnly: /official|primary source|เว็บทางการ|ทางการ/iu.test(text),
      freshness: /current|latest|today|ล่าสุด|วันนี้|ตอนนี้/iu.test(text) ? 'latest' : 'any',
      compare: /compare|conflict|เทียบ|ขัดแย้ง/iu.test(text),
    }, ['matcher:research.topic', 'scope:public-web']);
  }
  return { status: 'NO_MATCH', confidence: null, source: 'none', extracted: {}, evidence: ['matcher:no-match'] };
}

function matchValidatedSuggestion(text: string, suggestion: GoalSuggestion, catalog: GoalCatalog): Match {
  const validated = validateGoalSuggestion(suggestion, catalog);
  if (!validated) return { status: 'NO_MATCH', confidence: null, source: 'none', extracted: {}, evidence: ['suggestion:invalid'] };
  const definition = catalog.get(validated.goalId);
  if (!definition) return { status: 'NO_MATCH', confidence: null, source: 'none', extracted: {}, evidence: ['suggestion:unknown-goal'] };
  if (validated.confidence < 0.78) {
    return {
      definition,
      status: 'CLARIFICATION',
      confidence: validated.confidence,
      source: 'validated_suggestion',
      extracted: validated.extractedFields ?? {},
      question: `Did you mean: ${definition.name}?`,
      evidence: [`suggestion:${definition.id}`, 'confidence:below-execution-threshold'],
    };
  }
  return matched(definition, validated.confidence, validated.extractedFields ?? {}, [`suggestion:${definition.id}`, 'suggestion:catalog-validated'], 'validated_suggestion');
}

function resolveRoute(
  definition: GoalDefinition,
  route: GoalDefinition['routes'][number],
  extracted: Record<string, unknown>,
  host: CapabilityHost,
  adapters: TrustedInputAdapterRegistry,
  context: InteractionContext | null | undefined,
  snapshot: Awaited<ReturnType<typeof buildSelfKnowledgeSnapshot>>,
): GoalResolvedRoute {
  const ownerSelectedScope = extracted.scope === route.scope;
  if (route.scope !== definition.scope && !route.ownerDecisionRequired) {
    return unknownRoute(route, 'Route scope differs from the owner goal without an owner decision.');
  }
  const graph = resolveCapabilityGoal({
    id: `${definition.id}:${route.id}`,
    title: route.title,
    dependencies: route.dependencies,
  }, snapshot);
  const steps = route.steps.map(step => {
    const adapted = step.adapterId
      ? adapters.run({
          adapterId: step.adapterId,
          capabilityId: step.capabilityId,
          goalInput: adapterInputFor(definition, extracted),
          host,
          context: { trustedWorkspaceId: context?.recentWorkspaceId },
        })
      : directCapabilityInput(host.lookup(step.capabilityId), {});
    return {
      capabilityId: step.capabilityId,
      input: adapted.input,
      compatibility: adapted.compatibility,
      ...(adapted.adapterId ? { adapterId: adapted.adapterId } : {}),
      evidence: adapted.evidence,
    };
  });
  const inputCompatible = steps.every(step => step.compatibility === 'DIRECT_COMPATIBLE' || step.compatibility === 'ADAPTER_COMPATIBLE');
  const available = graph.ready;
  const issues = route.steps.flatMap((step, index) => {
    const resolved = steps[index];
    return resolved && resolved.compatibility !== 'DIRECT_COMPATIBLE' && resolved.compatibility !== 'ADAPTER_COMPATIBLE'
      ? [`${step.capabilityId} input is ${resolved.compatibility}.`]
      : [];
  });
  return {
    id: route.id,
    title: route.title,
    priority: route.priority,
    scope: route.scope,
    risk: route.risk,
    ownerDecisionRequired: Boolean(route.ownerDecisionRequired && !ownerSelectedScope),
    available,
    inputCompatible,
    steps,
    reason: !available
      ? graph.missing.map(item => `${item.capabilityId}: ${item.status}`).join(' · ')
      : !inputCompatible
        ? issues.join(' · ') || 'Typed input is incompatible.'
        : route.ownerDecisionRequired && !ownerSelectedScope
          ? 'This route changes scope or risk and requires an explicit owner decision.'
          : 'Registered capability evidence and typed input are ready.',
    evidence: [...graph.evidence, ...steps.flatMap(step => step.evidence), `goal-route:${route.id}`],
  };
}

function adapterInputFor(definition: GoalDefinition, extracted: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set([...definition.requiredInputs, ...definition.optionalInputs].map(item => item.id));
  return Object.fromEntries(Object.entries(extracted).filter(([key]) => allowed.has(key)));
}

function missingInputs(definition: GoalDefinition, extracted: Record<string, unknown>): string[] {
  return definition.requiredInputs
    .filter(item => !(item.id in extracted) || extracted[item.id] === undefined || extracted[item.id] === '')
    .map(item => item.id);
}

function baseResolution(
  definition: GoalDefinition,
  raw: string,
  match: Match,
  attempted: number,
  maximum: number,
  patch: Pick<GoalResolution, 'status' | 'missingInputs' | 'routes' | 'rejectedAlternatives'> & Partial<GoalResolution>,
): GoalResolution {
  const selected = patch.routes.find(route => route.id === patch.selectedRouteId);
  return {
    status: patch.status,
    goalId: definition.id,
    goalName: definition.name,
    scope: selected?.scope ?? definition.scope,
    handler: definition.handler,
    matchedIntent: raw,
    matchSource: match.source,
    confidence: match.confidence,
    extractedInputs: safeInputs(match.extracted),
    missingInputs: patch.missingInputs,
    ...(patch.smallestOwnerQuestion ? { smallestOwnerQuestion: patch.smallestOwnerQuestion } : {}),
    routes: patch.routes,
    ...(patch.selectedRouteId ? { selectedRouteId: patch.selectedRouteId } : {}),
    rejectedAlternatives: patch.rejectedAlternatives,
    permissionRequired: selected?.ownerDecisionRequired ? selected.steps.map(step => step.capabilityId) : [],
    verificationStrategy: [definition.verificationExpectation],
    evidence: [
      `goal:${definition.id}`,
      `match:${match.source}:${match.confidence ?? 'unknown'}`,
      ...match.evidence,
      ...(selected?.evidence ?? []),
    ],
    boundedAttempts: { attempted, maximum },
  };
}

function matched(
  definition: GoalDefinition | undefined,
  confidence: number,
  extracted: Record<string, unknown>,
  evidence: string[],
  source: GoalResolution['matchSource'] = 'deterministic',
): Match {
  return { definition, confidence, source, extracted, evidence };
}

function noMatch(raw: string, attempted: number, maximum: number, evidence = ['matcher:no-match']): GoalResolution {
  return {
    status: 'NO_MATCH',
    matchedIntent: raw,
    matchSource: 'none',
    confidence: null,
    extractedInputs: {},
    missingInputs: [],
    routes: [],
    rejectedAlternatives: [],
    permissionRequired: [],
    verificationStrategy: [],
    evidence,
    boundedAttempts: { attempted, maximum },
  };
}

function missingRoute(route: GoalDefinition['routes'][number], missing: string[]): GoalResolvedRoute {
  return {
    id: route.id,
    title: route.title,
    priority: route.priority,
    scope: route.scope,
    risk: route.risk,
    ownerDecisionRequired: Boolean(route.ownerDecisionRequired),
    available: false,
    inputCompatible: false,
    steps: route.steps.map(step => ({
      capabilityId: step.capabilityId,
      input: {},
      compatibility: 'MISSING_REQUIRED_INPUT',
      ...(step.adapterId ? { adapterId: step.adapterId } : {}),
      evidence: [],
    })),
    reason: `Missing required input: ${missing.join(', ')}.`,
    evidence: [`goal-route:${route.id}`, 'input:missing'],
  };
}

function unknownRoute(route: GoalDefinition['routes'][number], reason: string): GoalResolvedRoute {
  return {
    id: route.id,
    title: route.title,
    priority: route.priority,
    scope: route.scope,
    risk: route.risk,
    ownerDecisionRequired: Boolean(route.ownerDecisionRequired),
    available: false,
    inputCompatible: false,
    steps: route.steps.map(step => ({ capabilityId: step.capabilityId, input: {}, compatibility: 'UNKNOWN', evidence: [] })),
    reason,
    evidence: [`goal-route:${route.id}`, 'runtime:unknown'],
  };
}

function safeInputs(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === 'string' ? redactSecrets(item) : item]));
}

function isWorkspaceIntent(text: string): boolean {
  return /workspace|codebase|\brepo\b|local (?:files?|project)|my project|in my project|approved workspace|ค้น.*(?:workspace|โปรเจกต์)|หา.*(?:ไฟล์|โค้ด)|อยู่ไฟล์ไหน|อยู่ตรงไหน/iu.test(text);
}

function extractWorkspaceQuery(text: string): string {
  return text
    .replace(/search|find|look for|check|where is|workspace|codebase|\brepo\b|local files?|my project|in my project|approved|ช่วย|ค้น|หา|เช็ก|เช็ค|ในโปรเจกต์|โปรเจกต์|ไฟล์|โค้ด|อยู่ไฟล์ไหน|อยู่ตรงไหน/giu, ' ')
    .replace(/[?!.,]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 200);
}

function isResearchIntent(text: string): boolean {
  return /\bresearch\b|search the (?:web|internet)|look up|find current|current information|latest information|public sources?|official sources?|ค้นคว้า|ค้นเว็บ|ข้อมูลล่าสุด|ข่าวล่าสุด|หาข้อมูล.*(?:เว็บ|ล่าสุด)/iu.test(text);
}

function extractResearchQuery(text: string): string {
  return text
    .replace(/\bresearch\b|search the (?:web|internet)(?: for)?|look up|find current information(?: about)?|current information(?: about)?|latest information(?: about)?|public sources?|official sources?|compare|ค้นคว้า|ค้นเว็บ|ข้อมูลล่าสุด|ข่าวล่าสุด|หาข้อมูล|ช่วย|ให้หน่อย|please|about/giu, ' ')
    .replace(/[?!.,]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 200);
}

function isAmbiguousComparison(text: string): boolean {
  return /^(?:compare|เทียบ)\s+.+/iu.test(text.trim())
    && !isWorkspaceIntent(text)
    && !isResearchIntent(text);
}

function hasReminderTime(text: string): boolean {
  const relative = /(?:in|อีก)\s+(?:half|ครึ่ง|\d+|หนึ่ง|สอง|สาม|สี่|ห้า)\s*(?:seconds?|minutes?|hours?|วินาที|นาที|ชั่วโมง|ชม)/iu;
  const explicitClock = /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|โมง(?:เช้า|เย็น|บ่าย)?|ทุ่ม|นาฬิกา)\b|\bat\s+\d{1,2}(?::\d{2})?\b/iu;
  const daypart = /tomorrow\s+(?:morning|afternoon|evening|night)|today\s+(?:morning|afternoon|evening)|tonight|พรุ่งนี้\s*(?:ตอนเช้า|บ่าย|ตอนเย็น|ค่ำ|ดึก)|วันนี้\s*(?:ตอนเช้า|บ่าย|ตอนเย็น)|ตอนเช้า|บ่าย|ตอนเย็น/iu;
  const recurrence = /every\s+(?:day|weekday|monday|tuesday|wednesday|thursday|friday|saturday|sunday).*(?:at\s+\d|morning|afternoon|evening)|ทุกวัน.*(?:\d|โมง|ทุ่ม|ตอนเช้า|ตอนเย็น|บ่าย)/iu;
  const datedClock = /(?:tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|พรุ่งนี้|วันนี้|จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์).*(?:at\s+\d|\d{1,2}:\d{2}|โมง|ทุ่ม|ตอนเช้า|ตอนเย็น|บ่าย)/iu;
  return relative.test(text) || explicitClock.test(text) || daypart.test(text) || recurrence.test(text) || datedClock.test(text);
}

function extractAfter(text: string, cue: RegExp): string {
  const match = cue.exec(text);
  if (!match || match.index === undefined) return '';
  return text.slice(match.index + match[0].length).replace(/[?!.,]/gu, ' ').trim().slice(0, 160);
}
