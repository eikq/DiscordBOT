import type { DesktopLaunchResult } from './types';
import type { DisplayInfo } from '../../desktop/monitorTopology';

export type ScopedDesktopResult = DesktopLaunchResult & {
  placement?: 'placed' | 'skipped' | 'unverified' | 'failed';
  placementReason?: string;
  displayId?: string;
};

export interface DesktopActionAdapter {
  openApplication(applicationId: string): Promise<DesktopLaunchResult>;
  openProject(projectId: string): Promise<DesktopLaunchResult>;
  openUrl(url: string): Promise<DesktopLaunchResult>;
  openSettings?(settingsId: string): Promise<DesktopLaunchResult>;
  listDisplays?(): Promise<DisplayInfo[]>;
  placeWindow?(input: { processName: string; displayId: string }): Promise<ScopedDesktopResult>;
  focusWindow?(input: { processName: string }): Promise<ScopedDesktopResult>;
}
