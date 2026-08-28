import type { PlanStep, WorkTask, WorkTaskOutcome } from '../agent/types';
import { applyTaskOutcome } from '../evolution/lifecycle';
import type { EvolutionLifecycleResult, EvolutionLifecycleStores } from '../evolution/lifecycle';
import type { ProceduralSkillVersion } from '../evolution/types';
import { looksLikeSecret, redactSecrets } from '../security/redaction';
import type { PrivilegeActor } from '../security/types';
import type { VerificationState } from '../safety/types';
import type { AgentRun } from './types';
import { isAgentRunTerminal } from './types';

export type RuntimeLearningInput = {
  run: AgentRun;
  objective: string;
  outcome: WorkTaskOutcome;
  verification: {
    state: VerificationState;
    summary: string;
    evidence: string[];
    failedChecks?: string[];
  };
  observedTools?: string[];
  workflow?: string[];
  evidence?: string[];
  simulated?: boolean;
};
export type RuntimeLearningRecord = {
  lifecycle: EvolutionLifecycleResult;
  skillCandidates: ProceduralSkillVersion[];
  rawRuntimeOutputPersisted: false;
  autoPromotion: false;
};

export type RuntimeSkillEvaluation = {
  isolated: boolean;
  testsPassed: boolean;
  securityPassed: boolean;
  benchmarkBefore: number;
  benchmarkAfter: number;
};

export class RuntimeLearningError extends Error {
  constructor(public readonly reasonCode: string, message: string) {
    super(message);
    this.name = 'RuntimeLearningError';
  }
}

export class AgentRuntimeLearningBridge {
  constructor(private readonly stores: EvolutionLifecycleStores) {}

  public recordVerifiedOutcome(input: RuntimeLearningInput): RuntimeLearningRecord {
    this.assertLearnable(input);
    const before = new Set(this.stores.skills.list().map(skill => `${skill.skillId}:${skill.version}`));
    const lifecycle = applyTaskOutcome(this.toTask(input), this.stores);
    const skillCandidates = this.stores.skills.list().filter(skill =>
      !before.has(`${skill.skillId}:${skill.version}`) && skill.status === 'CANDIDATE');
    return {
      lifecycle,
      skillCandidates,
      rawRuntimeOutputPersisted: false,
      autoPromotion: false,
    };
  }

  public evaluateSkillCandidate(
    skillId: string,
    version: number,
    evaluation: RuntimeSkillEvaluation,
  ): ProceduralSkillVersion {
    const passed = evaluation.isolated
      && evaluation.testsPassed
      && evaluation.securityPassed
      && evaluation.benchmarkAfter > evaluation.benchmarkBefore;
    return this.stores.skills.markTested(skillId, version, passed);
  }

  public promoteSkillCandidate(
    actor: PrivilegeActor,
    skillId: string,
    version: number,
  ): ProceduralSkillVersion {
    if (actor !== 'owner') {
      throw new RuntimeLearningError('RUNTIME_SKILL_OWNER_REQUIRED', 'Only the owner may activate a learned runtime skill.');
    }
    const skill = this.stores.skills.get(skillId, version);
    if (!skill || skill.status !== 'TESTED') {
      throw new RuntimeLearningError('RUNTIME_SKILL_NOT_TESTED', 'Runtime skill must pass isolated evaluation before promotion.');
    }
    return this.stores.skills.promote(skillId, version, true);
  }
  private assertLearnable(input: RuntimeLearningInput): void {
    if (!isAgentRunTerminal(input.run.status)) {
      throw new RuntimeLearningError('RUNTIME_LEARNING_RUN_NOT_TERMINAL', 'Runtime learning requires a terminal Hermes run.');
    }
    if (input.outcome === 'success' && input.verification.state !== 'VERIFIED') {
      throw new RuntimeLearningError(
        'RUNTIME_LEARNING_UNVERIFIED_SUCCESS',
        'Hermes completion cannot become learned success without JARVIS verification.',
      );
    }
    if (input.outcome === 'success' && input.run.status !== 'completed') {
      throw new RuntimeLearningError('RUNTIME_LEARNING_STATUS_MISMATCH', 'A non-completed Hermes run cannot become success.');
    }
    for (const value of [input.objective, input.verification.summary]) {
      if (looksLikeSecret(value)) {
        throw new RuntimeLearningError('RUNTIME_LEARNING_SECRET_REJECTED', 'Runtime learning evidence contained secret material.');
      }
    }
  }

