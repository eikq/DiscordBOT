import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaultJarvisDbPath } from '../src/bot/memory/jarvis/migrate';
import { defaultBuildRoot } from '../src/jarvis/build/sandbox';
import { DESKTOP_OPEN_APPLICATION } from '../src/jarvis/capabilities/actions/constants';
import { isForbiddenGenericShell } from '../src/jarvis/security/constants';
import { RESEARCH_PRIVATE_BROWSE } from '../src/jarvis/research/private/constants';
import { BotService } from '../src/bot/BotService';
import { McpResearchGateway } from '../src/bot/research/McpResearchGateway';
import { VoiceServiceClient } from '../src/bot/voice/VoiceServiceClient';
import { NightOrchestrator } from '../src/agent/night/NightOrchestrator';
import { SimulatedDeviceProvider } from '../src/jarvis/devices';
import { PrivateResearchGateway } from '../src/jarvis/research/private/privateGateway';
import { WindowsDesktopActionAdapter } from '../src/jarvis/capabilities/actions/WindowsDesktopActionAdapter';
import {
  applyCommunityEditionEnv,
  assertNotOwnerJarvisRoot,
  communityCapabilityFlags,
  communityCapabilitySummaryText,
  COMMUNITY_LAB_PAGE_IDS,
  COMMUNITY_MODEL_OFFLINE_MESSAGE,
  communityRejectedDemoScenario,
  communityRejectedHttpPath,
  createEditionCapabilityHost,
  isCommunityCapabilityAllowed,
  jarvisDataRoot,
  jarvisEditionManifest,
  jarvisMemoryDbName,
  jarvisProviderPlan,
  jarvisWorkspaceLogicalPath,
  PRIVATE_PROVIDER_IDS,
  privateProviderConstructions,
  privateProviderLaunches,
  resetPrivateProviderConstructions,
  resolveJarvisEdition,
} from '../src/jarvis/edition';
import { createBuildPlan } from '../src/jarvis/build/planner';
import { buildSurfaceFromPlan } from '../src/jarvis/ui/presence/buildSurface';
import { bindDiscourseToIntent, emptyConversationState, interpretDiscourse } from '../src/jarvis/conversation';
import { interpretSemanticIntent } from '../src/jarvis/intent/semanticIntent';
import { parseJarvisPage, visibleJarvisPages } from '../src/jarvis/ui/operating/JarvisOperatingShell';
import { communityModelBadge, communityWelcomeVisible } from '../src/jarvis/ui/presence/CommunityPresenceChrome';

const TRACKED = [
  'JARVIS_EDITION',
  'JARVIS_STANDALONE',
  'JARVIS_DATA_ROOT',
  'JARVIS_RUNTIME_DIR',
  'JARVIS_COMMUNITY_PROVIDER_LOCK',
  'HOST',
  'PORT',
  'JARVIS_LLM_MODEL',
  'JARVIS_LLM_BASE_URL',
] as const;

function snapshotEnv() {
  return Object.fromEntries(TRACKED.map(key => [key, process.env[key]]));
}

function restoreEnv(prior: Record<string, string | undefined>) {
  for (const key of TRACKED) {
    if (prior[key] === undefined) delete process.env[key];
    else process.env[key] = prior[key];
  }
}

function withEnv<T>(patch: Record<string, string | undefined>, run: () => T): T {
  const prior = snapshotEnv();
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return run();
  } finally {
    restoreEnv(prior);
  }
}

test('owner remains the default edition and keeps the owner data root', () => {
  withEnv({ JARVIS_EDITION: undefined, JARVIS_DATA_ROOT: undefined }, () => {
    assert.equal(resolveJarvisEdition(), 'owner');
    assert.equal(jarvisMemoryDbName(), 'jarvis.db');
    assert.match(jarvisDataRoot(), /data[\\/]jarvis$/u);
    assert.match(defaultJarvisDbPath(), /data[\\/]jarvis[\\/]jarvis\.db$/u);
    assert.match(defaultBuildRoot(), /data[\\/]jarvis[\\/]builds$/u);
    assert.equal(jarvisWorkspaceLogicalPath('todo'), 'data/jarvis/builds/todo');
  });
});

