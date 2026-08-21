import { useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Ban,
  BookOpenCheck,
  Box,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Clock3,
  CloudOff,
  Code2,
  Cpu,
  FileSearch,
  Gauge,
  HardDrive,
  Info,
  Laptop,
  MemoryStick,
  Network,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  TriangleAlert,
  WandSparkles,
  Wifi,
  XCircle,
} from 'lucide-react';
import type { HostSecuritySnapshot } from '../../security/types';
import type { CommandCenterClientSnapshot } from '../../standalone/commandCenterView';
import type { GraphSnapshot } from '../graph/graphTypes';
import {
  formatMb,
  formatPct,
  labServiceShortName,
  labServiceStateLabel,
  reminderLocalTime,
  reminderScheduleTag,
  researchClassLabel,
  type LabResearchSnapshot,
  type LabServiceView,
  type LabWorkspaceSnapshot,
  type NightAgentView,
  type ReminderSnapshotView,
  type SystemHealthView,
} from '../labViewModels';
import type { JarvisPageId } from './JarvisOperatingShell';
import { EmptyState, ExpertDetails, PageHeader, PreparedFeature, SectionCard } from './JarvisOperatingShell';
import { ActivePrivilegeLease, PermissionCard, TrustedOperatorNote, VerificationReport, type RiskBriefModel } from './TrustedOperator';

export type CapabilityCatalogItem = {
  id: string;
  description?: string;
  providerKind: string;
  untrustedOutput: boolean;
  requiredService: string;
  sideEffect?: 'read' | 'write';
};

export type PersonalAiRuntimeStatus = {
  ready: boolean;
  coreState: string;
  memory: { attached: boolean; schemaVersion?: number };
  llm?: { enabled?: boolean; reachable?: boolean; model?: string; loaded?: boolean };
  stt?: { reachable?: boolean; model?: string; reason?: string };
  runtime?: { id?: string; keepAlive?: string | number; contextTokens?: number };
  services?: LabServiceView[];
  presentation?: {
    persona: { id: string; available: boolean; mode: string };
    voice: { profileId: string; available: boolean; speechActive: boolean; reason?: string };
  };
  capabilities?: { attached: boolean; ids: string[]; catalog?: CapabilityCatalogItem[] };
};

export type ToolActivityItem = {
  id: string;
  status: string;
  failed: boolean;
  provider?: string;
  untrusted: boolean;
  summary?: string;
  sourceUrls: string[];
};

export type ConversationView = {
  answer?: string;
  draft?: string;
  busy: boolean;
  error?: string | null;
  route?: { route: string; socialAction: string; agentic: boolean; reason: string };
  taskId?: string;
  workOutcome?: { outcome: string; text: string };
  heard?: string | null;
  timingsLine?: string | null;
  memoryRefs: Array<{ canonicalId: string; type?: string; confidence?: number; sourceRefs?: string[]; status?: string; domain?: string }>;
  uncertainty: string[];
  tools: ToolActivityItem[];
  actionResults: Array<{ name: string; status: string; capabilityId?: string; risk?: string; summary?: string }>;
  modelMetrics?: { promptTokens?: number; outputTokens?: number; tokensPerSec?: number; promptTokensPerSec?: number; loadMs?: number };
};

type Props = {
  page: JarvisPageId;
  status: PersonalAiRuntimeStatus | null;
  system: SystemHealthView | null;
  security: HostSecuritySnapshot | null;
  night: NightAgentView | null;
  reminders: ReminderSnapshotView | null;
  research: LabResearchSnapshot | null;
  workspace: LabWorkspaceSnapshot | null;
  commandCenter: CommandCenterClientSnapshot | null;
  graph: GraphSnapshot | null;
  coreTitle: string;
  coreSubtitle: string;
  coreVisual: ReactNode;
  composer: ReactNode;
  conversation: ConversationView;
  settings: ReactNode;
  memoryExplorer: ReactNode;
  pendingRisk: RiskBriefModel | null;
  busy: boolean;
  selectedSourceId: string | null;
  selectedDocumentId: string | null;
  onNavigate: (page: JarvisPageId) => void;
  onSelectSource: (id: string) => void;
  onSelectDocument: (id: string) => void;
  onRefreshWorkspace: () => void;
  onTask: (objective: string) => void;
  onCancelTask: () => void;
  onGrantTask: () => void;
  onDemo: (id: 'research' | 'coding' | 'evolution' | 'monitoring') => void;
  onNight: (action: 'run' | 'resume' | 'pause' | 'cancel') => void;
  onSimulation: (enabled: boolean) => void;
  onReminder: (capabilityId: string, input: Record<string, unknown>) => void;
  onAckReminder: (action: 'dismiss' | 'complete' | 'snooze', delivery: ReminderSnapshotView['pendingDeliveries'][number], minutes?: number) => void;
  onService: (capabilityId: 'jarvis.startService' | 'jarvis.restartService', serviceId: string) => void;
};

export default function JarvisPages(props: Props) {
  switch (props.page) {
    case 'home': return <HomePage {...props} />;
    case 'assistant': return <AssistantPage {...props} />;
    case 'tasks': return <TasksPage {...props} />;
    case 'research': return <ResearchPage {...props} />;
    case 'documents': return <DocumentsPage />;
    case 'workspace': return <WorkspacePage {...props} />;
    case 'content': return <ContentPage />;
    case 'devices': return <DevicesPage {...props} />;
    case 'automations': return <AutomationsPage {...props} />;
    case 'evolution': return <EvolutionPage {...props} />;
    case 'security': return <SecurityPage {...props} />;
    case 'system': return <SystemPage {...props} />;
    case 'activity': return <ActivityPage {...props} />;
    case 'settings': return <SettingsPage {...props} />;
  }
}

