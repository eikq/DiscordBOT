import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SqliteJarvisMemoryStore } from '../src/bot/memory/jarvis/SqliteJarvisMemoryStore';
import {
  PROJECT_BUILD,
  PROJECT_INSTALL_DEPENDENCIES,
  PROJECT_RUN_SCRIPT,
  PROJECT_WRITE_FILE,
  PrivilegeLeaseStore,
  SOFTWARE_APPLY_BUILD,
  SOFTWARE_PLAN_BUILD,
  applyOwnerDecision,
  compactCapabilityCatalog,
  createBuildPlan,
  createFakeCommandRunner,
  createPendingPermissionRecord,
  createStandaloneCapabilityHost,
  executeApprovedBuild,
  isActionHost,
  isForbiddenGenericShell,
  isModelIdentityQuestion,
  looksLikeShellMetachar,
  ownerConfirmationVisibleText,
  permissionPolicyFingerprint,
  PERMISSION_POLICY_REVISION,
  revalidatePermissionRecord,
  spokenTrustedModelIdentity,
  trustedRuntimeModelIdentity,
  typedArgv,
  validateActionInput,
  writeTodoWebsite,
} from '../src/jarvis';
import type { DesktopActionAdapter } from '../src/jarvis/capabilities/actions/DesktopActionAdapter';
import type { DesktopAllowlists } from '../src/jarvis/capabilities/actions/types';
import { BUILD_GOAL_EFFECTS } from '../src/jarvis/security/permissionProposal';
import { BuildPlanStore } from '../src/jarvis/build/planStore';
import { formatSseEvent } from '../src/jarvis/ops/sse';
import { DevServerRegistry } from '../src/jarvis/project/devServer';
import { resolveWorkspaceFile } from '../src/jarvis/project/pathGuard';
import { evidencePassed } from '../src/jarvis/project/commands';
import { ProjectWorkspace as Workspace } from '../src/jarvis/project/workspace';
import { createJarvisLabRuntime } from '../src/jarvis/standalone/labRuntime';
import { PersistentPermissionStore } from '../src/jarvis/security/persistentPermission';
import { JarvisEventBus } from '../src/jarvis/security/eventBus';

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function stubAdapter(): DesktopActionAdapter {
  return {
    openApplication: async () => ({ status: 'started' }),
    openProject: async () => ({ status: 'started' }),
    openUrl: async () => ({ status: 'started' }),
  };
}

function emptyAllowlists(): DesktopAllowlists {
  return {
    applications: [],
    projects: [],
    trustedOrigins: [],
    trustedPathPrefixes: [],
    explorerExecutable: 'C:\\Safe\\explorer.exe',
    workspaceRoot: process.cwd(),
  };
}

function builderHost(root: string, memory: SqliteJarvisMemoryStore) {
  const events = new JarvisEventBus();
  const leases = new PrivilegeLeaseStore({ events });
  const permissions = new PersistentPermissionStore({
    dbPath: path.join(root, 'permissions.db'),
  });
  const host = createStandaloneCapabilityHost({
    worldIntel: false,
    reminders: false,
    research: false,
    workspace: false,
    build: { db: memory.database(), sandboxRoot: path.join(root, 'builds') },
    actions: {
      allowlists: emptyAllowlists(),
      adapter: stubAdapter(),
      leases,
      permissions,
      events,
      audit: false,
    },
  });
  return { host, leases, permissions };
}