test('community edition isolates the data root and never falls back to owner jarvis.db', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-community-'));
  withEnv({ JARVIS_EDITION: 'community', JARVIS_DATA_ROOT: root, JARVIS_RUNTIME_DIR: undefined }, () => {
    assert.equal(resolveJarvisEdition(), 'community');
    assert.equal(jarvisMemoryDbName(), 'community.db');
    assert.equal(jarvisDataRoot(), path.resolve(root));
    assert.equal(defaultJarvisDbPath(), path.join(path.resolve(root), 'community.db'));
    assert.equal(defaultBuildRoot(), path.join(path.resolve(root), 'workspaces'));
    assert.equal(jarvisWorkspaceLogicalPath('todo'), 'data/community/workspaces/todo');
    assert.equal(defaultJarvisDbPath().includes(`${path.sep}data${path.sep}jarvis`), false);
    assert.throws(() => assertNotOwnerJarvisRoot(path.join(process.cwd(), 'data', 'jarvis')));
  });
});

test('community capability manifest enables builder and excludes private subsystems', () => {
  const flags = communityCapabilityFlags();
  assert.equal(flags.conversation, true);
  assert.equal(flags.softwareBuilder, true);
  assert.equal(flags.projectWorkspace, true);
  assert.equal(flags.localhostPreview, true);
  assert.equal(flags.research, true);
  assert.equal(flags.devices, false);
  assert.equal(flags.cctv, false);
  assert.equal(flags.cybersecurity, false);
  assert.equal(flags.privateBrowser, false);
  assert.equal(flags.desktop, false);
  assert.equal(flags.worldIntel, false);
  const manifest = jarvisEditionManifest('community');
  assert.equal(manifest.dataRootKind, 'community');
  assert.equal(manifest.capabilities.cctv, false);
  assert.match(communityCapabilitySummaryText(), /conversation/i);
  assert.match(COMMUNITY_MODEL_OFFLINE_MESSAGE, /LOCAL MODEL OFFLINE/);
});

test('community capability allowlist rejects private and unrestricted routes', () => {
  assert.equal(isCommunityCapabilityAllowed('software.planBuild'), true);
  assert.equal(isCommunityCapabilityAllowed('software.applyBuild'), true);
  assert.equal(isCommunityCapabilityAllowed('research.current'), true);
  assert.equal(isCommunityCapabilityAllowed(RESEARCH_PRIVATE_BROWSE), false);
  assert.equal(isCommunityCapabilityAllowed(DESKTOP_OPEN_APPLICATION), false);
  assert.equal(isCommunityCapabilityAllowed('cctv.connect'), false);
  assert.equal(isCommunityCapabilityAllowed('devices.lan.scan'), false);
  assert.equal(isCommunityCapabilityAllowed('cyber.scan'), false);
  assert.equal(isCommunityCapabilityAllowed('world-intel.intel_news_feed'), false);
  assert.equal(isCommunityCapabilityAllowed('shell.exec'), false);
  assert.equal(isForbiddenGenericShell('shell.exec'), true);
});

test('community host does not register or execute private capabilities', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-community-host-'));
  const prior = snapshotEnv();
  process.env.JARVIS_EDITION = 'community';
  process.env.JARVIS_DATA_ROOT = root;
  process.env.JARVIS_RUNTIME_DIR = path.join(root, 'runtime');
  try {
    const host = createEditionCapabilityHost({
      worldIntel: false,
      reminders: false,
      workspace: false,
      research: false,
      build: false,
      actions: false,
    });
    const ids = host.list().map(item => item.id);
    assert.equal(ids.some(id => id.startsWith('desktop.')), false);
    assert.equal(ids.some(id => id.startsWith('cctv.')), false);
    assert.equal(ids.some(id => id.startsWith('world-intel.')), false);
    assert.equal(ids.includes(RESEARCH_PRIVATE_BROWSE), false);
    assert.equal(host.lookup(DESKTOP_OPEN_APPLICATION), undefined);
    const denied = await host.invoke({ id: RESEARCH_PRIVATE_BROWSE, input: {} });
    assert.equal(denied.status, 'rejected');
    assert.equal(denied.error, 'COMMUNITY_EXCLUDED');
    const shell = await host.invoke({ id: 'shell.exec', input: { command: 'whoami' } });
    assert.equal(shell.status, 'rejected');
  } finally {
    restoreEnv(prior);
  }
});

