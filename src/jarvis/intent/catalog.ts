import { GATED_CAPABILITY_IDS, isReadOnlyGatedCapability } from '../capabilities/actions/constants';
import type { CapabilityHost } from '../capabilities/types';
import type { CompactCapability } from './types';

const DESCRIPTIONS: Record<string, { shortDescription: string; argumentSchemaSummary: string; sideEffectClass: CompactCapability['sideEffectClass'] }> = {
  'desktop.openApplication': {
    shortDescription: 'Open an allowlisted desktop application.',
    argumentSchemaSummary: 'applicationId',
    sideEffectClass: 'LOW_RISK_ACTION',
  },
  'desktop.openProject': {
    shortDescription: 'Reveal an allowlisted project folder.',
    argumentSchemaSummary: 'projectId',
    sideEffectClass: 'LOW_RISK_ACTION',
  },
  'desktop.openTrustedUrl': {
    shortDescription: 'Open an http(s) URL after URL policy.',
    argumentSchemaSummary: 'url',
    sideEffectClass: 'CONFIRM_REQUIRED',
  },
  'desktop.openSettings': {
    shortDescription: 'Open an allowlisted Settings page.',
    argumentSchemaSummary: 'settingsId',
    sideEffectClass: 'LOW_RISK_ACTION',
  },
  'desktop.openScopedResource': {
    shortDescription: 'Open an allowlisted app or website, optionally on a verified display.',
    argumentSchemaSummary: 'kind, applicationId?, url?, display?',
    sideEffectClass: 'LOW_RISK_ACTION',
  },
  'desktop.placeWindow': {
    shortDescription: 'Move an allowlisted application window onto a verified display.',
    argumentSchemaSummary: 'applicationId, display',
    sideEffectClass: 'LOW_RISK_ACTION',
  },
  'desktop.focusWindow': {
    shortDescription: 'Focus one Jarvis-managed window.',
    argumentSchemaSummary: 'windowHandle|url|applicationId',
    sideEffectClass: 'LOW_RISK_ACTION',
  },
  'system.status': {
    shortDescription: 'Read local CPU/RAM/GPU/disk status.',
    argumentSchemaSummary: '(none)',
    sideEffectClass: 'READ_ONLY',
  },
  'system.batteryStatus': {
    shortDescription: 'Read battery status if present.',
    argumentSchemaSummary: '(none)',
    sideEffectClass: 'READ_ONLY',
  },
  'system.networkStatus': {
    shortDescription: 'Read whether a network interface is up.',
    argumentSchemaSummary: '(none)',
    sideEffectClass: 'READ_ONLY',
  },
  'applications.status': {
    shortDescription: 'Check whether an allowlisted app is installed.',
    argumentSchemaSummary: 'applicationId?',
    sideEffectClass: 'READ_ONLY',
  },
  'jarvis.runtimeStatus': {
    shortDescription: 'Read Jarvis runtime and registered service health.',
    argumentSchemaSummary: '(none)',
    sideEffectClass: 'READ_ONLY',
  },
  'jarvis.healthCheck': {
    shortDescription: 'Check one registered Jarvis service.',
    argumentSchemaSummary: 'serviceId',
    sideEffectClass: 'READ_ONLY',
  },
  'jarvis.startService': {
    shortDescription: 'Start a registered Jarvis service.',
    argumentSchemaSummary: 'serviceId',
    sideEffectClass: 'LOW_RISK_ACTION',
  },
  'jarvis.stopService': {
    shortDescription: 'Stop a Jarvis-owned service after confirmation.',
    argumentSchemaSummary: 'serviceId',
    sideEffectClass: 'CONFIRM_REQUIRED',
  },
  'jarvis.restartService': {
    shortDescription: 'Restart a Jarvis-owned service after confirmation.',
    argumentSchemaSummary: 'serviceId',
    sideEffectClass: 'CONFIRM_REQUIRED',
  },
  'media.createVideo': {
    shortDescription: 'Create a local multi-shot video from an owner storyline using the shared AI Media Bridge.',
    argumentSchemaSummary: 'storyline, title?, targetDurationSeconds?, aspectRatio?, style?, fps?, shotCount?',
    sideEffectClass: 'LOW_RISK_ACTION',
  },
  'media.status': {
    shortDescription: 'Read render progress for a shared media project.',
    argumentSchemaSummary: 'projectId',
    sideEffectClass: 'READ_ONLY',
  },
  'media.cancel': {
    shortDescription: 'Cancel queued or running jobs owned by one media project.',
    argumentSchemaSummary: 'projectId',
    sideEffectClass: 'LOW_RISK_ACTION',
  },
  'media.getOutput': {
    shortDescription: 'Collect completed media outputs and optionally stitch final.mp4.',
    argumentSchemaSummary: 'projectId, stitch?',
    sideEffectClass: 'LOW_RISK_ACTION',
  },
  'reminders.create': {
    shortDescription: 'Create a notification-only reminder.',
    argumentSchemaSummary: 'whenText, title, message?',
    sideEffectClass: 'LOW_RISK_ACTION',
  },
  'reminders.list': {
    shortDescription: 'List active reminders.',
    argumentSchemaSummary: '(none)',
    sideEffectClass: 'READ_ONLY',
  },
  'reminders.cancel': {
    shortDescription: 'Cancel a reminder by id or query.',
    argumentSchemaSummary: 'reminderId? query?',
    sideEffectClass: 'LOW_RISK_ACTION',
  },
  'reminders.reschedule': {
    shortDescription: 'Move a reminder in time.',
    argumentSchemaSummary: 'reminderId? query? whenText',
    sideEffectClass: 'LOW_RISK_ACTION',
  },
  'reminders.get': {
    shortDescription: 'Read one reminder by id.',
    argumentSchemaSummary: 'reminderId',
    sideEffectClass: 'READ_ONLY',
  },
  'reminders.pause': {
    shortDescription: 'Pause a reminder.',
    argumentSchemaSummary: 'reminderId? query?',
    sideEffectClass: 'LOW_RISK_ACTION',
  },
  'reminders.resume': {
    shortDescription: 'Resume a paused reminder.',
    argumentSchemaSummary: 'reminderId? query?',
    sideEffectClass: 'LOW_RISK_ACTION',
  },
  'reminders.complete': {
    shortDescription: 'Mark a due reminder complete.',
    argumentSchemaSummary: 'reminderId, occurrenceAt',
    sideEffectClass: 'LOW_RISK_ACTION',
  },
  'reminders.dismiss': {
    shortDescription: 'Dismiss a due reminder.',
    argumentSchemaSummary: 'reminderId, occurrenceAt',
    sideEffectClass: 'LOW_RISK_ACTION',
  },
  'reminders.snooze': {
    shortDescription: 'Snooze a due reminder.',
    argumentSchemaSummary: 'reminderId, occurrenceAt, minutes?',
    sideEffectClass: 'LOW_RISK_ACTION',
  },
  'research.current': {
    shortDescription: 'Read-only public web research for current information.',
    argumentSchemaSummary: 'query, officialOnly?, freshness?, compare?, reuseLast?',
    sideEffectClass: 'READ_ONLY',
  },
  'research.search': {
    shortDescription: 'Search public sources only.',
    argumentSchemaSummary: 'query, maxResults?, freshness?',
    sideEffectClass: 'READ_ONLY',
  },
  'research.fetchSource': {
    shortDescription: 'Fetch one public source by sourceId or validated URL.',
    argumentSchemaSummary: 'sourceId? url?',
    sideEffectClass: 'READ_ONLY',
  },
  'research.compareSources': {
    shortDescription: 'Compare already-selected public sources.',
    argumentSchemaSummary: 'sourceIds?',
    sideEffectClass: 'READ_ONLY',
  },
  'research.getSource': {
    shortDescription: 'Read a cached source record.',
    argumentSchemaSummary: 'sourceId',
    sideEffectClass: 'READ_ONLY',
  },
  'research.privateBrowse': {
    shortDescription: 'Isolated private browser research. Fails closed without Whonix. Never uses the owner browser.',
    argumentSchemaSummary: 'url? query? depth?',
    sideEffectClass: 'CONFIRM_REQUIRED',
  },
  'workspace.listWorkspaces': {
    shortDescription: 'List owner-approved local workspaces.',
    argumentSchemaSummary: '(none)',
    sideEffectClass: 'READ_ONLY',
  },
  'workspace.listDocuments': {
    shortDescription: 'List indexed documents in a registered workspace.',
    argumentSchemaSummary: 'workspaceId? query?',
    sideEffectClass: 'READ_ONLY',
  },
  'workspace.search': {
    shortDescription: 'Search approved local files by name or content.',
    argumentSchemaSummary: 'query, workspaceId?',
    sideEffectClass: 'READ_ONLY',
  },
  'workspace.getDocument': {
    shortDescription: 'Read a bounded local document by documentId.',
    argumentSchemaSummary: 'documentId',
    sideEffectClass: 'READ_ONLY',
  },
  'workspace.getExcerpt': {
    shortDescription: 'Read a local excerpt by documentId.',
    argumentSchemaSummary: 'documentId, query?',
    sideEffectClass: 'READ_ONLY',
  },
  'workspace.findSymbol': {
    shortDescription: 'Find a code symbol in the approved workspace.',
    argumentSchemaSummary: 'query, workspaceId?',
    sideEffectClass: 'READ_ONLY',
  },
  'workspace.compareDocuments': {
    shortDescription: 'Compare two approved local documents.',
    argumentSchemaSummary: 'documentIds? leftQuery? rightQuery?',
    sideEffectClass: 'READ_ONLY',
  },
  'workspace.getMetadata': {
    shortDescription: 'Read local document metadata.',
    argumentSchemaSummary: 'documentId',
    sideEffectClass: 'READ_ONLY',
  },
  'workspace.current': {
    shortDescription: 'Search, retrieve, summarize, or compare approved local files.',
    argumentSchemaSummary: 'query?, documentId?, mode?, hybridWeb?',
    sideEffectClass: 'READ_ONLY',
  },
  'workspace.refreshIndex': {
    shortDescription: 'Refresh the index of a registered workspace.',
    argumentSchemaSummary: 'workspaceId?',
    sideEffectClass: 'READ_ONLY',
  },
  'software.planBuild': {
    shortDescription: 'Create a structured software/website plan without writing files.',
    argumentSchemaSummary: 'brief, planId?, merge?',
    sideEffectClass: 'READ_ONLY',
  },
  'software.applyBuild': {
    shortDescription: 'Write an approved plan into the Jarvis sandbox after owner permission.',
    argumentSchemaSummary: 'planId?, brief?, merge?',
    sideEffectClass: 'CONFIRM_REQUIRED',
  },
  'project.createWorkspace': {
    shortDescription: 'Create a goal-scoped project folder under the edition sandbox workspace.',
    argumentSchemaSummary: 'slug',
    sideEffectClass: 'CONFIRM_REQUIRED',
  },
  'project.writeFile': {
    shortDescription: 'Write one relative file inside the project workspace.',
    argumentSchemaSummary: 'slug, relativePath, contents',
    sideEffectClass: 'CONFIRM_REQUIRED',
  },
  'project.readFile': {
    shortDescription: 'Read one relative file inside the project workspace.',
    argumentSchemaSummary: 'slug, relativePath',
    sideEffectClass: 'READ_ONLY',
  },
  'project.listFiles': {
    shortDescription: 'List files inside the project workspace.',
    argumentSchemaSummary: 'slug',
    sideEffectClass: 'READ_ONLY',
  },
  'project.installDependencies': {
    shortDescription: 'Run npm install or npm ci inside the exact project workspace.',
    argumentSchemaSummary: 'slug, mode?',
    sideEffectClass: 'CONFIRM_REQUIRED',
  },
  'project.runScript': {
    shortDescription: 'Run a registered package.json script. No raw shell.',
    argumentSchemaSummary: 'slug, script',
    sideEffectClass: 'CONFIRM_REQUIRED',
  },
  'project.runTests': {
    shortDescription: 'Run the registered test script or bounded Node smoke test.',
    argumentSchemaSummary: 'slug',
    sideEffectClass: 'CONFIRM_REQUIRED',
  },
  'project.build': {
    shortDescription: 'Run the registered build script inside the project workspace.',
    argumentSchemaSummary: 'slug',
    sideEffectClass: 'CONFIRM_REQUIRED',
  },
  'project.startDevServer': {
    shortDescription: 'Start the registered dev script on 127.0.0.1 only.',
    argumentSchemaSummary: 'slug',
    sideEffectClass: 'CONFIRM_REQUIRED',
  },
  'project.stopDevServer': {
    shortDescription: 'Stop a Jarvis-owned localhost preview process.',
    argumentSchemaSummary: 'slug',
    sideEffectClass: 'CONFIRM_REQUIRED',
  },
  'project.inspectArtifact': {
    shortDescription: 'Inspect generated project files without opening arbitrary paths.',
    argumentSchemaSummary: 'slug',
    sideEffectClass: 'READ_ONLY',
  },
};

export function compactCapabilityCatalog(host?: CapabilityHost, availability: Record<string, CompactCapability['availability']> = {}): CompactCapability[] {
  const ids = host?.list().map(item => item.id) ?? [...GATED_CAPABILITY_IDS];
  return ids.flatMap(id => {
    const meta = DESCRIPTIONS[id];
    if (!meta) return [];
    return [{
      id,
      shortDescription: meta.shortDescription,
      argumentSchemaSummary: meta.argumentSchemaSummary,
      sideEffectClass: isReadOnlyGatedCapability(id) ? 'READ_ONLY' : meta.sideEffectClass,
      availability: availability[id] ?? 'unknown',
    }];
  });
}

export function catalogIds(catalog: CompactCapability[]): Set<string> {
  return new Set(catalog.map(item => item.id));
}

export function catalogHas(catalog: CompactCapability[], id: string): boolean {
  return catalog.some(item => item.id === id);
}
