import type { SynthesizedTaskResponse, WorkTask } from './types';

export function synthesizeTaskResponse(task: WorkTask): SynthesizedTaskResponse {
  const outcome = outcomeOf(task);
  const evidence = unique([
    ...task.evidence,
    ...task.toolResults
      .filter(item => item.status === 'ok' && !item.summary.startsWith('untrusted'))
      .map(item => item.summary),
  ]).slice(0, 6);
  const observations = task.toolResults.map(item => (
    item.summary.startsWith('untrusted')
      ? `${item.capability}: untrusted external data (not owner-trusted memory)`
      : `${item.capability}: ${item.summary}`
  )).slice(0, 8);
  return {
    outcome,
    text: render(task, outcome, evidence, observations),
    evidence,
    observations,
    verification: task.verification?.summary,
  };
}

function outcomeOf(task: WorkTask): SynthesizedTaskResponse['outcome'] {
  if (task.status === 'WAITING_INPUT' || task.status === 'WAITING_PERMISSION' || task.outcome === 'blocked' || task.status === 'BLOCKED') {
    return 'BLOCKED';
  }
  if (task.outcome === 'cancelled' || task.status === 'CANCELLED') return 'CANCELLED';
  if (task.outcome === 'degraded' || task.status === 'DEGRADED') return 'DEGRADED';
  if (task.outcome === 'failure' || task.status === 'FAILED') return 'FAILED';
  if (task.outcome === 'success' || task.status === 'COMPLETED') {
    const skipped = task.plan.some(step => step.status === 'skipped');
    const incomplete = !task.verification?.passed && task.toolResults.length === 0;
    return skipped || incomplete ? 'PARTIAL' : 'SUCCESS';
  }
  return 'PARTIAL';
}

function render(
  task: WorkTask,
  outcome: SynthesizedTaskResponse['outcome'],
  evidence: string[],
  observations: string[],
): string {
  const planSpeak = task.toolResults.find(item => item.capability === 'software.planBuild' && item.status === 'ok')?.summary;
  if (planSpeak && !planSpeak.startsWith('untrusted') && !isInternalSpeak(planSpeak)) return compactSpeak(planSpeak);
  const applySpeak = task.toolResults.find(item => item.capability === 'software.applyBuild' && item.status === 'ok')?.summary;
  if (applySpeak && !applySpeak.startsWith('untrusted') && !isInternalSpeak(applySpeak)) return compactSpeak(applySpeak);
  const testSpeak = task.toolResults.find(item => /runTests|\.test/i.test(item.capability) && item.status === 'ok')?.summary;
  if (outcome === 'SUCCESS' && task.verification?.summary && !isInternalSpeak(task.verification.summary)) {
    return compactSpeak(task.verification.summary);
  }
  if (outcome === 'SUCCESS' && testSpeak && !isInternalSpeak(testSpeak)) {
    return compactSpeak(testSpeak);
  }
  const objective = task.objective.slice(0, 80);
  const lines = [`${label(outcome)} for “${objective}”.`];
  if (task.verification?.summary) lines.push(task.verification.summary);
  if (observations[0] && outcome !== 'SUCCESS') lines.push(observations[0]);
  if (outcome === 'BLOCKED' && task.permissionRequirements[0]) {
    lines.push('ทำได้ครับ แต่ต้องขอสิทธิ์ก่อน');
  }
  if (outcome === 'FAILED' && evidence[0]) lines.push(evidence[0]);
  if (task.status === 'WAITING_INPUT' && task.waitingInput) {
    lines.push(`Waiting for owner input: ${task.waitingInput.question}`);
  }
  if (outcome === 'BLOCKED' && task.blockers?.[0]) {
    const blocker = task.blockers[0];
    lines.push(`Current blocker: ${blocker.blocker} at ${blocker.capabilityId}.`);
    if (task.gapResolution?.recommendedPath) {
      lines.push(`Safest next path: ${task.gapResolution.recommendedPath.title}`);
    }
  }
  if (outcome === 'FAILED' && task.errors[0]) {
    lines.push(task.errors[0].message);
  }
  if (task.simulated) lines.push('This run was labeled SIMULATION.');
  return lines.join(' ').replace(/\s+/gu, ' ').trim();
}

function isInternalSpeak(text: string): boolean {
  return /postcondition|mutation postcondition|no mutation/i.test(text);
}

function compactSpeak(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 180 ? `${clean.slice(0, 177)}…` : clean;
}

function label(outcome: SynthesizedTaskResponse['outcome']): string {
  if (outcome === 'SUCCESS') return 'Done';
  if (outcome === 'PARTIAL') return 'Partially completed';
  if (outcome === 'BLOCKED') return 'Blocked';
  if (outcome === 'FAILED') return 'Failed';
  if (outcome === 'CANCELLED') return 'Cancelled';
  return 'Completed with degradation';
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(item => item.trim()).filter(Boolean))];
}