test('community lab page filter hides owner-only modules', () => {
  const pages = visibleJarvisPages('community').map(page => page.id);
  assert.deepEqual(pages, [...COMMUNITY_LAB_PAGE_IDS]);
  assert.equal((pages as string[]).includes('devices'), false);
  assert.equal((pages as string[]).includes('evolution'), false);
  assert.equal(parseJarvisPage('/jarvis-lab/devices', 'community'), 'home');
  assert.equal(parseJarvisPage('/jarvis-lab/tasks', 'community'), 'tasks');
  assert.equal(parseJarvisPage('/jarvis-lab/devices'), 'devices');
});

test('community presence copy stays model-agnostic and offline-honest', () => {
  assert.equal(communityModelBadge('MODEL_READY'), 'MODEL READY');
  assert.equal(communityModelBadge('MODEL_OFFLINE'), 'LOCAL MODEL OFFLINE');
  assert.equal(communityWelcomeVisible({
    edition: 'community',
    ambient: false,
    hasAnswer: false,
    busy: false,
    taskActive: false,
    waitingPermission: false,
  }), true);
  assert.equal(communityWelcomeVisible({
    edition: 'owner',
    ambient: false,
    hasAnswer: false,
    busy: false,
    taskActive: false,
    waitingPermission: false,
  }), false);
});

test('applyCommunityEditionEnv forces loopback and refuses the owner data root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-community-env-'));
  const prior = snapshotEnv();
  try {
    const env: NodeJS.ProcessEnv = {
      JARVIS_DATA_ROOT: root,
      HOST: '0.0.0.0',
    };
    applyCommunityEditionEnv(env, process.cwd());
    assert.equal(env.JARVIS_EDITION, 'community');
    assert.equal(env.JARVIS_STANDALONE, '1');
    assert.equal(env.HOST, '127.0.0.1');
    assert.equal(env.JARVIS_COMMUNITY_PROVIDER_LOCK, '1');
    assert.ok(fs.existsSync(path.join(root, 'workspaces')));
    assert.throws(() => applyCommunityEditionEnv({
      JARVIS_DATA_ROOT: path.join(process.cwd(), 'data', 'jarvis'),
    }, process.cwd()));
  } finally {
    restoreEnv(prior);
  }
});

test('community HTTP routes reject private browser and night agent', () => {
  assert.equal(communityRejectedHttpPath('/api/jarvis/private-research'), true);
  assert.equal(communityRejectedHttpPath('/api/jarvis/command-center/night'), true);
  assert.equal(communityRejectedHttpPath('/api/jarvis/night'), true);
  assert.equal(communityRejectedHttpPath('/api/intelligence/status'), true);
  assert.equal(communityRejectedHttpPath('/api/bot/start'), true);
  assert.equal(communityRejectedHttpPath('/api/control'), true);
  assert.equal(communityRejectedHttpPath('/api/voice-export'), true);
  assert.equal(communityRejectedHttpPath('/api/tts/test'), true);
  assert.equal(communityRejectedHttpPath('/api/colab/notebook'), true);
  assert.equal(communityRejectedHttpPath('/api/jarvis/status'), false);
  assert.equal(communityRejectedHttpPath('/api/jarvis/ask'), false);
  assert.equal(communityRejectedHttpPath('/api/jarvis/research'), false);
  assert.equal(communityRejectedDemoScenario('monitoring'), true);
  assert.equal(communityRejectedDemoScenario('research'), false);
});

test('community provider plan never constructs or launches private providers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-community-providers-'));
  withEnv({
    JARVIS_EDITION: 'community',
    JARVIS_DATA_ROOT: root,
    JARVIS_RUNTIME_DIR: path.join(root, 'runtime'),
    JARVIS_COMMUNITY_PROVIDER_LOCK: undefined,
  }, () => {
    applyCommunityEditionEnv();
    resetPrivateProviderConstructions();
    const plan = jarvisProviderPlan('community');
    assert.equal(plan.publicResearch, true);
    for (const id of PRIVATE_PROVIDER_IDS) {
      assert.equal(plan[id], false, id);
    }
    const host = createEditionCapabilityHost({
      actions: { displayAliases: () => [] },
    });
    const ids = host.list().map(item => item.id);
    assert.equal(ids.some(id => id.startsWith('world-intel.')), false);
    assert.equal(ids.some(id => id.startsWith('desktop.')), false);
    assert.equal(ids.some(id => id.startsWith('cctv.')), false);
    assert.equal(ids.includes(RESEARCH_PRIVATE_BROWSE), false);
    assert.deepEqual([...privateProviderConstructions()], []);
    assert.deepEqual([...privateProviderLaunches()], []);
    assert.throws(() => new McpResearchGateway(), /worldIntel/);
    assert.throws(() => new PrivateResearchGateway(), /privateBrowser/);
    assert.throws(() => new BotService(), /discord/);
    assert.throws(() => new VoiceServiceClient(), /voiceClone/);
    assert.throws(() => new SimulatedDeviceProvider(), /devices|cctv/);
    assert.throws(() => new WindowsDesktopActionAdapter({
      applications: [],
      projects: [],
      trustedOrigins: [],
      trustedPathPrefixes: [],
      workspaceRoot: root,
    }), /desktop/);
    assert.throws(() => new NightOrchestrator({} as never), /nightAgent/);
    assert.deepEqual([...privateProviderConstructions()], []);
    assert.deepEqual([...privateProviderLaunches()], []);
  });
});

