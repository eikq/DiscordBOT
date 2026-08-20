import { sourceGraphLayout } from './operationsView';
import type { CommandCenterClientSnapshot } from '../standalone/commandCenterView';
import type { DemoScenarioId } from '../standalone/commandCenterHttp';

const DEMOS: Array<{ id: DemoScenarioId; label: string }> = [
  { id: 'research', label: 'Research' },
  { id: 'coding', label: 'Coding' },
  { id: 'evolution', label: 'Evolution' },
  { id: 'monitoring', label: 'Monitor' },
];

type Props = {
  snapshot: CommandCenterClientSnapshot | null;
  domains: string[];
  busy: boolean;
  onDemo: (scenario: DemoScenarioId) => void;
  onCancel: () => void;
  onGrant: () => void;
  onSimulation: (enabled: boolean) => void;
  onRunTask: (objective: string) => void;
  onNight: () => void;
};

export default function CommandCenterPanels({
  snapshot,
  domains,
  busy,
  onDemo,
  onCancel,
  onGrant,
  onSimulation,
  onRunTask,
  onNight,
}: Props) {
  const graph = sourceGraphLayout(domains);
  const simulation = Boolean(snapshot?.simulationMode || snapshot?.task?.simulated);
  const inspect = snapshot?.task ?? snapshot?.lastTask ?? null;
  const liveTask = Boolean(snapshot?.task);
  return (
    <>
      <section className="jcc-block">
        <h2>Live operations</h2>
        {simulation ? <p className="jcc-sim-inline">SIMULATION — not live hardware</p> : null}
        <p className="jcc-hint">
          {snapshot?.visualLabel || 'IDLE'}
          {snapshot?.task ? ` · ${snapshot.task.status}` : ''}
          {snapshot?.request ? ` · ${snapshot.request.route}` : ''}
        </p>
        {snapshot?.request ? (
          <p className="jcc-hint">
            Route {snapshot.request.route} · {snapshot.request.socialAction}
            {snapshot.request.agentic ? ' · agentic' : ' · conversation'}
            {snapshot.request.requestId ? ` · ${snapshot.request.requestId}` : ''}
          </p>
        ) : (
          <p className="jcc-empty">No current request route.</p>
        )}
        {inspect ? (
          <>
            <p className="jcc-hint">
              {liveTask ? 'Active task' : 'Last task'} · {inspect.status}
              {` · ${inspect.id}`}
              {inspect.verification ? ` · ${inspect.verification}` : inspect.outcome ? ` · ${inspect.outcome}` : ''}
            </p>
            <ol className="jcc-ops">
              {inspect.steps.map(step => (
                <li key={step.id} className={`jcc-ops__step is-${step.state}`}>
                  <em>{step.index}</em>
                  <span>
                    {step.title}
                    {step.capability ? <small> · {step.capability}</small> : null}
                    {step.summary ? <small>{step.summary}</small> : null}
                  </span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="jcc-empty">No multi-step work task. Demos below are tagged simulation.</p>
        )}
        {inspect?.evidence[0] ? <p className="jcc-hint">Evidence: {inspect.evidence[0]}</p> : null}
        {inspect?.errors[0] ? <p className="jcc-error">{inspect.errors[0]}</p> : null}
        {snapshot?.task?.waitingPermission ? (
          <div className="jcc-permit jcc-permit--task">
            <p className="jcc-permit__kicker">WAITING_PERMISSION</p>
            <p>{snapshot.task.objective}</p>
            <p className="jcc-hint">
              {snapshot.permission?.taskId || snapshot.task.id}
              {snapshot.permission?.stepId ? ` · ${snapshot.permission.stepId}` : ''}
              {snapshot.permission?.capability ? ` · ${snapshot.permission.capability}` : ''}
            </p>
            <p className="jcc-hint">
              {snapshot.permission?.risk ? `${snapshot.permission.risk}` : ''}
              {snapshot.permission?.proposalId ? ` · ${snapshot.permission.proposalId}` : ''}
              {snapshot.permission?.scope?.url ? ` · ${String(snapshot.permission.scope.url)}` : ''}
            </p>
            <div className="jcc-permit__actions">
              <button type="button" className="jcc-permit__deny" disabled={busy} onClick={onCancel}>Cancel</button>
              <button type="button" className="jcc-permit__allow" disabled={busy} onClick={onGrant}>Grant once</button>
            </div>
          </div>
        ) : snapshot?.task?.active ? (
          <p>
            <button type="button" className="jcc-ghost" disabled={busy} onClick={onCancel}>Cancel task</button>
          </p>
        ) : null}
        <form
          className="jcc-task-form"
          onSubmit={event => {
            event.preventDefault();
            const form = event.currentTarget;
            const input = form.elements.namedItem('objective') as HTMLInputElement | null;
            const objective = input?.value.trim() ?? '';
            if (objective) onRunTask(objective);
          }}
        >
          <label>
            <span className="jcc-hint">Run a real work task</span>
            <input name="objective" maxLength={240} placeholder="system status" disabled={busy} />
          </label>
          <button type="submit" className="jcc-ghost" disabled={busy}>Run task</button>
        </form>
        <div className="jcc-seg jcc-seg--tight" role="group" aria-label="Simulated demos">
          {DEMOS.map(demo => (
            <button key={demo.id} type="button" disabled={busy} onClick={() => onDemo(demo.id)}>{demo.label}</button>
          ))}
        </div>
      </section>

      <section className="jcc-block">
        <h2>Evolution</h2>
        <dl className="jcc-kv">
          <div><dt>Experiences</dt><dd>{snapshot?.evolution.experiences ?? 0}</dd></div>
          <div><dt>Reflections</dt><dd>{snapshot?.evolution.reflections ?? 0}</dd></div>
          <div><dt>Skills</dt><dd>{snapshot?.evolution.skills ?? 0}</dd></div>
          <div><dt>Failures</dt><dd>{snapshot?.evolution.failures ?? 0}</dd></div>
        </dl>
        <p className="jcc-hint">
          Night {snapshot?.evolution.night.status || 'idle'}
          {snapshot?.evolution.night.stage ? ` · ${snapshot.evolution.night.stage}` : ''}
          {snapshot?.evolution.night.pausedFor ? ` · paused for ${snapshot.evolution.night.pausedFor}` : ''}
          {snapshot?.evolution.night.experiencesProcessed
            ? ` · ${snapshot.evolution.night.experiencesProcessed} digested`
            : ''}
        </p>
        <p>
          <button type="button" className="jcc-ghost" disabled={busy} onClick={onNight}>Night cycle</button>
        </p>
        {(snapshot?.evolution.selfModel.length ?? 0) === 0 ? (
          <p className="jcc-empty">INSUFFICIENT DATA — no capability trend yet.</p>
        ) : (
          <ul className="jcc-meters">
            {snapshot?.evolution.selfModel.map(item => (
              <li key={item.label}>
                <span>{item.label}</span>
                <div className="jcc-meter">{item.pct === null ? null : <i style={{ width: `${item.pct}%` }} />}</div>
                <em>{item.text}</em>
              </li>
            ))}
          </ul>
        )}
        {snapshot?.evolution.goals[0] ? <p className="jcc-hint">Goal: {snapshot.evolution.goals[0]}</p> : null}
        {snapshot?.evolution.lessons[0] ? <p className="jcc-hint">Lesson: {snapshot.evolution.lessons[0]}</p> : null}
        <p className="jcc-hint">
          Model adaptation registry-only
          {snapshot?.evolution.modelAdaptation
            ? ` · ${snapshot.evolution.modelAdaptation.candidates} candidates · trained=${snapshot.evolution.modelAdaptation.trained}`
            : ' · no LoRA training'}
        </p>
        {snapshot?.evolution.graph.empty ? (
          <p className="jcc-empty">Fluctlight is empty until a real experience is recorded.</p>
        ) : (
          <p className="jcc-hint">
            Fluctlight {snapshot?.evolution.graph.nodes ?? 0} nodes · {snapshot?.evolution.graph.edges ?? 0} edges
          </p>
        )}
        {(snapshot?.evolution.benchmarks.length ?? 0) > 0 ? (
          <p className="jcc-hint">
            Benchmarks {snapshot?.evolution.benchmarks.filter(item => item.passed).length}/{snapshot?.evolution.benchmarks.length} passed
          </p>
        ) : (
          <p className="jcc-empty">No benchmark runs yet.</p>
        )}
        {(snapshot?.evolution.candidates.length ?? 0) > 0 ? (
          <ul className="jcc-evidence">
            {snapshot?.evolution.candidates.map(item => (
              <li key={item.id}>
                <code>{item.status}</code>
                <span>{item.hypothesis}</span>
                {item.simulated ? <small>SIMULATION</small> : null}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="jcc-hint">Production promotion is owner-gated and currently denied.</p>
      </section>

      <section className="jcc-block">
        <h2>Intelligence</h2>
        <dl className="jcc-kv">
          <div><dt>Traces</dt><dd>{snapshot?.intelligence?.traces.count ?? 0}</dd></div>
          <div><dt>Spec</dt><dd>{snapshot?.intelligence?.runtimeSpec.id ?? 'spec_baseline_v1'}</dd></div>
          <div>
            <dt>Analyzer</dt>
            <dd>{snapshot?.intelligence?.analyzer.status ?? 'INSUFFICIENT_DATA'}</dd>
          </div>
        </dl>
        {snapshot?.intelligence?.traces.lastRoute ? (
          <p className="jcc-hint">
            Last route {snapshot.intelligence.traces.lastRoute}
            {snapshot.intelligence.traces.lastInput ? ` · ${snapshot.intelligence.traces.lastInput}` : ''}
          </p>
        ) : (
          <p className="jcc-empty">No operational traces yet.</p>
        )}
        {snapshot?.intelligence?.analyzer.status === 'INSUFFICIENT_DATA' ? (
          <p className="jcc-empty">{snapshot.intelligence?.analyzer.reason || 'INSUFFICIENT_DATA'}</p>
        ) : (
          <p className="jcc-hint">
            Efficiency {snapshot?.intelligence?.efficiency.status}
            {snapshot?.intelligence?.efficiency.p50Ms != null ? ` · p50 ${Math.round(snapshot.intelligence.efficiency.p50Ms)}ms` : ''}
            {snapshot?.intelligence?.efficiency.p95Ms != null ? ` · p95 ${Math.round(snapshot.intelligence.efficiency.p95Ms)}ms` : ''}
          </p>
        )}
        <p className="jcc-hint">
          Models {(snapshot?.intelligence?.models ?? []).map(item => `${item.id}:${item.trustTier}`).join(' · ') || 'none'}
        </p>
        <p className="jcc-hint">RESTRICTED models have no security authority.</p>
        {(snapshot?.intelligence?.certifications.length ?? 0) > 0 ? (
          <p className="jcc-hint">
            Certification {snapshot?.intelligence?.certifications[0]?.status}
            {' · '}
            {snapshot?.intelligence?.certifications[0]?.passed}/{snapshot?.intelligence?.certifications[0]?.total}
          </p>
        ) : (
          <p className="jcc-empty">Model certification is fixture-only until local acceptance.</p>
        )}
        {(snapshot?.intelligence?.specCandidates.length ?? 0) > 0 ? (
          <ul className="jcc-evidence">
            {snapshot?.intelligence?.specCandidates.map(item => (
              <li key={item.id}>
                <code>{item.status}</code>
                <span>{item.hypothesis}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="jcc-empty">No runtime-spec candidates. Auto-promote is denied.</p>
        )}
        {(snapshot?.intelligence?.artifacts.length ?? 0) > 0 ? (
          <ul className="jcc-evidence">
            {snapshot?.intelligence?.artifacts.map(item => (
              <li key={item.taskId}>
                <code>{item.status}</code>
                <span>{item.artifactClass}</span>
                {item.simulated ? <small>SIMULATION</small> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="jcc-empty">No artifact tasks. Media provider is simulated; publish stays owner-gated.</p>
        )}
        <p className="jcc-hint">
          Schedulers: reminders, night cycle, monitor. Jobs are not permissions.
        </p>
      </section>

      <section className="jcc-block">
        <h2>Source graph</h2>
        {graph.length === 0 ? (
          <p className="jcc-empty">No research domains this session.</p>
        ) : (
          <svg className="jcc-source-graph" viewBox="0 0 100 100" role="img" aria-label="Research source domains">
            <circle cx="50" cy="50" r="4" className="jcc-source-graph__core" />
            {graph.map(node => (
              <g key={node.domain}>
                <line x1="50" y1="50" x2={node.x} y2={node.y} className="jcc-source-graph__edge" />
                <circle cx={node.x} cy={node.y} r="3.2" className="jcc-source-graph__node" />
                <text x={node.x} y={node.y + 7} textAnchor="middle">{node.domain}</text>
              </g>
            ))}
          </svg>
        )}
      </section>

      <section className="jcc-block">
        <h2>Devices</h2>
        {(snapshot?.devices.length ?? 0) === 0 ? (
          <p className="jcc-empty">No device providers attached.</p>
        ) : (
          <ul className="jcc-evidence">
            {snapshot?.devices.map(device => (
              <li key={device.id}>
                <code>{device.node}</code>
                <span>{device.label} · {device.kind}</span>
                <small>{device.simulated ? 'SIMULATION · VIEW only' : device.status}</small>
              </li>
            ))}
          </ul>
        )}
        {(snapshot?.notifications.length ?? 0) > 0 ? (
          <ul className="jcc-evidence">
            {snapshot?.notifications.map(item => (
              <li key={item.id} className={item.severity === 'critical' ? 'is-failed' : ''}>
                <code>{item.severity}</code>
                <span>{item.summary}</span>
                {item.simulated ? <small>SIMULATION</small> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {snapshot?.vision ? (
          <p className="jcc-hint">
            Vision {snapshot.vision.title} · {snapshot.vision.elements} elements
            {snapshot.vision.simulated ? ' · SIMULATION' : ''}
          </p>
        ) : null}
      </section>

      <section className="jcc-block">
        <h2>Owner control</h2>
        <p className="jcc-hint">
          Autonomy {snapshot?.control.currentAutonomy ?? 1}/{snapshot?.control.maxAutonomy ?? 2}
          {snapshot?.control.autonomyLabel ? ` · ${snapshot.control.autonomyLabel}` : ''}
        </p>
        <p className="jcc-hint">Research depth {snapshot?.control.researchDepth || 'standard'}</p>
        <label className={`jcc-toggle${snapshot?.control.simulationMode ? ' is-on' : ''}`}>
          <input
            type="checkbox"
            checked={Boolean(snapshot?.control.simulationMode)}
            disabled={busy || !snapshot}
            onChange={event => onSimulation(event.target.checked)}
          />
          Simulation mode
        </label>
      </section>
    </>
  );
}
