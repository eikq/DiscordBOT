import type { DesktopLaunchResult } from './types';

export interface DesktopActionAdapter {
  openApplication(applicationId: string): Promise<DesktopLaunchResult>;
  openProject(projectId: string): Promise<DesktopLaunchResult>;
  openUrl(url: string): Promise<DesktopLaunchResult>;
  openSettings?(settingsId: string): Promise<DesktopLaunchResult>;
}
