import type { DesktopLaunchResult } from './types';
import type { DisplayInfo } from '../../desktop/monitorTopology';

export type ScopedDesktopResult = DesktopLaunchResult & {
  placement?: 'placed' | 'skipped' | 'unverified' | 'failed';
  placementReason?: string;
  displayId?: string;
  windowHandle?: string;
};

export interface DesktopActionAdapter {
  openApplication(applicationId: string): Promise<DesktopLaunchResult>;
  openProject(projectId: string): Promise<DesktopLaunchResult>;
  openUrl(url: string): Promise<DesktopLaunchResult>;
  openSettings?(settingsId: string): Promise<DesktopLaunchResult>;
  listDisplays?(): Promise<DisplayInfo[]>;
  placeWindow?(input: {
    processName: string;
    displayId: string;
    windowHandle?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }): Promise<ScopedDesktopResult>;
  focusWindow?(input: { processName: string }): Promise<ScopedDesktopResult>;
  openApplicationWithProject?(applicationId: string, projectId: string): Promise<DesktopLaunchResult>;
}
