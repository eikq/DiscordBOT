/**
 * Project aliases resolve through registered workspace/project records only.
 * Memory text cannot become a filesystem path.
 */

import { looksLikeSecret } from '../security/redaction';

export type RegisteredWorkspace = {
  id: string;
  displayName: string;
  root?: string;
};

export type RegisteredProject = {
  id: string;
  displayName: string;
  path: string;
  installed: boolean;
};

export type WorkspaceAuthorityResult =
  | { ok: true; workspaceId: string; projectId: string; label: string; path?: string; evidence: 'workspace-registry' | 'project-allowlist' }
  | {
      ok: false;
      reasonCode: 'WORKSPACE_UNREGISTERED' | 'FABRICATED_WORKSPACE_PATH' | 'AMBIGUOUS_WORKSPACE';
      message: string;
    };

const PATH_LIKE = /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/u;

export function looksLikeFilesystemPath(value: string): boolean {
  const text = value.trim();
  return PATH_LIKE.test(text) || /[\\/]/.test(text) && /\.(ts|js|json|md)$/iu.test(text);
}

export function resolveRegisteredWorkspace(
  phrase: string | undefined,
  options: {
    workspaces?: RegisteredWorkspace[];
    projects?: RegisteredProject[];
    currentWorkspaceId?: string;
  } = {},
): WorkspaceAuthorityResult {
  const raw = (phrase || '').trim();
  if (raw && (looksLikeFilesystemPath(raw) || looksLikeSecret(raw))) {
    return {
      ok: false,
      reasonCode: 'FABRICATED_WORKSPACE_PATH',
      message: 'I will not open a filesystem path from memory text. Use a registered workspace.',
    };
  }

  const workspaces = options.workspaces ?? [];
  const projects = options.projects ?? [];
  const needle = collapse(raw || 'the project');
  const current = options.currentWorkspaceId;

  if ((!raw || /^(the )?project$|โปรเจกต์|โปรเจค/iu.test(raw)) && current) {
    const workspace = workspaces.find(item => item.id === current);
    const project = projects.find(item => item.id === current);
    if (workspace || project) {
      return {
        ok: true,
        workspaceId: current,
        projectId: project?.id || current,
        label: workspace?.displayName || project?.displayName || current,
        path: project?.path,
        evidence: workspace ? 'workspace-registry' : 'project-allowlist',
      };
    }
  }

  const workspaceHits = workspaces.filter(item => matches(needle, item.id, item.displayName));
  const projectHits = projects.filter(item => matches(needle, item.id, item.displayName));
  const ids = [...new Set([...workspaceHits.map(item => item.id), ...projectHits.map(item => item.id)])];
  if (ids.length > 1) {
    return { ok: false, reasonCode: 'AMBIGUOUS_WORKSPACE', message: 'Which registered project do you mean?' };
  }
  if (ids.length === 1) {
    const id = ids[0]!;
    const workspace = workspaces.find(item => item.id === id);
    const project = projects.find(item => item.id === id);
    return {
      ok: true,
      workspaceId: id,
      projectId: id,
      label: workspace?.displayName || project?.displayName || id,
      path: project?.path,
      evidence: workspace ? 'workspace-registry' : 'project-allowlist',
    };
  }
  return {
    ok: false,
    reasonCode: 'WORKSPACE_UNREGISTERED',
    message: 'I do not have a registered workspace for that name.',
  };
}

function matches(needle: string, id: string, displayName: string): boolean {
  if (!needle) return false;
  const names = [id, displayName, id.replace(/-/g, ' ')].map(collapse);
  return names.some(name => name && (needle === name || needle.includes(name) || name.includes(needle)));
}

function collapse(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]+/giu, '');
}
