import type { JarvisEventBus } from '../../security/eventBus';
import { assertDedicatedChromium, isBrowserDenied } from './browserPolicy';
import { interpretWebContent } from './injectionBoundary';
import { PrivateRouteHealthChecker } from './routeHealth';
import type { BrowserLaunchOptions, PrivateBrowseRequest, PrivateBrowseResult, PrivateRouteHealth } from './types';

export type PrivateBrowserWorker = {
  browse(request: PrivateBrowseRequest): Promise<PrivateBrowseResult>;
};

export type PrivateResearchGatewayOptions = {
  health?: PrivateRouteHealthChecker;
  worker?: PrivateBrowserWorker;
  bus?: JarvisEventBus;
  hostPlaywrightFallback?: boolean;
};

export class PrivateResearchGateway {
  private readonly health: PrivateRouteHealthChecker;

  constructor(private readonly options: PrivateResearchGatewayOptions = {}) {
    this.health = options.health ?? new PrivateRouteHealthChecker();
  }

  public async healthCheck(): Promise<PrivateRouteHealth> {
    const result = await this.health.check();
    this.options.bus?.emit('PRIVATE_ROUTE_CHECK', result.detail, {
      available: result.available,
      reasonCode: result.reasonCode,
    }, result.available ? 'info' : 'warn');
    return result;
  }

  public assertLaunch(options: BrowserLaunchOptions = {}): PrivateBrowseResult {
    const launch = assertDedicatedChromium(options);
    if (isBrowserDenied(launch)) {
      this.options.bus?.emit('PRIVILEGE_DENIED', launch.userMessage, { reasonCode: launch.reasonCode }, 'warn');
      return closed(launch.reasonCode, launch.userMessage);
    }
    return {
      status: 'ok',
      reasonCode: 'DEDICATED_CHROMIUM',
      userMessage: 'Dedicated Chromium launch is allowed only inside a healthy Whonix route.',
      available: true,
      usedOwnerBrowser: false,
      usedHostPlaywrightFallback: false,
    };
  }

  public async browse(request: PrivateBrowseRequest, launch: BrowserLaunchOptions = {}): Promise<PrivateBrowseResult> {
    if (this.options.hostPlaywrightFallback) {
      return closed('HOST_PLAYWRIGHT_FALLBACK_FORBIDDEN', 'PRIVATE_BROWSER must not fall back to host Playwright.');
    }
    const launchCheck = assertDedicatedChromium(launch);
    if (isBrowserDenied(launchCheck)) return closed(launchCheck.reasonCode, launchCheck.userMessage);

    const health = await this.healthCheck();
    if (!health.available) {
      this.options.bus?.emit('PRIVATE_ROUTE_CHECK', health.detail, { reasonCode: health.reasonCode }, 'warn');
      return closed(health.reasonCode, 'Private browser is unavailable. Jarvis will not use the owner browser or host Playwright.');
    }

    if (!this.options.worker) {
      return closed('PRIVATE_BROWSER_WORKER_UNAVAILABLE', 'Whonix Playwright worker is not attached. PRIVATE_BROWSER stays unavailable.');
    }

    this.options.bus?.emit('BROWSER_START', 'Private browser session starting', { depth: request.depth ?? 'standard' });
    try {
      const result = await this.options.worker.browse(request);
      return {
        ...result,
        usedOwnerBrowser: false,
        usedHostPlaywrightFallback: false,
      };
    } finally {
      this.options.bus?.emit('BROWSER_DESTROY', 'Private browser session destroyed', {});
    }
  }

  public interpretPage(text: string) {
    const interpreted = interpretWebContent(text);
    if (interpreted.injectionSignals.length) {
      this.options.bus?.emit('PROMPT_INJECTION', 'Webpage instruction ignored as untrusted data', {
        signals: interpreted.injectionSignals,
      }, 'warn');
    }
    return interpreted;
  }
}

function closed(reasonCode: string, userMessage: string): PrivateBrowseResult {
  return {
    status: reasonCode.includes('DENIED') || reasonCode.includes('FORBIDDEN') || reasonCode.includes('BLOCKED')
      ? 'denied'
      : 'unavailable',
    reasonCode,
    userMessage,
    available: false,
    usedOwnerBrowser: false,
    usedHostPlaywrightFallback: false,
  };
}
