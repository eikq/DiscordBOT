import { REMINDERS_CREATE } from '../automation/constants';
import {
  DESKTOP_OPEN_APPLICATION,
  DESKTOP_OPEN_SCOPED_RESOURCE,
  DESKTOP_OPEN_TRUSTED_URL,
  JARVIS_RUNTIME_STATUS,
  SYSTEM_STATUS,
} from '../capabilities/actions/constants';
import { RESEARCH_CURRENT, RESEARCH_PRIVATE_BROWSE, RESEARCH_SEARCH } from '../research/constants';
import { WORKSPACE_CURRENT, WORKSPACE_LIST, WORKSPACE_LIST_DOCUMENTS, WORKSPACE_SEARCH } from '../workspace/constants';
import type { GoalDefinition, GoalRouteDefinition } from './types';

export class GoalCatalog {
  private readonly goals = new Map<string, GoalDefinition>();

  public register(definition: GoalDefinition): void {
    validateDefinition(definition);
    if (this.goals.has(definition.id)) throw new Error(`Goal ${definition.id} is already registered.`);
    this.goals.set(definition.id, cloneDefinition(definition));
  }

  public get(id: string): GoalDefinition | undefined {
    const item = this.goals.get(id);
    return item ? cloneDefinition(item) : undefined;
  }

  public list(): GoalDefinition[] {
    return [...this.goals.values()].map(cloneDefinition);
  }
}

export function createDefaultGoalCatalog(): GoalCatalog {
  const catalog = new GoalCatalog();
  for (const definition of DEFAULT_GOALS) catalog.register(definition);
  return catalog;
}

