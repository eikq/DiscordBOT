import {
  QWEN38_CYBER_PROFILE_ID,
  qwen38CyberProfile,
} from './qwen38Cyber';
import type { ModelProfile } from './types';

export type TrustedRuntimeModelIdentity = {
  id: string;
  alias: string;
  displayName: string;
  family: string;
  architecture: string;
  source: 'profile-registry' | 'profile-registry+models';
  modelsEndpointId?: string;
  selectedProvider: string;
  immutable: true;
};

export function trustedRuntimeModelIdentity(input: {
  profile?: ModelProfile;
  selectedId?: string;
  models?: Array<{ id?: string }>;
} = {}): TrustedRuntimeModelIdentity {
  const canonical = qwen38CyberProfile();
  const selected = (input.selectedId || input.profile?.id || QWEN38_CYBER_PROFILE_ID).trim() || QWEN38_CYBER_PROFILE_ID;
  const useCanonical = selected === QWEN38_CYBER_PROFILE_ID || selected.startsWith('qwen38-cyber');
  const endpoint = input.models?.map(item => String(item.id || '').trim()).find(Boolean);
  return {
    id: useCanonical ? canonical.id : (input.profile?.id || canonical.id),
    alias: useCanonical ? QWEN38_CYBER_PROFILE_ID : selected,
    displayName: useCanonical ? canonical.displayName : (input.profile?.displayName || canonical.displayName),
    family: useCanonical ? (canonical.family || canonical.displayName) : (input.profile?.family || canonical.family || canonical.displayName),
    architecture: useCanonical ? (canonical.architecture || 'Qwen3.8') : (input.profile?.architecture || canonical.architecture || 'Qwen3.8'),
    source: endpoint ? 'profile-registry+models' : 'profile-registry',
    modelsEndpointId: endpoint,
    selectedProvider: 'local-openai-compatible',
    immutable: true,
  };
}

export function spokenTrustedModelIdentity(identity = trustedRuntimeModelIdentity()): string {
  return `ตอนนี้ใช้โมเดล ${identity.displayName} (alias ${identity.alias})`;
}

export function isModelIdentityQuestion(text: string): boolean {
  const raw = text.trim();
  if (!raw) return false;
  return /ตอนนี้ใช้โมเดลอะไร|ใช้โมเดลอะไร|โมเดลอะไรอยู่|what model|which model|what(?:'s| is) (?:the )?model/iu.test(raw);
}
