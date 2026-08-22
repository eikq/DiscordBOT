import type {
  CapabilityHandler,
  CapabilityHost,
  CapabilityInvocationContext,
  CapabilityResult,
} from '../capabilities/types';
import type { JarvisEventBus } from '../security/eventBus';
import { SOFTWARE_APPLY_BUILD, SOFTWARE_PLAN_BUILD } from './constants';
import { createBuildPlan, spokenPlanSummary } from './planner';
import type { BuildPlanStore } from './planStore';
import { sandboxExists, writeApprovedSandbox } from './sandbox';
import type { BuildPlan } from './types';

export type SoftwareCapabilityDeps = {
  plans: BuildPlanStore;
  events?: JarvisEventBus;
  sandboxRoot?: string;
};

const WRITABLE = new Set(['APPROVED', 'EXECUTING', 'VERIFYING', 'COMPLETED']);

export function registerSoftwareCapabilities(host: CapabilityHost, deps: SoftwareCapabilityDeps): void {
  host.register(planHandler(deps));
  host.register(applyHandler(deps));
}

function planHandler(deps: SoftwareCapabilityDeps): CapabilityHandler {
  return {
    descriptor: () => ({
      id: SOFTWARE_PLAN_BUILD,
      description: 'Create a structured software or website plan without writing files. The plan is not execution permission.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          brief: { type: 'string' },
          query: { type: 'string' },
          goalId: { type: 'string' },
        },
        anyOf: [{ required: ['brief'] }, { required: ['query'] }],
      },
      outputSchema: { type: 'object' },
      sideEffect: 'read',
      requiredService: 'software',
      providerKind: 'local',
      timeoutMs: 8_000,
      untrustedOutput: false,
      intelligence: {
        maturity: 'REAL',
        executionMode: 'REAL',
        permission: 'NOT_REQUIRED',
        distribution: ['CORE'],
      },
    }),
    availability: async () => ({ id: SOFTWARE_PLAN_BUILD, availability: 'up', degraded: false }),
    invoke: async (input, context) => invokePlan(input, context, deps),
  };
}

function applyHandler(deps: SoftwareCapabilityDeps): CapabilityHandler {
  return {
    descriptor: () => ({
      id: SOFTWARE_APPLY_BUILD,
      description: 'Write an approved build plan into the Jarvis sandbox after owner permission. Never grants unrestricted shell.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          brief: { type: 'string' },
          planId: { type: 'string' },
          goalId: { type: 'string' },
        },
      },
      outputSchema: { type: 'object' },
      sideEffect: 'write',
      requiredService: 'software',
      providerKind: 'local',
      timeoutMs: 20_000,
      untrustedOutput: false,
      effects: [{
        kind: 'CREATE',
        description: 'Create sandbox project files under data/jarvis/builds/<slug>/.',
        destructive: false,
        reversible: true,
        privilege: 'owner_approval',
        targetInputFields: ['planId'],
        estimatedAffectedObjects: 6,
        massChangePolicy: 'bounded_generated_output',
      }],
      verification: { mode: 'handler_result', description: 'Confirm sandbox files exist after an approved apply.' },
      rollback: { mode: 'not_required', strategy: 'Sandbox files stay inside the Jarvis build root and can be deleted by the owner.' },
      intelligence: {
        maturity: 'REAL',
        executionMode: 'REAL',
        permission: 'OWNER_REQUIRED',
        distribution: ['CORE'],
        knownLimitations: ['No unrestricted shell', 'No npm install', 'No CLICK/TYPE/SUBMIT'],
      },
    }),
    availability: async () => ({ id: SOFTWARE_APPLY_BUILD, availability: 'up', degraded: false }),
    invoke: async (input, context) => invokeApply(input, context, deps),
  };
}

function invokePlan(
  input: Record<string, unknown>,
  context: CapabilityInvocationContext | undefined,
  deps: SoftwareCapabilityDeps,
): CapabilityResult {
  const brief = String(input.brief || input.query || '').trim();
  if (!brief) {
    return fail(SOFTWARE_PLAN_BUILD, 'rejected', 'INVALID_ARGUMENT', 'brief is required.', 'read');
  }
  const plan = createBuildPlan({
    brief,
    goalId: typeof input.goalId === 'string' ? input.goalId : undefined,
    sessionId: context?.sessionId,
  });
  deps.plans.save(plan);
  deps.events?.emit('PLAN_CREATED', 'reading requirements', {
    planId: plan.id,
    goalId: plan.goalId,
    title: plan.title,
    slug: plan.slug,
    status: plan.status,
  });
  const content = `${spokenPlanSummary(plan)}\nยังไม่สร้างไฟล์`;
  return {
    capabilityId: SOFTWARE_PLAN_BUILD,
    status: 'ok',
    structured: {
      status: 'completed',
      reasonCode: 'PLAN_ONLY',
      risk: 'READ_ONLY',
      summary: content,
      plan,
    },
    content,
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect: 'read',
  };
}