function HomePage(props: Props) {
  const task = props.commandCenter?.task;
  const waiting = Boolean(task?.waitingPermission || props.pendingRisk);
  const problems = [
    props.status?.llm?.reachable === false ? 'Model runtime is unavailable' : null,
    props.conversation.error || null,
    props.security && Object.values(pickProtections(props.security)).some(item => item.state === 'OFF') ? 'A host protection reports OFF' : null,
  ].filter((item): item is string => Boolean(item));
  const devices = props.commandCenter?.devices ?? [];
  const deviceCount = devices.filter(device => device.status === 'online').length;
  const devicesSimulated = deviceCount > 0 && devices.filter(device => device.status === 'online').every(device => device.simulated);
  const notifications = props.commandCenter?.notifications.slice(-3).reverse() ?? [];
  const summary = [
    { label: 'Model', value: props.status?.llm?.reachable === true ? 'Ready' : props.status?.llm?.reachable === false ? 'Unavailable' : props.status ? 'Unknown' : 'Checking', tone: props.status?.llm?.reachable === true ? 'green' : 'amber' },
    { label: 'Memory', value: props.status ? (props.status.memory.attached ? 'Healthy' : 'Not attached') : 'Checking', tone: props.status?.memory.attached ? 'green' : 'amber' },
    { label: 'Security', value: props.security ? securitySummary(props.security) : 'Checking', tone: props.security && securitySummary(props.security) === 'Protected' ? 'green' : 'amber' },
    { label: 'Devices', value: devicesSimulated ? `${deviceCount} simulated` : `${deviceCount} online`, tone: devicesSimulated ? 'violet' : deviceCount > 0 ? 'cyan' : 'neutral' },
    { label: 'Tasks', value: task ? humanTaskState(task.status) : 'Idle', tone: task?.active ? 'cyan' : waiting ? 'amber' : 'neutral' },
  ] as const;
  return (
    <div className="jai-page jai-page--home">
      <PageHeader eyebrow="JARVIS PERSONAL AI" title="At a glance" description="Everything that needs your attention, and nothing that does not." />
      <div className="jai-home-grid">
        <SectionCard title="Jarvis Core" description="Driven by observable runtime state" tone={props.coreTitle === 'error' ? 'red' : props.coreTitle === 'degraded' ? 'amber' : 'cyan'} className="jai-core-card">
          <div className="jai-core-card__visual">{props.coreVisual}</div>
          <div className="jai-core-card__copy"><span className="jai-eyebrow">Current state</span><h2>{humanCoreState(props.coreTitle)}</h2><p>{props.coreSubtitle}</p></div>
        </SectionCard>

        <SectionCard title="What’s happening now" description="Current work and owner attention" tone={waiting ? 'amber' : task?.active ? 'cyan' : 'neutral'}>
          {task ? (
            <button type="button" className="jai-current-task" onClick={() => props.onNavigate('tasks')}>
              <span className={`jai-task-orb is-${task.waitingPermission ? 'waiting' : task.active ? 'active' : 'done'}`} />
              <span><strong>{task.objective}</strong><small>{humanTaskState(task.status)} · {task.steps.filter(step => step.state === 'done').length}/{task.steps.length} steps</small></span>
              <ChevronRight size={18} />
            </button>
          ) : <EmptyState title="Nothing is running" detail="Jarvis is ready for a question or a task." />}
          {waiting ? <div className="jai-attention"><AlertTriangle size={18} /><span><strong>Owner decision required</strong><small>Review the scoped permission before Jarvis continues.</small></span><button type="button" onClick={() => props.onNavigate('security')}>Review</button></div> : null}
          {problems.map(problem => <div className="jai-alert" key={problem}><TriangleAlert size={17} /><span>{problem}</span></div>)}
          {notifications.map(notification => <div className={notification.severity === 'critical' ? 'jai-alert' : 'jai-attention'} key={notification.id}><TriangleAlert size={17} /><span><strong>{notification.summary}</strong><small>{notification.simulated ? 'Simulation · no live device effect' : 'Proactive alert'}</small></span></div>)}
          {!waiting && problems.length === 0 && !task?.active ? <TrustedOperatorNote>No urgent actions or security warnings are waiting.</TrustedOperatorNote> : null}
        </SectionCard>
      </div>

      <div className="jai-status-grid">
        {summary.map(item => <article key={item.label} className={`jai-summary jai-summary--${item.tone}`}><span>{item.label}</span><strong>{item.value}</strong><button type="button" onClick={() => props.onNavigate(summaryDestination(item.label))}>View details</button></article>)}
      </div>

      <SectionCard title="Ask Jarvis" description="Conversation, research, or a clearly scoped task" tone="cyan" className="jai-home-ask">
        {props.composer}
      </SectionCard>
    </div>
  );
}

function AssistantPage(props: Props) {
  const hasActivity = props.conversation.tools.length > 0 || props.conversation.actionResults.length > 0 || props.conversation.route;
  return (
    <div className="jai-page">
      <PageHeader eyebrow="CONVERSATION FIRST" title="Assistant" description="Talk naturally. Jarvis shows capability use without exposing hidden reasoning." />
      <div className="jai-assistant-grid">
        <section className="jai-conversation">
          <div className="jai-message jai-message--jarvis">
            <span className="jai-avatar"><Sparkles size={18} /></span>
            <div>
              <small>Jarvis</small>
              {props.conversation.draft || props.conversation.answer
                ? <p>{props.conversation.draft || props.conversation.answer}</p>
                : <p className="jai-muted">Ready when you are.</p>}
              {props.conversation.workOutcome ? <span className="jai-badge jai-badge--neutral">{props.conversation.workOutcome.outcome}</span> : null}
            </div>
          </div>
          {hasActivity ? (
            <div className="jai-activity-card">
              <Activity size={17} />
              <span><strong>{activitySummary(props.conversation)}</strong><small>{props.conversation.tools.length} tools · {props.conversation.memoryRefs.length} memory references</small></span>
              {props.conversation.route?.agentic ? <span className="jai-badge jai-badge--neutral">Task routed</span> : null}
            </div>
          ) : null}
          {props.conversation.heard ? <p className="jai-transcript"><strong>Heard</strong> {props.conversation.heard}</p> : null}
          {props.conversation.error ? <p className="jai-inline-error" role="alert"><XCircle size={17} /> {props.conversation.error}</p> : null}
          <div className="jai-assistant-composer">{props.composer}</div>
        </section>
        <aside className="jai-assistant-side">
          <SectionCard title="Current activity" description="Observable actions only" tone={props.conversation.busy ? 'cyan' : 'neutral'}>
            {!hasActivity ? <EmptyState title="No capability activity" detail="A normal conversation stays simple." /> : (
              <ul className="jai-compact-list">
                {props.conversation.tools.slice(0, 5).map(tool => <li key={tool.id} className={tool.failed ? 'is-error' : ''}><span>{tool.failed ? <XCircle size={16} /> : <CheckCircle2 size={16} />}</span><div><strong>{humanCapability(tool.id)}</strong><small>{tool.status}{tool.untrusted ? ' · untrusted data' : ''}</small></div></li>)}
                {props.conversation.actionResults.slice(0, 4).map(action => <li key={`${action.name}-${action.status}`}><span><ShieldCheck size={16} /></span><div><strong>{humanCapability(action.capabilityId || action.name)}</strong><small>{action.status}{action.risk ? ` · ${action.risk.replaceAll('_', ' ')}` : ''}</small></div></li>)}
              </ul>
            )}
          </SectionCard>
          <ExpertDetails summary="Turn and memory details">
            <dl className="jai-data-list">
              <div><dt>Route</dt><dd>{props.conversation.route?.route || 'Conversation'}</dd></div>
              <div><dt>Social action</dt><dd>{props.conversation.route?.socialAction || 'SPEAK'}</dd></div>
              <div><dt>Task ID</dt><dd><code>{props.conversation.taskId || 'none'}</code></dd></div>
              <div><dt>Timings</dt><dd>{props.conversation.timingsLine || 'not recorded'}</dd></div>
            </dl>
            {props.conversation.memoryRefs.length ? <ul className="jai-code-list">{props.conversation.memoryRefs.map(ref => <li key={ref.canonicalId}><code>{ref.canonicalId}</code><span>{ref.type || 'memory'} · {ref.status || 'active'}</span></li>)}</ul> : <p className="jai-muted">No canonical memory attached to this turn.</p>}
            {props.memoryExplorer}
          </ExpertDetails>
        </aside>
      </div>
    </div>
  );
}

