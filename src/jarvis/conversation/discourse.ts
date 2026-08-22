/**
 * Discourse-act interpretation.
 * Classifies conversational function, not capability ids.
 * Do not map owner phrases onto project.build / startDevServer here.
 */

import type { ConversationState, DiscourseAct, DiscourseInterpretation } from './types';

const ADDRESS = /^\s*((?:hey\s+)?jarvis[,.!?]*\s*|จาร์วิส[,.!?]*\s*)+/iu;

export function stripOwnerAddress(text: string): string {
  return text.replace(ADDRESS, '').replace(/^[.!?,\s]+|[.!?,\s]+$/gu, '').trim();
}

export function interpretDiscourse(
  text: string,
  state: ConversationState | null | undefined,
): DiscourseInterpretation {
  const raw = stripOwnerAddress(text);
  if (!raw) return act('GREET');

  const ordinals = parseOrdinals(raw, state);
  const ordinal = ordinals[0] ?? parseOrdinal(raw, state);
  if (ordinal !== undefined && isMostlyOrdinal(raw)) {
    if (!state?.offeredOptions.length && !state?.projects.length && state?.lastDiscourse !== 'RESEARCH') {
      return {
        act: 'SELECT_ORDINAL',
        ordinal,
        ordinals,
        confidence: 'MEDIUM',
        requiresClarification: true,
        clarification: 'อันไหนที่หมายถึงครับ?',
        source: 'discourse',
      };
    }
    return {
      act: 'SELECT_ORDINAL',
      ordinal,
      ordinals: ordinals.length ? ordinals : [ordinal],
      change: raw,
      confidence: 'HIGH',
      requiresClarification: false,
      source: 'discourse',
    };
  }

  if (isGreeting(raw)) return act('GREET');
  if (isAck(raw)) return act('ACKNOWLEDGE');
  if (isUnscopedAuthority(raw)) {
    return { ...act('STATUS_QUERY'), statusFocus: 'permission', change: 'REFUSE_GLOBAL' };
  }
  if (isProjectScopedGrant(raw)) {
    return { ...act('STATUS_QUERY'), statusFocus: 'permission', change: 'SCOPE_PROJECT' };
  }
  if (isSelfGrantQuery(raw)) {
    return { ...act('STATUS_QUERY'), statusFocus: 'permission', change: 'QWEN_CANNOT_GRANT' };
  }
  if (isModelQuery(raw)) return act('MODEL_QUERY');
  if (isPause(raw) && !isContinue(raw)) return act('PAUSE');
  if (isSwitchTopic(raw)) return act('SWITCH_TOPIC');
  if (isRestoreTopic(raw, state)) return act('RESTORE_TOPIC');
  if (isStartFresh(raw)) return act('START_FRESH');
  if (isGrant(raw)) return act(state?.pendingPermission ? 'GRANT_PERMISSION' : 'EXECUTE_NOW');
  if (isApprovePlan(raw) && state?.pendingPlanReview) return act('APPROVE_PLAN');
  const queueOp = parseQueueOp(raw, state);
  if (queueOp) {
    return {
      act: 'QUEUE',
      queueOp,
      confidence: 'HIGH',
      requiresClarification: false,
      source: 'discourse',
    };
  }
  if (isExecuteNow(raw)) {
    if (hasActiveQueue(state)) return act('CONTINUE');
    return act(state?.pendingPlanReview ? 'APPROVE_PLAN' : 'EXECUTE_NOW');
  }
  if (isContinue(raw)) {
    if (hasActiveQueue(state)) return act('CONTINUE');
    return act(state?.pendingPlanReview ? 'APPROVE_PLAN' : 'CONTINUE');
  }

  const conditional = parseConditional(raw);
  if (conditional) return conditional;
  const chain = parseOperationChain(raw);
  if (chain) return chain;

  const queueItems = parseQueue(raw);
  if (queueItems) {
    return { act: 'QUEUE', queueItems, confidence: 'HIGH', requiresClarification: false, source: 'discourse' };
  }

  if (isStopPreview(raw)) return act('STOP_PREVIEW');
  if (isRestartPreview(raw)) return act('RESTART_PREVIEW');
  if (isPreview(raw, state)) return act('PREVIEW');
  if (isTest(raw)) return act('TEST');
  if (isBuild(raw, state)) return act('BUILD');
  if (isRerun(raw)) return act('RERUN');
  if (isStatus(raw)) {
    return { ...act('STATUS_QUERY'), statusFocus: classifyStatusFocus(raw, state) };
  }
  if (isInspect(raw, state)) return act('INSPECT_PROJECT');
  if (isMemoryStore(raw)) return { ...act('MEMORY_STORE'), change: raw };
  if (isMemoryQuery(raw)) return act('MEMORY_QUERY');
  if (isModify(raw, state) && isNegate(raw) && hasPositiveEdit(raw)) {
    return { ...act('MODIFY_PROJECT'), change: raw, constraint: raw };
  }
  if (isNegate(raw)) return { ...act('NEGATE'), constraint: raw, change: raw };
  if (isCorrect(raw)) {
    if (state?.lastDiscourse === 'AMBIGUOUS' && /preview process|preview เก่า|dev server/iu.test(raw)) {
      return act('STOP_PREVIEW');
    }
    return { ...act('CORRECT'), change: raw };
  }
  if (isPlanRequest(raw) && !hasActiveQueue(state)) return act('PLAN_REQUEST');

  if (isDestructiveAmbiguous(raw)) {
    return {
      act: 'AMBIGUOUS',
      confidence: 'HIGH',
      requiresClarification: true,
      clarification: 'ลบอันไหนครับ — preview process, ไฟล์, หรือโปรเจกต์?',
      source: 'discourse',
    };
  }

  if (isNewProject(raw, state)) {
    return { ...act('NEW_PROJECT'), change: raw };
  }
  if (isResearchRecommend(raw, state)) {
    return { ...act('RESEARCH'), researchQuery: raw, change: raw, recommend: true };
  }
  if (isResearchFollowUp(raw, state) || isResearch(raw)) {
    return { ...act('RESEARCH'), researchQuery: raw, change: raw };
  }
  if (isAccumulate(raw, state)) {
    return { ...act('ACCUMULATE_REQUIREMENTS'), change: raw };
  }
  if (isModify(raw, state)) {
    return { ...act('MODIFY_PROJECT'), change: raw };
  }

  if (hasActiveSoftware(state) && /ถ้ายัง/u.test(raw) && /ติดตั้ง|install/iu.test(raw)) {
    return { ...act('MODIFY_PROJECT'), change: raw };
  }
  if (hasActiveSoftware(state) && isShortFollowUp(raw)) {
    return act('CONTINUE');
  }
  return unknown(hasActiveSoftware(state) ? 'MEDIUM' : 'LOW');
}

