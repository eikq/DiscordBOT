import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { composePresenceHud, permissionSupersedesResearch } from '../src/jarvis/ui/presence/cinematic/hudComposition';
import { presenceCoreMotion } from '../src/jarvis/ui/presence/cinematic/coreMotion';
import { pcmAmplitude } from '../src/jarvis/ui/presence/cinematic/pcmAmplitude';
import { composePresenceVisual, researchActiveFromRuntime } from '../src/jarvis/ui/presence/cinematic/presenceVisualModel';
import { presenceQualityBudget } from '../src/jarvis/ui/presence/cinematic/presenceQuality';
import { researchStageFromEvent } from '../src/jarvis/ui/presence/cinematic/researchEvents';
import {
  boundVisibleNodes,
  classifyResearchSource,
  honestProgressPercent,
  honestTaskProgress,
  presentResearch,
} from '../src/jarvis/ui/presence/cinematic/researchPresentation';
import { fixtureMustNotLeak, parsePresenceVisualScene, presenceVisualFixture } from '../src/jarvis/ui/presence/cinematic/visualFixtures';
import { derivePresenceHud } from '../src/jarvis/ui/presence/presenceRuntime';
import type { LabResearchSnapshot } from '../src/jarvis/ui/labViewModels';

function snapshot(overrides: Partial<NonNullable<LabResearchSnapshot['last']>> = {}): LabResearchSnapshot {
  return {
    attached: true,
    healthy: true,
    last: {
      query: 'Qwen',
      sources: [
        { sourceId: 'a', url: 'https://qwenlm.github.io', canonicalUrl: 'https://qwenlm.github.io', domain: 'qwenlm.github.io', title: 'Docs', publishedAt: null, fetchedAt: 't', sourceClass: 'OFFICIAL', status: 'fetched', cached: false },
        { sourceId: 'b', url: 'https://reddit.com/r/x', canonicalUrl: 'https://reddit.com/r/x', domain: 'reddit.com', title: 'Thread', publishedAt: null, fetchedAt: 't', sourceClass: 'COMMUNITY', status: 'fetched', cached: false },
      ],
      evidence: [
        { evidenceId: 'e1', sourceId: 'a', excerpt: 'Official note', publishedAt: null, fetchedAt: null, kind: 'SOURCE_SUPPORTED' },
        { evidenceId: 'e2', sourceId: 'b', excerpt: 'Forum restatement', publishedAt: null, fetchedAt: null, kind: 'UNCERTAIN' },
      ],
      stages: [
        { id: 'search', label: 'Search', detail: '', state: 'done' },
        { id: 'fetch', label: 'Fetch', detail: '', state: 'done' },
        { id: 'compare', label: 'Compare', detail: '', state: 'done' },
        { id: 'synthesis', label: 'Synthesis', detail: '', state: 'done' },
      ],
      researchedAt: 't',
      cached: false,
      uncertainty: [],
      ...overrides,
    },
  };
}

test('idle Presence keeps leftover research off the HUD', () => {
  const hud = derivePresenceHud({ phase: 'IDLE', researchSources: 8, researchActive: false });
  assert.equal(hud, 'none');
  const visual = composePresenceVisual({
    phase: 'IDLE',
    hudKind: 'none',
    research: snapshot(),
    researchLive: false,
  });
  assert.equal(visual.quietIdle, true);
  assert.equal(visual.research, null);
});

test('research events create a live research HUD from real source state', () => {
  assert.equal(researchStageFromEvent({ type: 'SEARCH' }), 'RESEARCH_STARTED');
  assert.equal(researchStageFromEvent({ type: 'SOURCE', payload: { status: 'listed' } }), 'SOURCE_DISCOVERED');
  assert.equal(researchStageFromEvent({ type: 'EVIDENCE' }), 'EVIDENCE_UPDATED');
  const visual = composePresenceVisual({
    phase: 'RESEARCHING',
    hudKind: 'research',
    research: snapshot(),
    researchLive: true,
    researchStage: 'EVIDENCE_UPDATED',
  });
  assert.equal(visual.hud?.kind, 'research');
  assert.equal(visual.research?.counts.sources, 2);
  assert.equal(visual.research?.counts.verified, 1);
  assert.equal(visual.research?.nodes.find(node => node.id === 'b')?.trust, 'untrusted');
});

test('untrusted sources stay labelled and are never auto-verified', () => {
  const community = classifyResearchSource({
    sourceId: 'c',
    status: 'fetched',
    sourceClass: 'COMMUNITY',
    fetchedAt: 't',
    domain: 'reddit.com',
    title: 'Thread',
  }, [{ sourceId: 'c', kind: 'UNCERTAIN', excerpt: 'hearsay' }]);
  assert.equal(community.trust, 'untrusted');
  assert.equal(community.visual, 'UNTRUSTED');
  const merePresence = classifyResearchSource({
    sourceId: 'd',
    status: 'listed',
    sourceClass: 'UNKNOWN',
    fetchedAt: null,
    domain: 'x.test',
    title: 'Maybe',
  });
  assert.notEqual(merePresence.visual, 'VERIFIED');
  assert.notEqual(merePresence.trust, 'verified');
});