function TasksPage(props: Props) {
  const snapshot = props.commandCenter;
  const task = snapshot?.task;
  const counts = countTaskStates(snapshot);
  return (
    <div className="jai-page">
      <PageHeader eyebrow="WORKAGENT" title="Task Center" description="Plans, permissions, evidence, verification, and recovery in one place." actions={<span className="jai-badge jai-badge--neutral">{snapshot?.simulationMode ? 'Simulation enabled' : 'Real task route'}</span>} />
      <div className="jai-task-tabs" aria-label="Task status summary">
        {(['ACTIVE', 'QUEUED', 'WAITING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'] as const).map(label => <span key={label}><strong>{counts[label]}</strong>{label.toLowerCase()}</span>)}
      </div>
      <div className="jai-task-layout">
        <SectionCard title="Tasks" description="Current and recent objectives" tone="neutral">
          <TaskForm busy={props.busy} onTask={props.onTask} />
          <ul className="jai-task-list">
            {task ? <li className="is-selected"><span className={`jai-task-orb is-${task.waitingPermission ? 'waiting' : task.active ? 'active' : 'done'}`} /><div><strong>{task.objective}</strong><small>{humanTaskState(task.status)}</small></div></li> : null}
            {snapshot?.recentTasks.filter(item => item.id !== task?.id).map(item => <li key={item.id}><span className="jai-task-orb" /><div><strong>{item.objective}</strong><small>{humanTaskState(item.status)}{item.simulated ? ' · simulation' : ''}</small></div></li>)}
            {!task && !snapshot?.recentTasks.length ? <li><EmptyState title="No tasks yet" detail="Start a scoped objective above." /></li> : null}
          </ul>
        </SectionCard>
        <div className="jai-task-detail">
          <SectionCard title="Selected task" description={task ? humanTaskState(task.status) : 'No task selected'} tone={task?.waitingPermission ? 'amber' : task?.active ? 'cyan' : 'neutral'}>
            {!task ? <EmptyState title="Select or start a task" detail="The plan and evidence will appear here." /> : (
              <>
                <div className="jai-task-objective"><span>Objective</span><h3>{task.objective}</h3></div>
                <div className="jai-task-meta"><span><small>Capabilities</small><strong>{task.steps.filter(step => step.capability).length ? task.steps.filter(step => step.capability).map(step => humanCapability(step.capability!)).join(' · ') : 'No typed capability declared'}</strong></span><span><small>Risk / permission</small><strong>{task.waitingPermission ? 'Owner approval required' : 'Policy enforced at each step'}</strong></span><span><small>Rollback</small><strong>Not declared in task snapshot</strong></span></div>
                <ol className="jai-plan">
                  {task.steps.map(step => <li key={step.id} className={`is-${step.state}`}><span>{step.index}</span><div><strong>{step.title}</strong>{step.summary ? <small>{step.summary}</small> : null}</div>{step.state === 'done' ? <Check size={16} /> : step.state === 'active' ? <RefreshCw className="is-spinning" size={16} /> : step.state === 'failed' ? <XCircle size={16} /> : <CircleDashed size={16} />}</li>)}
                </ol>
                <PermissionCard snapshot={snapshot} busy={props.busy} onDeny={props.onCancelTask} onAllow={props.onGrantTask} />
                {task.active && !task.waitingPermission ? <div className="jai-action-row"><button type="button" className="jai-button jai-button--danger" disabled={props.busy} onClick={props.onCancelTask}><Square size={15} /> Cancel task</button><button type="button" className="jai-button" disabled title="Pause/resume contract not exposed by the current HTTP API"><Pause size={15} /> Pause · prepared</button></div> : null}
              </>
            )}
          </SectionCard>
          <SectionCard title="Verification" description="A command exit code alone is not success" tone="green"><VerificationReport task={task ?? null} /></SectionCard>
          <ExpertDetails summary="Task IDs, capability IDs, and simulation demos">
            {task ? <dl className="jai-data-list"><div><dt>Task ID</dt><dd><code>{task.id}</code></dd></div><div><dt>Status</dt><dd>{task.status}</dd></div><div><dt>Capability IDs</dt><dd>{task.steps.some(step => step.capability) ? task.steps.filter(step => step.capability).map(step => <code key={step.id}>{step.capability} </code>) : 'none'}</dd></div><div><dt>Errors</dt><dd>{task.errors.join(' · ') || 'none'}</dd></div><div><dt>Recovery</dt><dd>Retry/cancel state is recorded; no general rollback contract is exposed.</dd></div></dl> : null}
            <p className="jai-muted">Demos create tagged simulation data. They do not operate owner hardware.</p>
            <div className="jai-action-row">{(['research', 'coding', 'evolution', 'monitoring'] as const).map(id => <button type="button" className="jai-button" key={id} disabled={props.busy} onClick={() => props.onDemo(id)}>{id}</button>)}</div>
          </ExpertDetails>
        </div>
      </div>
    </div>
  );
}

function ResearchPage(props: Props) {
  const last = props.research?.last;
  const source = last?.sources.find(item => item.sourceId === props.selectedSourceId) ?? last?.sources[0];
  return (
    <div className="jai-page">
      <PageHeader eyebrow="SOURCE INTELLIGENCE" title="Research Center" description="Questions, sources, evidence, conflicts, freshness, and citations." actions={<button type="button" className="jai-button jai-button--primary" onClick={() => props.onNavigate('assistant')}><Search size={16} /> Start research</button>} />
      <div className="jai-research-overview">
        <SectionCard title="Current research" description={props.research?.healthy ? 'Public web provider ready' : props.research?.reason || 'Not configured'} tone={props.research?.healthy ? 'cyan' : 'amber'}>
          {last ? <><span className="jai-eyebrow">Research question</span><h3 className="jai-feature-title">{last.query}</h3><div className="jai-stat-row"><span><strong>{last.sources.length}</strong> sources</span><span><strong>{last.evidence.length}</strong> evidence items</span><span><strong>{last.cached ? 'Cached' : 'Fresh'}</strong> retrieval</span></div></> : <EmptyState title="No research session" detail="Ask Jarvis to research a current topic." />}
        </SectionCard>
        <SectionCard title="Research depth" description="Owner-defined in Security / Settings" tone="neutral"><div className="jai-depth"><span>Quick</span><span className={props.commandCenter?.control.researchDepth === 'standard' ? 'is-active' : ''}>Standard</span><span>Deep</span><span>Forensic</span></div><p className="jai-muted">Current: {props.commandCenter?.control.researchDepth || 'standard'}</p></SectionCard>
      </div>
      <div className="jai-two-column">
        <SectionCard title="Sources" description="Trust class and freshness first" tone="neutral">
          {!last?.sources.length ? <EmptyState title="No sources" detail="No source graph is fabricated before research runs." /> : <ul className="jai-source-list">{last.sources.map(item => <li key={item.sourceId}><button type="button" className={source?.sourceId === item.sourceId ? 'is-selected' : ''} onClick={() => props.onSelectSource(item.sourceId)}><span className="jai-source-favicon">{item.domain.slice(0, 1).toUpperCase()}</span><span><strong>{item.title}</strong><small>{item.domain} · {researchClassLabel(item.sourceClass)} · {item.publishedAt ? item.publishedAt.slice(0, 10) : 'published unknown'}</small></span><ChevronRight size={16} /></button></li>)}</ul>}
        </SectionCard>
        <SectionCard title="Evidence inspector" description="Document text is untrusted data" tone="cyan">
          {!source ? <EmptyState title="Select a source" detail="Evidence and provenance will appear here." /> : <><h3 className="jai-feature-title">{source.title}</h3><a href={source.canonicalUrl || source.url} target="_blank" rel="noreferrer">{source.canonicalUrl || source.url}</a><ul className="jai-claim-list">{last?.evidence.filter(item => item.sourceId === source.sourceId).map(item => <li key={item.evidenceId}><BookOpenCheck size={16} /><span>{item.excerpt}</span></li>)}</ul><ExpertDetails summary="Provenance"><dl className="jai-data-list"><div><dt>Source ID</dt><dd><code>{source.sourceId}</code></dd></div><div><dt>Fetched</dt><dd>{source.fetchedAt || 'unknown'}</dd></div><div><dt>Status</dt><dd>{source.status}</dd></div></dl></ExpertDetails></>}
        </SectionCard>
      </div>
      {last?.uncertainty.length ? <SectionCard title="Conflicts and uncertainty" tone="amber"><ul className="jai-bullet-list">{last.uncertainty.map(item => <li key={item}>{item}</li>)}</ul></SectionCard> : null}
      <div className="jai-prepared-grid"><PreparedFeature label="PREPARED" title="Social Intelligence" detail="Provider discovery catalog for official, local, and policy-reviewed video/social sources." next="video-scraping-apis remains catalog information; no bulk install." /><PreparedFeature label="BLOCKED_LOCAL_ACCEPTANCE" title="Private Browser" detail="Fail-closed Whonix route must be verified on the owner machine." next="Host Chrome and Edge are never substituted." /></div>
    </div>
  );
}

