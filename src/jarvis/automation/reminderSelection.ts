import type { ReminderRecord } from './types';

export type SelectionResult =
  | { kind: 'one'; reminder: ReminderRecord }
  | { kind: 'none' }
  | { kind: 'many'; reminders: ReminderRecord[] };

export function selectReminders(reminders: ReminderRecord[], query: string): SelectionResult {
  const needle = normalize(query);
  if (!needle) {
    if (reminders.length === 1) return { kind: 'one', reminder: reminders[0] };
    return reminders.length === 0 ? { kind: 'none' } : { kind: 'many', reminders };
  }
  const matches = reminders.filter(item => {
    const hay = normalize(`${item.title} ${item.message}`);
    return hay.includes(needle) || item.id === query.trim();
  });
  if (matches.length === 1) return { kind: 'one', reminder: matches[0] };
  if (matches.length === 0) return { kind: 'none' };
  return { kind: 'many', reminders: matches };
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/เตือน|reminder|เรื่อง|อันที่|the|for/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