test('research completion calms the live presentation', () => {
  const view = presentResearch(snapshot(), { live: false, stage: 'RESEARCH_COMPLETED' });
  assert.equal(view?.complete, true);
  assert.match(view?.stageLabel ?? '', /COMPLETE|PARTIALLY/);
  assert.equal(researchActiveFromRuntime({ phase: 'IDLE', liveStage: 'RESEARCH_COMPLETED', currentAskResearch: true }), false);
});

test('permission and Emergency Stop supersede research presentation', () => {
  const permission = composePresenceHud({ kind: 'research', permission: true });
  assert.equal(permission?.kind, 'permission');
  assert.equal(permissionSupersedesResearch(permission), true);
  const visual = composePresenceVisual({
    phase: 'WAITING_OWNER',
    hudKind: 'research',
    waitingPermission: true,
    research: snapshot(),
    researchLive: true,
    search: '?visualScene=waiting-owner',
  });
  assert.equal(visual.hud?.kind, 'permission');
  assert.equal(visual.fixture, 'waiting-owner');
  assert.equal(visual.research, null);
  const halt = composePresenceVisual({
    phase: 'EMERGENCY_STOP',
    hudKind: 'research',
    emergency: true,
    research: snapshot(),
    researchLive: true,
  });
  assert.equal(halt.motion.lock, true);
  assert.equal(halt.research, null);
  assert.equal(presenceCoreMotion('EMERGENCY_STOP').ringSpeed, 0);
});

test('reduced motion freezes decorative core travel', () => {
  const motion = presenceCoreMotion('IDLE', true);
  assert.equal(motion.ringSpeed, 0);
  assert.equal(motion.orbitSpeed, 0);
  assert.equal(motion.waveform, false);
});

test('fixture mode cannot leak into normal runtime', () => {
  assert.equal(parsePresenceVisualScene(''), null);
  assert.equal(parsePresenceVisualScene('?mode=ambient'), null);
  assert.equal(fixtureMustNotLeak('/jarvis'), true);
  assert.equal(parsePresenceVisualScene('?visualScene=research'), 'research');
  const fixture = presenceVisualFixture('research');
  assert.equal(fixture.simulated, true);
  assert.equal(fixture.label, 'DEVELOPMENT FIXTURE');
  const normal = composePresenceVisual({ phase: 'IDLE', hudKind: 'none', search: '' });
  assert.equal(normal.fixture, null);
  assert.equal(normal.fixtureLabel, null);
});

test('no fake progress percentage without a denominator', () => {
  assert.equal(honestProgressPercent(honestTaskProgress({})), null);
  assert.equal(honestTaskProgress({ phaseLabel: 'Executing' }).kind, 'unknown');
  const steps = honestTaskProgress({ stepsDone: 3, stepsTotal: 7 });
  assert.equal(steps.kind, 'steps');
  if (steps.kind === 'steps') assert.equal(steps.label, '3 / 7');
  assert.equal(honestProgressPercent(steps), 43);
});

test('large source streams stay bounded', () => {
  const many = Array.from({ length: 40 }, (_, index) => ({ id: String(index) }));
  const bounded = boundVisibleNodes(many, presenceQualityBudget('HIGH').visibleNodeCap);
  assert.equal(bounded.visible.length, 8);
  assert.equal(bounded.overflow, 32);
  const view = presentResearch({
    attached: true,
    healthy: true,
    last: {
      query: 'bulk',
      sources: Array.from({ length: 25 }, (_, index) => ({
        sourceId: `s${index}`,
        url: `https://example.test/${index}`,
        canonicalUrl: `https://example.test/${index}`,
        domain: 'example.test',
        title: `Source ${index}`,
        publishedAt: null,
        fetchedAt: 't',
        sourceClass: 'UNKNOWN',
        status: 'listed',
        cached: false,
      })),
      evidence: [],
      stages: [],
      researchedAt: 't',
      cached: false,
      uncertainty: [],
    },
  }, { live: true, quality: 'HIGH' });
  assert.ok((view?.nodes.length ?? 0) <= 8);
  assert.equal(view?.overflow, 17);
});

test('silent PCM does not invent microphone energy', () => {
  assert.equal(pcmAmplitude(new Uint8Array(64)), 0);
  assert.equal(pcmAmplitude(null), 0);
});

test('cinematic Presence stays Discord-free and does not replace Control Center', () => {
  const files = [
    path.join(process.cwd(), 'src', 'jarvis', 'ui', 'presence', 'cinematic', 'PresenceCoreScene.tsx'),
    path.join(process.cwd(), 'src', 'jarvis', 'ui', 'presence', 'cinematic', 'presenceVisualModel.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'ui', 'presence', 'JarvisPresencePage.tsx'),
  ];
  const discord = /from\s+['"](?:discord(?:\.js)?|@discordjs\/)['"]/u;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(discord.test(text), false, file);
    assert.doesNotMatch(text, /chain.of.thought|scratchpad/i);
  }
  const page = fs.readFileSync(files[2]!, 'utf8');
  assert.match(page, /Talk to Jarvis/);
  assert.match(page, /visualScene/);
});
