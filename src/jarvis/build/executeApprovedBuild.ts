import type { BuildPlan } from './types';
import type { JarvisEventBus } from '../security/eventBus';
import type { JarvisOperationEventType } from '../security/types';
import { sandboxExists } from './sandbox';
import { classifyProjectFailure, correctionProposalFromFailure } from '../project/failure';
import {
  assertScriptRegistered,
  commandKindForInstall,
  evidencePassed,
  skipLiveCommandsInTests,
} from '../project/commands';
import type { ProjectCommandEvidence, ProjectCommandRunner } from '../project/types';
import type { DevServerRegistry } from '../project/devServer';
import { ProjectWorkspace, writeTodoWebsite } from '../project/workspace';
import type { PreviewArtifact } from '../project/types';

export type ApprovedBuildRuntime = {
  workspace: ProjectWorkspace;
  runner?: ProjectCommandRunner;
  devServers?: DevServerRegistry;
  events?: JarvisEventBus;
  now?: () => number;
};

export type ApprovedBuildResult = {
  plan: BuildPlan;
  files: string[];
  workspace: string;
  install?: ProjectCommandEvidence;
  build?: ProjectCommandEvidence;
  tests?: ProjectCommandEvidence;
  preview?: PreviewArtifact;
  failedStage?: string;
  failureClass?: string;
  correction?: ReturnType<typeof correctionProposalFromFailure>;
};

export async function executeApprovedBuild(
  plan: BuildPlan,
  deps: ApprovedBuildRuntime,
): Promise<ApprovedBuildResult> {
  const now = deps.now ?? Date.now;
  const emit = (
    type: JarvisOperationEventType,
    summary: string,
    payload: Record<string, unknown> = {},
    visualState?: string,
  ) => {
    deps.events?.emit(type, summary, {
      planId: plan.id,
      goalId: plan.goalId,
      title: plan.title,
      slug: plan.slug,
      ...payload,
    }, 'info', visualState ? { visualState } : {});
  };

  emit('PLAN_STAGE_STARTED', 'scaffolding workspace', { stage: 'SCAFFOLD' }, 'EXECUTING');
  const files = writeTodoWebsite(plan, deps.workspace);
  emit('ARTIFACT_CREATED', 'workspace files written', { stage: 'SCAFFOLD', files }, 'EXECUTING');

  const workspace = deps.workspace.rootOf(plan.slug);
  const result: ApprovedBuildResult = { plan, files, workspace };

  const install = await maybeRun(deps, {
    kind: 'install',
    run: () => deps.runner!.run({ kind: commandKindForInstall('install'), workspace }),
  });
  result.install = install.evidence;
  emit('ARTIFACT_UPDATED', install.summary, { stage: 'INSTALL', evidence: install.evidence }, 'EXECUTING');
  if (install.failed) {
    return failStage(plan, result, 'INSTALL', install.evidence!, emit);
  }

  const build = await maybeRun(deps, {
    kind: 'build',
    run: () => {
      assertScriptRegistered(workspace, 'build');
      return deps.runner!.run({ kind: 'npm-run', workspace, script: 'build' });
    },
  });
  result.build = build.evidence;
  emit('ARTIFACT_UPDATED', build.summary, { stage: 'BUILD', evidence: build.evidence }, 'EXECUTING');
  if (build.failed) {
    return failStage(plan, result, 'BUILD', build.evidence!, emit);
  }

  emit('VERIFY_STARTED', 'running project tests', { stage: 'TEST' }, 'VERIFYING');
  const tests = await maybeRun(deps, {
    kind: 'test',
    run: async () => {
      try {
        assertScriptRegistered(workspace, 'test');
        return deps.runner!.run({ kind: 'npm-run', workspace, script: 'test' });
      } catch {
        return deps.runner!.run({ kind: 'node-test', workspace, script: 'tests/smoke.test.mjs' });
      }
    },
  });
  result.tests = tests.evidence;
  emit('VERIFY_RESULT', tests.summary, {
    stage: 'TEST',
    ok: tests.evidence ? evidencePassed(tests.evidence) : false,
    evidence: tests.evidence,
  }, 'VERIFYING');
  if (tests.failed) {
    return failStage(plan, result, 'TEST', tests.evidence!, emit);
  }

  if (deps.devServers && !skipLiveCommandsInTests()) {
    try {
      assertScriptRegistered(workspace, 'dev');
      result.preview = await deps.devServers.start({ workspace, script: 'dev' });
      emit('PREVIEW_READY', `preview ${result.preview.url}`, {
        stage: 'PREVIEW',
        preview: result.preview,
        url: result.preview.url,
      }, 'EXECUTING');
    } catch (error) {
      emit('PLAN_STAGE_FAILED', error instanceof Error ? error.message : String(error), { stage: 'PREVIEW' }, 'WARNING');
    }
  } else {
    emit('ARTIFACT_UPDATED', 'preview skipped in unit tests', { stage: 'PREVIEW', skipped: true }, 'EXECUTING');
  }

  const exists = sandboxExists({ slug: plan.slug }, deps.workspace.sandboxRoot) || deps.workspace.exists(plan.slug);
  const testsPassed = !result.tests || evidencePassed(result.tests) || result.tests.skipped === true;
  const ok = exists && testsPassed && (!result.build || evidencePassed(result.build) || result.build.skipped === true);
  emit(ok ? 'PLAN_STAGE_COMPLETED' : 'PLAN_STAGE_FAILED', ok ? 'project workspace verified' : 'verification missing', {
    stage: 'VERIFY',
    ok,
  }, ok ? 'IDLE' : 'WARNING');
  result.plan = {
    ...plan,
    status: ok ? 'COMPLETED' : 'FAILED',
    stages: plan.stages.map(stage => ({ ...stage, status: ok ? 'complete' : stage.status })),
    updatedAt: now(),
  };
  return result;
}