function DocumentsPage() {
  return (
    <div className="jai-page">
      <PageHeader eyebrow="JF-020 · PREPARE_CONTRACT" title="Document Intelligence" description="Structured local parsing with provenance. Documents never gain execution authority." />
      <SectionCard title="Analyze a document" description="Provider is not configured on this branch" tone="neutral"><div className="jai-dropzone" aria-disabled="true"><FileSearch size={32} /><strong>Local document intake prepared</strong><span>PDF · image · DOCX · PPTX · XLSX</span><button type="button" className="jai-button" disabled>Choose document · not configured</button></div></SectionCard>
      <div className="jai-prepared-grid"><PreparedFeature label="PREPARED" title="MinerU provider contract" detail="document.parse → CapabilityHost → DocumentProvider → MinerUProvider." next="Local parsing preferred; private files are not sent to cloud by default." /><PreparedFeature label="NOT CONFIGURED" title="Canonical document model" detail="Pages, sections, headings, tables, formulas, images, OCR text, source positions, and provenance." /><PreparedFeature label="PREPARED" title="Prompt-injection boundary" detail="A document saying ‘run PowerShell’ remains untrusted content and receives no authority." /></div>
    </div>
  );
}

function WorkspacePage(props: Props) {
  const last = props.workspace?.last;
  const selected = last?.documents.find(item => item.documentId === props.selectedDocumentId) ?? last?.documents[0];
  return (
    <div className="jai-page">
      <PageHeader eyebrow="LOCAL WORKSPACE" title={props.workspace?.displayName || 'Workspace Intelligence'} description="Read-only project search, symbols, evidence, and scoped metrics." actions={<button type="button" className="jai-button" disabled={!props.workspace?.attached || props.busy} onClick={props.onRefreshWorkspace}><RefreshCw size={16} /> Refresh index</button>} />
      <div className="jai-status-grid jai-status-grid--four"><Metric label="Documents" value={String(props.workspace?.documentCount ?? 0)} detail="indexed" /><Metric label="Index" value={props.workspace?.indexStatus || 'unavailable'} detail={props.workspace?.healthy ? 'healthy' : props.workspace?.reason || 'not attached'} /><Metric label="Changed" value={String(props.workspace?.changedCount ?? 0)} detail="since last refresh" /><Metric label="Scope" value="Read only" detail="no path authority" /></div>
      <div className="jai-two-column">
        <SectionCard title="Workspace results" description={last ? `Query: ${last.query}` : 'No current query'} tone="neutral">
          {!last?.documents.length ? <EmptyState title="No workspace results" detail="Ask Jarvis to find a file, symbol, or concept." /> : <ul className="jai-source-list">{last.documents.map(doc => <li key={doc.documentId}><button type="button" className={selected?.documentId === doc.documentId ? 'is-selected' : ''} onClick={() => props.onSelectDocument(doc.documentId)}><Code2 size={18} /><span><strong>{doc.displayName}</strong><small>{doc.relativePath}{doc.stale ? ' · stale' : ''}</small></span><ChevronRight size={16} /></button></li>)}</ul>}
        </SectionCard>
        <SectionCard title="Document context" description="Local evidence with source positions" tone="cyan">
          {!selected ? <EmptyState title="Select a result" detail="Excerpts will appear here." /> : <><h3 className="jai-feature-title">{selected.displayName}</h3><p className="jai-muted">{selected.relativePath}</p><ul className="jai-claim-list">{last?.evidence.filter(item => item.documentId === selected.documentId).map(item => <li key={item.evidenceId}><Code2 size={16} /><span>{item.excerpt}<small>{typeof item.lineStart === 'number' ? `Lines ${item.lineStart}–${item.lineEnd ?? item.lineStart}` : 'Excerpt'}</small></span></li>)}</ul><ExpertDetails summary="Document identifiers"><code>{selected.documentId}</code><p>{selected.modifiedAt} · {selected.indexStatus}</p></ExpertDetails></>}
        </SectionCard>
      </div>
      <div className="jai-prepared-grid"><PreparedFeature label="PREPARED" title="Workspace Metrics · Tokei" detail="Typed workspace.metrics provider for language distribution, LOC, comments, blanks, and scope estimation." next="No unrestricted shell and no install outside policy." /><PreparedFeature label="REFERENCE ONLY" title="OpenHarness patterns" detail="Session resume, dry-run, tool lifecycle, diagnostics, and skill packaging remain architecture references." /><PreparedFeature label="REFERENCE ONLY" title="Awesome LLM Apps" detail="Pattern catalog only; repositories are not bulk-installed." /></div>
    </div>
  );
}

function ContentPage() {
  const stages = ['Idea', 'Trend research', 'Research', 'Script', 'Voice', 'Visual assets', 'Video assembly', 'Quality review', 'Title / thumbnail / SEO', 'Owner approval', 'Publish', 'Analytics', 'Learning'];
  return (
    <div className="jai-page">
      <PageHeader eyebrow="PREPARE_CONTRACT" title="Content Studio" description="A measurable production pipeline, not a wall of agents and diagnostics." />
      <SectionCard title="Production pipeline" description="Prepared architecture · publishing remains owner-approved" tone="violet"><ol className="jai-content-pipeline">{stages.map((stage, index) => <li key={stage}><span>{String(index + 1).padStart(2, '0')}</span><strong>{stage}</strong>{index < stages.length - 1 ? <ArrowRight size={15} /> : null}</li>)}</ol></SectionCard>
      <div className="jai-prepared-grid"><PreparedFeature label="PREPARED" title="YouTube automation concepts" detail="Strategist, research, script, voice, visual, editor, QA, SEO, and analytics roles—deterministic tools where appropriate." /><PreparedFeature label="PREPARED" title="Objective feedback" detail="Views, CTR, retention, watch time, comments, and conversions may inform content strategy—not universal owner facts." /><PreparedFeature label="NOT CONFIGURED" title="Publishing integration" detail="No automatic upload or publish occurs without an approved owner policy and provider integration." /></div>
    </div>
  );
}

function DevicesPage(props: Props) {
  const devices = props.commandCenter?.devices ?? [];
  return (
    <div className="jai-page">
      <PageHeader eyebrow="VIEW ≠ CONTROL ≠ CONFIGURE ≠ ADMIN" title="Devices" description="Every device shows its actual provider state and permission class." />
      {!devices.length ? <EmptyState title="No device providers attached" detail="Missing hardware is unavailable, never silently successful." /> : <div className="jai-device-grid">{devices.map(device => <article key={device.id} className="jai-device-card"><div><Laptop size={22} /><span className={`jai-badge ${device.simulated ? 'jai-badge--simulation' : 'jai-badge--neutral'}`}>{device.simulated ? 'Simulation' : device.status}</span></div><h3>{device.label}</h3><p>{device.kind}</p><div className="jai-access-row"><span className="is-granted">View</span><span>Control</span><span>Configure</span><span>Admin</span></div><small>{device.simulated ? 'Fixture only · no live hardware effect' : device.node}</small></article>)}</div>}
      {props.commandCenter?.vision ? <SectionCard title="Visual context" description="SEE does not grant CLICK, TYPE, or SUBMIT" tone="violet"><p>{props.commandCenter.vision.title} · {props.commandCenter.vision.elements} elements</p>{props.commandCenter.vision.simulated ? <span className="jai-badge jai-badge--simulation">Simulation</span> : null}</SectionCard> : null}
      <div className="jai-prepared-grid"><PreparedFeature label="PREPARED" title="Local computer use" detail="Screen Capture → Vision → Grounding → Action Proposal → Policy → Permission → isolated desktop → verification." next="Open Computer Use is a design reference; E2B cloud is not required." /><PreparedFeature label="BLOCKED_LOCAL_ACCEPTANCE" title="Owner PC and screen" detail="Real capture and interaction require physical Windows verification and owner permission." /><PreparedFeature label="BLOCKED_LOCAL_ACCEPTANCE" title="Phone / CCTV / microphone / camera" detail="Provider credentials and hardware stay local. VIEW never implies CONTROL." /></div>
    </div>
  );
}