const PREEMPT_PENDING_GOAL: ReadonlySet<DiscourseAct> = new Set([
  'GREET',
  'STATUS_QUERY',
  'MODEL_QUERY',
  'MEMORY_QUERY',
  'MEMORY_STORE',
  'SWITCH_TOPIC',
  'RESTORE_TOPIC',
  'START_FRESH',
  'INSPECT_PROJECT',
]);

export function discoursePreemptsPendingGoal(discourse: DiscourseInterpretation): boolean {
  return PREEMPT_PENDING_GOAL.has(discourse.act);
}

function act(value: DiscourseAct): DiscourseInterpretation {
  return { act: value, confidence: 'HIGH', requiresClarification: false, source: 'discourse' };
}

function unknown(confidence: DiscourseInterpretation['confidence']): DiscourseInterpretation {
  return { act: 'UNKNOWN', confidence, requiresClarification: false, source: 'discourse' };
}

function hasActiveSoftware(state: ConversationState | null | undefined): boolean {
  return Boolean(state?.activeProjectSlug || state?.activePlanId || state?.pendingPlanReview);
}

function hasActiveQueue(state: ConversationState | null | undefined): boolean {
  return Boolean(state?.queue.some(item => item.status === 'pending' || item.status === 'running'));
}

function isGreeting(text: string): boolean {
  return /^(สวัสดี|hello|hi|hey|หวัดดี|yo)(?:\s+jarvis)?[\s,.!?]*$/iu.test(text);
}