  private toTask(input: RuntimeLearningInput): WorkTask {
    const now = new Date().toISOString();
    const tools = unique(input.observedTools ?? []).map(item => bounded(item, 120));
    const workflow = unique(input.workflow ?? []).map(item => bounded(item, 180));
    const taskId = `hermes_${bounded(input.run.runId, 80).replace(/[^a-z0-9_-]+/giu, '_')}`;
    const evidence = safeEvidence([
      `runtime:${input.run.runId}`,
      `runtime-status:${input.run.status}`,
      ...(input.evidence ?? []),
      ...input.verification.evidence,
    ]);
    const plan = buildPlan(workflow, tools, input.outcome);
    const verificationState = input.verification.state;
    const success = input.outcome === 'success';
    return {
      id: taskId,
      objective: bounded(input.objective, 500),
      createdAt: now,
      updatedAt: now,
      status: taskStatus(input.outcome),
      plan,
      evidence,
      toolResults: tools.map(capability => ({
        capability,
        status: success ? 'ok' : 'error',
        summary: 'Observed during Hermes execution; learning outcome is controlled by JARVIS verification.',
      })),
      permissionRequirements: [],
      retryBudget: 0,
      retriesUsed: 0,
      errors: success ? [] : [{
        at: now,
        code: verificationState === 'FAILED_VERIFICATION' ? 'VERIFICATION_FAILED' : 'STEP_FAILED',
        message: bounded(input.verification.summary, 300),
      }],
      verification: {
        passed: verificationState === 'VERIFIED',
        summary: bounded(input.verification.summary, 500),
        state: verificationState,
        evidence: safeEvidence(input.verification.evidence),
        failedChecks: (input.verification.failedChecks ?? []).map(item => bounded(item, 180)),
      },
      outcome: input.outcome,
      simulated: input.simulated,
    };
  }
}
function buildPlan(workflow: string[], tools: string[], outcome: WorkTaskOutcome): PlanStep[] {
  const titles = workflow.length > 0
    ? workflow
    : tools.length > 0
      ? tools.map(tool => `Use ${tool}`)
      : ['Execute Hermes runtime task'];
  return titles.map((title, index) => ({
    id: `runtime_step_${index + 1}`,
    title,
    kind: index === titles.length - 1 ? 'verify' : 'apply',
    dependencies: index === 0 ? [] : [`runtime_step_${index}`],
    status: outcome === 'success' ? 'done' : index === titles.length - 1 ? 'failed' : 'done',
    riskLevel: 'LOW',
    verificationMethod: 'JARVIS structured runtime verification',
    retryPolicy: { maxAttempts: 0, attempted: 0 },
  }));
}

function taskStatus(outcome: WorkTaskOutcome): WorkTask['status'] {
  if (outcome === 'success') return 'COMPLETED';
  if (outcome === 'cancelled') return 'CANCELLED';
  if (outcome === 'blocked') return 'BLOCKED';
  if (outcome === 'degraded') return 'DEGRADED';
  return 'FAILED';
}
function safeEvidence(values: string[]): string[] {
  return unique(values)
    .filter(value => !looksLikeSecret(value))
    .map(value => bounded(value, 240))
    .slice(0, 24);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function bounded(value: string, limit: number): string {
  return redactSecrets(String(value || '').trim()).slice(0, limit);
}
