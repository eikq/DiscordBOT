import type { LiveOpsStep } from '../../operationsView';
import type { PresenceHudKind, PresencePhase } from '../presenceRuntime';
import type { PresenceActivityItem } from './activityFeed';
import type { PresenceHudSlot } from './hudComposition';
import type { HonestProgress, PresenceResearchNode, PresenceResearchView } from './researchPresentation';

export function PresenceSpatialHud(props: {
  slot: PresenceHudSlot | null;
  phase: PresencePhase;
  research?: PresenceResearchView | null;
  selectedSourceId?: string | null;
  onSelectSource?: (id: string | null) => void;
  activity?: PresenceActivityItem[];
  planSteps?: LiveOpsStep[];
  systemLines?: string[];
  taskObjective?: string;
  taskStatus?: string;
  progress?: HonestProgress;
  verification?: { requested?: boolean; executed?: boolean; verified?: boolean; failed?: boolean; summary?: string };
  reminderTitle?: string;
  reminderWhen?: string;
  waitingQuestion?: string;
  desktopNote?: string;
  cctvNote?: string;
  mediaNote?: string;
  simulated?: boolean;
}) {
  const slot = props.slot;
  if (!slot || slot.kind === 'none' || slot.kind === 'permission') return null;

  return (
    <aside
      className={`jp-panel jp-panel--${slot.zone.toLowerCase().replaceAll('_', '-')} jp-panel--construct`}
      data-kind={slot.kind}
      data-depth={slot.depth}
      data-zone={slot.zone}
      aria-label={`${slot.kind} context`}
    >
      {slot.kind === 'research' ? (
        <ResearchPanel
          view={props.research}
          selectedId={props.selectedSourceId}
          onSelect={props.onSelectSource}
          activity={props.activity}
          simulated={props.simulated}
        />
      ) : null}
      {slot.kind === 'system' ? <SimplePanel title="System" lines={props.systemLines ?? ['UNKNOWN']} /> : null}
      {slot.kind === 'execution' ? (
        <TaskPanel objective={props.taskObjective} status={props.taskStatus} progress={props.progress} steps={props.planSteps} simulated={props.simulated} />
      ) : null}
      {slot.kind === 'verification' ? <VerificationPanel model={props.verification} /> : null}
      {slot.kind === 'waiting-input' ? (
        <SimplePanel title="Need one answer" lines={[props.waitingQuestion || 'One declared field is still missing.']} />
      ) : null}
      {slot.kind === 'reminder' ? (
        <SimplePanel title="Reminder" lines={[props.reminderTitle || 'A local reminder is active.', props.reminderWhen].filter((line): line is string => Boolean(line))} />
      ) : null}
      {slot.kind === 'cctv' ? (
        <SimplePanel title="Vision" badge="PREPARE CONTRACT" lines={[props.cctvNote || 'Live CCTV is not marked REAL.']} />
      ) : null}
      {slot.kind === 'media' ? (
        <SimplePanel title="Media" lines={[props.mediaNote || 'Media appears only for an active allowlisted session.']} />
      ) : null}
      {slot.kind === 'desktop' ? (
        <SimplePanel title="Desktop" lines={[props.desktopNote || 'Structured SEE, OPEN, verified PLACE, and managed FOCUS stay separate from CLICK, TYPE, and SUBMIT.']} />
      ) : null}
      {slot.kind === 'attention' && props.phase === 'EMERGENCY_STOP' ? (
        <SimplePanel title="Emergency stop" lines={['Autonomous work is suspended.']} />
      ) : null}
    </aside>
  );
}

function SimplePanel(props: { title: string; lines: string[]; badge?: string }) {
  return (
    <>
      <header>
        <span>{props.title}</span>
        {props.badge ? <em className="jp-sim">{props.badge}</em> : null}
      </header>
      <ul>
        {props.lines.map(line => <li key={line}>{line}</li>)}
      </ul>
    </>
  );
}

