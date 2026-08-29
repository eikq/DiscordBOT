import type { CapabilityDistributionClass } from './types';

const OWNER_ONLY_PREFIXES = [
  'devices.',
  'camera.',
  'cctv.',
  'phone.',
  'screen.',
  'cyber.',
  'cybersecurity.',
  'securityAcademy.',
  'media.',
] as const;

const CORE_SECURITY_PREFIXES = [
  'operator.',
  'jarvis.security.',
  'jarvis.permission.',
  'jarvis.verification.',
  'jarvis.rollback.',
] as const;

export function distributionForCapability(id: string): CapabilityDistributionClass[] {
  if (CORE_SECURITY_PREFIXES.some(prefix => id.startsWith(prefix))) return ['CORE'];
  if (OWNER_ONLY_PREFIXES.some(prefix => id.startsWith(prefix))) {
    return ['OWNER_ONLY', 'COMMUNITY_EXCLUDED', 'DEMO_EXCLUDED'];
  }
  return ['CORE'];
}

export function isOwnerOnlyCapability(id: string): boolean {
  return distributionForCapability(id).includes('OWNER_ONLY');
}

export function coreSecurityIsDistributionInvariant(id: string): boolean {
  return CORE_SECURITY_PREFIXES.some(prefix => id.startsWith(prefix));
}