export const DEFAULT_GOALS: GoalDefinition[] = [
  {
    id: 'information.compare',
    version: 1,
    name: 'Compare information in an owner-selected source',
    description: 'Compare evidence without guessing whether the owner meant public web or the approved workspace.',
    scope: 'OWNER_SELECTED_SOURCE',
    handler: 'CAPABILITY_PLAN',
    examples: ['Compare the security notes.', 'Compare X and Y.'],
    matchingHints: ['compare', 'source scope', 'workspace or web'],
    requiredInputs: [
      { id: 'scope', description: 'The owner-selected public-web or approved-workspace scope.', required: true, smallestQuestion: 'Do you mean public web or your approved workspace?' },
      { id: 'query', description: 'The items or evidence to compare.', required: true, smallestQuestion: 'What should I compare?' },
    ],
    optionalInputs: [],
    routes: [
      route('compare-workspace', 'Compare evidence in the approved workspace', 1, 'WORKSPACE', 'READ_ONLY', [
        { capabilityId: WORKSPACE_SEARCH, adapterId: 'workspace.search.query.v1' },
      ], true),
      route('compare-public-web', 'Compare public web evidence', 2, 'PUBLIC_WEB', 'READ_ONLY', [
        { capabilityId: RESEARCH_CURRENT, adapterId: 'research.current.query.v1' },
      ], true),
    ],
    expectedOutcome: 'A bounded comparison from the owner-selected source scope.',
    verificationExpectation: 'Every comparison item must retain workspace provenance or public source evidence.',
    permissionImplications: 'Read-only. Source scope must be selected explicitly and cannot drift after continuation.',
    maturity: 'REAL',
    allowedCapabilityPrefixes: ['workspace.', 'research.'],
    distribution: ['CORE'],
  },
  {
    id: 'research.topic',
    version: 1,
    name: 'Research a current topic',
    description: 'Collect and synthesize evidence from public web sources.',
    scope: 'PUBLIC_WEB',
    handler: 'CAPABILITY_PLAN',
    examples: ['Research RTX 5090 performance.', 'Find current information about Qwen.', 'Compare current evidence about X and Y.'],
    matchingHints: ['research', 'public web', 'current information', 'compare sources'],
    requiredInputs: [{ id: 'query', description: 'The research question or topic.', required: true, smallestQuestion: 'What topic should I research?' }],
    optionalInputs: [
      { id: 'officialOnly', description: 'Prefer official or primary sources.', required: false },
      { id: 'freshness', description: 'Latest or any available public evidence.', required: false },
      { id: 'compare', description: 'Compare conflicting source claims.', required: false },
    ],
    routes: [
      route('research-current', 'Research and synthesize public sources', 1, 'PUBLIC_WEB', 'READ_ONLY', [
        { capabilityId: RESEARCH_CURRENT, adapterId: 'research.current.query.v1' },
      ]),
      route('research-search', 'Search public sources', 2, 'PUBLIC_WEB', 'READ_ONLY', [
        { capabilityId: RESEARCH_SEARCH, adapterId: 'research.search.query.v1' },
      ]),
      route('research-private', 'Use the isolated private browser', 8, 'PRIVATE_BROWSER', 'HIGH', [
        { capabilityId: RESEARCH_PRIVATE_BROWSE, adapterId: 'research.private.query.v1' },
      ], true),
    ],
    expectedOutcome: 'A bounded synthesis with source and freshness evidence.',
    verificationExpectation: 'Require typed source/evidence records; do not manufacture citations.',
    permissionImplications: 'Public research is read-only. Private browsing is a separate owner-approved route.',
    maturity: 'REAL',
    allowedCapabilityPrefixes: ['research.'],
    distribution: ['CORE'],
  },
  {
    id: 'workspace.search',
    version: 1,
    name: 'Search the approved workspace',
    description: 'Find code, files, or symbols without leaving owner-approved workspace roots.',
    scope: 'WORKSPACE',
    handler: 'CAPABILITY_PLAN',
    examples: ['Search my workspace for CapabilityHost.', 'Find where the permission policy is defined.', 'Check my project for X.'],
    matchingHints: ['workspace', 'project', 'repo', 'codebase', 'local files'],
    requiredInputs: [{ id: 'query', description: 'Text, filename, or symbol to find.', required: true, smallestQuestion: 'What should I search for in the approved workspace?' }],
    optionalInputs: [],
    routes: [
      route('workspace-search', 'Search approved local workspace content', 1, 'WORKSPACE', 'READ_ONLY', [
        { capabilityId: WORKSPACE_SEARCH, adapterId: 'workspace.search.query.v1' },
      ]),
      route('workspace-current', 'Use bounded workspace intelligence', 2, 'WORKSPACE', 'READ_ONLY', [
        { capabilityId: WORKSPACE_CURRENT, adapterId: 'workspace.current.query.v1' },
      ]),
    ],
    expectedOutcome: 'Bounded local hits with document and provenance references.',
    verificationExpectation: 'Results must resolve to indexed records under the approved workspace.',
    permissionImplications: 'Read-only; workspace scope cannot be broadened by the adapter or model.',
    maturity: 'REAL',
    allowedCapabilityPrefixes: ['workspace.'],
    distribution: ['CORE'],
  },
  {
    id: 'workspace.overview',
    version: 1,
    name: 'Describe the approved codebase',
    description: 'List configured workspaces and indexed documents for a bounded overview.',
    scope: 'WORKSPACE',
    handler: 'CAPABILITY_PLAN',
    examples: ['Tell me about this codebase.', 'What is in my workspace?'],
    matchingHints: ['codebase overview', 'workspace overview'],
    requiredInputs: [],
    optionalInputs: [],
    routes: [route('workspace-overview', 'Read workspace and document inventory', 1, 'WORKSPACE', 'READ_ONLY', [
      { capabilityId: WORKSPACE_LIST },
      { capabilityId: WORKSPACE_LIST_DOCUMENTS },
    ])],
    expectedOutcome: 'A bounded overview of configured workspaces and indexed documents.',
    verificationExpectation: 'Use typed workspace inventory records only.',
    permissionImplications: 'Read-only.',
    maturity: 'REAL',
    allowedCapabilityPrefixes: ['workspace.'],
    distribution: ['CORE'],
  },
  {
    id: 'documents.analyze-basic',
    version: 1,
    name: 'Analyze an indexed text document',
    description: 'Summarize a document already indexed by Workspace Intelligence.',
    scope: 'DOCUMENT',
    handler: 'CAPABILITY_PLAN',
    examples: ['Analyze this document.', 'Summarize the current file.'],
    matchingHints: ['analyze document', 'summarize file', 'current document'],
    requiredInputs: [{ id: 'documentId', description: 'An indexed document reference.', required: true, smallestQuestion: 'Which indexed document should I analyze?' }],
    optionalInputs: [{ id: 'query', description: 'Optional focus for the analysis.', required: false }],
    routes: [route('document-workspace-current', 'Summarize the indexed document', 1, 'DOCUMENT', 'READ_ONLY', [
      { capabilityId: WORKSPACE_CURRENT, adapterId: 'workspace.current.query.v1' },
    ])],
    expectedOutcome: 'A bounded summary with document references and untrusted-content isolation.',
    verificationExpectation: 'The document reference must resolve in the approved workspace.',
    permissionImplications: 'Read-only. Unsupported binary formats still need a reviewed document provider.',
    maturity: 'PARTIAL',
    allowedCapabilityPrefixes: ['workspace.'],
    distribution: ['CORE'],
  },
  {
    id: 'system.health',
    version: 1,
    name: 'Check Jarvis health',
    description: 'Read Jarvis runtime and local system health without changing configuration.',
    scope: 'SYSTEM',
    handler: 'CAPABILITY_PLAN',
    examples: ['Is Jarvis okay?', 'What services are running?', 'Check system health.'],
    matchingHints: ['Jarvis health', 'runtime status', 'system health', 'services running'],
    requiredInputs: [],
    optionalInputs: [],
    routes: [
      route('jarvis-runtime-health', 'Read Jarvis runtime health', 1, 'SYSTEM', 'READ_ONLY', [{ capabilityId: JARVIS_RUNTIME_STATUS }]),
      route('system-telemetry', 'Read local system telemetry', 2, 'SYSTEM', 'READ_ONLY', [{ capabilityId: SYSTEM_STATUS }]),
    ],
    expectedOutcome: 'A typed health snapshot with unknown and unavailable states preserved.',
    verificationExpectation: 'Use observed runtime/provider records; do not invent hardware state.',
    permissionImplications: 'Read-only.',
    maturity: 'REAL',
    allowedCapabilityPrefixes: ['jarvis.', 'system.'],
    distribution: ['CORE'],
  },
  {
    id: 'reminders.create',
    version: 1,
    name: 'Create a reminder',
    description: 'Create one notification-only reminder from explicit owner text and time.',
    scope: 'AUTOMATION',
    handler: 'CAPABILITY_PLAN',
    examples: ['Remind me tomorrow at 3.', 'Create a reminder for Friday at 10.'],
    matchingHints: ['remind me', 'create reminder', 'เตือน'],
    requiredInputs: [
      { id: 'whenText', description: 'The explicit reminder schedule in owner text.', required: true, smallestQuestion: 'When should I remind you?' },
      { id: 'title', description: 'What the reminder is about.', required: true, smallestQuestion: 'What should I remind you about?' },
    ],
    optionalInputs: [{ id: 'message', description: 'Optional notification detail.', required: false }],
    routes: [route('reminder-create', 'Create one typed reminder', 1, 'AUTOMATION', 'LOW', [
      { capabilityId: REMINDERS_CREATE, adapterId: 'reminders.create.text.v1' },
    ])],
    expectedOutcome: 'One reminder record with a validated local schedule.',
    verificationExpectation: 'Verify the typed reminder record and next scheduled time.',
    permissionImplications: 'Low-risk mutation evaluated by ActionGate; no hidden action or external message is scheduled.',
    maturity: 'REAL',
    allowedCapabilityPrefixes: ['reminders.'],
    distribution: ['CORE'],
  },
  {
    id: 'self.capabilities',
    version: 1,
    name: 'Explain what Jarvis can do',
    description: 'Answer from Self Knowledge and current runtime evidence.',
    scope: 'SELF_KNOWLEDGE',
    handler: 'SELF_KNOWLEDGE',
    examples: [
      'What can you do?',
      'What can you do right now?',
      'What can you do after setup?',
      'What capabilities need setup?',
      'What capabilities are unavailable?',
      'What requires my permission?',
      'What goals can you handle end to end?',
    ],
    matchingHints: ['capabilities', 'what can you do', 'need setup', 'unavailable', 'permission', 'goals can you handle'],
    requiredInputs: [],
    optionalInputs: [],
    routes: [],
    expectedOutcome: 'An evidence-backed capability and goal summary.',
    verificationExpectation: 'Self Knowledge snapshot IDs and statuses are the authority.',
    permissionImplications: 'Read-only structured response.',
    maturity: 'REAL',
    allowedCapabilityPrefixes: [],
    distribution: ['CORE'],
  },
  {
    id: 'self.explain-gap',
    version: 1,
    name: 'Explain a capability gap',
    description: 'Explain why a requested objective is blocked and the smallest safe next step.',
    scope: 'SELF_KNOWLEDGE',
    handler: 'SELF_KNOWLEDGE',
    examples: ["Why can't you do this?", "Why can't you run PowerShell?", 'What do you need from me to do X?'],
    matchingHints: ['why unavailable', 'what do you need', 'capability gap', 'powershell'],
    requiredInputs: [],
    optionalInputs: [],
    routes: [],
    expectedOutcome: 'A structured blocker and next possible path.',
    verificationExpectation: 'Use the latest structured gap record, never model imagination.',
    permissionImplications: 'Read-only structured response.',
    maturity: 'REAL',
    allowedCapabilityPrefixes: [],
    distribution: ['CORE'],
  },
  {
    id: 'devices.cctv.connect',
    version: 1,
    name: 'Connect owner CCTV',
    description: 'Future owner-only local CCTV connection through a reviewed provider.',
    scope: 'OWNER_DEVICE',
    handler: 'CAPABILITY_PLAN',
    examples: ['Connect to my CCTV.', 'Open the CCTV.'],
    matchingHints: ['CCTV', 'NVR', 'RTSP', 'ONVIF'],
    requiredInputs: [{ id: 'deviceIdentity', description: 'Camera or NVR vendor/model.', required: true, smallestQuestion: 'What is the camera or NVR vendor and model?' }],
    optionalInputs: [],
    routes: [route('cctv-provider-contract', 'Use a reviewed owner CCTV provider', 1, 'OWNER_DEVICE', 'HIGH', [
      { capabilityId: 'cctv.connect' },
      { capabilityId: 'cctv.status' },
    ], true)],
    expectedOutcome: 'A locally verified read-only CCTV status/view capability.',
    verificationExpectation: 'Real provider evidence and owner-machine acceptance are required.',
    permissionImplications: 'Owner-only. VIEW does not grant CONTROL, CONFIGURE, or ADMIN.',
    maturity: 'PREPARE_CONTRACT',
    allowedCapabilityPrefixes: ['cctv.'],
    distribution: ['OWNER_ONLY', 'COMMUNITY_EXCLUDED', 'DEMO_EXCLUDED'],
  },
  {
    id: 'desktop.open-resource',
    version: 1,
    name: 'Open an allowlisted desktop resource',
    description: 'Open one allowlisted application or website. Monitor placement is optional and must resolve against real topology.',
    scope: 'DESKTOP',
    handler: 'CAPABILITY_PLAN',
    examples: ['Open Cursor.', 'Open YouTube on monitor two.', 'เปิด YouTube ที่จอ 2'],
    matchingHints: ['open', 'launch', 'monitor', 'youtube', 'cursor', 'เปิด'],
    requiredInputs: [{ id: 'resource', description: 'Allowlisted application or website.', required: true, smallestQuestion: 'Which allowlisted app or site should I open?' }],
    optionalInputs: [{ id: 'display', description: 'Verified monitor reference.', required: false }],
    routes: [
      route('open-scoped', 'Open one scoped allowlisted resource', 1, 'DESKTOP', 'LOW', [
        { capabilityId: DESKTOP_OPEN_SCOPED_RESOURCE, adapterId: 'desktop.scoped.v1' },
      ]),
      route('open-app', 'Open an allowlisted application', 2, 'DESKTOP', 'LOW', [
        { capabilityId: DESKTOP_OPEN_APPLICATION, adapterId: 'desktop.app.v1' },
      ]),
      route('open-url', 'Open an allowlisted or confirmed URL', 3, 'DESKTOP', 'LOW', [
        { capabilityId: DESKTOP_OPEN_TRUSTED_URL, adapterId: 'desktop.url.v1' },
      ]),
    ],
    expectedOutcome: 'The named allowlisted resource is opened, preferably as a dedicated managed window, with honest placement if a monitor was requested.',
    verificationExpectation: 'Launcher acceptance plus identified window handle and observed bounds on the requested display. Handler start is not window or display verification.',
    permissionImplications: 'Scoped OPEN only. Never upgrades to shell, click, type, or submit.',
    maturity: 'REAL',
    allowedCapabilityPrefixes: ['desktop.'],
    distribution: ['CORE'],
  },
];

