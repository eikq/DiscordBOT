import type {
  CapabilityHandler,
  CapabilityHost,
  CapabilityInvocationContext,
  CapabilityResult,
} from '../capabilities/types';
import { SOFTWARE_APPLY_BUILD } from '../build/constants';
import { resolveJarvisEdition } from '../edition/resolve';
import { workspaceLogicalPath } from '../edition/types';
import {
  PROJECT_BUILD,
  PROJECT_CREATE_WORKSPACE,
  PROJECT_INSPECT_ARTIFACT,
  PROJECT_INSTALL_DEPENDENCIES,
  PROJECT_LIST_FILES,
  PROJECT_READ_FILE,
  PROJECT_RUN_SCRIPT,
  PROJECT_RUN_TESTS,
  PROJECT_START_DEV_SERVER,
  PROJECT_STOP_DEV_SERVER,
  PROJECT_WRITE_FILE,
  isRegisteredProjectScript,
  type ProjectInstallMode,
} from './constants';
import { ProjectPathError } from './pathGuard';
import { assertScriptRegistered, commandKindForInstall, skipLiveCommandsInTests } from './commands';
import type { ProjectCommandRunner } from './types';
import type { DevServerRegistry } from './devServer';
import { ProjectWorkspace } from './workspace';

export type ProjectCapabilityDeps = {
  workspace: ProjectWorkspace;
  runner?: ProjectCommandRunner;
  devServers?: DevServerRegistry;
  now?: () => number;
};

export function registerProjectCapabilities(host: CapabilityHost, deps: ProjectCapabilityDeps): void {
  for (const handler of projectHandlers(deps)) host.register(handler);
}

function projectHandlers(deps: ProjectCapabilityDeps): CapabilityHandler[] {
  return [
    mutating(PROJECT_CREATE_WORKSPACE, `Create a goal-scoped project workspace under ${workspaceLogicalPath('<slug>', resolveJarvisEdition())}.`, ['slug'], async input => {
      const slug = String(input.slug || '');
      const created = deps.workspace.create({ slug, title: slug });
      return ok(PROJECT_CREATE_WORKSPACE, `Workspace ready at ${created.dir}`, { workspace: created.dir, created: created.created });
    }),
    mutating(PROJECT_WRITE_FILE, 'Write one relative file inside the project workspace.', ['slug', 'relativePath', 'contents'], async input => {
      const written = deps.workspace.writeFile(String(input.slug), String(input.relativePath), String(input.contents));
      return ok(PROJECT_WRITE_FILE, `Wrote ${written.path}`, written);
    }),
    read(PROJECT_READ_FILE, 'Read one relative file inside the project workspace.', ['slug', 'relativePath'], async input => {
      const contents = deps.workspace.readFile(String(input.slug), String(input.relativePath));
      return ok(PROJECT_READ_FILE, contents.slice(0, 240), { contents }, 'read');
    }),
    read(PROJECT_LIST_FILES, 'List files inside the project workspace.', ['slug'], async input => {
      const files = deps.workspace.listFiles(String(input.slug));
      return ok(PROJECT_LIST_FILES, files.slice(0, 12).join(', ') || 'empty workspace', { files }, 'read');
    }),
    mutating(PROJECT_INSTALL_DEPENDENCIES, 'Run npm install or npm ci inside the project workspace.', ['slug'], async input => {
      return runInstall(deps, String(input.slug), input.mode === 'ci' ? 'ci' : 'install');
    }),
    mutating(PROJECT_RUN_SCRIPT, 'Run a registered package.json script inside the project workspace.', ['slug', 'script'], async input => {
      return runScript(deps, String(input.slug), String(input.script));
    }),
    mutating(PROJECT_RUN_TESTS, 'Run the registered test script or bounded Node smoke test.', ['slug'], async input => {
      return runTests(deps, String(input.slug));
    }),
    mutating(PROJECT_BUILD, 'Run the registered build script inside the project workspace.', ['slug'], async input => {
      return runScript(deps, String(input.slug), 'build');
    }),
    mutating(PROJECT_START_DEV_SERVER, 'Start the registered dev script on localhost only.', ['slug'], async input => {
      if (!deps.devServers) return fail(PROJECT_START_DEV_SERVER, 'DEV_SERVER_UNAVAILABLE', 'Dev server registry is not attached.');
      const workspace = deps.workspace.rootOf(String(input.slug));
      assertScriptRegistered(workspace, 'dev');
      const preview = await deps.devServers.start({ workspace, script: 'dev' });
      return ok(PROJECT_START_DEV_SERVER, `Preview ${preview.url}`, { preview });
    }),
    mutating(PROJECT_STOP_DEV_SERVER, 'Stop a Jarvis-owned localhost preview process.', ['slug'], async input => {
      if (!deps.devServers) return fail(PROJECT_STOP_DEV_SERVER, 'DEV_SERVER_UNAVAILABLE', 'Dev server registry is not attached.');
      const preview = await deps.devServers.stopWorkspace(deps.workspace.rootOf(String(input.slug)));
      return ok(PROJECT_STOP_DEV_SERVER, preview ? `Stopped ${preview.processRef}` : 'No preview was running', { preview });
    }),
    read(PROJECT_INSPECT_ARTIFACT, 'Inspect generated project files without opening arbitrary paths.', ['slug'], async input => {
      const files = deps.workspace.listFiles(String(input.slug));
      return ok(PROJECT_INSPECT_ARTIFACT, files.slice(0, 8).join(', '), {
        workspace: deps.workspace.rootOf(String(input.slug)),
        files,
        exists: deps.workspace.exists(String(input.slug)),
      }, 'read');
    }),
  ];
}