test('community demo history and memory phrases bind without a model', () => {
  const phrase = 'เมื่อกี้เราทำอะไรไปบ้าง';
  const state = {
    ...emptyConversationState('jarvis-lab', 1),
    lastOwnerIntent: 'สร้างเว็บ todo แบบ modern ให้ผม',
    recentOperation: { kind: 'write' as const, ok: true, summary: 'scaffolded todo site', at: 8, slug: 'todo-modern' },
    remembered: ['ชอบ UI แบบ clean futuristic'],
  };
  const discourse = interpretDiscourse(phrase, state);
  assert.equal(discourse.act, 'STATUS_QUERY');
  assert.equal(discourse.statusFocus, 'recent');
  const recap = bindDiscourseToIntent(discourse, state, phrase);
  assert.equal(recap?.kind, 'CONVERSATION');
  assert.match(String(recap?.userMessage || ''), /todo|scaffolded|ล่าสุด/i);

  const recall = 'ผมชอบ UI แบบไหน';
  assert.equal(interpretDiscourse(recall, state).act, 'MEMORY_QUERY');
  const memory = bindDiscourseToIntent(interpretDiscourse(recall, state), state, recall);
  assert.match(String(memory?.userMessage || ''), /clean futuristic/i);
  assert.equal(interpretSemanticIntent(recall).action, 'ASK_MEMORY');
});

test('community build plans advertise the community workspace, not owner builds', () => {
  withEnv({ JARVIS_EDITION: 'community' }, () => {
    const plan = createBuildPlan({ brief: 'สร้างเว็บ todo แบบ modern ให้ผม' });
    assert.equal(plan.slug, 'todo-modern');
    assert.match(plan.assumptions.join('\n'), /data\/community\/workspaces\/<slug>/);
    assert.doesNotMatch(plan.assumptions.join('\n'), /data\/jarvis\/builds/);
    assert.match(plan.acceptanceCriteria.join('\n'), /data\/community\/workspaces/);
    assert.doesNotMatch(plan.acceptanceCriteria.join('\n'), /data\/jarvis\/builds/);
  });
  const communitySurface = buildSurfaceFromPlan({
    title: 'Todo App',
    slug: 'todo-modern',
    status: 'READY_FOR_REVIEW',
    summary: 'Plan is not execution permission.',
  }, 'community');
  assert.equal(communitySurface?.artifact, 'data/community/workspaces/todo-modern');
  const ownerSurface = buildSurfaceFromPlan({
    title: 'Todo App',
    slug: 'todo-modern',
    status: 'READY_FOR_REVIEW',
    summary: 'Plan is not execution permission.',
  }, 'owner');
  assert.equal(ownerSurface?.artifact, 'data/jarvis/builds/todo-modern');
});

test('community documentation and launcher artifacts exist', () => {
  for (const file of [
    'COMMUNITY_EDITION.md',
    '.env.community.example',
    'docs/COMMUNITY_DEMO_SCRIPT.md',
    'docs/COMMUNITY_ARCHITECTURE.md',
    'docs/COMMUNITY_SUBMISSION_CHECKLIST.md',
    'Start-Jarvis-Community.ps1',
    'scripts/start_jarvis_community.ts',
  ]) {
    assert.equal(fs.existsSync(path.join(process.cwd(), file)), true, file);
  }
  const envExample = fs.readFileSync(path.join(process.cwd(), '.env.community.example'), 'utf8');
  assert.match(envExample, /JARVIS_EDITION=community/);
  assert.match(envExample, /JARVIS_LLM_BASE_URL/);
  assert.doesNotMatch(envExample, /DISCORD_TOKEN=/);
  assert.doesNotMatch(envExample, /qwen38-cyber/);
});
