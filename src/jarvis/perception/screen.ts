import type { ScreenCaptureResult, ScreenCaptureTarget } from './types';

export type ScreenCapturePort = {
  captureDisplay(displayId?: string): Promise<ScreenCaptureResult>;
  captureJarvisWindow(): Promise<ScreenCaptureResult>;
  captureSelectedRegion(region: { x: number; y: number; width: number; height: number }): Promise<ScreenCaptureResult>;
};

/**
 * Mock screen capture. No click/type/submit/window-move APIs.
 * Cloud-only. Not LIVE_VERIFIED.
 */
export class MockScreenCapture implements ScreenCapturePort {
  public readonly events: string[] = [];

  public async captureDisplay(displayId = 'display-1'): Promise<ScreenCaptureResult> {
    return this.finish('display', `screen-display-${displayId}`, { displayId });
  }

  public async captureJarvisWindow(): Promise<ScreenCaptureResult> {
    return this.finish('jarvis_window', 'screen-jarvis-lab');
  }

  public async captureSelectedRegion(region: { x: number; y: number; width: number; height: number }): Promise<ScreenCaptureResult> {
    return this.finish('selected_region', 'screen-region', { region });
  }

  private finish(
    target: ScreenCaptureTarget,
    imageId: string,
    extra: Partial<Pick<ScreenCaptureResult, 'displayId' | 'region'>> = {},
  ): ScreenCaptureResult {
    this.events.push(`capture:${target}`);
    return {
      imageId,
      target,
      simulated: true,
      controlGranted: false,
      capturedAt: new Date(0).toISOString(),
      ...extra,
    };
  }
}

export function screenCaptureIsNotControl(result: ScreenCaptureResult): boolean {
  return result.controlGranted === false;
}