function AutomationsPage(props: Props) {
  const scheduler = props.reminders?.scheduler;
  return (
    <div className="jai-page">
      <PageHeader eyebrow="SCHEDULED INTENT" title="Automations" description="Reminders and routines with explicit limits, quiet hours, and observable delivery." />
      <div className="jai-status-grid jai-status-grid--four"><Metric label="Scheduler" value={scheduler?.attached ? (scheduler.healthy ? 'Healthy' : 'Paused') : 'Unavailable'} detail={scheduler?.timezone || 'timezone unknown'} /><Metric label="Active" value={String(scheduler?.activeCount ?? 0)} detail="reminders" /><Metric label="Pending" value={String(scheduler?.pendingCount ?? 0)} detail="deliveries" /><Metric label="Next" value={reminderLocalTime(scheduler?.nextRunAt ?? null, scheduler?.timezone)} detail="local time" /></div>
      {(props.reminders?.pendingDeliveries.length ?? 0) > 0 ? <SectionCard title="Waiting for you" tone="amber">{props.reminders?.pendingDeliveries.map(delivery => <div className="jai-reminder-due" key={`${delivery.reminderId}-${delivery.occurrenceAt}`}><Clock3 size={21} /><span><strong>{delivery.title}</strong><small>{delivery.scheduledLocal}{delivery.kind === 'missed' ? ' · missed while offline' : ''}</small></span><div className="jai-action-row"><button type="button" className="jai-button jai-button--primary" onClick={() => props.onAckReminder('complete', delivery)}>Done</button><button type="button" className="jai-button" onClick={() => props.onAckReminder('snooze', delivery, 10)}>Snooze</button><button type="button" className="jai-button" onClick={() => props.onAckReminder('dismiss', delivery)}>Dismiss</button></div></div>)}</SectionCard> : null}
      <SectionCard title="Reminders" description="Only reminder mutations are scheduled; arbitrary capabilities are not" tone="neutral">
        {!props.reminders?.reminders.length ? <EmptyState title="No active reminders" detail="Ask Jarvis to remind you at a clear time." /> : <ul className="jai-automation-list">{props.reminders.reminders.map(item => <li key={item.id}><Clock3 size={18} /><span><strong>{item.title}</strong><small>{reminderLocalTime(item.nextRunAt, scheduler?.timezone)}{reminderScheduleTag(item) ? ` · ${reminderScheduleTag(item)}` : ''}{item.status === 'PAUSED' ? ' · paused' : ''}</small></span><button type="button" className="jai-button" onClick={() => props.onReminder(item.status === 'PAUSED' ? 'reminders.resume' : 'reminders.pause', { reminderId: item.id })}>{item.status === 'PAUSED' ? <Play size={14} /> : <Pause size={14} />}{item.status === 'PAUSED' ? 'Resume' : 'Pause'}</button><button type="button" className="jai-button jai-button--danger" onClick={() => props.onReminder('reminders.cancel', { reminderId: item.id })}>Cancel</button></li>)}</ul>}
      </SectionCard>
      <PreparedFeature label="PREPARED" title="Proactive Jarvis" detail="Importance, cooldown, quiet hours, owner preferences, and no notification spam." next="Real Windows monitoring remains BLOCKED_LOCAL_ACCEPTANCE." />
    </div>
  );
}

function EvolutionPage(props: Props) {
  const evolution = props.commandCenter?.evolution;
  const night = evolution?.night;
  const stages = ['Digest', 'Deduplicate', 'Consolidate', 'Reflect', 'Distill skills', 'Update self model', 'Select growth goals', 'Benchmark', 'Cleanup'];
  return (
    <div className="jai-page">
      <PageHeader eyebrow="EVOLUTION / FLUCTLIGHT" title="Growth without invented progress" description="Experiences become candidates and evidence—not automatic production authority." actions={<button type="button" className="jai-button jai-button--primary" disabled={props.busy} onClick={() => props.onNight(night?.status === 'paused' ? 'resume' : 'run')}><BrainCircuit size={16} /> {night?.status === 'paused' ? 'Resume Night Cycle' : 'Run Night Cycle'}</button>} />
      <div className="jai-status-grid jai-status-grid--four"><Metric label="Experiences" value={String(evolution?.experiences ?? 0)} detail="recorded" /><Metric label="Reflections" value={String(evolution?.reflections ?? 0)} detail="structured" /><Metric label="Skills" value={String(evolution?.skills ?? 0)} detail="trusted versions" /><Metric label="Failures" value={String(evolution?.failures ?? 0)} detail="cannot mint skills" /></div>
      <div className="jai-two-column">
        <SectionCard title="Night Cycle" description={`${night?.status || 'idle'}${night?.pausedFor ? ` · paused for ${night.pausedFor}` : ''}`} tone="violet"><ol className="jai-night-stages">{stages.map(stage => <li key={stage} className={night?.stage?.toLowerCase().includes(stage.split(' ')[0]!.toLowerCase()) ? 'is-active' : ''}><span>{night?.stage?.toLowerCase().includes(stage.split(' ')[0]!.toLowerCase()) ? <RefreshCw className="is-spinning" size={15} /> : <CircleDashed size={15} />}</span>{stage}</li>)}</ol><p className="jai-muted">Priority: realtime voice → owner task → background evolution.</p></SectionCard>
        <SectionCard title="Self model" description="Confidence comes from recorded outcomes" tone="cyan">{!evolution?.selfModel.length ? <EmptyState title="Insufficient data" detail="No capability trend is shown until evidence exists." /> : <ul className="jai-metric-list">{evolution.selfModel.map(item => <li key={item.label}><span>{item.label}</span><div><i style={{ width: `${item.pct ?? 0}%` }} /></div><em>{item.text}</em></li>)}</ul>}{evolution?.goals[0] ? <p className="jai-insight"><WandSparkles size={16} /> Growth goal: {evolution.goals[0]}</p> : null}{evolution?.lessons[0] ? <p className="jai-insight"><Info size={16} /> Lesson: {evolution.lessons[0]}</p> : null}</SectionCard>
      </div>
      <SectionCard title="Candidate improvements" description="Owner-gated; no automatic production promotion" tone="violet">{!evolution?.candidates.length ? <EmptyState title="No candidate improvements" detail="The graph remains empty until real experience is recorded." /> : <ul className="jai-candidate-list">{evolution.candidates.map(candidate => <li key={candidate.id}><span className="jai-badge jai-badge--neutral">{candidate.status}</span><strong>{candidate.hypothesis}</strong>{candidate.simulated ? <span className="jai-badge jai-badge--simulation">Simulation</span> : null}</li>)}</ul>}<ExpertDetails summary="Benchmarks and model adaptation"><p>{evolution?.benchmarks.length ? `${evolution.benchmarks.filter(item => item.passed).length}/${evolution.benchmarks.length} benchmarks passed` : 'No benchmark runs yet.'}</p><p>Model adaptation registry-only · {evolution?.modelAdaptation.candidates ?? 0} candidates · trained={String(evolution?.modelAdaptation.trained ?? false)}</p><p>Fluctlight {evolution?.graph.nodes ?? 0} nodes · {evolution?.graph.edges ?? 0} real edges</p></ExpertDetails></SectionCard>
      <div className="jai-prepared-grid"><PreparedFeature label="BENCHMARK LATER" title="FlashInfer" detail="Potential inference optimization only after an evidence-based provider benchmark." /><PreparedFeature label="REFERENCE ONLY" title="OpenHarness / Awesome LLM Apps" detail="Borrow patterns only after comparison with the existing Jarvis authority model." /><PreparedFeature label="PREPARED" title="Objective content learning" detail="Measurable external feedback may improve content strategy within its own domain." /><PreparedFeature label="REFERENCE ONLY" title="Security Academy" detail="Reviewed defensive exercises may become isolated, objectively verified practice. External cybersecurity projects are never bulk-installed or trusted." next="Third-party and dual-use code remains SANDBOX_REQUIRED; reflection alone is not improvement." /></div>
    </div>
  );
}

