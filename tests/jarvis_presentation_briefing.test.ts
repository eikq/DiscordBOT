import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyBriefingFollowUp,
  buildMotionTimeline,
  estimateNarrationMs,
  FORBIDDEN_PRESENTATION_KEYS,
  planPresentation,
  presentationHasForbiddenKeys,
  runPresentationPipeline,
  sanitizePlannedPresentation,
  spokenTextFor,
} from '../src/jarvis/presentation/briefing';
import { focusedTargetId, visibleMotionCues } from '../src/jarvis/ui/presenterMotion';

test('greetings stay plain while research becomes a briefing report', () => {
  assert.equal(planPresentation({ text: 'hello' }).density, 'plain');
  assert.equal(planPresentation({ text: 'thanks' }).density, 'plain');
  const research = planPresentation({
    text: 'research the latest Qwen documentation',
    route: 'RESEARCH',
    research: {
      query: 'Qwen documentation',
      synthesis: 'Qwen docs live on qwen.readthedocs.io and GitHub.',
      sources: [
        { sourceId: 'src-1', title: 'Qwen docs', url: 'https://qwen.readthedocs.io' },
        { sourceId: 'src-2', title: 'QwenLM', url: 'https://github.com/QwenLM' },
      ],
    },
  });
  assert.equal(research.density, 'briefing');
  assert.equal(research.mode, 'comparison');
});

test('comparison, diagnostics, and plans select the matching presentation mode', () => {
  assert.equal(planPresentation({
    text: 'compare those two sources',
    research: { sources: [{ sourceId: 'a', title: 'A', url: 'https://a.example' }, { sourceId: 'b', title: 'B', url: 'https://b.example' }] },
  }).mode, 'comparison');
  assert.equal(planPresentation({
    text: 'สถานะระบบ',
    capabilityId: 'system.status',
    systemSnapshot: { summary: 'CPU 20%' },
  }).mode, 'report');
  assert.equal(planPresentation({
    text: 'walk me through the roadmap',
    replyText: 'Step 1 then step 2 then step 3',
  }).mode, 'walkthrough');
});

test('pipeline builds a typed model with narration, motion, and no hidden CoT', () => {
  const planned = runPresentationPipeline({
    text: 'research the latest Qwen documentation',
    route: 'RESEARCH',
    replyText: 'Qwen documentation is published on the official docs site.',
    research: {
      query: 'Qwen documentation',
      synthesis: 'Official docs and the GitHub org are the primary sources.',
      sources: [
        { sourceId: 'src-docs', title: 'Qwen docs', url: 'https://qwen.readthedocs.io' },
        { sourceId: 'src-gh', title: 'QwenLM', url: 'https://github.com/QwenLM' },
      ],
      evidence: [{ evidenceId: 'ev-1', claim: 'Docs are public.', sourceId: 'src-docs' }],
      uncertainty: ['Freshness of some pages is unknown.'],
    },
  });
  assert.notEqual(planned.density, 'plain');
  if (planned.density === 'plain') return;
  assert.equal(planned.mode, 'comparison');
  assert.ok(planned.summary);
  assert.ok(planned.spokenSummary.length < planned.summary.length + 40);
  assert.ok(planned.sections.some(item => item.kind === 'summary'));
  assert.ok(planned.sections.some(item => item.kind === 'evidence'));
  assert.ok(planned.evidence.length >= 2);
  assert.ok(planned.narrationSegments[0]?.kind === 'summary');
  assert.ok(planned.narrationSegments.every(item => item.target.id && item.estimatedMs >= 800));
  assert.ok(planned.motionTimeline.some(item => item.action === 'focus'));
  assert.equal(presentationHasForbiddenKeys(planned), false);
  for (const key of FORBIDDEN_PRESENTATION_KEYS) {
    assert.equal(Object.hasOwn(planned, key), false, key);
  }
});

test('presenter motion uses elapsed segment timing without inventing word timings', () => {
  const planned = runPresentationPipeline({
    text: 'research the latest Qwen documentation',
    route: 'RESEARCH',
    research: {
      synthesis: 'Official docs.',
      sources: [{ sourceId: 'src-1', title: 'Docs', url: 'https://qwen.readthedocs.io' }],
    },
  });
  assert.notEqual(planned.density, 'plain');
  if (planned.density === 'plain') return;
  const later = visibleMotionCues(planned, 10_000);
  assert.ok(later.length >= 1);
  assert.ok(focusedTargetId(later));
});