function isAck(text: string): boolean {
  return /^(ok|okay|oke|โอเค|ครับ|ค่ะ|ได้|รับทราบ|thanks|thank you|👍+)$/iu.test(text);
}

function isModelQuery(text: string): boolean {
  return /ใช้โมเดลอะไร|โมเดลอะไรอยู่|what model|which model|context เท่าไหร่|context window|context size/iu.test(text);
}

function isPause(text: string): boolean {
  return /^(เดี๋ยวก่อน|pause|พัก(?:ไว้)?(?:ก่อน)?|หยุดก่อน)$/iu.test(text)
    || /พักเว็บนี้ไว้ก่อน/iu.test(text);
}

function isContinue(text: string): boolean {
  return /^(ทำต่อ|ไปต่อ|ต่อ|continue|resume|keep going)$/iu.test(text)
    || /กลับไปทำ(?:เว็บ)?ต่อ|ทำงานเดิมต่อ|finish this task|resume the task/iu.test(text)
    || /มาทำเว็บต่อ|กลับมาที่เว็บไซต์|กลับมาทำเว็บ/iu.test(text);
}

function isExecuteNow(text: string): boolean {
  return /^(ทำเลย|เอาเลย|ทำ|do it|go ahead|เริ่มได้|เริ่มเลย|โอเคเริ่ม|เริ่ม|ตามนั้น|โอเคตามนั้น)$/iu.test(text);
}

function isApprovePlan(text: string): boolean {
  return /เอาตาม(?:แผน)?นี้|ตามแผนนี้|อนุมัติแผน|approve (?:the )?plan|use this plan|go with this plan/iu.test(text);
}

function isGrant(text: string): boolean {
  return /^(อนุญาต(?:งานนี้|ครั้งนี้)?|allow(?: once)?|allow this goal)$/iu.test(text);
}

function isStopPreview(text: string): boolean {
  return /หยุด preview|stop (?:the )?preview|stop (?:the )?dev server/iu.test(text);
}

function isRestartPreview(text: string): boolean {
  return /restart (?:มัน|it|preview)|รีสตาร์ต(?:มัน| preview)?/iu.test(text);
}

function isPreview(text: string, state: ConversationState | null | undefined): boolean {
  if (/\.(jsx?|tsx?|css|json)\b|history|ประวัติ/iu.test(text)) return false;
  if (/อยู่ port|port ไหน|เปิดอยู่ไหม|preview อยู่ไหม/iu.test(text)) return false;
  if (/เปิดให้ดู|เปิดดู|show me(?: the site)?|open (?:the |its )?preview|เปิด preview|preview ของมัน|preview(?: หน่อย)?$/iu.test(text)) return true;
  if (/^preview$/iu.test(text)) return true;
  if (hasActiveSoftware(state) && /เปิด(?:ของ)?(?:อันนี้|มัน)|open (?:it|this|that)/iu.test(text) && !/chrome|youtube|notepad|cursor|vscode/iu.test(text)) {
    return true;
  }
  return false;
}

function isTest(text: string): boolean {
  return /^(test|รัน test|run tests?)$/iu.test(text)
    || /รัน test|run (?:the )?tests?|test ด้วย|test อีก|แล้ว tests?\b|then tests?\b|ดู tests?\b/iu.test(text);
}

function isBuild(text: string, state: ConversationState | null | undefined): boolean {
  if (/create workspace|สร้างโฟลเดอร์โปรเจกต์/iu.test(text)) return false;
  if (/^(build|rebuild|build ใหม่)$/iu.test(text)) return Boolean(state?.activeProjectSlug);
  return /build ใหม่|rebuild|รัน build|then build|ก็ build|ดู build|check (?:the )?build/iu.test(text) && Boolean(state?.activeProjectSlug);
}

function isRerun(text: string): boolean {
  return /รันใหม่|run\b.{0,16}\bagain|rerun|อีกที/iu.test(text) && !/\b(test|build|preview)\b/iu.test(text);
}