test('runtime identity is derived from the profile registry, not Qwen self-description', async () => {
  assert.equal(isModelIdentityQuestion('ตอนนี้ใช้โมเดลอะไร'), true);
  const identity = trustedRuntimeModelIdentity({
    models: [{ id: 'qwen38-cyber' }],
    selectedId: 'qwen38-cyber',
  });
  assert.equal(identity.displayName, 'Qwen3.8 27B Cyber Abliterated');
  assert.equal(identity.alias, 'qwen38-cyber');
  assert.equal(identity.immutable, true);
  assert.match(spokenTrustedModelIdentity(identity), /Qwen3\.8 27B Cyber Abliterated/);
  assert.match(spokenTrustedModelIdentity(identity), /qwen38-cyber/);
  const lab = createJarvisLabRuntime({
    attachDefaultMemory: false,
    attachDefaultSkills: false,
    attachDefaultPresentation: false,
    attachDefaultSpeech: false,
    reminders: false,
    research: false,
    workspace: false,
    commandCenter: false,
    llm: { generateText: async () => 'I am GPT-5 and Llama at the same time' },
  });
  const asked = await lab.ask({ text: 'ตอนนี้ใช้โมเดลอะไร', sessionId: 'identity' });
  assert.equal(asked.selfKnowledge?.kind, 'MODEL_IDENTITY');
  assert.match(asked.presented.text, /Qwen3\.8 27B Cyber Abliterated/);
  assert.match(asked.presented.text, /qwen38-cyber/);
  assert.doesNotMatch(asked.presented.text, /GPT-5|Llama/i);
});

test('owner confirmation labels stay honest for UI vs expressed text', () => {
  assert.equal(ownerConfirmationVisibleText({
    decision: 'allow',
    duration: 'THIS_GOAL',
    source: 'ui_action',
  }), '[อนุญาตงานนี้]');
  assert.equal(ownerConfirmationVisibleText({
    decision: 'allow',
    duration: 'ONCE',
    source: 'ui_action',
  }), '[อนุญาตครั้งนี้]');
  assert.equal(ownerConfirmationVisibleText({
    decision: 'deny',
    source: 'ui_action',
  }), '[ไม่อนุญาต]');
  assert.equal(ownerConfirmationVisibleText({
    decision: 'allow',
    source: 'text',
    visibleText: 'อนุญาตเลยครับ',
  }), 'อนุญาตเลยครับ');
});

test('path traversal, arbitrary shell, and unregistered scripts are rejected', () => {
  assert.equal(validateActionInput(PROJECT_WRITE_FILE, {
    slug: '../etc',
    relativePath: 'src/App.jsx',
    contents: 'x',
  }, emptyAllowlists()).ok, false);
  assert.equal(validateActionInput(PROJECT_WRITE_FILE, {
    slug: 'todo-app',
    relativePath: '../secret.txt',
    contents: 'x',
  }, emptyAllowlists()).ok, false);
  assert.equal(validateActionInput(PROJECT_RUN_SCRIPT, {
    slug: 'todo-app',
    script: 'build',
    command: 'npm exec evil',
  }, emptyAllowlists()).ok, false);
  const shell = validateActionInput(PROJECT_RUN_SCRIPT, {
    slug: 'todo-app',
    script: 'deploy',
  }, emptyAllowlists());
  assert.equal(shell.ok, false);
  if (shell.ok === false) assert.equal(shell.reasonCode, 'UNREGISTERED_SCRIPT');
  assert.throws(() => resolveWorkspaceFile({ slug: 'todo-app', relativePath: '..\\Windows\\system.ini' }));
  assert.throws(() => typedArgv({ kind: 'npm-install', workspace: 'x', extraArgs: ['-g'] }));
  assert.equal(looksLikeShellMetachar('npm exec evil'), true);
  assert.equal(isForbiddenGenericShell('shell.exec'), true);
  const catalog = compactCapabilityCatalog();
  assert.equal(catalog.some(item => item.id === 'project.createWorkspace'), true);
  assert.equal(catalog.some(item => item.id === 'shell.exec'), false);
});

test('typed npm install stays project-scoped and scripts must be registered', () => {
  const install = typedArgv({ kind: 'npm-install', workspace: '/tmp/project' });
  assert.equal(install.at(-1), 'install');
  assert.equal(install.includes('-g'), false);
  assert.equal(install.includes('exec'), false);
  assert.equal(install.some(item => item.endsWith('.cmd') || item === 'cmd.exe' || item === 'powershell'), false);
  if (process.platform === 'win32') {
    assert.equal(install[0], process.execPath);
    assert.match(install[1] || '', /npm-cli\.js$/u);
  } else {
    assert.equal(install[0], 'npm');
  }
  const run = typedArgv({ kind: 'npm-run', workspace: '/tmp/project', script: 'test' });
  const runAt = run.indexOf('run');
  assert.ok(runAt >= 0);
  assert.equal(run[runAt + 1], 'test');
  assert.throws(() => typedArgv({ kind: 'npm-run', workspace: '/tmp/project', script: 'postinstall' }));
});

