export const PROJECT_CREATE_WORKSPACE = 'project.createWorkspace';
export const PROJECT_WRITE_FILE = 'project.writeFile';
export const PROJECT_READ_FILE = 'project.readFile';
export const PROJECT_LIST_FILES = 'project.listFiles';
export const PROJECT_INSTALL_DEPENDENCIES = 'project.installDependencies';
export const PROJECT_RUN_SCRIPT = 'project.runScript';
export const PROJECT_RUN_TESTS = 'project.runTests';
export const PROJECT_BUILD = 'project.build';
export const PROJECT_START_DEV_SERVER = 'project.startDevServer';
export const PROJECT_STOP_DEV_SERVER = 'project.stopDevServer';
export const PROJECT_INSPECT_ARTIFACT = 'project.inspectArtifact';

export const PROJECT_CAPABILITY_IDS = [
  PROJECT_CREATE_WORKSPACE,
  PROJECT_WRITE_FILE,
  PROJECT_READ_FILE,
  PROJECT_LIST_FILES,
  PROJECT_INSTALL_DEPENDENCIES,
  PROJECT_RUN_SCRIPT,
  PROJECT_RUN_TESTS,
  PROJECT_BUILD,
  PROJECT_START_DEV_SERVER,
  PROJECT_STOP_DEV_SERVER,
  PROJECT_INSPECT_ARTIFACT,
] as const;

export const PROJECT_MUTATING_CAPABILITY_IDS = [
  PROJECT_CREATE_WORKSPACE,
  PROJECT_WRITE_FILE,
  PROJECT_INSTALL_DEPENDENCIES,
  PROJECT_RUN_SCRIPT,
  PROJECT_RUN_TESTS,
  PROJECT_BUILD,
  PROJECT_START_DEV_SERVER,
  PROJECT_STOP_DEV_SERVER,
] as const;

export const REGISTERED_PROJECT_SCRIPTS = ['build', 'test', 'lint', 'dev', 'preview'] as const;
export type RegisteredProjectScript = (typeof REGISTERED_PROJECT_SCRIPTS)[number];

export const ALLOWED_INSTALL_MODES = ['install', 'ci'] as const;
export type ProjectInstallMode = (typeof ALLOWED_INSTALL_MODES)[number];

export function isProjectCapabilityId(id: string): boolean {
  return (PROJECT_CAPABILITY_IDS as readonly string[]).includes(id);
}

export function isRegisteredProjectScript(value: string): value is RegisteredProjectScript {
  return (REGISTERED_PROJECT_SCRIPTS as readonly string[]).includes(value);
}