function isStatus(text: string): boolean {
  return /ถึงไหนแล้ว|กำลังทำอะไร|มีอะไรพัง|มีงานอะไรค้าง|พร้อมทำงาน|พร้อมไหม|ตอนนี้ล่ะ|เป็นไงบ้าง|ผ่านไหม|ผ่าน\?|มีอะไรค้าง|project หลัก|มีกี่ project|queue (?:เมื่อกี้|เป็นยังไง)|ตอนนี้ทำถึงข้อไหน|ตอนนี้ตอบผมแบบไหน|preview อยู่ port|port ไหน|เปิดอยู่ไหม|preview อยู่ไหม|เรื่องที่เราทำล่าสุด|ทำอะไรไปล่าสุด|เราทำอะไรล่าสุด|มือถือเป็นไง|บนมือถือ|responsive เป็นไง|เช็กให้หน่อย|ดีขึ้นไหม|มี error|สมมติ|permission อะไร|ครอบคลุมอะไร|ทำอะไรกับ project ได้บ้าง|อะไรที่ยังทำไม่ได้/iu.test(text)
    || /how far|what(?:'s| is) left|what failed|are you ready|ready to work|what did we (?:just )?do|last (?:thing|task) we|\bstatus\b|check (?:it|that|the site|for (?:me|errors?))/iu.test(text);
}

function classifyStatusFocus(text: string, state: ConversationState | null | undefined): import('./types').StatusFocus {
  if (/เรื่องที่เราทำล่าสุด|ทำอะไรไปล่าสุด|เราทำอะไรล่าสุด|what did we (?:just )?do|last (?:thing|task) we/iu.test(text)) return 'recent';
  if (/พร้อมทำงาน|พร้อมไหม|are you ready|ready to work/iu.test(text)) return 'readiness';
  if (/ผ่านไหม|ผ่าน\?/iu.test(text)) return 'verification';
  if (/สมมติ/.test(text) && /ขาว|blank|error|พัง/iu.test(text)) return 'recovery';
  if (/มีอะไรพัง|what failed|มี error ใน console|console error|ขาวหมด|blank page/iu.test(text)) return 'failure';
  if (/มีงานอะไรค้าง|มีอะไรค้าง|what(?:'s| is) left/iu.test(text)) return 'pending';
  if (/preview อยู่ port|port ไหน|เปิดอยู่ไหม|preview อยู่ไหม/iu.test(text)) return 'preview';
  if (/มีกี่ project|project หลัก/iu.test(text)) return 'inventory';
  if (/ตอนนี้ตอบผมแบบไหน/iu.test(text)) return 'preference';
  if (/permission อะไร|ครอบคลุมอะไร/iu.test(text)) return 'permission';
  if (/ทำอะไรกับ project ได้บ้าง|อะไรที่ยังทำไม่ได้/iu.test(text)) return 'capability';
  if (/ถึงไหนแล้ว|กำลังทำอะไร|ตอนนี้ทำถึงข้อไหน|queue (?:เมื่อกี้|เป็นยังไง)|how far/iu.test(text)) return 'progress';
  if (/มือถือเป็นไง|บนมือถือ|responsive เป็นไง|ดีขึ้นไหม|เช็กให้หน่อย|check (?:it|that|the site)/iu.test(text) && hasActiveSoftware(state)) {
    return 'project';
  }
  if (/เป็นไงบ้าง|ตอนนี้ล่ะ/iu.test(text) && hasActiveSoftware(state)) return 'project';
  if (/เป็นไงบ้าง/iu.test(text)) return 'readiness';
  return hasActiveSoftware(state) ? 'progress' : 'readiness';
}

function isInspect(text: string, state: ConversationState | null | undefined): boolean {
  if (/\.(jsx?|tsx?|css|json)\b/.test(text)) return true;
  if (/function ไหน|ฟังก์ชันไหน|which function|ไฟล์ไหน.*(จัดการ|todo)|where (?:is|does)/iu.test(text)) return true;
  if (!hasActiveSoftware(state) && !/โปรเจกต์นี้|เว็บนี้/iu.test(text)) return false;
  return /มีหน้าอะไร|ไฟล์อะไรหลัก|package อะไร|ติดตั้งแล้วหรือยัง|ใช้จริงไหม|ไฟล์ไหนเปลี่ยน|เมื่อกี้แก้อะไร|what changed|which files? changed|เปิดดู .+\.(jsx?|tsx?|css|json)/iu.test(text);
}

function isMemoryStore(text: string): boolean {
  if (/จำอะไรเกี่ยวกับ/iu.test(text)) return false;
  return /จำไว้|remember (?:this|that)|เก็บไว้|ตอบสั้น|บอกสั้น|อย่าถามซ้ำ|ถ้า.{0,40}(?:fail|พัง).{0,40}สาเหตุ|ติดตั้ง package.{0,24}ถามก่อน|อย่าเก็บพวก|permission เดิมก็แก้|จำแบบนี้ไว้/iu.test(text);
}

function isMemoryQuery(text: string): boolean {
  return /จำอะไรเกี่ยวกับ|สีที่ผมเลือก|memory ของ project|ตอนแรกผมบอก|เราคุยอะไร|ย้อนแค่เรื่อง|เปลี่ยนใจตรงไหน|ถ้าผมกลับมาพรุ่งนี้|จำบทสนทนา|ได้ทั้งหมดไหม|เปิด history|show history|open history|เปิดประวัติ/iu.test(text);
}

function isNegate(text: string): boolean {
  return /อย่าแตะ|ไม่ต้องเปลี่ยน|ไม่เอาส่วน|แต่ไม่เอา|ไม่ต้องถามผมระหว่างทาง|ไฟล์เก่าอย่าแตะ|อย่าเยอะ|อย่ามาก|ไม่ต้องเยอะ|keep it (?:simple|light)|don't overdo|อย่าเก็บพวก/iu.test(text);
}

function isCorrect(text: string): boolean {
  return /ไม่ใช่|หมายถึง|เปลี่ยนใจ|จริงๆ|i meant|actually /iu.test(text);
}

function isPlanRequest(text: string): boolean {
  return /วางแผน|ขอดูแบบสั้น|ลองวางแผน|คิดมาให้หน่อย|ขอดู list|เพิ่มอะไรดี|what should we add|what to add/iu.test(text);
}

function isSwitchTopic(text: string): boolean {
  return /^(อีกเรื่อง(?:นึง|หนึ่ง)?|side topic)$/iu.test(text);
}

function isStartFresh(text: string): boolean {
  return /เริ่มงานใหม่|งั้นเริ่ม(?:งาน)?ใหม่|start (?:a )?new (?:task|job|work)|let'?s start (?:something )?new/iu.test(text)
    && !/อยากทำเว็บ|สร้างเว็บ|todo app|portfolio|สร้างแอป|สร้างแอพ/iu.test(text)
    && !/^(เริ่มได้|เริ่มเลย|เริ่ม)$/iu.test(text);
}

function isRestoreTopic(text: string, state: ConversationState | null | undefined): boolean {
  if (isContinue(text)) return false;
  if (/กลับไปเว็บ|กลับไปอันแรก|back to (?:the )?(?:site|web|portfolio)/iu.test(text)) return true;
  if (state?.projects && state.projects.length > 1 && /สลับไป|switch to/iu.test(text)) return true;
  if (state?.topicStack.length && /กลับไป/.test(text) && /เว็บ|โปรเจกต์|อันแรก|portfolio/iu.test(text)) return true;
  return false;
}

function isNewProject(text: string, state: ConversationState | null | undefined): boolean {
  const create = /อยากทำเว็บ|สร้างเว็บ|ทำเว็บ|build (?:a |an )?(?:web|site|portfolio)|สร้างแอป|สร้างแอพ|สร้าง todo|todo app เล็ก/iu.test(text);
  if (!create) return false;
  if (/อีกอัน|อีกโปรเจกต์|โปรเจกต์ใหม่|another (?:app|site|project)/iu.test(text)) return true;
  if (!state?.activeProjectSlug && !state?.pendingPlanReview) return true;
  if (/portfolio ใหม่|เว็บ .+ ใหม่/iu.test(text) && !/build ใหม่|rebuild/iu.test(text)) return true;
  return false;
}

function isResearch(text: string): boolean {
  return /หาให้หน่อย|เทียบ|อันไหนเหมาะ|best practice|official docs|research/iu.test(text)
    && !/สร้างเว็บ|ทำเว็บ|เพิ่มหน้า/iu.test(text);
}

function isResearchRecommend(text: string, state: ConversationState | null | undefined): boolean {
  if (state?.lastDiscourse !== 'RESEARCH' && state?.activeTopic !== 'research') return false;
  if (/ใส่ในแผน|เพิ่มหน้า|แก้ไฟล์|ติดตั้ง|กลับไปทำเว็บ/iu.test(text)) return false;
  return /เลือกมาอันเดียว|เลือกมาอัน(?:นึง|หนึ่ง)?|recommend (?:just )?one|pick one|which one should I (?:use|pick)|เลือก\s*\d+\s*อย่าง|อันไหนเอามาใช้/iu.test(text);
}

function isResearchFollowUp(text: string, state: ConversationState | null | undefined): boolean {
  if (state?.lastDiscourse !== 'RESEARCH' && state?.activeTopic !== 'research') return false;
  if (/ใส่ในแผน|เพิ่มหน้า|แก้ไฟล์|ติดตั้ง|กลับไปทำเว็บ|preview|รัน test/iu.test(text)) return false;
  if (isResearchRecommend(text, state)) return false;
  return /เบากว่า|สวยกว่า|เหมาะ|อันไหน|animation|framer|gsap|library|official docs|docs ด้วย/iu.test(text)
    || (text.length < 72 && !/เพิ่มปุ่ม|dark mode|navbar|hover/iu.test(text));
}

function isAccumulate(text: string, state: ConversationState | null | undefined): boolean {
  if (!state?.pendingPlanReview) return false;
  if (isNewProject(text, state) || isApprovePlan(text) || isExecuteNow(text)) return false;
  return /แนว|โทน|สี|mobile|responsive|หน้า about|contact|futuristic|ไม่รก|เน้นโชว์|เพิ่มหน้า/iu.test(text)
    || text.length < 80;
}

function isModify(text: string, state: ConversationState | null | undefined): boolean {
  if (!hasActiveSoftware(state) && !/เว็บนี้|โปรเจกต์นี้|มัน|อันนี้|ตรงนั้น|ตรงนี้/iu.test(text)) return false;
  return /เพิ่ม|แก้|เปลี่ยน|ใส่|ปรับ|hover|animation|dark mode|ทำตามนั้น|ให้มันดู|layout|column|ตรงนั้นแหละ|ตรงนี้แหละ|โล่ง|ว่างไป|แน่นขึ้น|navbar|footer|ใช้สีเดิม|สีเดิม|อยู่ก่อน|before /iu.test(text);
}

function hasPositiveEdit(text: string): boolean {
  return /เพิ่ม|แก้|เปลี่ยน|ใส่|ปรับ|ทำตามนั้น|ตรงนั้นแหละ|ตรงนี้แหละ|hover|animation|dark mode|layout|column|โล่ง/iu.test(text)
    && !/^(?:อย่า|ไม่เอา|ไม่ต้อง|แต่ไม่เอา|keep it|don't)/iu.test(text);
}

function isDestructiveAmbiguous(text: string): boolean {
  return /ลบอันเก่า|delete the old|remove the old one/iu.test(text) && !/preview|process/iu.test(text);
}

function isShortFollowUp(text: string): boolean {
  if (/ช่วยทำหน่อย|ช่วยด้วย|^help me$|can you help/iu.test(text)) return false;
  return text.length <= 24 && /ทำ|ต่อ|เลย|เหมือนเดิม|อันนี้|มัน/u.test(text);
}

function parseOrdinals(text: string, state?: ConversationState | null): number[] {
  const found = [
    ...[...text.matchAll(/(?:ข้อ|อันที่|option)\s*(\d+)/giu)].map(item => Number(item[1])),
    ...[...text.matchAll(/(?:กับ|and|,)\s*(?:ข้อ\s*)?(\d+)/giu)].map(item => Number(item[1])),
  ].filter(item => Number.isFinite(item) && item > 0);
  if (found.length >= 2) return [...new Set(found)].slice(0, 6);
  const one = parseOrdinal(text, state);
  return one ? [one] : [];
}

function parseOrdinal(text: string, state?: ConversationState | null): number | undefined {
  if (/อันนั้น|ใช้อันนั้น|เอาอันนั้น|use that(?: one)?/iu.test(text)) {
    return state?.selectedOption?.index || state?.offeredOptions[0]?.index || 1;
  }
  if (/อันแรก|the first|ข้อ\s*1\b|ข้อ 1|option 1|ข้อหนึ่ง/iu.test(text)) return 1;
  if (/อันสอง|อันที่สอง|the second|ข้อ\s*2\b|ข้อ 2|option 2/iu.test(text)) return 2;
  if (/อันสาม|the third|ข้อ\s*3\b|ข้อ 3|option 3/iu.test(text)) return 3;
  const numbered = text.match(/(?:ข้อ|อันที่|option)\s*(\d+)/iu);
  if (numbered) return Number(numbered[1]);
  return undefined;
}

function isMostlyOrdinal(text: string): boolean {
  return /^(เอา)?\s*(อันแรก|อันสอง|อันที่\s*\d+|ข้อ\s*\d+|the first(?: one)?|the second(?: one)?|option\s*\d+)\s*(?:โอเค)?$/iu.test(text)
    || /เอาอันที่(?:สอง|สาม|\d+)|เอาข้อ\s*\d+|เอาอันแรก|ใช้อันนั้น|ใช้อันแรก/iu.test(text)
    || /ข้อ\s*\d+\s*คืออะไร/iu.test(text)
    || /เอาข้อ\s*\d+(?:\s*(?:กับ|and|,)\s*(?:ข้อ\s*)?\d+)+/iu.test(text);
}

function isUnscopedAuthority(text: string): boolean {
  return /ทุกไฟล์ในเครื่อง|all files on (?:this |the )?(?:machine|computer)|unrestricted (?:filesystem|file access)|แก้ได้ทั้งเครื่อง/iu.test(text);
}

function isProjectScopedGrant(text: string): boolean {
  return /เอาเฉพาะ\s*(?:project|โปรเจกต์)\s*นี้|เฉพาะโปรเจกต์นี้|only this project/iu.test(text);
}

function isSelfGrantQuery(text: string): boolean {
  return /qwen/i.test(text) && /สิทธิ์|grant|เพิ่มสิทธิ์|self-?grant|อนุญาตเอง/iu.test(text);
}

function parseConditional(text: string): DiscourseInterpretation | null {
  if (!/ถ้า/.test(text) && !/\bif\b/iu.test(text)) return null;
  const acts = chainActs(text);
  if (acts.length >= 2) return chainInterpretation(text, acts);
  const ifPass = /ถ้าผ่าน|if (?:it |they |that |the tests? |tests? )?pass/iu.test(text);
  const thenBuild = /\bbuild\b/iu.test(text);
  const thenPreview = /preview|เปิดให้ดู|เปิดดู/iu.test(text);
  const thenFix = /แก้|fix|แก้ไข/iu.test(text) && /ปัญหา|error|fail|พัง/iu.test(text);
  if (ifPass && thenBuild && thenPreview) {
    return {
      act: 'CONDITIONAL',
      ifKind: 'test',
      thenAct: 'PREVIEW',
      thenActs: ['TEST', 'BUILD', 'PREVIEW'],
      confidence: 'HIGH',
      requiresClarification: false,
      source: 'discourse',
      change: text,
    };
  }
  if (ifPass && thenBuild) {
    return {
      act: 'CONDITIONAL',
      ifKind: 'test',
      thenAct: 'BUILD',
      thenActs: ['TEST', 'BUILD'],
      confidence: 'HIGH',
      requiresClarification: false,
      source: 'discourse',
      change: text,
    };
  }
  if (ifPass && thenPreview) {
    return {
      act: 'CONDITIONAL',
      ifKind: 'build',
      thenAct: 'PREVIEW',
      thenActs: ['BUILD', 'PREVIEW'],
      confidence: 'HIGH',
      requiresClarification: false,
      source: 'discourse',
      change: text,
    };
  }
  if (thenFix) {
    return {
      act: 'CONDITIONAL',
      ifKind: 'test',
      thenAct: 'MODIFY_PROJECT',
      thenActs: ['MODIFY_PROJECT'],
      confidence: 'HIGH',
      requiresClarification: false,
      source: 'discourse',
      change: text,
    };
  }
  if (/fail|พัง/.test(text) && /หยุด|stop/.test(text)) {
    return {
      act: 'CONDITIONAL',
      ifKind: 'test',
      thenAct: 'PAUSE',
      thenActs: ['PAUSE'],
      confidence: 'HIGH',
      requiresClarification: false,
      source: 'discourse',
      change: text,
    };
  }
  return null;
}

function parseOperationChain(text: string): DiscourseInterpretation | null {
  if (!/แล้ว|then|เสร็จแล้ว|ผ่านแล้วให้|and then/iu.test(text)) return null;
  const acts = chainActs(text);
  if (acts.length < 2) return null;
  return chainInterpretation(text, acts);
}

function chainActs(text: string): DiscourseAct[] {
  const acts: DiscourseAct[] = [];
  const lower = text.toLocaleLowerCase();
  if (/เพิ่ม|แก้|dark mode|filter|animation|ปรับ/iu.test(text)
    && (/\btests?\b/iu.test(lower) || /\bbuild\b/iu.test(lower) || /preview|เปิดให้ดู|เปิดดู/iu.test(text))) {
    acts.push('MODIFY_PROJECT');
  }
  if (/\btests?\b/iu.test(lower) || /รัน test/iu.test(text)) acts.push('TEST');
  if (/\bbuild\b/iu.test(lower)) acts.push('BUILD');
  if ((/preview/iu.test(lower) || /เปิดให้ดู|เปิดดู/iu.test(text)) && acts.length) acts.push('PREVIEW');
  return acts;
}

function chainInterpretation(text: string, acts = chainActs(text)): DiscourseInterpretation | null {
  if (acts.length < 2) return null;
  const ifKind = acts.includes('TEST') ? 'test' as const : 'build' as const;
  return {
    act: 'CONDITIONAL',
    ifKind,
    thenAct: acts[acts.length - 1],
    thenActs: acts,
    confidence: 'HIGH',
    requiresClarification: false,
    source: 'discourse',
    change: text,
  };
}

function parseQueue(text: string): string[] | null {
  const lines = text.split(/\r?\n/).map(line => line.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean);
  if (lines.length >= 3 && lines.length <= 12) return lines;
  return null;
}

function parseQueueOp(
  text: string,
  state: ConversationState | null | undefined,
): DiscourseInterpretation['queueOp'] | null {
  if (!state?.queue.length) return null;
  if (/ขอดู list|queue เป็นยังไง|ตอนนี้ทำถึงข้อไหน|show (?:the )?(?:queue|list)/iu.test(text)) {
    return { kind: 'review' };
  }
  if (/^(โอเคเริ่ม|เริ่มคิว|start (?:the )?queue)$/iu.test(text)) return { kind: 'start' };
  const swap = text.match(/สลับข้อ\s*(\d+)\s*กับ\s*(\d+)|swap\s+(\d+)\s+and\s+(\d+)/iu);
  if (swap) {
    return { kind: 'swap', a: Number(swap[1] || swap[3]), b: Number(swap[2] || swap[4]) };
  }
  const cut = text.match(/ตัด\s+(.+?)\s*ออก|remove\s+(.+)/iu);
  if (cut) return { kind: 'remove', text: (cut[1] || cut[2] || '').trim() };
  const skip = text.match(/ข้าม\s+(.+?)(?:\s+ถ้า|$)|skip\s+(.+)/iu);
  if (skip) return { kind: 'skip', text: (skip[1] || skip[2] || '').trim() };
  const insert = text.match(/เพิ่ม\s+(.+?)\s+ก่อน\s+(.+)/iu);
  if (insert) return { kind: 'insert', text: insert[1]!.trim(), before: insert[2]!.trim() };
  const append = text.match(/(?:เสร็จแล้ว)?เพิ่ม\s+(.+?)\s*ต่อท้าย|append\s+(.+)/iu);
  if (append) return { kind: 'append', text: (append[1] || append[2] || '').trim() };
  const move = text.match(/ทำหลัง\s+(.+?)\s+ก่อน\s+(.+)/iu);
  if (move) return { kind: 'move', text: move[1]!.trim(), before: move[2]!.trim() };
  return null;
}
