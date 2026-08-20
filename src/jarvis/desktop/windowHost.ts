import { spawn } from 'node:child_process';
import { applyOwnerDisplayNames, displayContaining, loadOwnerDisplayNames, resolveDisplaySelector } from './displayNames';
import type { JarvisPresenceStore } from './presenceStore';
import type {
  DesktopHostKind,
  DisplayBounds,
  DisplayInfo,
  DisplaySelector,
  JarvisLayout,
  JarvisWindowInfo,
  ListDisplaysResult,
  OwnerDisplayName,
  WindowOpResult,
} from './types';

export type NativeJarvisWindowAdapter = {
  listDisplays?: () => Promise<DisplayInfo[]>;
  getWindow?: () => Promise<JarvisWindowInfo>;
  setBounds?: (bounds: DisplayBounds) => Promise<WindowOpResult>;
  focus?: () => Promise<WindowOpResult>;
  setLayout?: (layout: Exclude<JarvisLayout, 'restore' | 'presenter'>, display?: DisplayInfo) => Promise<WindowOpResult>;
};

export type JarvisWindowHostOptions = {
  presence: JarvisPresenceStore;
  hostKind?: DesktopHostKind;
  ownerNames?: OwnerDisplayName[];
  native?: NativeJarvisWindowAdapter;
  enumerateDisplays?: () => Promise<DisplayInfo[]>;
  now?: () => number;
};

export class JarvisWindowHost {
  constructor(private readonly options: JarvisWindowHostOptions) {}

  public hostKind(): DesktopHostKind {
    if (this.options.hostKind) return this.options.hostKind;
    if (this.options.native) return 'native-helper';
    if (typeof process.versions.electron === 'string') return 'electron';
    return 'browser';
  }

  public canMoveNative(): boolean {
    return Boolean(this.options.native?.setBounds);
  }

  public async listDisplays(): Promise<ListDisplaysResult> {
    const hostKind = this.hostKind();
    try {
      const raw = this.options.enumerateDisplays
        ? await this.options.enumerateDisplays()
        : this.options.native?.listDisplays
          ? await this.options.native.listDisplays()
          : await enumerateWindowsDisplays();
      const names = this.options.ownerNames ?? loadOwnerDisplayNames();
      const displays = applyOwnerDisplayNames(raw, names);
      if (displays.length === 0) {
        return {
          status: 'unavailable',
          reasonCode: hostKind === 'browser' && process.platform !== 'win32' ? 'UNSUPPORTED_HOST' : 'WINDOW_UNAVAILABLE',
          hostKind,
          displays: [],
          message: process.platform === 'win32'
            ? 'Display enumeration returned no screens.'
            : 'Display enumeration is unavailable on this host.',
        };
      }
      return {
        status: 'ok',
        hostKind,
        displays,
        primaryId: displays.find(item => item.primary)?.id,
        message: `${displays.length} display${displays.length === 1 ? '' : 's'} visible.`,
      };
    } catch {
      return {
        status: 'unavailable',
        reasonCode: 'UNSUPPORTED_HOST',
        hostKind,
        displays: [],
        message: 'Display APIs are unavailable. Fail-closed.',
      };
    }
  }

  public async getJarvisWindow(): Promise<WindowOpResult> {
    const listed = await this.listDisplays();
    const hostKind = this.hostKind();
    if (this.options.native?.getWindow) {
      const window = await this.options.native.getWindow();
      return {
        status: window.available ? 'reported' : 'unavailable',
        reasonCode: window.reasonCode,
        message: window.available
          ? `Jarvis window is on ${window.displayName || 'an unknown display'}.`
          : 'Jarvis window is not available.',
        hostKind,
        window,
      };
    }
    const window = this.options.presence.windowFromReport(listed.displays, hostKind);
    if (!window.available) {
      return {
        status: 'unavailable',
        reasonCode: 'WINDOW_UNAVAILABLE',
        message: 'Jarvis window bounds are unknown. The lab tab has not reported presence yet.',
        hostKind,
        window,
      };
    }
    return {
      status: 'reported',
      message: `Jarvis lab is on ${window.displayName || 'an unknown display'} (${window.source}).`,
      hostKind,
      window,
      display: listed.displays.find(item => item.id === window.displayId),
    };
  }