function SecurityPage(props: Props) {
  const protections = props.security ? Object.entries(pickProtections(props.security)) : [];
  const control = props.commandCenter?.control;
  const decisions = (props.commandCenter?.operations ?? []).filter(event => /PERMISSION|PRIVILEGE/iu.test(event.type)).slice(-6).reverse();
  return (
    <div className="jai-page">
      <PageHeader eyebrow="OWNER CONTROL CENTER" title="Security and authority" description="Maximum capability, minimum necessary privilege, transparent risk, reversible actions." />
      <div className="jai-security-hero">
        <SectionCard title="Autonomy" description="Jarvis cannot raise the owner-defined ceiling" tone="cyan"><div className="jai-autonomy"><strong>{control?.currentAutonomy ?? 1}</strong><span>of {control?.maxAutonomy ?? 2}<small>{control?.autonomyLabel || 'Assist'}</small></span></div><div className="jai-autonomy-track">{[0, 1, 2, 3, 4, 5].map(level => <i key={level} className={level <= (control?.currentAutonomy ?? 1) ? 'is-active' : level <= (control?.maxAutonomy ?? 2) ? 'is-ceiling' : ''} />)}</div><p className="jai-muted">Current level and maximum come from the actual owner-control snapshot.</p></SectionCard>
        <SectionCard title="Pending approvals" description="No permanent broad grant is created silently" tone={props.commandCenter?.permission.waiting || props.pendingRisk ? 'amber' : 'green'}>{props.commandCenter?.permission.waiting ? <PermissionCard snapshot={props.commandCenter} busy={props.busy} onDeny={props.onCancelTask} onAllow={props.onGrantTask} /> : props.pendingRisk ? <p className="jai-attention"><AlertTriangle size={18} /> An action approval is waiting in the owner dialog.</p> : <EmptyState title="Nothing is waiting" detail="Jarvis has no pending owner approval." />}</SectionCard>
      </div>
      <SectionCard title="Host protections" description={props.security ? `Probed ${new Date(props.security.probedAt).toLocaleString()}` : 'Checking the local-only endpoint'} tone="green">
        {!props.security ? <EmptyState title="Security snapshot unavailable" detail="No host protection state is being invented." /> : <div className="jai-protection-grid">{protections.map(([label, item]) => <article key={label} className={`is-${item.state.toLowerCase()}`}><span>{item.state === 'ON' ? <ShieldCheck size={19} /> : item.state === 'OFF' ? <TriangleAlert size={19} /> : <CircleDashed size={19} />}</span><div><strong>{label}</strong><small>{item.detail}</small></div></article>)}</div>}
        {props.security ? <TrustedOperatorNote>Jarvis reports weakenedByJarvis={String(props.security.weakenedByJarvis)}. Device encryption was not modified.</TrustedOperatorNote> : null}
      </SectionCard>
      <div className="jai-two-column">
        <SectionCard title="Privilege leases" description="Scoped, expiring, action-counted authority" tone="amber"><ActivePrivilegeLease /><ExpertDetails summary="Lease internals"><p>The current UI intentionally does not claim lease IDs, scopes, or expiries without a read-only endpoint.</p></ExpertDetails></SectionCard>
        <SectionCard title="Recent owner decisions" description="Approved, denied, or waiting permission events" tone="neutral">{!decisions.length ? <EmptyState title="No recent decisions" detail="The redacted event window contains no permission event." /> : <ul className="jai-compact-list">{decisions.map(event => <li key={event.id}><span>{event.type.includes('DENIED') ? <Ban size={16} /> : event.type.includes('APPROVED') ? <CheckCircle2 size={16} /> : <Clock3 size={16} />}</span><div><strong>{humanEventType(event.type)}</strong><small>{event.summary} · {new Date(event.at).toLocaleTimeString()}</small></div></li>)}</ul>}</SectionCard>
      </div>
      <SectionCard title="Trust boundaries" description="These are product invariants" tone="neutral"><ul className="jai-principles"><li>Discover ≠ Install ≠ Review ≠ Trust ≠ Execute</li><li>Data ≠ Authority</li><li>LLM output ≠ Execution</li><li>See ≠ Click ≠ Type ≠ Submit</li><li>View ≠ Control ≠ Configure ≠ Admin</li></ul></SectionCard>
      <PreparedFeature label="PREPARED" title="Emergency Stop runtime" detail="The always-accessible, confirmation-gated UI contract is present. Runtime cancellation, lease revocation, autonomy suspension, and evidence preservation are not falsely claimed as connected." next="Connect only after a typed owner-only endpoint and restart recovery policy are implemented." />
    </div>
  );
}

