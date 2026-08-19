import { spawn } from 'node:child_process';
import { applicationById, projectById } from './allowlists';
import type { DesktopActionAdapter } from './DesktopActionAdapter';
import { loadSettingsAllowlist, settingsById } from './settingsAllowlist';
import type { DesktopAllowlists, DesktopLaunchResult } from './types';
import { classifyOpenUrl } from './urlSafety';

export class WindowsDesktopActionAdapter implements DesktopActionAdapter {
  constructor(private readonly lists: DesktopAllowlists) {}

  public async openApplication(applicationId: string): Promise<DesktopLaunchResult> {
    const app = applicationById(this.lists, applicationId);
    if (!app) return { status: 'failed', errorCode: 'UNKNOWN_APPLICATION' };
    if (!app.installed || !app.executable) return { status: 'unavailable', errorCode: 'NOT_INSTALLED' };
    return launchExact(app.executable, app.allowedArgs);
  }

  public async openProject(projectId: string): Promise<DesktopLaunchResult> {
    const project = projectById(this.lists, projectId);
    if (!project) return { status: 'failed', errorCode: 'UNKNOWN_PROJECT' };
    if (!project.installed || !project.path) return { status: 'unavailable', errorCode: 'PROJECT_UNAVAILABLE' };
    const explorer = this.lists.explorerExecutable;
    if (!explorer) return { status: 'unavailable', errorCode: 'EXPLORER_UNAVAILABLE' };
    return launchExact(explorer, [project.path]);
  }

  public async openSettings(settingsId: string): Promise<DesktopLaunchResult> {
    const page = settingsById(loadSettingsAllowlist(this.lists.workspaceRoot), settingsId);
    if (!page) return { status: 'failed', errorCode: 'UNKNOWN_SETTINGS' };
    const explorer = this.lists.explorerExecutable;
    if (!explorer) return { status: 'unavailable', errorCode: 'EXPLORER_UNAVAILABLE' };
    return launchExact(explorer, [page.uri]);
  }

  public async openUrl(url: string): Promise<DesktopLaunchResult> {
    const classified = classifyOpenUrl(url, this.lists);
    if (!classified.ok || !classified.normalized) {
      return { status: 'failed', errorCode: classified.reasonCode || 'URL_NOT_ALLOWED' };
    }
    const explorer = this.lists.explorerExecutable;
    if (!explorer) return { status: 'unavailable', errorCode: 'EXPLORER_UNAVAILABLE' };
    return launchExact(explorer, [classified.normalized]);
  }
}

function launchExact(executable: string, args: readonly string[]): Promise<DesktopLaunchResult> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (result: DesktopLaunchResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      const child = spawn(executable, [...args], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: false,
      });
      const timer = setTimeout(() => {
        finish({ status: 'failed', errorCode: 'SPAWN_TIMEOUT' });
      }, 3_000);
      child.once('error', error => {
        clearTimeout(timer);
        finish({
          status: 'failed',
          errorCode: 'SPAWN_FAILED',
          message: error instanceof Error ? error.message : String(error),
        });
      });
      child.once('spawn', () => {
        clearTimeout(timer);
        child.unref();
        finish({ status: 'started' });
      });
    } catch (error) {
      finish({
        status: 'failed',
        errorCode: 'SPAWN_FAILED',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