  public async moveJarvisWindow(selector: DisplaySelector): Promise<WindowOpResult> {
    const listed = await this.listDisplays();
    const current = await this.getJarvisWindow();
    const resolved = resolveDisplaySelector(listed.displays, selector, current.window?.displayId);
    if (resolved.ok === false) {
      return {
        status: 'unavailable',
        reasonCode: resolved.reasonCode,
        message: resolved.message,
        hostKind: this.hostKind(),
        window: current.window,
      };
    }
    const bounds = boundsOnDisplay(resolved.display, current.window?.bounds);
    return this.applyBounds(bounds, resolved.display, 'moved', `Moved Jarvis window to ${resolved.display.name}.`);
  }

  public async setJarvisWindowBounds(bounds: DisplayBounds): Promise<WindowOpResult> {
    if (!validBounds(bounds)) {
      return {
        status: 'failed',
        reasonCode: 'INVALID_BOUNDS',
        message: 'Those window bounds are not allowed.',
        hostKind: this.hostKind(),
      };
    }
    const listed = await this.listDisplays();
    const display = displayContaining(listed.displays, {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    });
    return this.applyBounds(bounds, display, 'resized', 'Updated Jarvis window bounds.');
  }

  public async focusJarvisWindow(): Promise<WindowOpResult> {
    if (this.options.native?.focus) {
      return this.options.native.focus();
    }
    return this.unsupported('Jarvis can only focus its own native window. The browser host cannot steal focus.');
  }

  public async setJarvisLayout(layout: JarvisLayout, selector?: DisplaySelector): Promise<WindowOpResult> {
    if (layout === 'restore') {
      const previous = this.options.presence.restoreBounds();
      if (!previous) {
        return {
          status: 'unavailable',
          reasonCode: 'WINDOW_UNAVAILABLE',
          message: 'No previous Jarvis window bounds are stored.',
          hostKind: this.hostKind(),
        };
      }
      return this.setJarvisWindowBounds(previous);
    }
    const listed = await this.listDisplays();
    const current = await this.getJarvisWindow();
    const resolved = selector
      ? resolveDisplaySelector(listed.displays, selector, current.window?.displayId)
      : current.window?.displayId
        ? { ok: true as const, display: listed.displays.find(item => item.id === current.window?.displayId) || listed.displays[0] }
        : { ok: true as const, display: listed.displays.find(item => item.primary) || listed.displays[0] };
    if (resolved.ok === false) {
      return {
        status: 'unavailable',
        reasonCode: resolved.reasonCode,
        message: resolved.message,
        hostKind: this.hostKind(),
        window: current.window,
      };
    }
    if (!resolved.display) {
      return {
        status: 'unavailable',
        reasonCode: 'DISPLAY_NOT_FOUND',
        message: 'No display is available for that layout.',
        hostKind: this.hostKind(),
      };
    }
    if (this.options.native?.setLayout && layout !== 'presenter') {
      return this.options.native.setLayout(layout, resolved.display);
    }
    if (layout === 'presenter' || layout === 'maximized') {
      return this.applyBounds(resolved.display.workingArea, resolved.display, 'layout-set', `Jarvis layout ${layout} on ${resolved.display.name}.`);
    }
    if (layout === 'normal') {
      const bounds = boundsOnDisplay(resolved.display, current.window?.bounds);
      return this.applyBounds(bounds, resolved.display, 'layout-set', `Jarvis layout normal on ${resolved.display.name}.`);
    }
    return this.unsupported('Minimize requires a native Jarvis window host.');
  }

