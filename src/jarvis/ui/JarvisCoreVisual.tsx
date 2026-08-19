import type { CSSProperties } from 'react';
import type { LabCorePhase } from './labUiState';

const PARTICLE_COUNT = 12;

export default function JarvisCoreVisual(props: {
  phase: LabCorePhase;
  fx: 'full' | 'off';
  answer?: string;
  memoryActive: boolean;
  toolActive: boolean;
}) {
  const { phase, fx, answer, memoryActive, toolActive } = props;
  return (
    <section className={`jcc-core jcc-core--${phase}`} data-fx={fx} aria-live="polite">
      <div
        className="jcc-core__stage"
        role="img"
        aria-label={`Jarvis core ${phase}${memoryActive ? ', memory evidence present' : ''}${toolActive ? ', tool evidence present' : ''}`}
      >
        <span className="jcc-core__halo" />
        <span className={`jcc-core__ring jcc-core__ring--memory${memoryActive ? ' is-lit' : ''}`} />
        <span className="jcc-core__ring jcc-core__ring--mid" />
        <span className="jcc-core__ring jcc-core__ring--inner" />
        <span className="jcc-core__wave" />
        {Array.from({ length: PARTICLE_COUNT }, (_, index) => (
          <span
            key={index}
            className="jcc-core__particle"
            style={{ '--i': index } as CSSProperties}
          />
        ))}
        <span className={`jcc-core__orbit${toolActive ? ' is-lit' : ''}`} aria-hidden="true">
          <span className="jcc-core__node" />
          <span className="jcc-core__node" />
          <span className="jcc-core__node" />
        </span>
        <span className="jcc-core__nucleus">
          <strong>JARVIS</strong>
          <em>CORE</em>
        </span>
      </div>
      <p className="jcc-core__phase">{phase}</p>
      {answer ? <p className="jcc-core__answer">{answer}</p> : (
        <p className="jcc-core__answer jcc-core__answer--empty">Awaiting a request</p>
      )}
    </section>
  );
}
