import {
  COMMAND_CENTER_MODES,
  MODE_LABELS,
  buildOwnerCorrectionPhrase,
  type CommandCenterMode,
  type CommandCenterV2View,
  type RecommendedAction,
} from './commandCenterV2';
import {
  DevicesPanel,
  IntelligencePanel,
  OperationsPanel,
  SourceGraphPanel,
  type CommandCenterPanelProps,
} from './CommandCenterPanels';
import { formatConfidence, type LabMemoryRef } from './labUiState';

type NavProps = {
  mode: CommandCenterMode;
  onChange: (mode: CommandCenterMode) => void;
};

export function CommandCenterModeNav({ mode, onChange }: NavProps) {
  return (
    <nav className="jcc-modes" aria-label="Command Center modes">
      {COMMAND_CENTER_MODES.map(item => (
        <button
          key={item}
          type="button"
          aria-pressed={mode === item}
          aria-current={mode === item ? 'page' : undefined}
          data-chrome={item === 'presenter' ? 'jcc-presenter--fullscreen' : undefined}
          onClick={() => onChange(item)}
        >
          {MODE_LABELS[item]}
        </button>
      ))}
    </nav>
  );
}

export function AssistantHome({
  view,
  onRecommended,
}: {
  view: CommandCenterV2View;
  onRecommended: (action: RecommendedAction) => void;
}) {
  return (
    <section className="jcc-home" aria-label="Assistant home">
      <header>
        <p className="jcc-hint">ASSISTANT</p>
        <h2>Home</h2>
      </header>
      <dl className="jcc-kv">
        <div>
          <dt>Conversation</dt>
          <dd>{view.conversation.empty ? 'No conversation this session.' : view.conversation.text}</dd>
        </div>
        <div>
          <dt>Active task</dt>
          <dd>
            {view.activeTask
              ? `${view.activeTask.status} · ${view.activeTask.objective}`
              : 'No active task.'}
          </dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>{view.modelName || 'unknown'}</dd>
        </div>
        <div>
          <dt>Voice</dt>
          <dd>{view.voiceState || 'idle'}</dd>
        </div>
        <div>
          <dt>Alert</dt>
          <dd>
            {view.alert
              ? `${view.alert.severity} · ${view.alert.summary}${view.alert.simulated ? ' · SIMULATION' : ''}`
              : 'No important alert.'}
          </dd>
        </div>
      </dl>
      <p className="jcc-home__next">
        <span className="jcc-hint">Recommended next action</span>
        <button type="button" className="jcc-ghost" onClick={() => onRecommended(view.recommended)}>
          {view.recommended.label}
        </button>
      </p>
    </section>
  );
}

export function MemoryMode({
  items,
  onCorrect,
  onFocus,
}: {
  items: LabMemoryRef[];
  onCorrect: (phrase: string) => void;
  onFocus?: (id: string) => void;
}) {
  return (
    <section className="jcc-block" aria-label="Memory">
      <h2>Memory</h2>
      {items.length === 0 ? (
        <p className="jcc-empty">No canonical memory attached to this turn.</p>
      ) : (
        <ul className="jcc-evidence">
          {items.map(ref => {
            const confidence = formatConfidence(ref.confidence);
            const phraseBase = { canonicalId: ref.canonicalId };
            return (
              <li key={ref.canonicalId}>
                <button
                  type="button"
                  className="jcc-evidence__id"
                  onClick={() => onFocus?.(ref.canonicalId)}
                >
                  <code>{ref.canonicalId}</code>
                </button>
                <span>
                  {ref.type || 'memory'}
                  {ref.status ? ` · ${ref.status}` : ' · UNKNOWN'}
                  {ref.domain ? ` · ${ref.domain}` : ''}
                  {confidence ? ` · ${confidence}` : ''}
                </span>
                {ref.sourceRefs && ref.sourceRefs.length > 0 ? (
                  <small>provenance {ref.sourceRefs.join(', ')}</small>
                ) : (
                  <small>provenance unknown</small>
                )}
                <div className="jcc-memory-correct" role="group" aria-label={`Owner correction for ${ref.canonicalId}`}>
                  <button type="button" onClick={() => onCorrect(buildOwnerCorrectionPhrase('remember', phraseBase))}>
                    Remember
                  </button>
                  <button type="button" onClick={() => onCorrect(buildOwnerCorrectionPhrase('forget', phraseBase))}>
                    Forget
                  </button>
                  <button type="button" onClick={() => onCorrect(buildOwnerCorrectionPhrase('reject', phraseBase))}>
                    Reject
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="jcc-hint">Owner corrections go through Ask. Hidden memory reasoning is never shown.</p>
    </section>
  );
}

type ShellProps = CommandCenterPanelProps & {
  mode: CommandCenterMode;
  view: CommandCenterV2View;
  onModeChange: (mode: CommandCenterMode) => void;
  onRecommended: (action: RecommendedAction) => void;
  onOwnerCorrection: (phrase: string) => void;
  onFocusMemory?: (id: string) => void;
  memoryRefs: LabMemoryRef[];
};

export default function CommandCenterModeShell({
  mode,
  view,
  snapshot,
  domains,
  busy,
  onDemo,
  onCancel,
  onGrant,
  onSimulation,
  onRunTask,
  onNight,
  onRecommended,
  onOwnerCorrection,
  onFocusMemory,
  memoryRefs,
}: ShellProps) {
  const panelProps = { snapshot, domains, busy, onDemo, onCancel, onGrant, onSimulation, onRunTask, onNight };
  return (
    <div
      className="jcc-mode-shell"
      data-mode={mode}
      data-fullscreen-ready={mode === 'presenter' ? 'true' : 'false'}
      data-modes="ASSISTANT PRESENTER OPERATIONS MEMORY INTELLIGENCE DEVICES"
      aria-label={MODE_LABELS[mode]}
    >
      {mode === 'assistant' ? <AssistantHome view={view} onRecommended={onRecommended} /> : null}
      {mode === 'presenter' ? (
        <p className="jcc-hint">Presenter is fullscreen-ready. Rich briefing uses the existing visual architecture.</p>
      ) : null}
      {mode === 'operations' ? <OperationsPanel {...panelProps} /> : null}
      {mode === 'memory' ? (
        <MemoryMode items={memoryRefs} onCorrect={onOwnerCorrection} onFocus={onFocusMemory} />
      ) : null}
      {mode === 'intelligence' ? (
        <>
          {view.intelligence.insufficientData ? (
            <p className="jcc-empty">{view.intelligence.insufficientLabel || 'INSUFFICIENT_DATA'}</p>
          ) : null}
          <IntelligencePanel snapshot={snapshot} />
          <SourceGraphPanel domains={domains} />
        </>
      ) : null}
      {mode === 'devices' ? (
        <DevicesPanel snapshot={snapshot} busy={busy} onSimulation={onSimulation} />
      ) : null}
    </div>
  );
}