  private async applyBounds(
    bounds: DisplayBounds,
    display: DisplayInfo | undefined,
    status: WindowOpResult['status'],
    message: string,
  ): Promise<WindowOpResult> {
    const current = await this.getJarvisWindow();
    if (current.window?.bounds) this.options.presence.rememberBounds(current.window.bounds);
    if (this.options.native?.setBounds) {
      const moved = await this.options.native.setBounds(bounds);
      return {
        ...moved,
        status: moved.status === 'unavailable' ? 'unavailable' : status,
        display,
        window: moved.window ?? {
          available: true,
          hostKind: this.hostKind(),
          bounds,
          displayId: display?.id,
          displayName: display?.name,
          state: 'normal',
          source: 'native',
        },
        message: moved.message || message,
      };
    }
    return this.unsupported(
      'The lab runs in a browser tab. Jarvis will not move Chrome or Edge. A native Jarvis window host is required.',
      current.window,
      display,
    );
  }

  private unsupported(message: string, window?: JarvisWindowInfo, display?: DisplayInfo): WindowOpResult {
    return {
      status: 'unavailable',
      reasonCode: 'UNSUPPORTED_HOST',
      message,
      hostKind: this.hostKind(),
      window,
      display,
    };
  }
}

export function createJarvisWindowHost(options: JarvisWindowHostOptions): JarvisWindowHost {
  return new JarvisWindowHost(options);
}

export function enumerateWindowsDisplays(): Promise<DisplayInfo[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '[System.Windows.Forms.Screen]::AllScreens | ForEach-Object {',
    '  [PSCustomObject]@{ DeviceName = $_.DeviceName; Primary = $_.Primary;',
    '    X = $_.Bounds.X; Y = $_.Bounds.Y; Width = $_.Bounds.Width; Height = $_.Bounds.Height;',
    '    WorkingX = $_.WorkingArea.X; WorkingY = $_.WorkingArea.Y;',
    '    WorkingWidth = $_.WorkingArea.Width; WorkingHeight = $_.WorkingArea.Height }',
    '} | ConvertTo-Json -Compress',
  ].join('; ');
  return new Promise(resolve => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve([]);
    }, 15_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { out += chunk; });
    child.on('error', () => {
      clearTimeout(timer);
      resolve([]);
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(parseDisplayJson(out));
    });
  });
}

export function parseDisplayJson(raw: string): DisplayInfo[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.flatMap((row, index) => {
      if (!row || typeof row !== 'object') return [];
      const item = row as Record<string, unknown>;
      const id = String(item.DeviceName || `DISPLAY${index + 1}`);
      const bounds = {
        x: num(item.X),
        y: num(item.Y),
        width: num(item.Width, 1),
        height: num(item.Height, 1),
      };
      return [{
        id,
        name: id.replace(/^\\\\.\\/u, ''),
        aliases: [id, String(index + 1)],
        primary: Boolean(item.Primary),
        bounds,
        workingArea: {
          x: num(item.WorkingX, bounds.x),
          y: num(item.WorkingY, bounds.y),
          width: num(item.WorkingWidth, bounds.width),
          height: num(item.WorkingHeight, bounds.height),
        },
        ownerNamed: false,
      }];
    });
  } catch {
    return [];
  }
}

function boundsOnDisplay(display: DisplayInfo, current?: DisplayBounds): DisplayBounds {
  const width = current?.width && current.width > 200 ? Math.min(current.width, display.workingArea.width) : Math.round(display.workingArea.width * 0.86);
  const height = current?.height && current.height > 200 ? Math.min(current.height, display.workingArea.height) : Math.round(display.workingArea.height * 0.86);
  return {
    x: display.workingArea.x + Math.round((display.workingArea.width - width) / 2),
    y: display.workingArea.y + Math.round((display.workingArea.height - height) / 2),
    width,
    height,
  };
}

function validBounds(bounds: DisplayBounds): boolean {
  return Number.isFinite(bounds.x) && Number.isFinite(bounds.y)
    && bounds.width >= 200 && bounds.width <= 16000
    && bounds.height >= 200 && bounds.height <= 16000
    && Math.abs(bounds.x) <= 20000 && Math.abs(bounds.y) <= 20000;
}

function num(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
