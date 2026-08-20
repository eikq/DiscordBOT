import { applyBriefingFollowUp } from '../presentation/briefing/followUp';
import type { PlannedPresentation, PresentationFollowUpId } from '../presentation/briefing/types';
import { focusedTargetId, prefersReducedMotion, visibleMotionCues } from './presenterMotion';

type Props = {
  briefing: PlannedPresentation | undefined;
  open: boolean;
  onClose: () => void;
  onBriefingChange: (next: PlannedPresentation) => void;
  spokenAtMs?: number;
};

export default function PresenterBriefing({
  briefing,
  open,
  onClose,
  onBriefingChange,
  spokenAtMs = 0,
}: Props) {
  if (!open) return null;
  if (!briefing || briefing.density === 'plain') {
    return (
      <aside className="jcc-presenter" aria-label="Presenter briefing">
        <header>
          <h2>Presenter</h2>
          <button type="button" onClick={onClose} aria-label="Close presenter">×</button>
        </header>
        <p className="jcc-empty">This turn stays a lightweight reply. Rich briefing is reserved for research, comparisons, diagnostics, and multi-section reports.</p>
      </aside>
    );
  }

  const reduced = prefersReducedMotion();
  const cues = visibleMotionCues(briefing, spokenAtMs);
  const focused = focusedTargetId(cues);
  const follow = (id: PresentationFollowUpId, targetId?: string) => {
    onBriefingChange(applyBriefingFollowUp(briefing, id, targetId));
  };

  return (
    <aside className={`jcc-presenter${reduced ? ' is-reduced' : ''}`} aria-label="Presenter briefing">
      <header>
        <p className="jcc-hint">{briefing.mode}</p>
        <h2>{briefing.title}</h2>
        <button type="button" onClick={onClose} aria-label="Close presenter">×</button>
      </header>
      {briefing.subtitle ? <p className="jcc-hint">{briefing.subtitle}</p> : null}
      <p className="jcc-presenter__spoken">{briefing.spokenSummary}</p>
      <div className="jcc-presenter__sections">
        {briefing.sections.map(section => (
          <section
            key={section.id}
            id={section.id}
            className={`jcc-presenter__section${focused === section.id ? ' is-focused' : ''}`}
            data-kind={section.kind}
          >
            <h3>{section.title}</h3>
            <p>{section.body}</p>
          </section>
        ))}
      </div>
      {briefing.cards.length > 0 ? (
        <ul className="jcc-presenter__cards">
          {briefing.cards.map(card => (
            <li key={card.id} className={focused === card.id ? 'is-focused' : undefined} data-kind={card.kind}>
              <strong>{card.title}</strong>
              <span>{card.body}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {briefing.tables && briefing.tables.length > 0 ? (
        <div className="jcc-presenter__tables">
          {briefing.tables.map(table => (
            <table key={table.id}>
              <caption>{table.title}</caption>
              <thead>
                <tr>{table.headers.map(header => <th key={header}>{header}</th>)}</tr>
              </thead>
              <tbody>
                {table.rows.map((row, index) => (
                  <tr key={`${table.id}-${index}`}>
                    {row.map((cell, cellIndex) => <td key={`${table.id}-${index}-${cellIndex}`}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      ) : null}
      {briefing.evidence.length > 0 ? (
        <ul className="jcc-presenter__evidence">
          {briefing.evidence.map(item => (
            <li key={item.id} className={focused === item.id ? 'is-focused' : undefined}>
              {item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.label}</a> : item.label}
            </li>
          ))}
        </ul>
      ) : null}
      {briefing.recommendedActions.length > 0 ? (
        <ul className="jcc-presenter__actions">
          {briefing.recommendedActions.map((item, index) => (
            <li key={`rec-${index}`} className={focused === `rec-${index}` ? 'is-focused' : undefined}>{item}</li>
          ))}
        </ul>
      ) : null}
      {briefing.limitations.length > 0 ? (
        <p className="jcc-hint">Limits: {briefing.limitations.join(' ')}</p>
      ) : null}
      <div className="jcc-presenter__follows" role="group" aria-label="Briefing follow-ups">
        {briefing.followUpSuggestions.map(item => (
          <button key={item.id} type="button" onClick={() => follow(item.id, item.targetId)}>
            {item.label}
          </button>
        ))}
      </div>
    </aside>
  );
}