async function runInstall(deps: ProjectCapabilityDeps, slug: string, mode: ProjectInstallMode): Promise<CapabilityResult> {
  const workspace = deps.workspace.rootOf(slug);
  if (skipLiveCommandsInTests() && !deps.runner) {
    return ok(PROJECT_INSTALL_DEPENDENCIES, 'npm skipped in unit tests', {
      skipped: true,
      skipReason: 'NODE_TEST_CONTEXT',
      workspace,
    });
  }
  if (!deps.runner) return fail(PROJECT_INSTALL_DEPENDENCIES, 'RUNNER_UNAVAILABLE', 'Typed package installer is not attached.');
  const evidence = await deps.runner.run({
    kind: commandKindForInstall(mode),
    workspace,
  });
  if (evidence.exitCode !== 0) {
    return fail(PROJECT_INSTALL_DEPENDENCIES, 'INSTALL_FAILED', evidence.stderrSummary || 'npm install failed', evidence);
  }
  return ok(PROJECT_INSTALL_DEPENDENCIES, `Installed dependencies in ${slug}`, evidence);
}

async function runScript(deps: ProjectCapabilityDeps, slug: string, script: string): Promise<CapabilityResult> {
  if (!isRegisteredProjectScript(script)) {
    return fail(PROJECT_RUN_SCRIPT, 'UNREGISTERED_SCRIPT', 'Only registered package.json scripts can run.');
  }
  const workspace = deps.workspace.rootOf(slug);
  assertScriptRegistered(workspace, script);
  if (skipLiveCommandsInTests() && !deps.runner) {
    return ok(PROJECT_RUN_SCRIPT, `${script} skipped in unit tests`, { skipped: true, script, workspace });
  }
  if (!deps.runner) return fail(PROJECT_RUN_SCRIPT, 'RUNNER_UNAVAILABLE', 'Typed script runner is not attached.');
  const evidence = await deps.runner.run({ kind: 'npm-run', workspace, script });
  if (evidence.exitCode !== 0) {
    return fail(PROJECT_RUN_SCRIPT, 'SCRIPT_FAILED', evidence.stderrSummary || `${script} failed`, evidence);
  }
  return ok(PROJECT_RUN_SCRIPT, `Ran ${script}`, evidence);
}

