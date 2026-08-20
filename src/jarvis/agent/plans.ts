import { isGatedCapabilityId, isReadOnlyGatedCapability } from '../capabilities/actions/constants';
import { newStepId } from './store';
import type { PlanStep, PlanStepKind } from './types';

export function defaultPlanFor(objective: string): PlanStep[] {
  const title = objective.trim() || 'Untitled task';
  const understand = makeStep('understand', [], `Understand: ${title.slice(0, 80)}`);
  const plan = makeStep('plan', [understand.id], 'Build a structured plan');
  const apply = makeStep('apply', [plan.id], 'Execute the next safe action');
  const verify = makeStep('verify', [apply.id], 'Verify the outcome');
  const reflect = makeStep('reflect', [verify.id], 'Record a structured reflection');
  return [understand, plan, apply, verify, reflect];
}

export function capabilityKind(id: string): PlanStepKind {
  if (id.startsWith('research.')) return 'research';
  if (id.startsWith('workspace.')) return 'search';
  if (id.includes('memory') || id.includes('retrieve')) return 'retrieve';
  return 'apply';
}

export function needsOwnerPermission(capabilityId: string): boolean {
  return isGatedCapabilityId(capabilityId) && !isReadOnlyGatedCapability(capabilityId);
}

export function planForObjective(objective: string, capabilityId?: string): PlanStep[] {
  if (!capabilityId) return defaultPlanFor(objective);
  const title = objective.trim() || 'Untitled task';
  const understand = makeStep('understand', [], `Understand: ${title.slice(0, 80)}`);
  const deps = [understand.id];
  const steps: PlanStep[] = [understand];
  if (needsOwnerPermission(capabilityId)) {
    const permission = makeStep('permission', deps, `Request permission for ${capabilityId}`, capabilityId);
    steps.push(permission);
    deps[0] = permission.id;
  }
  const work = makeStep(capabilityKind(capabilityId), deps, `Invoke ${capabilityId}`, capabilityId);
  const verify = makeStep('verify', [work.id], 'Verify the structured outcome');
  const reflect = makeStep('reflect', [verify.id], 'Record a structured reflection');
  return [...steps, work, verify, reflect];
}

function makeStep(kind: PlanStepKind, dependencies: string[], title: string, capability?: string): PlanStep {
  return {
    id: newStepId(kind),
    title,
    kind,
    dependencies,
    status: 'pending',
    capability,
    riskLevel: kind === 'apply' && capability && needsOwnerPermission(capability) ? 'MEDIUM' : 'LOW',
    verificationMethod: kind === 'verify' || kind === 'test' ? 'structured_check' : 'observation',
    retryPolicy: { maxAttempts: 2, attempted: 0 },
  };
}
