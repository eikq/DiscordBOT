import type { PresentationDensity, PresentationInput, PresentationMode } from './types';
import { shouldAttachMemoryProvenance } from './memoryProvenance';

export type PresentationPlan = {
  density: PresentationDensity;
  mode: PresentationMode;
  reason: string;
};

const GREETING = /^(สวัสดี|hello|hi|hey|yo|หวัดดี)(\s|$|[!.])/iu;
const SHORT_ACK = /^(ok|okay|thanks|thank you|ครับ|ค่ะ|ได้|รับทราบ|👍+)$/iu;
const COMPARE = /\bcompar(e|ison|ing)\b|เทียบ|versus|\bvs\.?\b|ต่างจาก/iu;
const WALKTHROUGH = /\b(plan|roadmap|walkthrough|step[- ]by[- ]step|ลำดับ|แผนงาน|โรดแมป)\b/iu;
const RECOMMEND = /\brecommend|ควรทำ|ข้อเสนอ|next step|แนะนำ/iu;
const BENCHMARK = /\bbenchmark|tokens?\/sec|latency|p50|p95|วัดประสิทธิภาพ/iu;
const DIAGNOSTIC = /\b(status|diagnostic|สุขภาพ|สถานะระบบ|system status|telemetry)\b/iu;
const MONITOR = /\b(monitor|display|จอ|หน้าต่าง|desktop presence)\b/iu;
const REPORT = /\breport|สรุปผล|multi-section|findings\b/iu;

export function planPresentation(input: PresentationInput): PresentationPlan {
  const text = String(input.text || '').trim();
  const reply = String(input.replyText || input.workOutcome?.text || '').trim();
  const route = String(input.route || '').toUpperCase();

  if (!text || SHORT_ACK.test(text) || (GREETING.test(text) && text.length < 32)) {
    return { density: 'plain', mode: 'summary', reason: 'social_or_ack' };
  }

  if (route === 'CONVERSATION' && reply.length < 180 && !hasStructuredEvidence(input)) {
    return { density: 'plain', mode: 'summary', reason: 'short_conversation' };
  }

  if (isResearchTurn(input)) {
    if (COMPARE.test(text) || (input.research?.sources?.length ?? 0) >= 2) {
      return { density: 'briefing', mode: 'comparison', reason: 'research_comparison' };
    }
    return { density: 'briefing', mode: 'report', reason: 'research_summary' };
  }

  if (COMPARE.test(text) || (input.research?.disagreements?.length ?? 0) > 0) {
    return { density: 'briefing', mode: 'comparison', reason: 'explicit_comparison' };
  }

  if (BENCHMARK.test(text) || BENCHMARK.test(reply)) {
    return { density: 'rich', mode: 'report', reason: 'benchmark_results' };
  }

  if (input.capabilityId === 'system.status' || DIAGNOSTIC.test(text) || input.systemSnapshot) {
    return { density: 'rich', mode: 'report', reason: 'system_diagnostics' };
  }

  if (isDesktopPresenceCapability(input.capabilityId) || (MONITOR.test(text) && input.displays)) {
    return { density: 'rich', mode: 'summary', reason: 'monitor_device_status' };
  }

  if (WALKTHROUGH.test(text) || WALKTHROUGH.test(reply)) {
    return { density: 'briefing', mode: 'walkthrough', reason: 'plan_or_roadmap' };
  }

  if (RECOMMEND.test(text) && hasStructuredEvidence(input)) {
    return { density: 'rich', mode: 'recommendation', reason: 'recommendation_with_evidence' };
  }

  if (route === 'WORK' || input.workOutcome) {
    const outcome = input.workOutcome?.outcome;
    if (outcome === 'SUCCESS' || outcome === 'PARTIAL' || outcome === 'DEGRADED') {
      return { density: 'briefing', mode: REPORT.test(text) ? 'report' : 'summary', reason: 'work_result' };
    }
  }

  if (route === 'INFORMATION' && (reply.length >= 360 || sectionCount(reply) >= 3)) {
    return { density: 'rich', mode: 'summary', reason: 'long_informational' };
  }

  if (hasStructuredEvidence(input) && reply.length >= 220) {
    return { density: 'rich', mode: 'report', reason: 'structured_evidence' };
  }

  if (shouldAttachMemoryProvenance(input)) {
    return { density: 'rich', mode: 'report', reason: 'memory_provenance' };
  }

  return { density: 'plain', mode: 'summary', reason: 'lightweight_reply' };
}

export function shouldBuildRichPresentation(plan: PresentationPlan): boolean {
  return plan.density === 'rich' || plan.density === 'briefing';
}

function isResearchTurn(input: PresentationInput): boolean {
  const route = String(input.route || '').toUpperCase();
  if (input.capabilityId?.startsWith('research.') || route === 'RESEARCH') return true;
  if (input.capabilityId && !input.capabilityId.startsWith('research.')) return false;
  if (route === 'CAPABILITY' || route === 'CONVERSATION') return false;
  return hasResearchBody(input);
}

function hasResearchBody(input: PresentationInput): boolean {
  return Boolean(
    input.research?.synthesis
    || (input.research?.sources && input.research.sources.length > 0)
    || (input.research?.evidence && input.research.evidence.length > 0),
  );
}

function hasStructuredEvidence(input: PresentationInput): boolean {
  return hasResearchBody(input)
    || Boolean(input.workOutcome?.evidence?.length)
    || Boolean(input.workOutcome?.observations?.length)
    || Boolean(input.systemSnapshot?.parts?.length)
    || Boolean(input.systemSnapshot?.cpu || input.systemSnapshot?.ram || input.systemSnapshot?.disk || input.systemSnapshot?.gpu)
    || Boolean(typeof input.displays?.count === 'number' && input.displays.count > 0)
    || shouldAttachMemoryProvenance(input);
}

function isDesktopPresenceCapability(id?: string): boolean {
  return Boolean(id && (
    id === 'desktop.listDisplays'
    || id === 'desktop.getJarvisWindow'
    || id === 'desktop.moveJarvisWindow'
    || id === 'desktop.setJarvisWindowBounds'
    || id === 'desktop.focusJarvisWindow'
    || id === 'desktop.setJarvisLayout'
  ));
}

function sectionCount(text: string): number {
  return text.split(/\n{2,}|^#{1,3}\s+/mu).filter(part => part.trim().length > 40).length;
}
