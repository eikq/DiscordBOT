export const PRIVILEGE_LEASE_PREFIX = 'lease_';
export const DEFAULT_LEASE_TTL_MS = 15 * 60_000;
export const MAX_LEASE_TTL_MS = 2 * 60 * 60_000;
export const DEFAULT_LEASE_MAX_ACTIONS = 8;
export const ABSOLUTE_LEASE_MAX_ACTIONS = 32;

export const TYPED_CAPABILITY_ALIASES = {
  search_project: 'workspace.search',
  read_project_file: 'workspace.getDocument',
  write_project_file: null,
  run_project_test: null,
  research_web: 'research.current',
  research_private_browse: 'research.privateBrowse',
  query_memory: null,
  inspect_system_metric: 'jarvis.runtimeStatus',
  restart_specific_service: 'jarvis.restartService',
} as const;

export const LEASE_REQUIRED_CAPABILITY_IDS = [
  'research.privateBrowse',
] as const;

export const FORBIDDEN_GENERIC_SHELL_IDS = [
  'shell',
  'shell.exec',
  'system.shell',
  'desktop.runCommand',
  'process.exec',
] as const;

export function capabilityRequiresLease(id: string): boolean {
  return (LEASE_REQUIRED_CAPABILITY_IDS as readonly string[]).includes(id);
}

export function isForbiddenGenericShell(id: string): boolean {
  return (FORBIDDEN_GENERIC_SHELL_IDS as readonly string[]).includes(id)
    || /^(shell|cmd|powershell|bash)(\.|$)/iu.test(id);
}
