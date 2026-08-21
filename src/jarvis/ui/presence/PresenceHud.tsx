import type { PresenceHudKind, PresencePhase } from './presenceRuntime';

export function PresenceHud(props: {
  kind: PresenceHudKind;
  phase: PresencePhase;
  researchSources?: Array<{ id: string; title: string; url?: string; status?: string }>;
  systemLines?: string[];
  taskObjective?: string;
  taskStatus?: string;
  stepsDone?: number;
  stepsTotal?: number;
  verificationState?: string;
  verificationSummary?: string;
  reminderTitle?: string;
  reminderWhen?: string;
  desktopNote?: string;
  cctvNote?: string;
  mediaNote?: string;
  waitingQuestion?: string;
  simulated?: boolean;
}) {
  if (props.kind === 'none') return null;
  const simulation = props.simulated ? <em className="jp-sim">SIMULATION</em> : null;

  if (props.kind === 'research') {
    const sources = props.researchSources ?? [];
    return (
      <aside className="jp-hud jp-hud--research" aria-label="Research context" data-phase={props.phase}>
        <header><span>Research</span>{simulation}</header>
        {sources.length === 0 ? <p>Gathering public sources.</p> : (
          <ul>
            {sources.slice(0, 5).map(source => (
              <li key={source.id}>
                <strong>{source.title}</strong>
                {source.url ? <small>{source.url}</small> : null}
              </li>
            ))}
          </ul>
        )}
      </aside>
    );
  }

  if (props.kind === 'system') {
    return (
      <aside className="jp-hud jp-hud--system" aria-label="System context">
        <header><span>System</span></header>
        <ul>
          {(props.systemLines ?? ['Reading local runtime status.']).map(line => <li key={line}>{line}</li>)}
        </ul>
      </aside>
    );
  }

  if (props.kind === 'execution') {
    return (
      <aside className="jp-hud jp-hud--exec" aria-label="Execution progress">
        <header><span>Executing</span>{simulation}</header>
        <p>{props.taskObjective || 'Scoped work is in progress.'}</p>
        {props.stepsTotal ? (
          <div className="jp-progress" role="progressbar" aria-valuenow={props.stepsDone ?? 0} aria-valuemax={props.stepsTotal}>
            <i style={{ width: `${Math.round(((props.stepsDone ?? 0) / props.stepsTotal) * 100)}%` }} />
            <small>{props.stepsDone ?? 0} / {props.stepsTotal}</small>
          </div>
        ) : <small>{props.taskStatus}</small>}
      </aside>
    );
  }

  if (props.kind === 'verification') {
    return (
      <aside className="jp-hud jp-hud--verify" aria-label="Verification result">
        <header><span>Verified</span></header>
        <p>{props.verificationState || 'Verification recorded.'}</p>
        {props.verificationSummary ? <small>{props.verificationSummary}</small> : null}
      </aside>
    );
  }

  if (props.kind === 'waiting-input') {
    return (
      <aside className="jp-hud jp-hud--wait" aria-label="Owner input required">
        <header><span>Need one answer</span></header>
        <p>{props.waitingQuestion || 'One declared field is still missing.'}</p>
      </aside>
    );
  }

  if (props.kind === 'reminder') {
    return (
      <aside className="jp-hud jp-hud--remind" aria-label="Reminder">
        <header><span>Reminder</span></header>
        <p>{props.reminderTitle || 'A local reminder is active.'}</p>
        {props.reminderWhen ? <small>{props.reminderWhen}</small> : null}
      </aside>
    );
  }

  if (props.kind === 'cctv') {
    return (
      <aside className="jp-hud jp-hud--cam" aria-label="Camera context">
        <header><span>Vision</span><em className="jp-sim">PREPARE CONTRACT</em></header>
        <p>{props.cctvNote || 'Camera context is prepared. Live CCTV is not marked REAL until a reviewed provider is accepted.'}</p>
      </aside>
    );
  }

  if (props.kind === 'media') {
    return (
      <aside className="jp-hud jp-hud--media" aria-label="Media">
        <header><span>Media</span></header>
        <p>{props.mediaNote || 'Media context is available only through allowlisted capabilities.'}</p>
      </aside>
    );
  }

  if (props.kind === 'desktop') {
    return (
      <aside className="jp-hud jp-hud--desk" aria-label="Desktop operator">
        <header><span>Desktop</span></header>
        <p>{props.desktopNote || 'OPEN is separately authorized from SEE, CLICK, TYPE, and SUBMIT.'}</p>
      </aside>
    );
  }

  return null;
}