function SystemPage(props: Props) {
  const [capabilityQuery, setCapabilityQuery] = useState('');
  const catalog = props.status?.capabilities?.catalog ?? [];
  const filtered = useMemo(() => catalog.filter(item => `${item.id} ${item.description || ''} ${item.providerKind} ${item.requiredService}`.toLowerCase().includes(capabilityQuery.toLowerCase())), [catalog, capabilityQuery]);
  return (
    <div className="jai-page">
      <PageHeader eyebrow="RUNTIME CENTER" title="System and capabilities" description="Useful health first; raw telemetry and provider metadata on demand." />
      <div className="jai-status-grid jai-status-grid--four"><Metric label="CPU" value={props.system?.cpu ? formatPct(props.system.cpu.usagePct) : 'Unknown'} detail={props.system?.cpu ? `${props.system.cpu.cores} cores` : 'not measured'} /><Metric label="RAM" value={props.system?.ram ? formatPct(props.system.ram.usedPct) : 'Unknown'} detail={props.system?.ram ? `${formatMb(props.system.ram.totalMb - props.system.ram.freeMb)} / ${formatMb(props.system.ram.totalMb)}` : 'not measured'} /><Metric label="GPU" value={props.system?.gpu ? formatPct(props.system.gpu.utilizationPct) : 'Unavailable'} detail={props.system?.gpu?.name || props.system?.gpuUnavailableReason || 'not measured'} /><Metric label="Disk" value={props.system?.disk ? formatPct(props.system.disk.usedPct) : 'Unknown'} detail={props.system?.disk ? `${props.system.disk.freeGb} GB free` : 'not measured'} /></div>
      <div className="jai-two-column">
        <SectionCard title="Model / inference" description={props.status?.llm?.reachable === true ? 'Configured runtime reachable' : props.status?.llm?.reachable === false ? 'Runtime unavailable' : 'Runtime state unknown'} tone={props.status?.llm?.reachable ? 'cyan' : 'amber'}><div className="jai-model-card"><Cpu size={25} /><div><span>Model</span><strong>{props.status?.llm?.model || 'Not reported'}</strong><small>{props.status?.runtime?.contextTokens ? `${props.status.runtime.contextTokens.toLocaleString()} context tokens` : 'Context unknown'}</small></div></div><dl className="jai-data-list"><div><dt>Loaded</dt><dd>{props.status?.llm?.loaded === undefined ? 'unknown' : String(props.status.llm.loaded)}</dd></div><div><dt>Keep alive</dt><dd>{String(props.status?.runtime?.keepAlive || 'unknown')}</dd></div><div><dt>VRAM</dt><dd>{props.system?.gpu?.vramTotalMb ? `${formatMb(props.system.gpu.vramUsedMb)} / ${formatMb(props.system.gpu.vramTotalMb)}` : 'unavailable'}</dd></div><div><dt>Last turn</dt><dd>{props.conversation.modelMetrics?.tokensPerSec ? `${props.conversation.modelMetrics.tokensPerSec.toFixed(1)} tok/s · ${props.conversation.modelMetrics.outputTokens ?? '—'} output tokens` : 'not recorded'}</dd></div></dl><ExpertDetails summary="Inference details"><dl className="jai-data-list"><div><dt>Prompt tokens</dt><dd>{props.conversation.modelMetrics?.promptTokens ?? 'not recorded'}</dd></div><div><dt>Prompt rate</dt><dd>{props.conversation.modelMetrics?.promptTokensPerSec ? `${props.conversation.modelMetrics.promptTokensPerSec.toFixed(1)} tok/s` : 'not recorded'}</dd></div><div><dt>Load time</dt><dd>{props.conversation.modelMetrics?.loadMs !== undefined ? `${Math.round(props.conversation.modelMetrics.loadMs)} ms` : 'not recorded'}</dd></div><div><dt>Queue / active requests</dt><dd>not exposed by the current status contract</dd></div></dl></ExpertDetails></SectionCard>
        <SectionCard title="Services" description="Typed lifecycle actions only" tone="neutral"><ServiceList services={props.status?.services ?? []} busy={props.busy} onService={props.onService} /></SectionCard>
      </div>
      <SectionCard title="Capability Explorer" description="Registered contracts are not proof of live provider health" tone="cyan" action={<label className="jai-inline-search"><Search size={15} /><input value={capabilityQuery} onChange={event => setCapabilityQuery(event.target.value)} placeholder="Search capabilities" /></label>}>
        {!filtered.length ? <EmptyState title="No capabilities match" detail="The registry returned no matching descriptors." /> : <div className="jai-capability-table" role="table"><div className="jai-capability-table__head" role="row"><span>Name</span><span>Category</span><span>Risk / permission</span><span>Provider</span><span>Status</span></div>{filtered.map(item => <div className="jai-capability-table__row" role="row" key={item.id}><span><strong>{humanCapability(item.id)}</strong><code>{item.id}</code></span><span>{capabilityCategory(item.id)}</span><span>{item.sideEffect === 'read' ? 'Read only' : item.sideEffect === 'write' ? 'Request scoped' : 'Policy at request time'}</span><span>{item.providerKind}<small>{item.requiredService}</small></span><span><span className="jai-badge jai-badge--neutral">Registered</span><small>{item.untrustedOutput ? 'Untrusted output' : 'Output trust: typed'}</small><small>Mode / health / last used: checked at request time · not exposed</small></span></div>)}</div>}
      </SectionCard>
      <PreparedFeature label="BENCHMARK LATER" title="FlashInfer" detail="Compare only through the model provider layer after stable owner-machine baselines exist." />
    </div>
  );
}

function ActivityPage(props: Props) {
  const [filter, setFilter] = useState('ALL');
  const operations = props.commandCenter?.operations ?? [];
  const visible = filter === 'ALL' ? operations : operations.filter(item => item.type === filter || item.level.toUpperCase() === filter);
  const types = [...new Set(operations.map(item => item.type))].slice(0, 7);
  return (
    <div className="jai-page">
      <PageHeader eyebrow="AUDIT / OPERATIONS" title="Activity" description="Observable events, redacted secrets, no chain-of-thought." />
      <div className="jai-filter-row"><button type="button" className={filter === 'ALL' ? 'is-active' : ''} onClick={() => setFilter('ALL')}>All</button>{types.map(type => <button type="button" className={filter === type ? 'is-active' : ''} onClick={() => setFilter(type)} key={type}>{humanEventType(type)}</button>)}<button type="button" className={filter === 'ERROR' ? 'is-active' : ''} onClick={() => setFilter('ERROR')}>Errors</button></div>
      <SectionCard title="Event timeline" description={`${visible.length} visible events`} tone="neutral">
        {!visible.length ? <EmptyState title="No activity" detail="No matching events are available." /> : <ol className="jai-audit-timeline">{visible.slice().reverse().map(event => <li key={event.id} className={`is-${event.level}`}><span className="jai-audit-icon">{eventIcon(event.type)}</span><div><span><strong>{humanEventType(event.type)}</strong><time>{new Date(event.at).toLocaleTimeString()}</time>{event.simulated ? <em className="jai-badge jai-badge--simulation">Simulation</em> : null}</span><p>{event.summary}</p><ExpertDetails summary="Event details"><dl className="jai-data-list"><div><dt>Event ID</dt><dd><code>{event.id}</code></dd></div><div><dt>Sequence</dt><dd>{event.seq}</dd></div><div><dt>Task</dt><dd><code>{event.taskId || 'none'}</code></dd></div><div><dt>Visual state</dt><dd>{event.visualState || 'none'}</dd></div></dl></ExpertDetails></div></li>)}</ol>}
        <ExpertDetails summary="Filter coverage"><p>Type, status/level, task ID, and time are present in the redacted client snapshot. Capability, risk, and provider filters remain unavailable until those indexed fields can be exposed without leaking event payloads or secrets.</p></ExpertDetails>
      </SectionCard>
      <SectionCard title="Personal Digital Memory" description="PREPARE_CONTRACT · privacy-first perceptual memory" tone="violet">
        <div className="jai-memory-contract">
          {['Today', 'Sessions', 'Apps', 'Activities', 'Files', 'Visual context', 'Recall'].map(item => <span key={item}>{item}</span>)}
        </div>
        <p className="jai-muted">No perpetual capture is active. Future observations must pass source-specific consent, a fail-closed Privacy Gate, sensitive-context filtering, and redaction before bounded storage.</p>
        <TrustedOperatorNote>Observation ≠ fact · Pattern ≠ owner preference · Inference ≠ authority.</TrustedOperatorNote>
        <ExpertDetails summary="CatchMe architecture classification"><p>Borrow: event boundaries, Day → Session → App → Context → Event, timeline/tree UX. Modify: SQLite/FTS staging and local summaries. Reject: capture-everything and default global-input/admin monitoring.</p></ExpertDetails>
      </SectionCard>
    </div>
  );
}

