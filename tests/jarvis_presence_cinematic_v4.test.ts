import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pushActivityItem, researchActivityLine, visibleActivityItems } from '../src/jarvis/ui/presence/cinematic/activityFeed';
import { parsePresenceReplay, replayMustNotEnterProduction, replayResearchAt } from '../src/jarvis/ui/presence/cinematic/cinematicReplay';
import { presenceCoreMotion } from '../src/jarvis/ui/presence/cinematic/coreMotion';
import { inspectDragEnabled, pointerChangesRuntimeAuthority, pointerMayGrantPermission, visualDebugEnabled } from '../src/jarvis/ui/presence/cinematic/pointerAuthority';
import { composePresenceVisual } from '../src/jarvis/ui/presence/cinematic/presenceVisualModel';
import { nextPresenceAutoTier, presenceParticleCount, presenceQualityBudget } from '../src/jarvis/ui/presence/cinematic/presenceQuality';
import { classifyResearchSource, honestProgressPercent, honestTaskProgress, presentResearch } from '../src/jarvis/ui/presence/cinematic/researchPresentation';
import { sourceSpatial, sourceStreamsEnergy } from '../src/jarvis/ui/presence/cinematic/spatialLayout';
import { analyserAmplitude } from '../src/jarvis/ui/presence/cinematic/speechAmplitude';
import { fixtureMustNotLeak, parsePresenceVisualScene, presenceVisualFixture } from '../src/jarvis/ui/presence/cinematic/visualFixtures';