function invokeApply(
  input: Record<string, unknown>,
  context: CapabilityInvocationContext | undefined,
  deps: SoftwareCapabilityDeps,
): CapabilityResult {
  const plan = resolvePlan(input, context, deps);
  if (!plan) {
    return fail(SOFTWARE_APPLY_BUILD, 'rejected', 'PLAN_NOT_FOUND', 'I do not have an approved plan for this session.', 'write');
  }
  if (!WRITABLE.has(plan.status)) {
    return fail(
      SOFTWARE_APPLY_BUILD,
      'rejected',
      'PLAN_NOT_APPROVED',
      'แผนยังไม่ถูกอนุมัติ ผมยังไม่สร้างไฟล์',
      'write',
      plan,
    );
  }
  deps.events?.emit('PLAN_STAGE_STARTED', 'project structure prepared', {
    planId: plan.id,
    title: plan.title,
    slug: plan.slug,
  });
  if (plan.status !== 'COMPLETED') {
    deps.plans.save({ ...plan, status: 'EXECUTING' });
  }
  const written = writeApprovedSandbox(plan, deps.sandboxRoot);
  deps.events?.emit('ARTIFACT_CREATED', 'file created', {
    planId: plan.id,
    title: plan.title,
    slug: plan.slug,
    files: written.files,
  });
  deps.events?.emit('VERIFY_STARTED', 'checking sandbox artifacts', { planId: plan.id, slug: plan.slug });
  const exists = sandboxExists({ slug: plan.slug }, deps.sandboxRoot);
  deps.events?.emit('VERIFY_RESULT', exists ? 'test passed' : 'test failed', {
    planId: plan.id,
    slug: plan.slug,
    ok: exists,
  });
  const next: BuildPlan = {
    ...plan,
    status: exists ? 'COMPLETED' : 'FAILED',
    stages: plan.stages.map(stage => ({ ...stage, status: exists ? 'complete' : stage.status })),
    updatedAt: Date.now(),
  };
  deps.plans.save(next);
  deps.events?.emit(exists ? 'PLAN_STAGE_COMPLETED' : 'PLAN_STAGE_FAILED', exists ? 'sandbox ready' : 'sandbox missing', {
    planId: next.id,
    title: next.title,
    slug: next.slug,
  });
  const content = exists
    ? `สร้างโปรเจกต์ ${next.title} ใน sandbox แล้ว (${written.dir})`
    : 'สร้างไฟล์ไม่สำเร็จ';
  return {
    capabilityId: SOFTWARE_APPLY_BUILD,
    status: exists ? 'ok' : 'error',
    structured: {
      status: exists ? 'completed' : 'failed',
      reasonCode: exists ? 'SANDBOX_WRITTEN' : 'SANDBOX_MISSING',
      risk: 'CONFIRM_REQUIRED',
      summary: content,
      plan: next,
      artifact: written.dir,
    },
    content,
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect: 'write',
    ...(exists ? {} : { error: 'SANDBOX_MISSING' }),
  };
}

function resolvePlan(
  input: Record<string, unknown>,
  context: CapabilityInvocationContext | undefined,
  deps: SoftwareCapabilityDeps,
): BuildPlan | null {
  if (typeof input.planId === 'string' && input.planId.trim()) {
    return deps.plans.get(input.planId.trim());
  }
  if (context?.sessionId) {
    const fromSession = deps.plans.latestForSession(context.sessionId);
    if (fromSession) return fromSession;
  }
  return deps.plans.list(1)[0] || null;
}

function fail(
  id: string,
  status: CapabilityResult['status'],
  reasonCode: string,
  content: string,
  sideEffect: CapabilityResult['sideEffect'],
  plan?: BuildPlan,
): CapabilityResult {
  return {
    capabilityId: id,
    status,
    structured: {
      status,
      reasonCode,
      summary: content,
      ...(plan ? { plan } : {}),
    },
    content,
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect,
    error: reasonCode,
  };
}