test('pending permission persists, SSE snapshot replays it, and UI confirmation enters history', async () => {
  const root = tempDir('jarvis-perm-pending-');
  const memory = new SqliteJarvisMemoryStore(path.join(root, 'jarvis.db'));
  const { host, permissions } = builderHost(root, memory);
  assert.equal(isActionHost(host), true);
  if (!isActionHost(host)) return;
  try {
    const planned = await host.invoke({
      id: SOFTWARE_PLAN_BUILD,
      input: { brief: 'สร้างเว็บ todo แบบ modern ให้ผม', goalId: 'BUILD_WEBSITE' },
      sessionId: 'jarvis-lab',
    });
    assert.equal(planned.status, 'ok');
    const plan = planned.structured.plan as { id: string; slug: string; status: string };
    assert.equal(plan.status, 'READY_FOR_REVIEW');
    assert.equal(fs.existsSync(path.join(root, 'builds', plan.slug, 'package.json')), false);
    new BuildPlanStore(memory.database()).setStatus(plan.id, 'APPROVED');

    const lab = createJarvisLabRuntime({
      capabilities: host,
      memoryStore: memory,
      commandCenter: false,
      attachDefaultMemory: false,
      attachDefaultSkills: false,
      attachDefaultPresentation: false,
      attachDefaultSpeech: false,
      reminders: false,
      research: false,
      workspace: false,
      llm: { generateText: async () => 'should not invent identity or grants' },
    });
    memory.history.startTurn({
      sessionId: 'jarvis-lab',
      role: 'OWNER',
      visibleText: 'เอาตามแผนนี้',
      inputMode: 'text',
    });

    const asked = await host.invoke({
      id: SOFTWARE_APPLY_BUILD,
      input: { planId: plan.id, brief: 'todo', goalId: 'BUILD_WEBSITE' },
      sessionId: 'jarvis-lab',
    });
    assert.equal(asked.status, 'confirmation_required');
    const pending = host.pendingFrom(asked);
    assert.ok(pending?.token);
    assert.equal(permissions.list('PENDING').length, 1);
    assert.equal(permissions.latestPending('jarvis-lab')?.grantMode, 'THIS_GOAL');

    const snapshot = lab.permissionSnapshot('jarvis-lab');
    assert.ok(snapshot.pendingPermission?.token);
    assert.equal(snapshot.pendingPermission?.proposalId, pending?.proposalId);
    assert.equal(snapshot.pendingPermission?.token, pending?.token);
    const replayed = lab.permissionSnapshot('jarvis-lab');
    assert.equal(replayed.pendingPermission?.token, snapshot.pendingPermission?.token);
    assert.equal(snapshot.plan?.id, plan.id);
    assert.equal(snapshot.stage, 'PERMISSION');
    const sse = formatSseEvent({
      id: 'snapshot',
      seq: 0,
      type: 'PERMISSION_SNAPSHOT',
      at: new Date().toISOString(),
      level: 'info',
      summary: 'Pending permission restored',
      payload: snapshot as unknown as Record<string, unknown>,
      visualState: 'WAITING_PERMISSION',
    });
    assert.match(sse, /PERMISSION_SNAPSHOT/);
    assert.match(sse, /pendingPermission/);
    assert.match(sse, new RegExp(pending!.proposalId));

    const confirmed = await lab.confirmAction({
      proposalId: pending!.proposalId,
      token: snapshot.pendingPermission!.token,
      sessionId: 'jarvis-lab',
      actionSource: 'ui',
      duration: 'THIS_GOAL',
    });
    assert.equal(confirmed.pendingConfirmation, undefined);
    const turns = memory.history.listTurns('jarvis-lab');
    const ownerGrant = turns.find(item => item.role === 'OWNER' && item.visibleText.includes('[อนุญาตงานนี้]'));
    assert.ok(ownerGrant);
    assert.equal(ownerGrant?.metadata.source, 'ui_action');
    assert.equal(ownerGrant?.planId, plan.id);
    assert.equal(fs.existsSync(path.join(root, 'builds', plan.slug, 'package.json')), true);
    assert.equal(permissions.list('ACTIVE').length, 1);

    const covered = await host.invoke({
      id: PROJECT_WRITE_FILE,
      input: { slug: plan.slug, relativePath: 'src/note.txt', contents: 'same goal' },
      sessionId: 'jarvis-lab',
    });
    assert.notEqual(covered.status, 'confirmation_required');
    assert.equal(covered.status, 'ok');
  } finally {
    memory.close();
    permissions.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('text confirmation history stores the owner-expressed text', async () => {
  const root = tempDir('jarvis-perm-text-');
  const memory = new SqliteJarvisMemoryStore(path.join(root, 'jarvis.db'));
  const { host, permissions } = builderHost(root, memory);
  if (!isActionHost(host)) return;
  try {
    const planned = await host.invoke({
      id: SOFTWARE_PLAN_BUILD,
      input: { brief: 'สร้างเว็บ todo ให้ผม' },
      sessionId: 'hist-text',
    });
    const plan = planned.structured.plan as { id: string };
    new BuildPlanStore(memory.database()).setStatus(plan.id, 'APPROVED');
    const asked = await host.invoke({
      id: SOFTWARE_APPLY_BUILD,
      input: { planId: plan.id },
      sessionId: 'hist-text',
    });
    const pending = host.pendingFrom(asked)!;
    const lab = createJarvisLabRuntime({
      capabilities: host,
      memoryStore: memory,
      commandCenter: false,
      attachDefaultMemory: false,
      attachDefaultSkills: false,
      attachDefaultPresentation: false,
      attachDefaultSpeech: false,
      reminders: false,
      research: false,
      workspace: false,
      llm: { generateText: async () => 'no' },
    });
    await lab.confirmAction({
      proposalId: pending.proposalId,
      token: pending.token,
      sessionId: 'hist-text',
      actionSource: 'text',
      visibleText: 'อนุญาตเลยครับ',
      duration: 'ONCE',
    });
    const owner = memory.history.listTurns('hist-text').find(item => item.role === 'OWNER');
    assert.equal(owner?.visibleText, 'อนุญาตเลยครับ');
    assert.equal(owner?.metadata.source, 'text');
  } finally {
    memory.close();
    permissions.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('restart revalidates a granted lease; expiry and policy change do not silently restore', () => {
  const now = { t: 1_000_000 };
  const plan = createBuildPlan({ brief: 'สร้างเว็บ todo ให้ผม', goalId: 'BUILD_WEBSITE', sessionId: 's1' });
  const target = `data/jarvis/builds/${plan.slug}`;
  const base = createPendingPermissionRecord({
    proposalId: 'prop_restart',
    capabilityId: SOFTWARE_APPLY_BUILD,
    capabilityIds: [SOFTWARE_APPLY_BUILD, PROJECT_WRITE_FILE],
    displayName: 'Apply build',
    summary: 'Write the approved plan',
    target,
    argumentsHash: 'abc',
    normalizedArguments: { planId: plan.id },
    effects: BUILD_GOAL_EFFECTS,
    grantMode: 'THIS_GOAL',
    goalId: plan.goalId,
    planId: plan.id,
    expiresAt: now.t + 60_000,
    now: now.t,
  });
  const granted = applyOwnerDecision(base, {
    decision: 'granted',
    source: 'ui_action',
    now: now.t,
    lease: {
      id: 'lease_restart',
      issuedAt: new Date(now.t).toISOString(),
      expiresAt: new Date(now.t + 60_000).toISOString(),
      capabilityIds: [SOFTWARE_APPLY_BUILD, PROJECT_WRITE_FILE],
      resourceScopes: [plan.id, target],
      maxActions: 32,
      remainingActions: 31,
      reason: 'Owner granted this build goal.',
      ownerApproved: true,
      taskId: plan.goalId,
      stepId: plan.id,
    },
  });
  const ok = revalidatePermissionRecord(granted, {
    now: now.t + 1_000,
    policyRevision: PERMISSION_POLICY_REVISION,
    currentEffects: BUILD_GOAL_EFFECTS,
    plan,
    capabilityAvailable: () => true,
    targetAllowed: () => true,
  });
  assert.equal(ok.restored, true);
  assert.equal(ok.record.status, 'ACTIVE');

  const expired = revalidatePermissionRecord(granted, {
    now: now.t + 120_000,
    policyRevision: PERMISSION_POLICY_REVISION,
    currentEffects: BUILD_GOAL_EFFECTS,
    plan,
    capabilityAvailable: () => true,
    targetAllowed: () => true,
  });
  assert.equal(expired.restored, false);
  assert.equal(expired.record.status, 'EXPIRED');

  const policy = revalidatePermissionRecord(granted, {
    now: now.t + 1_000,
    policyRevision: 'policy-changed-v2',
    currentEffects: BUILD_GOAL_EFFECTS,
    plan,
    capabilityAvailable: () => true,
    targetAllowed: () => true,
  });
  assert.equal(policy.restored, false);
  assert.equal(policy.record.status, 'NEEDS_REAPPROVAL');
  assert.notEqual(
    granted.policyFingerprint,
    permissionPolicyFingerprint({
      capabilityId: granted.capabilityId,
      effects: BUILD_GOAL_EFFECTS,
      target,
      grantMode: 'THIS_GOAL',
      revision: 'policy-changed-v2',
    }),
  );
});

test('same goal continues after restart via revalidated lease, and Qwen cannot renew or expand it', async () => {
  const root = tempDir('jarvis-perm-restart-');
  const memory = new SqliteJarvisMemoryStore(path.join(root, 'jarvis.db'));
  const { host, permissions } = builderHost(root, memory);
  if (!isActionHost(host)) return;
  try {
    const planned = await host.invoke({
      id: SOFTWARE_PLAN_BUILD,
      input: { brief: 'สร้างเว็บ todo ให้ผม' },
      sessionId: 'restart-goal',
    });
    const plan = planned.structured.plan as { id: string; slug: string };
    new BuildPlanStore(memory.database()).setStatus(plan.id, 'APPROVED');
    const asked = await host.invoke({
      id: SOFTWARE_APPLY_BUILD,
      input: { planId: plan.id },
      sessionId: 'restart-goal',
    });
    const pending = host.pendingFrom(asked)!;
    await host.confirm({
      proposalId: pending.proposalId,
      token: pending.token,
      source: 'ui',
      sessionId: 'restart-goal',
      duration: 'THIS_GOAL',
    });
    const persisted = permissions.list('ACTIVE')[0];
    assert.ok(persisted?.leaseId);

    const leasesAfterRestart = new PrivilegeLeaseStore();
    const restarted = createStandaloneCapabilityHost({
      worldIntel: false,
      reminders: false,
      research: false,
      workspace: false,
      build: { db: memory.database(), sandboxRoot: path.join(root, 'builds') },
      actions: {
        allowlists: emptyAllowlists(),
        adapter: stubAdapter(),
        leases: leasesAfterRestart,
        permissions,
        events: new JarvisEventBus(),
        audit: false,
      },
    });
    assert.equal(isActionHost(restarted), true);
    if (!isActionHost(restarted)) return;
    assert.equal(leasesAfterRestart.listInventory().some(item => item.state === 'ACTIVE'), true);
    const write = await restarted.invoke({
      id: PROJECT_WRITE_FILE,
      input: { slug: plan.slug, relativePath: 'README.restart.md', contents: 'revalidated' },
      sessionId: 'restart-goal',
    });
    assert.notEqual(write.status, 'confirmation_required');
    const lease = leasesAfterRestart.list()[0]!;
    const renew = leasesAfterRestart.renew(lease.id, 'jarvis');
    assert.equal(renew.ok, false);
    if (!renew.ok) assert.equal(renew.reasonCode, 'SELF_RENEWAL_FORBIDDEN');
    const expand = leasesAfterRestart.expand(lease.id, 'model', { capabilityIds: ['shell.exec'] });
    assert.equal(expand.ok, false);
    if (!expand.ok) assert.equal(expand.reasonCode, 'SELF_EXPAND_FORBIDDEN');
  } finally {
    memory.close();
    permissions.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('build/test evidence requires an exit code, and failure proposes a bounded fix instead of blind retry', async () => {
  const root = tempDir('jarvis-perm-fail-');
  const workspace = new Workspace(root);
  const plan = createBuildPlan({ brief: 'สร้างเว็บ todo ให้ผม' });
  writeTodoWebsite(plan, workspace);
  let builds = 0;
  const runner = createFakeCommandRunner(request => {
    if (request.kind === 'npm-run' && request.script === 'test') {
      return { exitCode: 1, stderrSummary: 'assert failed' };
    }
    if (request.kind === 'npm-run' && request.script === 'build') {
      builds += 1;
      return { exitCode: 0, stdoutSummary: 'built' };
    }
    return { exitCode: 0 };
  });
  const failed = await executeApprovedBuild(plan, { workspace, runner });
  assert.equal(failed.plan.status, 'FAILED');
  assert.equal(failed.failedStage, 'TEST');
  assert.equal(failed.correction?.retryMutation, false);
  assert.equal(failed.tests?.exitCode, 1);
  assert.equal(failed.tests?.passed, false);
  assert.equal(evidencePassed(failed.tests!), false);

  const passing = createFakeCommandRunner(() => ({ exitCode: 0, stdoutSummary: 'ok' }));
  const retried = await executeApprovedBuild(plan, { workspace, runner: passing });
  assert.equal(retried.plan.status, 'COMPLETED');
  assert.equal(retried.tests?.exitCode, 0);
  assert.equal(evidencePassed(retried.tests!), true);
  assert.equal(builds >= 1, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('dev server restart recovery marks unknown process state and stays localhost-only', () => {
  const root = tempDir('jarvis-perm-dev-');
  const persistPath = path.join(root, 'dev-servers.json');
  fs.writeFileSync(persistPath, JSON.stringify([{
    url: 'http://127.0.0.1:4173',
    workspace: root,
    processRef: 'dev_owned',
    status: 'running',
    host: '127.0.0.1',
    port: 4173,
    script: 'dev',
    pid: 9_999_991,
    startedAt: Date.now(),
    commandType: 'npm-run',
  }]), 'utf8');
  const registry = new DevServerRegistry({ persistPath });
  const handle = registry.list()[0];
  assert.ok(handle);
  assert.equal(handle?.host, '127.0.0.1');
  assert.equal(handle?.url, 'http://127.0.0.1:4173');
  assert.equal(handle?.status, 'unknown');
  assert.equal(handle?.processRef, 'dev_owned');
  assert.doesNotMatch(handle?.url || '', /0\.0\.0\.0|192\.168|10\./);
  const argv = typedArgv({
    kind: 'npm-run',
    workspace: root,
    script: 'dev',
    extraArgs: ['--host', '127.0.0.1', '--port', '4173'],
  });
  assert.equal(argv.includes('127.0.0.1'), true);
  assert.equal(argv.includes('0.0.0.0'), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('install and build capabilities remain gated until a goal lease covers them', async () => {
  const root = tempDir('jarvis-perm-gate-');
  const memory = new SqliteJarvisMemoryStore(path.join(root, 'jarvis.db'));
  const { host, permissions } = builderHost(root, memory);
  try {
    const install = await host.invoke({
      id: PROJECT_INSTALL_DEPENDENCIES,
      input: { slug: 'todo-app', mode: 'install' },
      sessionId: 'gate',
    });
    assert.equal(install.status, 'confirmation_required');
    const build = await host.invoke({
      id: PROJECT_BUILD,
      input: { slug: 'todo-app' },
      sessionId: 'gate',
    });
    assert.equal(build.status, 'confirmation_required');
  } finally {
    memory.close();
    permissions.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