function route(
  id: string,
  title: string,
  priority: number,
  scope: GoalRouteDefinition['scope'],
  risk: GoalRouteDefinition['risk'],
  steps: GoalRouteDefinition['steps'],
  ownerDecisionRequired = false,
): GoalRouteDefinition {
  return {
    id,
    title,
    priority,
    scope,
    risk,
    ownerDecisionRequired,
    steps,
    dependencies: steps.map(step => ({ capabilityId: step.capabilityId, relation: 'REQUIRED' as const })),
  };
}

function validateDefinition(definition: GoalDefinition): void {
  if (!definition.id.trim() || !definition.name.trim()) throw new Error('Goal definition requires id and name.');
  if (definition.handler === 'CAPABILITY_PLAN' && definition.routes.length === 0) throw new Error(`Goal ${definition.id} requires a capability route.`);
  if (definition.handler === 'SELF_KNOWLEDGE' && definition.routes.length > 0) throw new Error(`Self Knowledge goal ${definition.id} cannot execute capabilities.`);
  const allowed = definition.allowedCapabilityPrefixes;
  const routeIds = new Set<string>();
  for (const route of definition.routes) {
    if (routeIds.has(route.id)) throw new Error(`Goal ${definition.id} has duplicate route ${route.id}.`);
    routeIds.add(route.id);
    if (route.scope !== definition.scope && !route.ownerDecisionRequired) {
      throw new Error(`Goal ${definition.id} route ${route.id} changes scope without an owner decision.`);
    }
    for (const step of route.steps) {
      if (!allowed.some(prefix => step.capabilityId.startsWith(prefix))) {
        throw new Error(`Goal ${definition.id} route ${route.id} drifts to capability ${step.capabilityId}.`);
      }
    }
  }
}

function cloneDefinition(definition: GoalDefinition): GoalDefinition {
  return structuredClone(definition);
}
