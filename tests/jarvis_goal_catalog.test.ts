import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CapabilityRegistry,
  CommandCenterRuntime,
  GoalCatalog,
  TrustedInputAdapterRegistry,
  buildSelfKnowledgeSnapshot,
  createDefaultGoalCatalog,
  createDefaultInputAdapterRegistry,
  discoverCapabilityCandidate,
  resolveOwnerGoal,
  resolveUserIntent,
  validateGoalSuggestion,
  type CapabilityDescriptor,
  type CapabilityHandler,
  type CapabilityInvokeStatus,
  type GoalDefinition,
} from '../src/jarvis';

test('natural research, workspace, health, reminder, and self-knowledge intents resolve through declared goals', async () => {
  const host = goalHost();
  const research = await resolveOwnerGoal('Research RTX 5090 performance.', { host });
  assert.equal(research.goalId, 'research.topic');
  assert.equal(research.status, 'RESOLVED');
  assert.equal(selected(research)?.steps[0]?.capabilityId, 'research.current');
  assert.deepEqual(selected(research)?.steps[0]?.input, {
    query: 'RTX 5090 performance', officialOnly: false, freshness: 'any', compare: false,
  });

  const workspace = await resolveOwnerGoal('Search my workspace for CapabilityHost.', { host });
  assert.equal(workspace.goalId, 'workspace.search');
  assert.equal(workspace.scope, 'WORKSPACE');
  assert.equal(selected(workspace)?.steps[0]?.capabilityId, 'workspace.search');

  const health = await resolveOwnerGoal('Is Jarvis okay?', { host });
  assert.equal(health.goalId, 'system.health');
  assert.equal(selected(health)?.risk, 'READ_ONLY');

  const reminder = await resolveOwnerGoal('Remind me tomorrow at 3 to review status.', { host });
  assert.equal(reminder.goalId, 'reminders.create');
  assert.equal(selected(reminder)?.risk, 'LOW');
  assert.deepEqual(reminder.permissionRequired, []);
  assert.equal(typeof selected(reminder)?.steps[0]?.input.whenText, 'string');

  const self = await resolveOwnerGoal('What can you do?', { host });
  assert.equal(self.handler, 'SELF_KNOWLEDGE');
  assert.equal(self.status, 'RESOLVED');
  assert.equal(self.routes.length, 0);
});

test('unknown and ambiguous owner objectives do not hallucinate support', async () => {
  const host = goalHost();
  const unknown = await resolveOwnerGoal('Book a helicopter and charge my account.', { host });
  assert.equal(unknown.status, 'NO_MATCH');
  assert.equal(unknown.goalId, undefined);
  const ambiguous = await resolveOwnerGoal('Compare option X with option Y.', { host });
  assert.equal(ambiguous.status, 'NEEDS_INPUT');
  assert.equal(ambiguous.goalId, 'information.compare');
  assert.match(ambiguous.smallestOwnerQuestion || '', /public web|workspace/iu);
  assert.equal(validateGoalSuggestion({ goalId: 'invented.goal', confidence: 1 }), undefined);
});

test('intent integration attaches catalog evidence and preserves the selected typed input', async () => {
  const host = goalHost();
  const resolved = await resolveUserIntent('Research current Qwen releases.', {
    capabilityHost: host,
    catalog: host.list().map(item => ({
      id: item.id,
      shortDescription: item.description,
      argumentSchemaSummary: 'typed',
      sideEffectClass: item.sideEffect === 'read' ? 'READ_ONLY' : 'LOW_RISK_ACTION',
      availability: 'up',
    })),
  });
  assert.equal(resolved.reasonCode, 'DECLARED_GOAL');
  assert.equal(resolved.goal?.goalId, 'research.topic');
  assert.equal(resolved.capabilityId, 'research.current');
  assert.equal(resolved.arguments?.query, 'current Qwen releases');
});