async function maybeRun(
  deps: ApprovedBuildRuntime,
  input: { kind: 'install' | 'build' | 'test'; run: () => Promise<ProjectCommandEvidence> },
): Promise<{ evidence?: ProjectCommandEvidence; failed: boolean; summary: string }> {
  if (skipLiveCommandsInTests() && !deps.runner) {
    return {
      evidence: {
        commandType: input.kind === 'install' ? 'npm-install' : input.kind === 'test' ? 'node-test' : 'npm-run',
        argv: ['skipped'],
        workspace: '',
        exitCode: 0,
        durationMs: 0,
        stdoutSummary: 'skipped in unit tests',
        stderrSummary: '',
        passed: false,
        skipped: true,
        skipReason: 'NODE_TEST_CONTEXT',
      },
      failed: false,
      summary: `${input.kind} skipped in unit tests`,
    };
  }
  if (!deps.runner) {
    return { failed: true, summary: `typed ${input.kind} runner is not attached` };
  }
  try {
    const evidence = await input.run();
    const failed = evidence.skipped !== true && evidence.exitCode !== 0;
    return {
      evidence,
      failed,
      summary: failed
        ? `${input.kind} failed with exit ${evidence.exitCode}`
        : evidence.skipped
          ? `${input.kind} skipped`
          : `${input.kind} exit ${evidence.exitCode}`,
    };
  } catch (error) {
    return { failed: true, summary: error instanceof Error ? error.message : String(error) };
  }
}

function failStage(
  plan: BuildPlan,
  result: ApprovedBuildResult,
  stage: string,
  evidence: ProjectCommandEvidence,
  emit: (type: JarvisOperationEventType, summary: string, payload?: Record<string, unknown>, visualState?: string) => void,
): ApprovedBuildResult {
  const correction = correctionProposalFromFailure({ evidence, workspace: result.workspace });
  emit('PLAN_STAGE_FAILED', correction.summary, { stage, evidence, correction }, 'WARNING');
  return {
    ...result,
    failedStage: stage,
    failureClass: classifyProjectFailure(evidence),
    correction,
    plan: {
      ...plan,
      status: 'FAILED',
      updatedAt: Date.now(),
    },
  };
}
