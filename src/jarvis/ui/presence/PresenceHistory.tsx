import { useMemo, useState } from 'react';
import type { PresenceHistoryItem } from './buildSurface';

export function PresenceHistory(props: {
  items: PresenceHistoryItem[];
  query: string;
  onQuery: (value: string) => void;
  onReopen?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => {
    const needle = props.query.trim().toLocaleLowerCase();
    if (!needle) return props.items.slice(-8);
    return props.items.filter(item => item.text.toLocaleLowerCase().includes(needle)).slice(-8);
  }, [props.items, props.query]);
  const related = useMemo(() => {
    const latest = [...props.items].reverse().find(item => item.goalId || item.planId);
    if (!latest) return null;
    return [latest.goalId, latest.planId].filter(Boolean).join(' · ');
  }, [props.items]);

  return (
    <aside className="jp-history" data-open={open ? 'true' : 'false'}>
      <button type="button" className="jp-history__toggle" onClick={() => setOpen(value => !value)}>
        History
      </button>
      {open ? (
        <div className="jp-history__panel">
          <input
            aria-label="Search visible messages"
            placeholder="Search turns"
            value={props.query}
            onChange={event => props.onQuery(event.target.value)}
          />
          {related ? <p className="jp-history__related">Related: {related}</p> : null}
          <ul>
            {filtered.map(item => (
              <li key={item.id} data-role={item.role} data-status={item.status || 'completed'}>
                <button type="button" onClick={() => props.onReopen?.(item.id)}>
                  <strong>{item.role}</strong>
                  <span>{item.text.slice(0, 140) || '(incomplete)'}</span>
                  {item.goalId || item.planId ? (
                    <small>{[item.goalId, item.planId].filter(Boolean).join(' · ')}</small>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