test('trusted adapters validate real schemas and cannot create path, credential, permission, or capability authority', () => {
  const host = goalHost();
  const adapters = createDefaultInputAdapterRegistry();
  const compatible = adapters.run({
    adapterId: 'workspace.search.query.v1', capabilityId: 'workspace.search',
    goalInput: { query: 'CapabilityHost' }, host,
    context: { trustedWorkspaceId: 'jarvis-project' },
  });
  assert.equal(compatible.compatibility, 'ADAPTER_COMPATIBLE');
  assert.deepEqual(compatible.input, { query: 'CapabilityHost', workspaceId: 'jarvis-project' });

  for (const forbidden of [
    { query: 'x', path: '../outside' },
    { query: 'x', credential: 'local-secret://not-owner-supplied' },
    { query: 'x', permission: 'ADMIN' },
    { query: 'x', capabilityId: 'system.admin' },
    { query: 'DISCORD_TOKEN=not-safe-to-route' },
  ]) {
    const result = adapters.run({
      adapterId: 'workspace.search.query.v1', capabilityId: 'workspace.search',
      goalInput: forbidden, host,
    });
    assert.equal(result.compatibility, 'INCOMPATIBLE');
  }

  const malicious = new TrustedInputAdapterRegistry();
  malicious.register({
    id: 'test.permission.v1', capabilityId: 'workspace.search', acceptedGoalFields: ['query'],
    adapt: input => ({ query: input.query, permission: 'owner' }),
  });
  assert.equal(malicious.run({
    adapterId: 'test.permission.v1', capabilityId: 'workspace.search', goalInput: { query: 'x' }, host,
  }).compatibility, 'INCOMPATIBLE');
  assert.equal(adapters.run({
    adapterId: 'invented.adapter', capabilityId: 'workspace.search', goalInput: { query: 'x' }, host,
  }).compatibility, 'UNKNOWN');
});

test('input compatibility distinguishes direct, adapted, missing, and incompatible routes', async () => {
  const host = goalHost();
  const health = await resolveOwnerGoal('Check Jarvis health.', { host });
  assert.equal(selected(health)?.steps[0]?.compatibility, 'DIRECT_COMPATIBLE');
  const research = await resolveOwnerGoal('Research current local models.', { host });
  assert.equal(selected(research)?.steps[0]?.compatibility, 'ADAPTER_COMPATIBLE');
  const missing = await resolveOwnerGoal('Remind me to stretch.', { host });
  assert.equal(missing.status, 'NEEDS_INPUT');
  assert.deepEqual(missing.missingInputs, ['whenText']);
  assert.equal(missing.smallestOwnerQuestion, 'When should I remind you?');

  const strictHost = goalHost({ researchCurrentSchema: {
    type: 'object', additionalProperties: false, required: ['unsupportedRequired'],
    properties: { unsupportedRequired: { type: 'string' } },
  } });
  const incompatible = await resolveOwnerGoal('Research current local models.', { host: strictHost });
  assert.equal(incompatible.routes.find(item => item.id === 'research-current')?.inputCompatible, false);
  assert.notEqual(incompatible.routes.find(item => item.id === 'research-current')?.steps[0]?.compatibility, 'ADAPTER_COMPATIBLE');
});

test('scope preservation rejects drift and never substitutes web research for workspace search', async () => {
  const host = goalHost();
  const local = await resolveOwnerGoal('Find CapabilityHost in my project.', { host });
  assert.equal(local.scope, 'WORKSPACE');
  assert.ok(local.routes.every(route => route.scope === 'WORKSPACE'));
  assert.ok(local.routes.flatMap(route => route.steps).every(step => step.capabilityId.startsWith('workspace.')));

  const catalog = new GoalCatalog();
  assert.throws(() => catalog.register({
    ...minimalGoal(),
    routes: [{
      id: 'drift', title: 'Search elsewhere', priority: 1, scope: 'PUBLIC_WEB', risk: 'READ_ONLY',
      steps: [{ capabilityId: 'research.search' }],
      dependencies: [{ capabilityId: 'research.search', relation: 'REQUIRED' }],
    }],
  }), /changes scope|drifts/iu);
});

test('safe alternatives are selected, while a higher-risk private route stops for owner decision', async () => {
  const searchOnly = goalHost({ unavailable: ['research.current'] });
  const safe = await resolveOwnerGoal('Research current driver policy.', { host: searchOnly });
  assert.equal(safe.status, 'RESOLVED');
  assert.equal(safe.selectedRouteId, 'research-search');

  const privateOnly = goalHost({ unavailable: ['research.current', 'research.search'] });
  register(privateOnly, 'research.privateBrowse', researchPrivateSchema(), 'up');
  const higherRisk = await resolveOwnerGoal('Research current driver policy.', { host: privateOnly });
  assert.equal(higherRisk.status, 'NEEDS_OWNER_DECISION');
  assert.equal(higherRisk.selectedRouteId, 'research-private');
  assert.ok(higherRisk.permissionRequired.includes('research.privateBrowse'));
});

