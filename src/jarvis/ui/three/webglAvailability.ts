export type WebglApiScope = {
  WebGL2RenderingContext?: unknown;
  WebGLRenderingContext?: unknown;
};

export type WebglCanvasConnection = {
  isConnected: boolean;
};

export type FrameScheduler = (callback: () => void) => void;

/**
 * Detect whether the browser exposes a WebGL API without allocating a context.
 *
 * Context creation belongs to R3F/Three.js. Creating a temporary context for
 * feature detection can race its asynchronous release or exhaust Chromium's
 * per-process context budget during repeated visual-QA reloads.
 */
export function webglAvailable(
  scope: WebglApiScope = globalThis,
): boolean {
  return typeof scope.WebGL2RenderingContext !== 'undefined'
    || typeof scope.WebGLRenderingContext !== 'undefined';
}

/**
 * Context disposal during React StrictMode's development remount can emit the
 * same event as a genuine GPU loss. Defer the decision until the next frame:
 * an intentionally removed Canvas is disconnected, while a live failed Canvas
 * remains attached and must activate the 2D fallback.
 */
export function scheduleWebglLossCheck(
  canvas: WebglCanvasConnection,
  onLost: () => void,
  schedule: FrameScheduler = callback => requestAnimationFrame(callback),
  isCurrent: () => boolean = () => true,
): void {
  schedule(() => {
    if (canvas.isConnected && isCurrent()) onLost();
  });
}
