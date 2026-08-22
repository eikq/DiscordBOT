import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LocalLlmProvider } from '../src/bot/llm/LocalLlmProvider';
import { CANONICAL_LLM_BASE_URL, CANONICAL_LLM_MODEL } from '../src/bot/llm/canonicalRuntime';
import { openaiCompatibleHeaders } from '../src/bot/llm/openaiCompatibleAuth';
import { parseOpenAiToolCalls, visibleModelText } from '../src/bot/llm/visibleModelText';
import { SqliteJarvisMemoryStore } from '../src/bot/memory/jarvis/SqliteJarvisMemoryStore';
import { openMigratedDatabase } from '../src/bot/memory/jarvis/migrate';
import {
  ActionAuditLog,
  ConfirmationStore,
  JarvisEventBus,
  PermissionPolicy,
  PrivilegeLeaseStore,
  SOFTWARE_APPLY_BUILD,
  SOFTWARE_PLAN_BUILD,
  createBuildPlan,
  createDefaultGoalCatalog,
  createStandaloneCapabilityHost,
  inferProjectType,
  isActionHost,
  isBuildSoftwareIntent,
  isBuildWebsiteIntent,
  isForbiddenGenericShell,
  isPlanApprovalUtterance,
  permissionFirstFromCapability,
  permissionProposalFromBuild,
  qwen38CyberProfile,
  resolveOwnerGoal,
  sandboxExists,
  spokenPlanSummary,
  validateActionInput,
} from '../src/jarvis';
import { inferCapabilityFromObjective } from '../src/jarvis/agent/capabilityResolve';
import { BuildPlanStore } from '../src/jarvis/build/planStore';
import { registerSoftwareCapabilities } from '../src/jarvis/build/capabilities';
import { CapabilityRegistry } from '../src/jarvis/capabilities/CapabilityRegistry';
import type { DesktopActionAdapter } from '../src/jarvis/capabilities/actions/DesktopActionAdapter';
import type { DesktopAllowlists } from '../src/jarvis/capabilities/actions/types';
import { buildJarvisContext, CONTEXT_DYNAMIC_BUDGET_TOKENS } from '../src/jarvis/memory/contextBuilder';
import { extractDurableOwnerMemory } from '../src/jarvis/memory/durableExtract';
import { defaultObsidianVaultPath, projectObsidianVault } from '../src/jarvis/memory/obsidianProjection';
import { rememberOwnerPreference } from '../src/jarvis/memory/ownerSemantics';
import { JarvisMemoryRetrieval } from '../src/jarvis/memory/retrieval';
import { buildSurfaceFromEvents, hidesReasoning, historyItemsFromTurns } from '../src/jarvis/ui/presence/buildSurface';

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

test('qwen38-cyber is the canonical Jarvis profile', () => {
  const profile = qwen38CyberProfile();
  assert.equal(profile.id, CANONICAL_LLM_MODEL);
  assert.equal(profile.id, 'qwen38-cyber');
  assert.equal(profile.runtime, 'openai-compatible');
  assert.equal(profile.contextLimits?.inputTokens, 32_768);
  assert.equal(profile.contextLimits?.outputTokens, 4_096);
  assert.equal(CANONICAL_LLM_BASE_URL, 'http://127.0.0.1:8086/v1');
  assert.ok(profile.specialization?.includes('coding'));
  assert.doesNotMatch(JSON.stringify(profile), /\.gguf/i);
});