async function runTests(deps: ProjectCapabilityDeps, slug: string): Promise<CapabilityResult> {
  const workspace = deps.workspace.rootOf(slug);
  if (skipLiveCommandsInTests() && !deps.runner) {
    return ok(PROJECT_RUN_TESTS, 'tests skipped in unit tests', { skipped: true, workspace });
  }
  if (!deps.runner) return fail(PROJECT_RUN_TESTS, 'RUNNER_UNAVAILABLE', 'Typed test runner is not attached.');
  let evidence;
  try {
    assertScriptRegistered(workspace, 'test');
    evidence = await deps.runner.run({ kind: 'npm-run', workspace, script: 'test' });
  } catch {
    evidence = await deps.runner.run({ kind: 'node-test', workspace, script: 'tests/smoke.test.mjs' });
  }
  if (evidence.exitCode !== 0) {
    return fail(PROJECT_RUN_TESTS, 'TEST_FAILED', evidence.stderrSummary || 'tests failed', evidence);
  }
  return ok(PROJECT_RUN_TESTS, `Tests passed for ${slug}`, evidence);
}

function mutating(
  id: string,
  description: string,
  fields: string[],
  invoke: (input: Record<string, unknown>, context?: CapabilityInvocationContext) => Promise<CapabilityResult>,
): CapabilityHandler {
  return {
    descriptor: () => ({
      id,
      description,
      inputSchema: { type: 'object', additionalProperties: false },
      outputSchema: { type: 'object' },
      sideEffect: 'write',
      requiredService: 'software',
      providerKind: 'local',
      timeoutMs: id === PROJECT_INSTALL_DEPENDENCIES || id === PROJECT_BUILD ? 180_000 : 60_000,
      untrustedOutput: false,
      intelligence: {
        maturity: 'REAL',
        executionMode: 'REAL',
        permission: 'OWNER_REQUIRED',
        distribution: ['CORE'],
        knownLimitations: ['No unrestricted shell', 'No CLICK/TYPE/SUBMIT', 'Workspace-bound only'],
      },
    }),
    availability: async () => ({ id, availability: 'up', degraded: false }),
    invoke: async (input, context) => {
      try {
        return await invoke(input, context);
      } catch (error) {
        return pathFail(id, error);
      }
    },
  };
}

function read(
  id: string,
  description: string,
  _fields: string[],
  invoke: (input: Record<string, unknown>, context?: CapabilityInvocationContext) => Promise<CapabilityResult>,
): CapabilityHandler {
  return {
    descriptor: () => ({
      id,
      description,
      inputSchema: { type: 'object', additionalProperties: false },
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
    availability: async () => ({ id, availability: 'up', degraded: false }),
    invoke: async (input, context) => {
      try {
        return await invoke(input, context);
      } catch (error) {
        return pathFail(id, error);
      }
    },
  };
}

function ok(
  id: string,
  content: string,
  structured: Record<string, unknown>,
  sideEffect: CapabilityResult['sideEffect'] = 'write',
): CapabilityResult {
  return {
    capabilityId: id,
    status: 'ok',
    structured: { status: 'completed', summary: content, ...structured },
    content,
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect,
  };
}

function fail(
  id: string,
  reasonCode: string,
  content: string,
  structured: Record<string, unknown> = {},
): CapabilityResult {
  return {
    capabilityId: id,
    status: 'error',
    structured: { status: 'failed', reasonCode, summary: content, ...structured },
    content,
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect: 'write',
    error: reasonCode,
  };
}

function pathFail(id: string, error: unknown): CapabilityResult {
  const reasonCode = error instanceof ProjectPathError ? error.reasonCode : 'PROJECT_PATH_BLOCKED';
  const content = error instanceof Error ? error.message : String(error);
  return fail(id, reasonCode, content);
}

export const APPLY_BUILD_COVERED_CAPABILITIES = [
  SOFTWARE_APPLY_BUILD,
  PROJECT_CREATE_WORKSPACE,
  PROJECT_WRITE_FILE,
  PROJECT_READ_FILE,
  PROJECT_LIST_FILES,
  PROJECT_INSTALL_DEPENDENCIES,
  PROJECT_RUN_SCRIPT,
  PROJECT_RUN_TESTS,
  PROJECT_BUILD,
  PROJECT_START_DEV_SERVER,
  PROJECT_STOP_DEV_SERVER,
  PROJECT_INSPECT_ARTIFACT,
] as const;
