import { jarvisEditionManifest } from './manifest';
import { resolveJarvisEdition } from './resolve';
import type { JarvisEdition } from './types';

export const PRIVATE_PROVIDER_IDS = [
  'worldIntel',
  'privateBrowser',
  'discord',
  'voiceClone',
  'nightAgent',
  'cctv',
  'devices',
  'desktop',
  'cybersecurity',
] as const;

export type PrivateProviderId = (typeof PRIVATE_PROVIDER_IDS)[number];

export type JarvisProviderPlan = {
  publicResearch: boolean;
} & Record<PrivateProviderId, boolean>;

const constructions: PrivateProviderId[] = [];
const launches: PrivateProviderId[] = [];

export function jarvisProviderPlan(edition: JarvisEdition = resolveJarvisEdition()): JarvisProviderPlan {
  const capabilities = jarvisEditionManifest(edition).capabilities;
  const owner = edition === 'owner';
  return {
    publicResearch: capabilities.research,
    worldIntel: capabilities.worldIntel,
    privateBrowser: capabilities.privateBrowser,
    discord: owner,
    voiceClone: owner,
    nightAgent: owner,
    cctv: capabilities.cctv,
    devices: capabilities.devices,
    desktop: capabilities.desktop,
    cybersecurity: capabilities.cybersecurity,
  };
}

export const COMMUNITY_PROVIDER_LOCK_ENV = 'JARVIS_COMMUNITY_PROVIDER_LOCK';

export function isCommunityProviderLock(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[COMMUNITY_PROVIDER_LOCK_ENV] === '1' || env[COMMUNITY_PROVIDER_LOCK_ENV] === 'true';
}

export function isPrivateProviderEnabled(
  id: PrivateProviderId,
  edition: JarvisEdition = resolveJarvisEdition(),
): boolean {
  return jarvisProviderPlan(edition)[id];
}

export function assertPrivateProviderAllowed(id: PrivateProviderId): void {
  if (isCommunityProviderLock()) {
    throw new Error(`Community Edition must not construct or start private provider: ${id}`);
  }
}

export function notePrivateProviderConstruction(id: PrivateProviderId): void {
  assertPrivateProviderAllowed(id);
  constructions.push(id);
}

export function notePrivateProviderLaunch(id: PrivateProviderId): void {
  assertPrivateProviderAllowed(id);
  launches.push(id);
}

/** @deprecated Use notePrivateProviderConstruction. */
export function assertCommunityMayConstruct(id: PrivateProviderId): void {
  notePrivateProviderConstruction(id);
}

export function privateProviderConstructions(): readonly PrivateProviderId[] {
  return constructions.slice();
}

export function privateProviderLaunches(): readonly PrivateProviderId[] {
  return launches.slice();
}

export function resetPrivateProviderConstructions(): void {
  constructions.length = 0;
  launches.length = 0;
}