test('Presence Core is a real WebGL scene with shaders and bloom', () => {
  const scene = fs.readFileSync(path.join(process.cwd(), 'src', 'jarvis', 'ui', 'presence', 'cinematic', 'PresenceCoreScene.tsx'), 'utf8');
  assert.match(scene, /from '@react-three\/fiber'/);
  assert.match(scene, /<Canvas/);
  assert.match(scene, /ShaderMaterial/);
  assert.match(scene, /PresenceBloom/);
  assert.match(scene, /gyro/);
  assert.doesNotMatch(scene, /from ['"]discord/);
  const bloom = fs.readFileSync(path.join(process.cwd(), 'src', 'jarvis', 'ui', 'presence', 'cinematic', 'PresenceBloom.tsx'), 'utf8');
  assert.match(bloom, /UnrealBloomPass/);
  assert.match(bloom, /EffectComposer/);
});

test('quality modes change bloom, particles, and gyro count', () => {
  const high = presenceQualityBudget('HIGH');
  const low = presenceQualityBudget('LOW');
  assert.equal(high.bloom, true);
  assert.equal(high.shaders, true);
  assert.ok(high.gyroRings >= 4);
  assert.ok(presenceParticleCount('HIGH') > presenceParticleCount('LOW'));
  assert.equal(low.bloom, false);
  assert.equal(low.shaders, false);
  assert.ok(low.gyroRings < high.gyroRings);
  assert.equal(nextPresenceAutoTier('HIGH', 20), 'BALANCED');
  assert.equal(nextPresenceAutoTier('HIGH', 60), null);
});

test('Emergency Stop freezes animation state', () => {
  const motion = presenceCoreMotion('EMERGENCY_STOP');
  assert.equal(motion.lock, true);
  assert.equal(motion.ringSpeed, 0);
  assert.equal(motion.gyroX, 0);
  assert.equal(motion.gyroY, 0);
  assert.equal(motion.gyroZ, 0);
  assert.equal(motion.orbitSpeed, 0);
  const reduced = presenceCoreMotion('RESEARCHING', true);
  assert.equal(reduced.gyroX, 0);
  assert.equal(reduced.waveform, false);
});

test('research nodes and streams come from evidence, not animation', () => {
  const official = classifyResearchSource({
    sourceId: 'a',
    status: 'fetched',
    sourceClass: 'OFFICIAL',
    fetchedAt: 't',
    domain: 'qwenlm.github.io',
    title: 'Docs',
  }, [{ sourceId: 'a', kind: 'SOURCE_SUPPORTED', excerpt: 'Official' }]);
  assert.equal(official.trust, 'verified');
  assert.equal(sourceStreamsEnergy(official.visual), true);
  const pose = sourceSpatial({
    id: 'a',
    title: 'Docs',
    visual: official.visual,
    trust: official.trust,
  }, 0, 1);
  assert.ok(pose.stream);
  assert.ok(pose.brightness >= 0.9);
  const view = presentResearch({
    attached: true,
    healthy: true,
    last: {
      query: 'Qwen',
      sources: [{
        sourceId: 'a', url: 'https://qwenlm.github.io', canonicalUrl: 'https://qwenlm.github.io', domain: 'qwenlm.github.io',
        title: 'Docs', publishedAt: null, fetchedAt: 't', sourceClass: 'OFFICIAL', status: 'fetched', cached: false,
      }],
      evidence: [{ evidenceId: 'e1', sourceId: 'a', excerpt: 'Official', publishedAt: null, fetchedAt: null, kind: 'SOURCE_SUPPORTED' }],
      stages: [],
      researchedAt: 't',
      cached: false,
      uncertainty: [],
    },
  }, { live: true });
  assert.equal(view?.counts.evidence, 1);
  assert.equal(view?.nodes[0]?.trust, 'verified');
});

test('source node lifecycle changes spatial state without inventing certainty', () => {
  const discovered = sourceSpatial({ id: 'x', title: 'X', visual: 'DISCOVERED', trust: 'unknown' }, 0, 2);
  const verified = sourceSpatial({ id: 'x', title: 'X', visual: 'VERIFIED', trust: 'verified' }, 0, 2);
  const failed = sourceSpatial({ id: 'x', title: 'X', visual: 'FAILED', trust: 'unknown' }, 0, 2);
  assert.ok(verified.size > discovered.size);
  assert.ok(failed.fade < discovered.fade);
  assert.equal(discovered.stream, false);
  assert.notEqual(discovered.brightness, 1);
});

test('pointer interaction cannot change runtime authority', () => {
  assert.equal(pointerChangesRuntimeAuthority('hover'), false);
  assert.equal(pointerChangesRuntimeAuthority('select'), false);
  assert.equal(pointerChangesRuntimeAuthority('inspect-drag'), false);
  assert.equal(pointerMayGrantPermission(), false);
  assert.equal(inspectDragEnabled(''), false);
  assert.equal(inspectDragEnabled('?inspect=1'), false);
  assert.equal(visualDebugEnabled('/jarvis'), false);
  assert.equal(visualDebugEnabled('?visualDebug=1'), true);
});

test('dev replay cannot enter production Presence', () => {
  assert.equal(parsePresenceReplay(''), null);
  assert.equal(parsePresenceReplay('?mode=ambient'), null);
  assert.equal(replayMustNotEnterProduction('/jarvis'), true);
  assert.equal(fixtureMustNotLeak('/jarvis'), true);
  const replay = parsePresenceReplay('?visualReplay=1&replaySpeed=0.5');
  assert.equal(replay?.speed, 0.5);
  const early = replayResearchAt(800);
  assert.equal(early.label, 'DEVELOPMENT REPLAY');
  assert.equal(early.simulated, true);
  assert.ok((early.snapshot.last?.sources.length ?? 0) >= 1);
  const later = replayResearchAt(7000);
  assert.ok((later.snapshot.last?.sources.length ?? 0) > (early.snapshot.last?.sources.length ?? 0));
  const idle = composePresenceVisual({ phase: 'IDLE', hudKind: 'none', search: '' });
  assert.equal(idle.replay, null);
  assert.equal(idle.fixtureLabel, null);
  const playing = composePresenceVisual({ phase: 'IDLE', hudKind: 'none', search: '?visualReplay=1', replayElapsedMs: 2500 });
  assert.equal(playing.fixtureLabel, 'DEVELOPMENT REPLAY');
  assert.ok((playing.research?.nodes.length ?? 0) > 0);
});

test('no fake research progress and no stale idle constellation', () => {
  assert.equal(honestProgressPercent(honestTaskProgress({})), null);
  const idle = composePresenceVisual({
    phase: 'IDLE',
    hudKind: 'none',
    research: presenceVisualFixture('research').research,
    researchLive: false,
  });
  assert.equal(idle.quietIdle, true);
  assert.equal(idle.research, null);
});

test('hidden-tab and reduced-motion paths stay in the Core scene', () => {
  const scene = fs.readFileSync(path.join(process.cwd(), 'src', 'jarvis', 'ui', 'presence', 'cinematic', 'PresenceCoreScene.tsx'), 'utf8');
  assert.match(scene, /frameloop = paused \? 'never'/);
  assert.match(scene, /props.reducedMotion \? 'demand'/);
  assert.match(scene, /hidden/);
});

test('permission UI still binds the exact proposal only', () => {
  const page = fs.readFileSync(path.join(process.cwd(), 'src', 'jarvis', 'ui', 'presence', 'JarvisPresencePage.tsx'), 'utf8');
  assert.match(page, /proposalId: pendingConfirmation.proposalId/);
  assert.match(page, /token: pendingConfirmation.token/);
  assert.match(page, /Talk to Jarvis/);
  assert.match(page, /mode=ambient/);
  assert.match(page, /visualScene/);
  const approval = fs.readFileSync(path.join(process.cwd(), 'src', 'jarvis', 'ui', 'presence', 'PresenceApproval.tsx'), 'utf8');
  assert.match(approval, /Allow once/);
  assert.match(approval, /binds only this request/);
});

test('activity feed is telemetry, not chain-of-thought', () => {
  assert.equal(researchActivityLine('SOURCE_DISCOVERED'), 'Source discovered');
  const items = pushActivityItem([], 'EVIDENCE_UPDATED', 1_000);
  assert.equal(items[0]?.text, 'Evidence arriving');
  assert.equal(visibleActivityItems(items, 6_000).length, 0);
  const scene = fs.readFileSync(path.join(process.cwd(), 'src', 'jarvis', 'ui', 'presence', 'cinematic', 'activityFeed.ts'), 'utf8');
  assert.doesNotMatch(scene, /chain.of.thought|scratchpad/i);
});

test('silent analyser and missing audio do not invent speech energy', () => {
  assert.equal(analyserAmplitude(null), 0);
});

test('new visual scenes stay opt-in fixtures', () => {
  assert.equal(parsePresenceVisualScene('?visualScene=synthesizing'), 'synthesizing');
  assert.equal(parsePresenceVisualScene('?visualScene=open-application'), 'open-application');
  assert.equal(presenceVisualFixture('planning').planSteps.length, 3);
  assert.equal(presenceVisualFixture('open-application').applicationLabel, 'Cursor');
  assert.equal(presenceVisualFixture('research-start').research?.last?.sources.length, 2);
});