function TaskPanel(props: { objective?: string; status?: string; progress?: HonestProgress; steps?: LiveOpsStep[]; simulated?: boolean }) {
  const progress = props.progress;
  return (
    <>
      <header>
        <span>Current work</span>
        {props.simulated ? <em className="jp-sim">SIMULATION</em> : null}
      </header>
      <p>{props.objective || 'Scoped work is in progress.'}</p>
      {props.steps && props.steps.length > 0 ? (
        <ol className="jp-dag">
          {props.steps.slice(0, 6).map(step => (
            <li key={step.id} data-state={step.state}>
              <i>{step.index}</i>
              <span>{step.title}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {progress?.kind === 'steps' ? (
        <div className="jp-progress" role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total}>
          <i style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
          <small>{progress.label}</small>
        </div>
      ) : <small>{progress?.kind === 'unknown' ? progress.label : props.status}</small>}
    </>
  );
}

function VerificationPanel(props: {
  model?: { requested?: boolean; executed?: boolean; verified?: boolean; failed?: boolean; summary?: string };
}) {
  const model = props.model;
  return (
    <>
      <header><span>Verification</span></header>
      <ol className="jp-verify">
        <li data-on={model?.requested ? 'true' : 'false'}>Requested</li>
        <li data-on={model?.executed ? 'true' : 'false'}>Executed</li>
        <li data-on={model?.verified ? 'true' : 'false'} data-fail={model?.failed ? 'true' : 'false'}>
          {model?.failed ? 'Verified failed' : 'Verified'}
        </li>
      </ol>
      {model?.summary ? <small>{model.summary}</small> : null}
    </>
  );
}

function ResearchPanel(props: {
  view?: PresenceResearchView | null;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  activity?: PresenceActivityItem[];
  simulated?: boolean;
}) {
  const view = props.view;
  if (!view) {
    return (
      <>
        <header><span>Research</span></header>
        <p>Gathering public sources.</p>
      </>
    );
  }
  const selected = view.nodes.find(node => node.id === props.selectedId) ?? null;
  return (
    <>
      <header>
        <span>{view.stageLabel}</span>
        {props.simulated ? <em className="jp-sim">SIMULATION</em> : null}
      </header>
      {view.query ? <p className="jp-panel__query">{view.query}</p> : null}
      {view.unavailable || view.degraded ? <p>{view.reason}</p> : null}
      <dl className="jp-stats">
        <div><dt>Sources</dt><dd>{view.counts.sources}</dd></div>
        <div><dt>Reviewed</dt><dd>{view.counts.reviewed}</dd></div>
        <div><dt>Evidence</dt><dd>{view.counts.evidence}</dd></div>
        <div><dt>Verified</dt><dd>{view.counts.verified}</dd></div>
        {view.counts.conflicts > 0 ? <div><dt>Conflicts</dt><dd>{view.counts.conflicts}</dd></div> : null}
        {view.overflow ? <div><dt>More</dt><dd>+{view.overflow}</dd></div> : null}
      </dl>
      {props.activity && props.activity.length > 0 ? (
        <ul className="jp-activity" aria-label="Research activity">
          {props.activity.map(item => <li key={item.id}>{item.text}</li>)}
        </ul>
      ) : null}
      <ul className="jp-sources">
        {view.nodes.map(node => (
          <li key={node.id}>
            <button type="button" data-visual={node.visual} data-trust={node.trust} onClick={() => props.onSelect?.(selected?.id === node.id ? null : node.id)}>
              <strong>{node.title}</strong>
              <small>{nodeLabel(node)}</small>
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <div className="jp-source-detail">
          <span>{selected.domain || 'Source'}</span>
          <p>{selected.excerpt || 'No extracted excerpt is available yet.'}</p>
          {selected.trust === 'untrusted' ? <em className="jp-sim">UNTRUSTED</em> : null}
        </div>
      ) : null}
    </>
  );
}

function nodeLabel(node: PresenceResearchNode): string {
  if (node.trust === 'untrusted') return `UNTRUSTED · ${node.visual.replaceAll('_', ' ')}`;
  return `${node.visual.replaceAll('_', ' ')}${node.domain ? ` · ${node.domain}` : ''}`;
}
