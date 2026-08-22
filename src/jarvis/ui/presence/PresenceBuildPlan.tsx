import type { PresenceBuildSurface } from './buildSurface';

export function PresenceBuildPlan(props: { surface: PresenceBuildSurface }) {
  const { surface } = props;
  return (
    <aside className="jp-build" aria-label="Build plan">
      <header>
        <span>BUILDING</span>
        <strong>{surface.title}</strong>
      </header>
      <ol>
        {surface.nodes.map(node => (
          <li key={node.id} data-state={node.state}>
            <i aria-hidden="true" />
            <span>{node.label}</span>
            <em>{node.state.replace('-', ' ')}</em>
          </li>
        ))}
      </ol>
      {surface.artifact ? <p className="jp-build__art">Artifact: {surface.artifact}</p> : null}
      {surface.tests ? <p className="jp-build__art">Tests: {surface.tests}</p> : null}
      {surface.evidence[0] ? (
        <p className="jp-build__ev">{surface.evidence[surface.evidence.length - 1]}</p>
      ) : null}
    </aside>
  );
}