test('OpenAI-compatible requests authenticate /models and chat without exposing reasoning_content', async () => {
  const previous = process.env.LOCAL_QWEN_API_KEY;
  process.env.LOCAL_QWEN_API_KEY = 'test-local-qwen-key';
  const headers = openaiCompatibleHeaders();
  assert.equal(headers.Authorization, 'Bearer test-local-qwen-key');
  const seen: Array<{ url: string; auth: string | null; body?: string }> = [];
  let chatRound = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({
      url,
      auth: new Headers(init?.headers).get('authorization'),
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    if (url.endsWith('/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'qwen38-cyber' }] }), { status: 200 });
    }
    if (url.endsWith('/chat/completions')) {
      chatRound += 1;
      if (chatRound === 1) {
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: '<think>hidden</think>Visible owner answer',
              reasoning_content: 'do not persist this',
            },
          }],
        }), { status: 200 });
      }
      if (chatRound === 2) {
        return new Response(JSON.stringify({
          choices: [{
            message: {
              tool_calls: [{ id: 'call_1', function: { name: 'lookup', arguments: '{"q":"x"}' } }],
            },
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'after tool' } }],
      }), { status: 200 });
    }
    return new Response('missing', { status: 404 });
  }) as typeof fetch;
  try {
    const provider = new LocalLlmProvider('http://127.0.0.1:8086/v1', 'qwen38-cyber');
    const health = await provider.getRuntimeStatus();
    assert.equal(health.health, 'MODEL_READY');
    assert.equal(seen[0]?.auth, 'Bearer test-local-qwen-key');
    const generated = await provider.generateTextDetailed({ userPrompt: 'hello' });
    assert.equal(generated.text, 'Visible owner answer');
    assert.equal(generated.health, 'MODEL_READY');
    assert.doesNotMatch(generated.text || '', /reasoning_content|hidden/u);
    const tools = await provider.generateWithTools({
      userPrompt: 'use a tool',
      tools: [{
        type: 'function',
        function: {
          name: 'lookup',
          description: 'lookup',
          parameters: { type: 'object', properties: {} },
        },
      }],
      executeTool: async () => ({ content: 'tool-ok' }),
    });
    assert.equal(tools.calls[0]?.name, 'lookup');
    const authFailed = await (async () => {
      globalThis.fetch = (async () => new Response('nope', { status: 401 })) as typeof fetch;
      return new LocalLlmProvider('http://127.0.0.1:8086/v1', 'qwen38-cyber').getRuntimeStatus();
    })();
    assert.equal(authFailed.health, 'AUTH_FAILED');
    const missing = await (async () => {
      globalThis.fetch = (async () => new Response(JSON.stringify({ data: [{ id: 'other' }] }), { status: 200 })) as typeof fetch;
      return new LocalLlmProvider('http://127.0.0.1:8086/v1', 'qwen38-cyber').getRuntimeStatus();
    })();
    assert.equal(missing.health, 'MODEL_NOT_FOUND');
    const offline = await (async () => {
      globalThis.fetch = (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
      return new LocalLlmProvider('http://127.0.0.1:8086/v1', 'qwen38-cyber').getRuntimeStatus();
    })();
    assert.equal(offline.health, 'MODEL_UNREACHABLE');
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.LOCAL_QWEN_API_KEY;
    else process.env.LOCAL_QWEN_API_KEY = previous;
    (LocalLlmProvider as unknown as { offlineUntil: number }).offlineUntil = 0;
  }
  assert.equal(visibleModelText('<think>secret</think>ok', 'chain'), 'ok');
  assert.equal(parseOpenAiToolCalls([{ function: { name: 'lookup', arguments: '{"q":"x"}' } }])[0]?.name, 'lookup');
});