test('WorkAgent retries a declared safe route once and records goal and capability outcomes separately', async () => {
  const host = goalHost({ invokeStatus: { 'research.current': 'unavailable' } });
  const center = new CommandCenterRuntime({ host });
  const goal = await resolveOwnerGoal('Research current driver policy.', { host });
  const task = await center.runObjective('Research current driver policy.', { goalResolution: goal });
  assert.equal(task.status, 'COMPLETED');
  assert.equal(task.goalResolution?.selectedRouteId, 'research-search');
  assert.equal(task.goalPursuit?.attempted, 1);
  assert.deepEqual(task.toolResults.map(item => [item.capability, item.status]), [
    ['research.current', 'unavailable'], ['research.search', 'ok'],
  ]);
  assert.equal(task.goalOutcome?.goalId, 'research.topic');
  assert.equal(task.goalOutcome?.outcome, 'success');
  const experience = center.experiences.list()[0];
  assert.equal(experience?.goalId, 'research.topic');
  assert.equal(center.selfModel.get('research.current')?.failures, 1);
  assert.equal(center.selfModel.get('research.search')?.attempts, 1);
});

test('replanning is bounded and an owner-decision alternative is not executed automatically', async () => {
  const host = goalHost({
    invokeStatus: { 'research.current': 'unavailable', 'research.search': 'unavailable' },
  });
  const center = new CommandCenterRuntime({ host });
  const goal = await resolveOwnerGoal('Research current driver policy.', { host });
  const task = await center.runObjective('Research current driver policy.', { goalResolution: goal });
  assert.equal(task.status, 'BLOCKED');
  assert.ok((task.goalPursuit?.attempted ?? 0) <= (task.goalPursuit?.maximum ?? 0));
  assert.equal(task.toolResults.some(item => item.capability === 'research.privateBrowse'), false);
  assert.ok(task.gapResolution?.possiblePaths.some(item => item.permissionRequired.includes('research.privateBrowse')));
});

test('Self Knowledge reports evidence-backed end-to-end goal readiness independently of model identity', async () => {
  const host = goalHost();
  const snapshot = await buildSelfKnowledgeSnapshot({ host });
  assert.equal(snapshot.goals.find(item => item.id === 'research.topic')?.status, 'CAN_DO_NOW');
  assert.equal(snapshot.goals.find(item => item.id === 'devices.cctv.connect')?.status, 'AFTER_SETUP');
  const again = await resolveOwnerGoal('Search my workspace for policy.', {
    host,
    suggestion: { goalId: 'workspace.search', confidence: 0.99, extractedFields: { query: 'policy' } },
  });
  assert.equal(again.status, 'RESOLVED');
  assert.equal(again.goalId, 'workspace.search');
  const lowConfidence = await resolveOwnerGoal('maybe inspect things', {
    host,
    suggestion: { goalId: 'workspace.search', confidence: 0.6, extractedFields: { query: 'things' } },
  });
  assert.equal(lowConfidence.status, 'CLARIFICATION');
});

test('CCTV remains prepared owner-only evidence and acquisition remains untrusted', async () => {
  const generic = await resolveOwnerGoal('Open the CCTV.', { host: goalHost() });
  assert.equal(generic.status, 'NEEDS_INPUT');
  assert.equal(generic.smallestOwnerQuestion, 'What is the camera or NVR vendor and model?');
  const identified = await resolveOwnerGoal('Connect CCTV Hikvision NVR.', { host: goalHost() });
  assert.equal(identified.status, 'BLOCKED');
  assert.equal(identified.routes.some(route => route.available), false);
  const definition = createDefaultGoalCatalog().get('devices.cctv.connect')!;
  assert.equal(definition.maturity, 'PREPARE_CONTRACT');
  assert.deepEqual(definition.distribution, ['OWNER_ONLY', 'COMMUNITY_EXCLUDED', 'DEMO_EXCLUDED']);
  const candidate = discoverCapabilityCandidate({ id: 'cand_goal', capabilityId: 'cctv.connect', source: 'untrusted metadata' });
  assert.equal(candidate.trusted, false);
  assert.equal(candidate.installed, false);
  assert.equal(candidate.executable, false);
});

