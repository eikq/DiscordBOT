import { spawn } from 'node:child_process';
import { applicationById, projectById } from './allowlists';
import type { DesktopActionAdapter, ScopedDesktopResult } from './DesktopActionAdapter';
import { loadSettingsAllowlist, settingsById } from './settingsAllowlist';
import type { DesktopAllowlists, DesktopLaunchResult } from './types';
import { classifyOpenUrl } from './urlSafety';
import {
  enumerateWindowsDisplays,
  focusAllowlistedWindow,
  placeAllowlistedWindow,
  processNameForApplication,
  WindowsDesktopPerception,
} from '../../desktop/windowsDisplayHost';
import { verifyPlacement } from '../../desktop/perception';
import type { DisplayInfo } from '../../desktop/monitorTopology';
import { notePrivateProviderConstruction } from '../../edition/providers';

const NEW_WINDOW_ARG = '--new-window';

export class WindowsDesktopActionAdapter implements DesktopActionAdapter {
  private readonly perception = new WindowsDesktopPerception();

  constructor(private readonly lists: DesktopAllowlists) {
    notePrivateProviderConstruction('desktop');
  }

  public async openApplication(applicationId: string): Promise<DesktopLaunchResult> {
    const app = applicationById(this.lists, applicationId);
    if (!app) return { status: 'failed', errorCode: 'UNKNOWN_APPLICATION' };
    if (!app.installed || !app.executable) return { status: 'unavailable', errorCode: 'NOT_INSTALLED' };
    return launchExact(app.executable, app.allowedArgs, processNameForApplication(applicationId) || undefined);
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
    return launchExact(app.executable, [project.path], processNameForApplication(applicationId) || undefined);
  }

  public async openProject(projectId: string): Promise<DesktopLaunchResult> {
    const project = projectById(this.lists, projectId);
    if (!project) return { status: 'failed', errorCode: 'UNKNOWN_PROJECT' };
    if (!project.installed || !project.path) return { status: 'unavailable', errorCode: 'PROJECT_UNAVAILABLE' };
    const explorer = this.lists.explorerExecutable;
    if (!explorer) return { status: 'unavailable', errorCode: 'EXPLORER_UNAVAILABLE' };
    return launchExact(explorer, [project.path], 'explorer');
  }

  public async openSettings(settingsId: string): Promise<DesktopLaunchResult> {
    const page = settingsById(loadSettingsAllowlist(this.lists.workspaceRoot), settingsId);
    if (!page) return { status: 'failed', errorCode: 'UNKNOWN_SETTINGS' };
    const explorer = this.lists.explorerExecutable;
    if (!explorer) return { status: 'unavailable', errorCode: 'EXPLORER_UNAVAILABLE' };
    return launchExact(explorer, [page.uri], 'explorer');
  }

  public async listDisplays(): Promise<DisplayInfo[]> {
    return enumerateWindowsDisplays();
  }

  public async perceiveDesktop() {
    return this.perception.snapshot();
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
    const displays = await this.listDisplays();
    const display = displays.find(item => item.id === input.displayId) || (
      [input.x, input.y, input.width, input.height].every(value => Number.isInteger(value))
        ? {
          id: input.displayId,
          name: input.displayId,
          primary: false,
          x: input.x!,
          y: input.y!,
          width: input.width!,
          height: input.height!,
        }
        : undefined
    );
    if (!display) {
      return { status: 'unavailable', errorCode: 'DISPLAY_NOT_FOUND', placement: 'unverified', placementReason: 'DISPLAY_NOT_FOUND' };
    }
    if ((input.processName === 'chrome' || input.processName === 'msedge') && !input.windowHandle) {
      return {
        status: 'unavailable',
        errorCode: 'PLACE_REQUIRES_MANAGED_WINDOW',
        placement: 'unverified',
        placementReason: 'PLACE_REQUIRES_MANAGED_WINDOW',
      };
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
    const observed = placed.window
      ? { bounds: { x: placed.window.x, y: placed.window.y, width: placed.window.width, height: placed.window.height } }
      : undefined;
    const verified = verifyPlacement(observed, display);
    return {
      status: 'started',
      placement: verified.verified ? 'placed' : 'unverified',
      placementReason: verified.verified ? undefined : 'PLACEMENT_UNVERIFIED',
      displayId: display.id,
      displayFingerprint: verified.displayFingerprint,
      windowVerified: Boolean(placed.window),
      displayVerified: verified.verified,
      ...(placed.window?.handle ? { windowHandle: placed.window.handle } : {}),
    };
  }

  public async focusWindow(input: { processName?: string; windowHandle?: string }): Promise<ScopedDesktopResult> {
    if (!input.windowHandle) {
      return { status: 'unavailable', errorCode: 'FOCUS_REQUIRES_MANAGED_WINDOW', placement: 'unverified' };
    }
    const focused = await focusAllowlistedWindow({ windowHandle: input.windowHandle });
    if (focused.ok !== true) {
      return { status: 'unavailable', errorCode: focused.reasonCode, focusVerified: false };
    }
    const observed = await this.perception.getWindow(focused.windowHandle);
    const focusVerified = focused.verified || observed?.foreground === true;
    return {
      status: 'started',
      windowHandle: focused.windowHandle,
      focusVerified,
      ...(focusVerified ? {} : { errorCode: 'FOCUS_UNVERIFIED' }),
    };
  }

  public async openUrl(url: string): Promise<DesktopLaunchResult> {
    const classified = classifyOpenUrl(url, this.lists);
    if (!classified.ok || !classified.normalized) {
      return { status: 'failed', errorCode: classified.reasonCode || 'URL_NOT_ALLOWED' };
    }
    const browser = approvedBrowser(this.lists);
    if (browser) {
      const launched = await launchExact(browser.executable, [NEW_WINDOW_ARG, classified.normalized], browser.processName);
      return { ...launched, dedicatedWindow: launched.status === 'started' };
    }
    const explorer = this.lists.explorerExecutable;
    if (!explorer) return { status: 'unavailable', errorCode: 'EXPLORER_UNAVAILABLE' };
    return launchExact(explorer, [classified.normalized], 'chrome');
  }
}

function approvedBrowser(lists: DesktopAllowlists): { executable: string; processName: string } | null {
  const chrome = applicationById(lists, 'chrome');
  if (chrome?.installed && chrome.executable) return { executable: chrome.executable, processName: 'chrome' };
  const edge = applicationById(lists, 'msedge');
  if (edge?.installed && edge.executable) return { executable: edge.executable, processName: 'msedge' };
  return null;
}

function launchExact(executable: string, args: readonly string[], processName?: string): Promise<DesktopLaunchResult> {
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
        finish({ status: 'started', processName, dedicatedWindow: args[0] === NEW_WINDOW_ARG });
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