function SettingsPage(props: Props) {
  return (
    <div className="jai-page">
      <PageHeader eyebrow="PREFERENCES" title="Settings" description="Daily experience preferences without weakening owner protections." />
      <div className="jai-two-column"><SectionCard title="Assistant presentation" description="Persona and voice remain independent" tone="cyan">{props.settings}</SectionCard><SectionCard title="Owner preferences" description="Current control snapshot" tone="neutral"><dl className="jai-data-list"><div><dt>Research depth</dt><dd>{props.commandCenter?.control.researchDepth || 'standard'}</dd></div><div><dt>Proactive alerts</dt><dd>{props.commandCenter?.control.proactiveAlerts ? 'enabled' : 'disabled'}</dd></div><div><dt>Background evolution</dt><dd>{props.commandCenter?.control.backgroundEvolution ? 'enabled' : 'disabled'}</dd></div><div><dt>Night Cycle</dt><dd>{props.commandCenter?.control.nightCycle ? 'enabled' : 'disabled'}</dd></div></dl><label className="jai-setting-toggle"><input type="checkbox" checked={Boolean(props.commandCenter?.control.simulationMode)} onChange={event => props.onSimulation(event.target.checked)} /><span><strong>Simulation mode</strong><small>All demos remain clearly tagged.</small></span></label></SectionCard></div>
      <SectionCard title="Perceptual memory privacy" description="PREPARE_CONTRACT · no capture provider is active" tone="violet"><div className="jai-two-column"><div><h3>Never capture</h3><p className="jai-muted">Passwords, password managers, OTP/2FA, private keys, credential dialogs, banking/payment views, owner-private apps/windows, and known secret stores.</p></div><div><h3>Redact before storage</h3><p className="jai-muted">API keys, authorization headers, cookies, tokens, Discord credentials, private-key material, payment patterns, and password-like clipboard content.</p></div></div><TrustedOperatorNote>Local does not automatically mean safe. Filter failure means no capture.</TrustedOperatorNote></SectionCard>
      <div className="jai-prepared-grid"><PreparedFeature label="PREPARED" title="Proactive notification policy" detail="Importance, cooldown, quiet hours, and owner preferences." /><PreparedFeature label="NOT CONFIGURED" title="Attachment intake" detail="Assistant attachment UI waits for the Document Intelligence contract." /><PreparedFeature label="BLOCKED_LOCAL_ACCEPTANCE" title="Microphone / voice output" detail="The controls exist; audio hardware and local STT/TTS must be verified on Windows." /><PreparedFeature label="BLOCKED_LOCAL_ACCEPTANCE" title="Perpetual monitoring" detail="Windows event, visual, file, notification, and hardware capture require owner-machine privacy, performance, retention, and consent acceptance." /></div>
    </div>
  );
}

function TaskForm({ busy, onTask }: { busy: boolean; onTask: (objective: string) => void }) {
  return <form className="jai-task-form" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); const objective = String(data.get('objective') || '').trim(); if (objective) onTask(objective); }}><input name="objective" maxLength={240} placeholder="Describe a scoped objective…" disabled={busy} /><button type="submit" className="jai-button jai-button--primary" disabled={busy}><Play size={15} /> Start task</button></form>;
}

function ServiceList({ services, busy, onService }: { services: LabServiceView[]; busy: boolean; onService: Props['onService'] }) {
  if (!services.length) return <EmptyState title="No service records" detail="The runtime returned no service catalog." />;
  return <ul className="jai-service-list">{services.map(service => { const state = labServiceStateLabel(service); const canStart = service.startAllowed && (service.lifecycle === 'STOPPED' || service.health === 'offline'); const canRestart = service.restartAllowed && service.lifecycle === 'RUNNING'; return <li key={service.id}><span className={`jai-service-dot is-${state}`} /><span><strong>{service.displayName || labServiceShortName(service.id)}</strong><small>{state}{service.reason ? ` · ${service.reason}` : ''}</small></span>{canStart ? <button type="button" className="jai-button" disabled={busy} onClick={() => onService('jarvis.startService', service.id)}>Start</button> : canRestart ? <button type="button" className="jai-button" disabled={busy} onClick={() => onService('jarvis.restartService', service.id)}>Restart</button> : <span />}</li>; })}</ul>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="jai-metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function pickProtections(security: HostSecuritySnapshot) {
  return {
    Defender: security.defender,
    Firewall: security.firewall,
    'Tamper protection': security.tamperProtection,
    'Memory integrity': security.memoryIntegrity,
    VBS: security.virtualizationBasedSecurity,
    'Secure Boot': security.secureBoot,
    UAC: security.uac,
  };
}

function securitySummary(security: HostSecuritySnapshot) {
  const states = Object.values(pickProtections(security)).map(item => item.state);
  if (states.includes('OFF')) return 'Attention';
  if (states.includes('UNKNOWN')) return 'Partially known';
  return 'Protected';
}

function summaryDestination(label: string): JarvisPageId {
  if (label === 'Security') return 'security';
  if (label === 'Devices') return 'devices';
  if (label === 'Tasks') return 'tasks';
  if (label === 'Memory') return 'assistant';
  return 'system';
}

function humanCoreState(state: string) {
  const map: Record<string, string> = { idle: 'Ready', thinking: 'Thinking', planning: 'Planning', searching: 'Researching', permission: 'Waiting for owner', executing: 'Executing', verifying: 'Verifying', evolving: 'Evolving', reflecting: 'Reflecting', degraded: 'Degraded', error: 'Needs attention', listening: 'Listening', transcribing: 'Transcribing', speaking: 'Speaking', responding: 'Responding' };
  return map[state] || state.replaceAll('_', ' ');
}

function humanTaskState(state: string) {
  return state.toLowerCase().replaceAll('_', ' ').replace(/\b\w/gu, char => char.toUpperCase());
}

function countTaskStates(snapshot: CommandCenterClientSnapshot | null) {
  const counts = { ACTIVE: 0, QUEUED: 0, WAITING: 0, PAUSED: 0, COMPLETED: 0, FAILED: 0, CANCELLED: 0 };
  const tasks = snapshot?.recentTasks ?? [];
  for (const task of tasks) {
    if (task.status === 'WAITING_PERMISSION') counts.WAITING += 1;
    else if (task.status === 'PAUSED') counts.PAUSED += 1;
    else if (task.status === 'SUCCESS' || task.status === 'COMPLETED') counts.COMPLETED += 1;
    else if (task.status === 'FAILED') counts.FAILED += 1;
    else if (task.status === 'CANCELLED') counts.CANCELLED += 1;
    else if (['RECEIVED', 'UNDERSTANDING', 'PLANNING', 'READY'].includes(task.status)) counts.QUEUED += 1;
    else counts.ACTIVE += 1;
  }
  return counts;
}

function activitySummary(conversation: ConversationView) {
  if (conversation.busy) return 'Jarvis is working';
  if (conversation.actionResults.some(item => item.status === 'confirmation_required')) return 'Waiting for approval';
  if (conversation.tools.length) return conversation.tools.some(item => item.failed) ? 'Capability completed with issues' : 'Capability activity complete';
  if (conversation.route?.agentic) return 'Task routed through WorkAgent';
  return 'Conversation response';
}

function humanCapability(id: string) {
  return id.split('.').map(part => part.replace(/([a-z])([A-Z])/gu, '$1 $2')).join(' · ').replace(/\b\w/gu, char => char.toUpperCase());
}

function capabilityCategory(id: string) {
  const root = id.split('.')[0] || 'other';
  const map: Record<string, string> = { desktop: 'Applications', jarvis: 'System', system: 'System', research: 'Research', workspace: 'Workspace', reminders: 'Automation', private: 'Research', vision: 'Vision', devices: 'Devices', social: 'Social', document: 'Documents' };
  return map[root] || root.replace(/\b\w/gu, char => char.toUpperCase());
}

function humanEventType(type: string) {
  return type.toLowerCase().replaceAll('_', ' ').replace(/\b\w/gu, char => char.toUpperCase());
}

function eventIcon(type: string) {
  if (type.includes('ERROR') || type.includes('FAILED') || type.includes('BLOCKED')) return <XCircle size={17} />;
  if (type.includes('SEARCH') || type.includes('SOURCE')) return <Search size={17} />;
  if (type.includes('DEVICE') || type.includes('VISION')) return <Laptop size={17} />;
  if (type.includes('MEMORY') || type.includes('REFLECTION')) return <BrainCircuit size={17} />;
  if (type.includes('PERMISSION') || type.includes('PRIVILEGE')) return <ShieldCheck size={17} />;
  if (type.includes('TASK') || type.includes('PROGRESS')) return <Activity size={17} />;
  return <Info size={17} />;
}
