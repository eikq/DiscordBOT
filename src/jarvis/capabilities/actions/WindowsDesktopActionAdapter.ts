import { spawn } from 'node:child_process';
import { applicationById, projectById } from './allowlists';
import type { DesktopActionAdapter, ScopedDesktopResult } from './DesktopActionAdapter';
import { loadSettingsAllowlist, settingsById } from './settingsAllowlist';
import type { DesktopAllowlists, DesktopLaunchResult } from './types';
import { classifyOpenUrl } from './urlSafety';
import { enumerateWindowsDisplays, placeAllowlistedWindow, windowPlacementAgainstDisplay } from '../../desktop/windowsDisplayHost';
import type { DisplayInfo } from '../../desktop/monitorTopology';

export class WindowsDesktopActionAdapter implements DesktopActionAdapter {
  constructor(private readonly lists: DesktopAllowlists) {}

  public async openApplication(applicationId: string): Promise<DesktopLaunchResult> {
    const app = applicationById(this.lists, applicationId);
    if (!app) return { status: 'failed', errorCode: 'UNKNOWN_APPLICATION' };
    if (!app.installed || !app.executable) return { status: 'unavailable', errorCode: 'NOT_INSTALLED' };
    return launchExact(app.executable, app.allowedArgs);
  }

  public async openApplicationWithProject(applicationId: string, projectId: string): Promise<DesktopLaunchResult> {
    if (applicationId !== 'cursor' && applicationId !== 'vscode') {
      return { status: 'failed', errorCode: 'UNKNOWN_APPLICATION' };
    }
    const app = applicationById(this.lists, applicationId);
    const project = projectById(this.lists, projectId);
    if (!app) return { status: 'failed', errorCode: 'UNKNOWN_APPLICATION' };
    if (!app.installed || !app.executable) return { status: 'unavailable', errorCode: 'NOT_INSTALLED' };
    if (!project?.installed || !project.path) return { status: 'unavailable', errorCode: 'PROJECT_UNAVAILABLE' };
    return launchExact(app.executable, [project.path]);
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

  public async listDisplays(): Promise<DisplayInfo[]> {
    return enumerateWindowsDisplays();
  }

  public async placeWindow(input: {
    processName: string;
    displayId: string;
    windowHandle?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }): Promise<ScopedDesktopResult> {
    const hasBounds = [input.x, input.y, input.width, input.height].every(value => Number.isInteger(value));
    const displays = hasBounds ? [] : await this.listDisplays();
    const display = hasBounds
      ? {
        id: input.displayId,
        name: input.displayId,
        primary: false,
        x: input.x!,
        y: input.y!,
        width: input.width!,
        height: input.height!,
      }
      : displays.find(item => item.id === input.displayId);
    if (!display) {
      return { status: 'unavailable', errorCode: 'DISPLAY_NOT_FOUND', placement: 'unverified', placementReason: 'DISPLAY_NOT_FOUND' };
    }
    const placed = await placeAllowlistedWindow({
      processName: input.processName,
      x: display.x,
      y: display.y,
      width: Math.max(800, Math.floor(display.width * 0.92)),
      height: Math.max(600, Math.floor(display.height * 0.92)),
      ...(input.windowHandle ? { windowHandle: input.windowHandle } : {}),
    });
    if (placed.ok !== true) {
      return {
        status: placed.reasonCode === 'WINDOW_NOT_FOUND' ? 'unavailable' : 'failed',
        errorCode: placed.reasonCode,
        placement: 'failed',
        placementReason: placed.reasonCode,
      };
    }
    const verified = windowPlacementAgainstDisplay(placed.window, [display, ...displays], display.id);
    return {
      status: 'started',
      placement: verified.verifiedOnIntended ? 'placed' : 'unverified',
      placementReason: verified.verifiedOnIntended ? undefined : 'PLACEMENT_UNVERIFIED',
      displayId: display.id,
      ...(placed.window?.handle ? { windowHandle: placed.window.handle } : {}),
    };
  }

  public async focusWindow(input: { processName: string }): Promise<ScopedDesktopResult> {
    const displays = await this.listDisplays();
    const primary = displays.find(item => item.primary) || displays[0];
    if (!primary) return { status: 'unavailable', errorCode: 'DISPLAY_TOPOLOGY_UNKNOWN', placement: 'unverified' };
    return this.placeWindow({ processName: input.processName, displayId: primary.id });
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
