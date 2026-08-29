import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MEDIA_CANCEL,
  MEDIA_CREATE_VIDEO,
  MEDIA_GET_OUTPUT,
  MEDIA_STATUS,
  createStandaloneCapabilityHost,
  distributionForCapability,
  validateActionInput,
} from '../src/jarvis';
import type {
  MediaCapabilityPort,
  MediaCreateRequest,
  MediaGatewayAvailability,
  SubmittedMediaProject,
} from '../src/jarvis';
import type { DesktopAllowlists } from '../src/jarvis/capabilities/actions/types';

const lists: DesktopAllowlists = {
  applications: [], projects: [], trustedOrigins: [], trustedPathPrefixes: [],
  workspaceRoot: process.cwd(),
};

class FakeMediaPort implements MediaCapabilityPort {
  public creates: MediaCreateRequest[] = [];
  public cancelled: string[] = [];
  public collected: Array<{ projectId: string; stitch: boolean }> = [];

  async availability(): Promise<MediaGatewayAvailability> {
    return { configured: true, bridgeConnected: true, comfyConnected: true, backendReachable: true };
  }

  async createVideo(input: MediaCreateRequest): Promise<SubmittedMediaProject> {
    this.creates.push(input);
    return {
      projectId: 'media_abcdef123456',
      workflowId: 'ltx23-story-video',
      jobs: [{ shotIndex: 1, promptId: 'prompt-1', workflowFile: 'shot_001.json' }],
    };
  }

  async status(projectId: string): Promise<Record<string, unknown>> {
    return { project_id: projectId, status: 'running', shots: [{ index: 1, status: 'queued' }] };
  }

  async cancel(projectId: string): Promise<Record<string, unknown>> {
    this.cancelled.push(projectId);
    return { project_id: projectId, cancelled: ['prompt-1'] };
  }

  async collectOutput(projectId: string, stitch: boolean): Promise<Record<string, unknown>> {
    this.collected.push({ projectId, stitch });
    return { project_id: projectId, status: 'completed', final_video: 'C:\\AI\\outputs\\final.mp4' };
  }
}

function hostFor(port: MediaCapabilityPort) {
  return createStandaloneCapabilityHost({
    worldIntel: false,
    research: false,
    workspace: false,
    reminders: false,
    build: false,
    desktop: false,
    media: { port },
    actions: { allowlists: lists, audit: false },
  });
}

test('media createVideo is a gated owner capability and queues bounded local jobs', async () => {
  const port = new FakeMediaPort();
  const host = hostFor(port);
  const result = await host.invoke({
    id: MEDIA_CREATE_VIDEO,
    input: {
      storyline: 'A robot walks through a rainy neon city, then looks up at the moon.',
      title: 'Neon Walk',
      targetDurationSeconds: 12,
      aspectRatio: '16:9',
      fps: 24,
    },
    source: 'text',
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.structured.projectId, 'media_abcdef123456');
  assert.equal(port.creates.length, 1);
  assert.equal(port.creates[0].title, 'Neon Walk');
});

test('media action schema rejects arbitrary paths and invalid project ids', () => {
  const forbidden = validateActionInput(MEDIA_CREATE_VIDEO, {
    storyline: 'safe story',
    path: 'C:\\outside\\workflow.json',
  }, lists);
  assert.equal(forbidden.ok, false);
  if (!forbidden.ok) assert.equal(forbidden.reasonCode, 'FORBIDDEN_ARGUMENT');

  const invalid = validateActionInput(MEDIA_STATUS, { projectId: '../escape' }, lists);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.reasonCode, 'INVALID_MEDIA_PROJECT');
});

test('media status remains read-only while cancel and output stay project-scoped', async () => {
  const port = new FakeMediaPort();
  const host = hostFor(port);
  const projectId = 'media_abcdef123456';

  const status = await host.invoke({ id: MEDIA_STATUS, input: { projectId }, source: 'text' });
  assert.equal(status.status, 'ok');
  assert.equal(status.sideEffect, 'read');

  const cancelled = await host.invoke({ id: MEDIA_CANCEL, input: { projectId }, source: 'text' });
  assert.equal(cancelled.status, 'ok');
  assert.deepEqual(port.cancelled, [projectId]);

  const output = await host.invoke({ id: MEDIA_GET_OUTPUT, input: { projectId, stitch: true }, source: 'text' });
  assert.equal(output.status, 'ok');
  assert.deepEqual(port.collected, [{ projectId, stitch: true }]);
});

test('standalone host does not spawn or register media unless media deps are explicit', () => {
  const host = createStandaloneCapabilityHost({
    worldIntel: false, research: false, workspace: false, reminders: false,
    build: false, desktop: false, actions: { allowlists: lists, audit: false },
  });
  assert.equal(host.lookup(MEDIA_CREATE_VIDEO), undefined);
});

test('media capabilities are owner-only and absent from Community Edition host', () => {
  assert.deepEqual(distributionForCapability(MEDIA_CREATE_VIDEO), [
    'OWNER_ONLY', 'COMMUNITY_EXCLUDED', 'DEMO_EXCLUDED',
  ]);
  const previous = process.env.JARVIS_EDITION;
  process.env.JARVIS_EDITION = 'community';
  try {
    const host = createStandaloneCapabilityHost({
      worldIntel: false, research: false, workspace: false, reminders: false,
      build: false, desktop: false, media: { port: new FakeMediaPort() },
      actions: { allowlists: lists, audit: false },
    });
    assert.equal(host.lookup(MEDIA_CREATE_VIDEO), undefined);
  } finally {
    if (previous === undefined) delete process.env.JARVIS_EDITION;
    else process.env.JARVIS_EDITION = previous;
  }
});