test('reduced-motion skips pulse and zoom cues', () => {
  const segments = [{
    id: 'narr-summary',
    order: 0,
    text: 'Summary',
    kind: 'summary' as const,
    target: { type: 'graph-node' as const, id: 'node-1' },
    estimatedMs: 1200,
  }];
  const motion = buildMotionTimeline(segments, { reducedMotion: true });
  assert.equal(motion.some(item => item.action === 'pulse' || item.action === 'zoom'), false);
  assert.ok(motion.every(item => item.reducedMotion === 'instant' || item.reducedMotion === 'skip'));
});

test('follow-ups stay on the presenter model and never call tools', () => {
  const planned = runPresentationPipeline({
    text: 'compare Qwen and Llama docs',
    route: 'RESEARCH',
    research: {
      synthesis: 'Two public docs.',
      sources: [
        { sourceId: 'src-a', title: 'A', url: 'https://a.example' },
        { sourceId: 'src-b', title: 'B', url: 'https://b.example' },
      ],
    },
  });
  assert.notEqual(planned.density, 'plain');
  if (planned.density === 'plain') return;
  const shorter = applyBriefingFollowUp(planned, 'shorten');
  assert.ok(shorter.sections.every(item => item.kind === 'summary' || item.kind === 'actions'));
  const source = applyBriefingFollowUp(planned, 'show-source', 'src-a');
  assert.ok(source.motionTimeline.some(item => item.action === 'spotlight' && item.target.id === 'src-a'));
  const repeated = applyBriefingFollowUp(planned, 'repeat');
  assert.equal(repeated.playback.segmentId, planned.narrationSegments[planned.playback.segmentIndex]?.id);
  const backed = applyBriefingFollowUp(applyBriefingFollowUp(planned, 'repeat'), 'back');
  assert.ok(backed.playback.segmentIndex <= repeated.playback.segmentIndex);
});

test('secrets are redacted from presentation text', () => {
  const planned = sanitizePlannedPresentation(runPresentationPipeline({
    text: 'system status report with notes',
    route: 'INFORMATION',
    replyText: 'API_KEY=sk-live-should-not-leak and a long enough diagnostic paragraph to become a rich report about CPU RAM and GPU.',
    systemSnapshot: { summary: 'API_KEY=sk-live-should-not-leak CPU 12%', parts: ['CPU 12%', 'RAM 40%'] },
  }) as Exclude<ReturnType<typeof runPresentationPipeline>, { density: 'plain' }>);
  if (planned.density === 'plain') return;
  assert.doesNotMatch(JSON.stringify(planned), /sk-live/u);
});

test('stale research snapshot does not override a diagnostic or greeting turn', () => {
  const leftover = {
    query: 'old research',
    synthesis: 'Old sources.',
    sources: [
      { sourceId: 'src-old', title: 'Old', url: 'https://old.example' },
      { sourceId: 'src-old-2', title: 'Older', url: 'https://older.example' },
    ],
  };
  assert.equal(planPresentation({
    text: 'สถานะระบบ',
    route: 'CAPABILITY',
    capabilityId: 'system.status',
    replyText: 'CPU 17% · RAM 46%',
    research: leftover,
  }).reason, 'system_diagnostics');
  assert.equal(planPresentation({
    text: 'hello',
    route: 'CONVERSATION',
    research: leftover,
  }).density, 'plain');
});

test('desktop and diagnostic turns become rich; greetings stay plain', () => {
  assert.equal(planPresentation({ text: 'hello Jarvis' }).density, 'plain');
  const desktop = planPresentation({
    text: 'which display am I on',
    capabilityId: 'desktop.getJarvisWindow',
    displays: { count: 2, currentName: 'notebook', hostKind: 'browser' },
  });
  assert.equal(desktop.density, 'rich');
  assert.equal(desktop.mode, 'summary');
});

test('spoken helper uses the short narration, not the raw reply', () => {
  const planned = runPresentationPipeline({
    text: 'research the latest Qwen documentation',
    route: 'RESEARCH',
    replyText: 'A very long raw answer that should not be spoken in full because it is not presenter narration.',
    research: {
      synthesis: 'Short official summary.',
      sources: [{ sourceId: 'src-1', title: 'Docs', url: 'https://qwen.readthedocs.io' }],
    },
  });
  const spoken = spokenTextFor(planned, 'fallback');
  assert.notEqual(spoken, 'A very long raw answer that should not be spoken in full because it is not presenter narration.');
  assert.ok(spoken.length < 1200);
  assert.ok(estimateNarrationMs(spoken) >= 800);
});
