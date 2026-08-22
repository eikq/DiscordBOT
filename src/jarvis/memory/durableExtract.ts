import { rememberOwnerPreference } from './ownerSemantics';
import type { JarvisMemoryStore } from '../../bot/memory/jarvis/store';

const PREFERENCE = /จำไว้ว่า(?:ผม|ฉัน)?(.+)|i prefer (.+)|remember that i (.+)/iu;

export function extractDurableOwnerMemory(
  store: JarvisMemoryStore | undefined,
  text: string,
  actor = 'owner',
): { stored: boolean; factKey?: string } {
  const match = PREFERENCE.exec(text.trim());
  if (!match || !store) return { stored: false };
  const value = (match[1] || match[2] || match[3] || '').trim();
  if (!value) return { stored: false };
  const written = rememberOwnerPreference(store, {
    key: preferenceKey(value),
    value,
    actor,
  });
  return written.ok ? { stored: true, factKey: written.factKey } : { stored: false };
}

function preferenceKey(value: string): string {
  if (/ตอบสั้น|short|concise|ตรง/iu.test(value)) return 'reply.style';
  if (/ไทย|thai/iu.test(value)) return 'speech.language';
  return 'owner.note';
}