test('conversation history persists OWNER/JARVIS turns, crash incompletes, search, and redaction', () => {
  const root = tempDir('jarvis-history-');
  const dbPath = path.join(root, 'jarvis.db');
  let store = new SqliteJarvisMemoryStore(dbPath);
  try {
    const history = store.history;
    history.startTurn({ sessionId: 's1', role: 'OWNER', visibleText: 'hello LOCAL_QWEN_API_KEY=sk-secret', inputMode: 'text' });
    const owner = history.listTurns('s1')[0]!;
    history.completeTurn(owner.id, owner.visibleText);
    const jarvis = history.startTurn({ sessionId: 's1', role: 'JARVIS', visibleText: '', inputMode: 'system-derived' });
    history.completeTurn(jarvis.id, 'ได้ครับ');
    history.startTurn({ sessionId: 's1', role: 'JARVIS', visibleText: '', inputMode: 'system-derived' });
    assert.match(history.searchVisible('hello')[0]?.visibleText || '', /hello/);
    assert.doesNotMatch(history.listTurns('s1')[0]!.visibleText, /sk-secret/);
  } finally {
    store.close();
  }
  store = new SqliteJarvisMemoryStore(dbPath);
  try {
    const turns = store.history.listTurns('s1');
    assert.equal(turns.filter(item => item.role === 'OWNER' && item.status === 'completed').length, 1);
    assert.equal(turns.filter(item => item.role === 'JARVIS' && item.status === 'completed').length, 1);
    assert.equal(turns.some(item => item.status === 'incomplete'), true);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('durable owner memory supersedes, rejects untrusted web writes, and rebuilds Obsidian from SQLite', () => {
  const root = tempDir('jarvis-memory-');
  const dbPath = path.join(root, 'jarvis.db');
  const vault = path.join(root, 'obsidian');
  const store = new SqliteJarvisMemoryStore(dbPath);
  try {
    extractDurableOwnerMemory(store, 'จำไว้ว่าผมชอบให้ตอบสั้นและตรง');
    const first = rememberOwnerPreference(store, { key: 'reply.style', value: 'short', actor: 'owner' });
    const second = rememberOwnerPreference(store, { key: 'reply.style', value: 'shorter', actor: 'owner' });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (second.ok) assert.ok(second.superseded);
    const web = rememberOwnerPreference(store, { key: 'reply.style', value: 'from the web', actor: 'webpage' });
    assert.equal(web.ok, false);
    if (web.ok === false) assert.equal(web.reasonCode, 'UNTRUSTED_MEMORY_WRITE');
    const retrieval = new JarvisMemoryRetrieval(store);
    const found = retrieval.retrieveForTurn({ text: 'ผมชอบให้ตอบแบบไหน', limit: 8 });
    assert.ok(found.items.some(item => /shorter|ตอบสั้น/u.test(item.text)));
    assert.equal(found.items.some(item => item.text.includes('from the web')), false);
    const history = store.history;
    history.startTurn({ sessionId: 'mem', role: 'OWNER', visibleText: 'จำไว้ว่าผมชอบให้ตอบสั้นและตรง', inputMode: 'text' });
    const owner = history.listTurns('mem')[0]!;
    history.completeTurn(owner.id, owner.visibleText);
    projectObsidianVault({
      store,
      vaultPath: vault,
      sessions: history.listSessions(),
      turnsBySession: { mem: history.listTurns('mem') },
      plans: [],
    });
    const home = fs.readFileSync(path.join(vault, 'Home.md'), 'utf8');
    const ownerNote = fs.readFileSync(path.join(vault, 'Memory', 'Owner.md'), 'utf8');
    assert.match(home, /Recent conversations/);
    assert.match(ownerNote, /shorter|ตอบสั้น/);
    fs.rmSync(vault, { recursive: true, force: true });
    projectObsidianVault({
      store,
      vaultPath: vault,
      sessions: history.listSessions(),
      turnsBySession: { mem: history.listTurns('mem') },
    });
    assert.equal(fs.existsSync(path.join(vault, 'Home.md')), true);
    assert.equal(defaultObsidianVaultPath().includes(path.join('data', 'jarvis', 'obsidian')), true);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ContextBuilder stays inside the 19k dynamic budget and drops stale memory', () => {
  const built = buildJarvisContext({
    ownerRequest: 'สร้างเว็บ portfolio',
    recentTurns: [
      { id: '1', sessionId: 's', timestamp: 1, role: 'OWNER', visibleText: 'hi', inputMode: 'text', status: 'completed', memoryRefs: [], operationRefs: [], metadata: {} },
      { id: '2', sessionId: 's', timestamp: 2, role: 'JARVIS', visibleText: 'ได้ครับ', inputMode: 'text', status: 'completed', memoryRefs: [], operationRefs: [], metadata: {} },
    ],
    activeGoal: { id: 'BUILD_WEBSITE' },
    memories: [
      { canonicalId: 'a', type: 'fact', status: 'active', text: 'Owner likes short answers', factKey: 'owner.pref.reply_style', confidence: 0.9, sourceRefs: [] },
      { canonicalId: 'b', type: 'fact', status: 'superseded', text: 'stale irrelevant memory about weather', confidence: 0.1, sourceRefs: [] },
    ],
    pendingPermission: permissionProposalFromBuild({ title: 'Portfolio', slug: 'portfolio', capabilityId: SOFTWARE_APPLY_BUILD }),
    plan: createBuildPlan({ brief: 'Jarvis สร้างเว็บ portfolio ให้ผม' }),
  });
  assert.ok(built.tokenEstimate <= CONTEXT_DYNAMIC_BUDGET_TOKENS);
  assert.ok(built.included.includes('turns'));
  assert.ok(built.included.includes('goal'));
  assert.ok(built.included.includes('plan'));
  assert.ok(built.included.includes('permission'));
  assert.match(built.promptBlock, /short answers/);
  assert.doesNotMatch(built.promptBlock, /stale irrelevant memory/);
});

test('permission-first outcomes, bounded leases, owner denial, and no self-grant', async () => {
  assert.equal(permissionFirstFromCapability({ status: 'ok' }).outcome, 'EXECUTE');
  assert.equal(permissionFirstFromCapability({ confirmationRequired: true }).outcome, 'ASK_PERMISSION');
  assert.doesNotMatch(permissionFirstFromCapability({ confirmationRequired: true }).userMessage, /I cannot do that/i);
  assert.equal(permissionFirstFromCapability({ missingInput: true }).outcome, 'NEED_INPUT');
  assert.equal(permissionFirstFromCapability({ unavailable: true }).outcome, 'NEED_CAPABILITY');
  assert.equal(permissionFirstFromCapability({ ownerDenied: true }).outcome, 'REFUSE');
  assert.equal(permissionFirstFromCapability({ hardSafety: true }).outcome, 'REFUSE');
  assert.equal(isForbiddenGenericShell('shell.exec'), true);

  const leases = new PrivilegeLeaseStore();
  const self = leases.issue({
    capabilityIds: [SOFTWARE_APPLY_BUILD],
    resourceScopes: ['plan_1'],
    reason: 'model asked',
    ownerApproved: true,
  }, 'model');
  assert.equal(self.ok, false);

  const root = tempDir('jarvis-perm-');
  const db = openMigratedDatabase(path.join(root, 'j.sqlite'));
  const sandboxRoot = path.join(root, 'builds');
  const host = createStandaloneCapabilityHost({
    worldIntel: false,
    reminders: false,
    research: false,
    workspace: false,
    build: { db, sandboxRoot },
    actions: {
      allowlists: emptyAllowlists(),
      adapter: stubAdapter(),
      policy: new PermissionPolicy(),
      confirmations: new ConfirmationStore(),
      audit: new ActionAuditLog(path.join(root, 'audit.jsonl')),
      leases,
      events: new JarvisEventBus(),
    },
  });
  try {
    const planned = await host.invoke({
      id: SOFTWARE_PLAN_BUILD,
      input: { brief: 'Jarvis สร้างเว็บ portfolio ให้ผม' },
      sessionId: 'jarvis-lab',
      source: 'text',
    });
    assert.equal(planned.status, 'ok');
    const plan = planned.structured.plan as { id: string; slug: string };
    assert.equal(sandboxExists({ slug: plan.slug }, sandboxRoot), false);
    new BuildPlanStore(db).setStatus(plan.id, 'APPROVED');
    const waiting = await host.invoke({
      id: SOFTWARE_APPLY_BUILD,
      input: { planId: plan.id, brief: 'portfolio' },
      sessionId: 'jarvis-lab',
      source: 'text',
    });
    assert.equal(waiting.status, 'confirmation_required');
    assert.ok(waiting.structured.permissionProposal);
    const denied = isActionHost(host)
      ? await host.denyProposal(String(waiting.structured.proposalId))
      : waiting;
    assert.equal(denied.status, 'rejected');
    assert.equal(denied.structured.status, 'denied');
    const waitingAgain = await host.invoke({
      id: SOFTWARE_APPLY_BUILD,
      input: { planId: plan.id, brief: 'portfolio' },
      sessionId: 'jarvis-lab',
      source: 'text',
    });
    assert.equal(waitingAgain.status, 'confirmation_required');
    const granted = isActionHost(host)
      ? await host.confirm({
        proposalId: String(waitingAgain.structured.proposalId),
        token: String(waitingAgain.structured.confirmToken),
        duration: 'THIS_GOAL',
      })
      : waitingAgain;
    assert.equal(granted.status, 'ok');
    assert.equal(sandboxExists({ slug: plan.slug }, sandboxRoot), true);
    const leased = await host.invoke({
      id: SOFTWARE_APPLY_BUILD,
      input: { planId: plan.id, brief: 'portfolio' },
      sessionId: 'jarvis-lab',
      source: 'text',
    });
    assert.equal(leased.status, 'ok');
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('natural Thai/English build requests plan first and keep the same goal after approval', async () => {
  assert.equal(isBuildWebsiteIntent('Jarvis สร้างเว็บ portfolio แบบ modern ให้ผม'), true);
  assert.equal(isBuildSoftwareIntent('Build a todo app'), true);
  assert.equal(isBuildWebsiteIntent('ทำเว็บขายรองเท้าให้หน่อย'), true);
  assert.equal(inferProjectType('mixed Thai-English portfolio website สร้างเว็บ'), 'WEBSITE');
  assert.equal(isPlanApprovalUtterance('เอาตามแผนนี้'), true);

  const catalog = createDefaultGoalCatalog();
  assert.ok(catalog.get('BUILD_WEBSITE'));
  assert.ok(catalog.get('BUILD_SOFTWARE'));

  const root = tempDir('jarvis-build-');
  const db = openMigratedDatabase(path.join(root, 'j.sqlite'));
  const sandboxRoot = path.join(root, 'builds');
  const registry = new CapabilityRegistry();
  const plans = new BuildPlanStore(db);
  registerSoftwareCapabilities(registry, { plans, sandboxRoot });
  const host = createStandaloneCapabilityHost({
    worldIntel: false,
    reminders: false,
    research: false,
    workspace: false,
    build: { db, sandboxRoot },
    actions: false,
  });
  try {
    const website = await resolveOwnerGoal('Jarvis สร้างเว็บ portfolio แบบ modern ให้ผม', { host });
    assert.equal(website.goalId, 'BUILD_WEBSITE');
    assert.equal(website.status, 'RESOLVED');
    assert.equal(website.selectedRouteId, 'plan-website');
    const software = await resolveOwnerGoal('Build a todo app', { host });
    assert.equal(software.goalId, 'BUILD_SOFTWARE');
    assert.equal(inferCapabilityFromObjective('สร้างเว็บ portfolio', host), SOFTWARE_PLAN_BUILD);
    const planned = await host.invoke({
      id: SOFTWARE_PLAN_BUILD,
      input: { brief: 'Jarvis สร้างเว็บ portfolio ให้ผม', goalId: website.goalId },
      sessionId: 'jarvis-lab',
    });
    assert.equal(planned.status, 'ok');
    assert.match(planned.content, /ยังไม่สร้างไฟล์/);
    const plan = planned.structured.plan as { id: string; slug: string; goalId: string; status: string };
    assert.equal(plan.status, 'READY_FOR_REVIEW');
    assert.equal(sandboxExists({ slug: plan.slug }, sandboxRoot), false);
    const softwareOk = validateActionInput(SOFTWARE_PLAN_BUILD, { brief: 'todo' }, emptyAllowlists());
    assert.equal(softwareOk.ok, true);
    const blockedPath = validateActionInput(SOFTWARE_APPLY_BUILD, { path: 'C:\\Windows' }, emptyAllowlists());
    assert.equal(blockedPath.ok, false);
    plans.setStatus(plan.id, 'APPROVED');
    const apply = await registry.invoke({
      id: SOFTWARE_APPLY_BUILD,
      input: { planId: plan.id, brief: 'portfolio', goalId: plan.goalId },
    });
    assert.equal(apply.status, 'ok');
    assert.equal(plan.goalId, website.goalId);
    assert.match(spokenPlanSummary(createBuildPlan({ brief: 'สร้างเว็บ portfolio' })), /วางแผน/);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Presence plan/history surfaces render operational evidence without fake progress or CoT', () => {
  const surface = buildSurfaceFromEvents([
    { type: 'PLAN_CREATED', summary: 'reading requirements', payload: { title: 'Shoe Store', slug: 'shoe-store' } },
    { type: 'PLAN_APPROVED', summary: 'plan approved', payload: { title: 'Shoe Store' } },
    { type: 'PERMISSION_REQUESTED', summary: 'waiting permission', payload: { title: 'Shoe Store' } },
    { type: 'PLAN_STAGE_STARTED', summary: 'project structure prepared', payload: { title: 'Shoe Store', slug: 'shoe-store' } },
  ]);
  assert.ok(surface);
  assert.equal(surface?.title, 'Shoe Store');
  assert.equal(surface?.nodes.find(item => item.id === 'BUILD')?.state, 'active');
  assert.equal(JSON.stringify(surface).includes('%'), false);
  assert.equal(hidesReasoning('Visible answer'), true);
  assert.equal(hidesReasoning('<think>nope</think>'), false);
  const items = historyItemsFromTurns([
    { id: '1', role: 'OWNER', visibleText: 'สร้างเว็บ', timestamp: 1, status: 'completed' },
    { id: '2', role: 'JARVIS', visibleText: '<think>hidden</think>', timestamp: 2, status: 'completed' },
  ]);
  assert.equal(items.length, 1);
  const approval = fs.readFileSync(path.join(process.cwd(), 'src', 'jarvis', 'ui', 'presence', 'PresenceApproval.tsx'), 'utf8');
  assert.match(approval, /อนุญาตงานนี้/);
  assert.match(approval, /ครั้งเดียว/);
  assert.match(approval, /Allow once/);
  assert.match(approval, /รายละเอียด/);
  const page = fs.readFileSync(path.join(process.cwd(), 'src', 'jarvis', 'ui', 'presence', 'JarvisPresencePage.tsx'), 'utf8');
  assert.match(page, /PresenceBuildPlan/);
  assert.match(page, /PresenceHistory/);
  assert.match(page, /QWEN OFFLINE/);
});