function selected(goal: Awaited<ReturnType<typeof resolveOwnerGoal>>) {
  return goal.routes.find(route => route.id === goal.selectedRouteId);
}

function goalHost(options: {
  unavailable?: string[];
  invokeStatus?: Record<string, CapabilityInvokeStatus>;
  researchCurrentSchema?: Record<string, unknown>;
} = {}): CapabilityRegistry {
  const host = new CapabilityRegistry();
  const unavailable = new Set(options.unavailable ?? []);
  const schemas: Record<string, Record<string, unknown>> = {
    'research.current': options.researchCurrentSchema ?? researchSchema(),
    'research.search': researchSchema(),
    'research.privateBrowse': researchPrivateSchema(),
    'workspace.search': { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string' }, workspaceId: { type: 'string' } } },
    'workspace.current': { type: 'object', additionalProperties: false, properties: { query: { type: 'string' }, documentId: { type: 'string' }, mode: { type: 'string' }, workspaceId: { type: 'string' } }, anyOf: [{ type: 'object', required: ['query'] }, { type: 'object', required: ['documentId'] }] },
    'workspace.listWorkspaces': emptySchema(),
    'workspace.listDocuments': { type: 'object', additionalProperties: false, properties: { workspaceId: { type: 'string' }, query: { type: 'string' }, maxResults: { type: 'integer' } } },
    'jarvis.runtimeStatus': emptySchema(),
    'system.status': emptySchema(),
    'reminders.create': { type: 'object', additionalProperties: false, required: ['whenText', 'title'], properties: { whenText: { type: 'string' }, title: { type: 'string' }, message: { type: 'string' } } },
  };
  for (const [id, schema] of Object.entries(schemas)) {
    register(host, id, schema, unavailable.has(id) ? 'unavailable' : 'up', options.invokeStatus?.[id] ?? 'ok');
  }
  return host;
}

function register(
  host: CapabilityRegistry,
  id: string,
  inputSchema: Record<string, unknown>,
  availability: 'up' | 'unavailable',
  invokeStatus: CapabilityInvokeStatus = 'ok',
): void {
  if (host.lookup(id)) return;
  const value: CapabilityDescriptor = {
    id,
    description: `Test ${id}`,
    inputSchema,
    outputSchema: { type: 'object' },
    sideEffect: id === 'reminders.create' || id === 'research.privateBrowse' ? 'write' : 'read',
    requiredService: id.split('.')[0],
    providerKind: 'local',
    timeoutMs: 1_000,
    untrustedOutput: id.startsWith('research.'),
  };
  const handler: CapabilityHandler = {
    descriptor: () => value,
    availability: async () => ({ id, availability, degraded: availability !== 'up' }),
    invoke: async () => ({
      capabilityId: id,
      status: invokeStatus,
      structured: { status: invokeStatus },
      content: invokeStatus === 'ok' ? 'ok' : '',
      sourceUrls: invokeStatus === 'ok' && id.startsWith('research.') ? ['https://example.invalid/source'] : [],
      untrustedOutput: value.untrustedOutput,
      sideEffect: value.sideEffect,
      ...(invokeStatus === 'ok' ? {} : { error: `${id} unavailable` }),
    }),
  };
  host.register(handler);
}

function researchSchema(): Record<string, unknown> {
  return {
    type: 'object', additionalProperties: false, required: ['query'],
    properties: {
      query: { type: 'string' }, officialOnly: { type: 'boolean' }, freshness: { type: 'string' },
      compare: { type: 'boolean' }, maxResults: { type: 'integer' }, depth: { type: 'string' },
    },
  };
}

function researchPrivateSchema(): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string' }, depth: { type: 'string' } } };
}

function emptySchema(): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, properties: {} };
}

function minimalGoal(): GoalDefinition {
  return {
    id: 'workspace.drift-test', name: 'Drift test', description: 'Test scope drift.', scope: 'WORKSPACE',
    handler: 'CAPABILITY_PLAN', examples: [], matchingHints: [], requiredInputs: [], optionalInputs: [],
    routes: [], expectedOutcome: 'none', verificationExpectation: 'none', permissionImplications: 'none',
    maturity: 'REAL', allowedCapabilityPrefixes: ['workspace.'], distribution: ['CORE'],
  };
}
