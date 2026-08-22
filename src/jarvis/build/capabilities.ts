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
import { sandboxExists } from './sandbox';
import type { BuildPlan } from './types';
import { executeApprovedBuild } from './executeApprovedBuild';
import { ProjectWorkspace } from '../project/workspace';
import { createProjectCommandRunner, skipLiveCommandsInTests } from '../project/commands';
import type { ProjectCommandRunner } from '../project/types';
import type { DevServerRegistry } from '../project/devServer';

export type SoftwareCapabilityDeps = {
  plans: BuildPlanStore;
  events?: JarvisEventBus;
  sandboxRoot?: string;
  runner?: ProjectCommandRunner;
  devServers?: DevServerRegistry;
  workspace?: ProjectWorkspace;
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
      timeoutMs: 300_000,
      untrustedOutput: false,
      effects: [{
        kind: 'CREATE',
        description: 'Create, install, build, test, and optionally preview a project under data/jarvis/builds/<slug>/.',
        destructive: false,
        reversible: true,
        privilege: 'owner_approval',
        targetInputFields: ['planId'],
        estimatedAffectedObjects: 12,
        massChangePolicy: 'bounded_generated_output',
      }],
      verification: { mode: 'handler_result', description: 'Confirm workspace files and command exit codes after an approved apply.' },
      rollback: { mode: 'not_required', strategy: 'Project files stay inside the Jarvis build root and can be deleted by the owner.' },
      intelligence: {
        maturity: 'REAL',
        executionMode: 'REAL',
        permission: 'OWNER_REQUIRED',
        distribution: ['CORE'],
        knownLimitations: ['No unrestricted shell', 'No CLICK/TYPE/SUBMIT', 'Localhost preview only'],
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

async function invokeApply(
  input: Record<string, unknown>,
  context: CapabilityInvocationContext | undefined,
  deps: SoftwareCapabilityDeps,
): Promise<CapabilityResult> {
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
  if (plan.status !== 'COMPLETED') {
    deps.plans.save({ ...plan, status: 'EXECUTING' });
  }
  const workspace = deps.workspace ?? new ProjectWorkspace(deps.sandboxRoot);
  const executed = await executeApprovedBuild(plan, {
    workspace,
    runner: deps.runner ?? (skipLiveCommandsInTests() ? undefined : createProjectCommandRunner()),
    devServers: deps.devServers,
    events: deps.events,
  });
  deps.plans.save(executed.plan);
  const exists = sandboxExists({ slug: executed.plan.slug }, workspace.sandboxRoot) || workspace.exists(executed.plan.slug);
  const testsOk = !executed.tests || executed.tests.skipped || executed.tests.exitCode === 0;
  const ok = executed.plan.status === 'COMPLETED' && exists && testsOk;
  const content = ok
    ? executed.preview
      ? `สร้างโปรเจกต์ ${executed.plan.title} แล้ว Preview ${executed.preview.url}`
      : `สร้างโปรเจกต์ ${executed.plan.title} ใน ${executed.workspace}`
    : executed.correction?.summary || 'สร้างโปรเจกต์ไม่สำเร็จ';
  return {
    capabilityId: SOFTWARE_APPLY_BUILD,
    status: ok ? 'ok' : 'error',
    structured: {
      status: ok ? 'completed' : 'failed',
      reasonCode: ok ? 'PROJECT_BUILT' : (executed.failedStage || 'PROJECT_FAILED'),
      risk: 'CONFIRM_REQUIRED',
      summary: content,
      plan: executed.plan,
      artifact: executed.workspace,
      files: executed.files,
      install: executed.install,
      build: executed.build,
      tests: executed.tests,
      preview: executed.preview,
      correction: executed.correction,
    },
    content,
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect: 'write',
    ...(ok ? {} : { error: executed.failedStage || 'PROJECT_FAILED' }),
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
