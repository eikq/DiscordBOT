import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DisplayInfo } from './monitorTopology';
import {
  buildPerceptionSnapshot,
  parseWindowSnapshotList,
  type DesktopPerceptionProvider,
  type DesktopPerceptionSnapshot,
  type WindowSnapshot,
} from './perception';
import { classifyWindowOnDisplays, parseWindowRectJson, type WindowRect } from './windowPlacement';

export type DisplayHostRunner = (script: string) => Promise<string>;

const DISP_TYPEDEF = [
  'using System; using System.Runtime.InteropServices;',
  'public class JarvisDisp {',
  '  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Auto)]',
  '  public struct DISPLAY_DEVICE {',
  '    public int cb;',
  '    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string DeviceName;',
  '    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceString;',
  '    public int StateFlags;',
  '    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceID;',
  '    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceKey;',
  '  }',
  '  [DllImport("user32.dll", CharSet=CharSet.Auto)]',
  '  public static extern bool EnumDisplayDevices(string device, uint devNum, ref DISPLAY_DEVICE info, uint flags);',
  '}',
].join(' ');

const WIN_TYPEDEF = [
  'using System; using System.Runtime.InteropServices;',
  'public class JarvisWin {',
  '  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr h, int x, int y, int cx, int cy, uint u);',
  '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);',
  '  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }',
  '}',
].join(' ');

const SEE_TYPEDEF = [
  'using System; using System.Collections.Generic; using System.Diagnostics; using System.Runtime.InteropServices; using System.Text;',
  'public class JarvisSee {',
  '  public delegate bool EnumProc(IntPtr hWnd, IntPtr l);',
  '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);',
  '  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);',
  '  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);',
  '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);',
  '  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);',
  '  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);',
  '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);',
  '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
  '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);',
  '  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }',
  '  public static string Snapshot() {',
  '    var fg = GetForegroundWindow();',
  '    var rows = new List<string>();',
  '    EnumWindows((h, l) => {',
  '      if (!IsWindowVisible(h)) return true;',
  '      var sb = new StringBuilder(512);',
  '      GetWindowText(h, sb, 512);',
  '      var title = sb.ToString();',
  '      if (string.IsNullOrWhiteSpace(title)) return true;',
  '      RECT r;',
  '      if (!GetWindowRect(h, out r)) return true;',
  '      int w = r.Right - r.Left; int ht = r.Bottom - r.Top;',
  '      if (w < 50 || ht < 50) return true;',
  '      uint pid; GetWindowThreadProcessId(h, out pid);',
  '      string name = "";',
  '      try { name = Process.GetProcessById((int)pid).ProcessName; } catch {}',
  '      rows.Add("{\\"Handle\\":" + ((long)h) + ",\\"ProcessId\\":" + pid + ",\\"ProcessName\\":" + JsonStr(name) + ",\\"Title\\":" + JsonStr(title) + ",\\"X\\":" + r.Left + ",\\"Y\\":" + r.Top + ",\\"Width\\":" + w + ",\\"Height\\":" + ht + ",\\"Visible\\":true,\\"Minimized\\":" + (IsIconic(h) ? "true" : "false") + ",\\"Maximized\\":" + (IsZoomed(h) ? "true" : "false") + ",\\"Foreground\\":" + (h == fg ? "true" : "false") + "}");',
  '      return true;',
  '    }, IntPtr.Zero);',
  '    return "[" + string.Join(",", rows.ToArray()) + "]";',
  '  }',
  '  static string JsonStr(string s) {',
  '    if (s == null) return "\\"\\"";',
  '    return "\\"" + s.Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"").Replace("\\r", " ").Replace("\\n", " ") + "\\"";',
  '  }',
  '}',
].join('\n');

const WIN_TYPE = `Add-Type -TypeDefinition '${WIN_TYPEDEF}'`;
export const DESKTOP_HOST_VERSION = 3;
const HOST_DIR = path.join(os.tmpdir(), `jarvis-desktop-host-v${DESKTOP_HOST_VERSION}`);
const HOST_DLL = path.join(HOST_DIR, 'JarvisDesktopHost.dll');
const HOST_CS = path.join(HOST_DIR, 'JarvisDesktopHost.cs');
const HOST_SOURCE = [
  'using System;',
  'using System.Collections.Generic;',
  'using System.Diagnostics;',
  'using System.Runtime.InteropServices;',
  'using System.Text;',
  DISP_TYPEDEF.replace('using System; using System.Runtime.InteropServices;', '').trim(),
  WIN_TYPEDEF.replace('using System; using System.Runtime.InteropServices;', '').trim(),
  SEE_TYPEDEF.replace('using System; using System.Collections.Generic; using System.Diagnostics; using System.Runtime.InteropServices; using System.Text;', '').trim(),
].join('\n');

export function desktopHostDllPath(): string {
  return HOST_DLL;
}

export function desktopHostUsesCachedAssembly(): boolean {
  return fs.existsSync(HOST_DLL);
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function typeLoadCommand(fallback: string): string {
  return fs.existsSync(HOST_DLL) ? `Add-Type -Path ${psQuote(HOST_DLL)}` : fallback;
}

function enumScript(): string {
  return [
    'Add-Type -AssemblyName System.Windows.Forms',
    typeLoadCommand(`Add-Type -TypeDefinition '${DISP_TYPEDEF}'`),
    'function Get-JarvisMonitorId([string]$name) {',
    '  $d = New-Object JarvisDisp+DISPLAY_DEVICE',
    '  $d.cb = [Runtime.InteropServices.Marshal]::SizeOf($d)',
    '  if ([JarvisDisp]::EnumDisplayDevices($name, 0, [ref]$d, 0)) { return $d.DeviceID }',
    '  return $null',
    '}',
    '[System.Windows.Forms.Screen]::AllScreens | ForEach-Object {',
    '  [pscustomobject]@{ DeviceName = $_.DeviceName; DevicePath = Get-JarvisMonitorId $_.DeviceName; Primary = $_.Primary; X = $_.Bounds.X; Y = $_.Bounds.Y; Width = $_.Bounds.Width; Height = $_.Bounds.Height }',
    '} | ConvertTo-Json -Compress',
  ].join('; ');
}

let hostCompile: Promise<string | null> | undefined;

export async function ensureDesktopHostAssembly(runner: DisplayHostRunner = runPowerShell): Promise<string | null> {
  if (fs.existsSync(HOST_DLL)) return HOST_DLL;
  if (!hostCompile) {
    hostCompile = (async () => {
      try {
        fs.mkdirSync(HOST_DIR, { recursive: true });
        fs.writeFileSync(HOST_CS, HOST_SOURCE, 'utf8');
        await runner(`Add-Type -Path ${psQuote(HOST_CS)} -OutputAssembly ${psQuote(HOST_DLL)}`);
        return fs.existsSync(HOST_DLL) ? HOST_DLL : null;
      } catch {
        return null;
      } finally {
        hostCompile = undefined;
      }
    })();
  }
  return hostCompile;
}

const FALLBACK_ENUM_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '[System.Windows.Forms.Screen]::AllScreens | ForEach-Object {',
  '  [pscustomobject]@{ DeviceName = $_.DeviceName; Primary = $_.Primary; X = $_.Bounds.X; Y = $_.Bounds.Y; Width = $_.Bounds.Width; Height = $_.Bounds.Height }',
  '} | ConvertTo-Json -Compress',
].join('; ');

export function parseDisplayJson(raw: string): DisplayInfo[] {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.flatMap((row, index) => {
      if (!row || typeof row !== 'object') return [];
      const item = row as Record<string, unknown>;
      const width = Number(item.Width);
      const height = Number(item.Height);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];
      const name = String(item.DeviceName || `Display ${index + 1}`);
      return [{
        id: name,
        name,
        deviceName: name,
        primary: Boolean(item.Primary),
        ...(item.Internal === true || item.Internal === 'True' ? { internal: true } : {}),
        ...(typeof item.DevicePath === 'string' && item.DevicePath ? { devicePath: String(item.DevicePath) } : {}),
        ...(typeof item.Manufacturer === 'string' && item.Manufacturer ? { manufacturer: String(item.Manufacturer) } : {}),
        ...(typeof item.Model === 'string' && item.Model ? { model: String(item.Model) } : {}),
        ...(typeof item.Serial === 'string' && item.Serial ? { serial: String(item.Serial) } : {}),
        ...(typeof item.ConnectionType === 'string' && item.ConnectionType ? { connectionType: String(item.ConnectionType) } : {}),
        x: Number(item.X) || 0,
        y: Number(item.Y) || 0,
        width,
        height,
      }];
    });
  } catch {
    return [];
  }
}

const ENUM_CACHE_MS = 30_000;
let enumCache: { at: number; displays: DisplayInfo[] } | undefined;

export async function enumerateWindowsDisplays(runner: DisplayHostRunner = runPowerShell): Promise<DisplayInfo[]> {
  if (runner === runPowerShell && enumCache && Date.now() - enumCache.at < ENUM_CACHE_MS) {
    return enumCache.displays;
  }
  if (runner === runPowerShell) await ensureDesktopHostAssembly(runner);
  let displays: DisplayInfo[] = [];
  try {
    displays = parseDisplayJson(await runner(enumScript()));
  } catch {
    // Fall back to Screen.AllScreens only. Do not invent identity fields.
  }
  if (!displays.length) {
    try {
      displays = parseDisplayJson(await runner(FALLBACK_ENUM_SCRIPT));
    } catch {
      displays = [];
    }
  }
  if (runner === runPowerShell && displays.length) {
    enumCache = { at: Date.now(), displays };
  }
  return displays;
}

export type PlaceWindowInput = {
  processName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  windowHandle?: string;
};

export type PlaceWindowResult =
  | { ok: true; verified: boolean; window?: WindowRect }
  | { ok: false; reasonCode: 'WINDOW_NOT_FOUND' | 'PROCESS_NOT_ALLOWLISTED' | 'PLACE_FAILED' | 'PLACE_REQUIRES_MANAGED_WINDOW' };

const ALLOWED_PROCESS = /^(Cursor|Code|chrome|msedge|explorer|notepad|Spotify|Discord|ApplicationFrameHost)$/u;

function resolveHwndScript(input: { processName: string; windowHandle?: string }): string {
  if (input.windowHandle && /^[0-9]+$/u.test(input.windowHandle)) {
    return `$hwnd = [IntPtr]${input.windowHandle}`;
  }
  if (input.processName === 'msedge' || input.processName === 'chrome') {
    return 'throw "PLACE_REQUIRES_MANAGED_WINDOW"';
  }
  return [
    '$p = Get-Process -Name $proc -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1',
    'if (-not $p) { throw "WINDOW_NOT_FOUND" }',
    '$hwnd = $p.MainWindowHandle',
  ].join('; ');
}

function emitRectScript(): string {
  return [
    'if ($hwnd -eq [IntPtr]::Zero) { throw "WINDOW_NOT_FOUND" }',
    '$rect = New-Object JarvisWin+RECT',
    '[void][JarvisWin]::GetWindowRect($hwnd, [ref]$rect)',
    '[pscustomobject]@{ Handle = [int64]$hwnd; ProcessName = $proc; X = $rect.Left; Y = $rect.Top; Width = ($rect.Right - $rect.Left); Height = ($rect.Bottom - $rect.Top) } | ConvertTo-Json -Compress',
  ].join('; ');
}

export function buildPlaceWindowScript(input: PlaceWindowInput): string | null {
  if (!ALLOWED_PROCESS.test(input.processName)) return null;
  if (![input.x, input.y, input.width, input.height].every(value => Number.isInteger(value))) return null;
  if (input.width < 200 || input.height < 200 || input.width > 10000 || input.height > 10000) return null;
  return [
    `$proc = '${input.processName}'`,
    `$x = ${input.x}; $y = ${input.y}; $w = ${input.width}; $h = ${input.height}`,
    typeLoadCommand(WIN_TYPE),
    resolveHwndScript(input),
    'if ($hwnd -eq [IntPtr]::Zero) { throw "WINDOW_NOT_FOUND" }',
    '[void][JarvisWin]::SetWindowPos($hwnd, [IntPtr]::Zero, $x, $y, $w, $h, 0x0040)',
    emitRectScript(),
  ].join('; ');
}

export function buildInspectWindowScript(input: { processName: string; windowHandle?: string }): string | null {
  if (!ALLOWED_PROCESS.test(input.processName)) return null;
  if (input.windowHandle && !/^[0-9]+$/u.test(input.windowHandle)) return null;
  return [
    `$proc = '${input.processName}'`,
    typeLoadCommand(WIN_TYPE),
    resolveHwndScript(input),
    emitRectScript(),
  ].join('; ');
}

export async function inspectAllowlistedWindow(
  input: { processName: string; windowHandle?: string },
  runner: DisplayHostRunner = runPowerShell,
): Promise<WindowRect | null> {
  if (runner === runPowerShell) await ensureDesktopHostAssembly(runner);
  const script = buildInspectWindowScript(input);
  if (!script) return null;
  try {
    return parseWindowRectJson(await runner(script), input.processName);
  } catch {
    return null;
  }
}

export async function placeAllowlistedWindow(
  input: PlaceWindowInput,
  runner: DisplayHostRunner = runPowerShell,
): Promise<PlaceWindowResult> {
  if (runner === runPowerShell) await ensureDesktopHostAssembly(runner);
  const script = buildPlaceWindowScript(input);
  if (!script) return { ok: false, reasonCode: 'PROCESS_NOT_ALLOWLISTED' };
  try {
    const raw = await runner(script);
    const window = parseWindowRectJson(raw, input.processName);
    return { ok: true, verified: Boolean(window), ...(window ? { window } : {}) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.includes('WINDOW_NOT_FOUND')) return { ok: false, reasonCode: 'WINDOW_NOT_FOUND' };
    if (detail.includes('PLACE_REQUIRES_MANAGED_WINDOW')) return { ok: false, reasonCode: 'PLACE_REQUIRES_MANAGED_WINDOW' };
    return { ok: false, reasonCode: 'PLACE_FAILED' };
  }
}

export function processNameForApplication(applicationId: string): string | null {
  switch (applicationId) {
    case 'cursor': return 'Cursor';
    case 'vscode': return 'Code';
    case 'chrome':
    case 'browser': return 'chrome';
    case 'msedge': return 'msedge';
    case 'explorer': return 'explorer';
    case 'notepad': return 'notepad';
    case 'spotify': return 'Spotify';
    case 'discord': return 'Discord';
    default: return null;
  }
}

export function processNamesForUrl(url: string): string[] {
  return processNameForUrl(url) ? ['chrome', 'msedge'] : [];
}

export function processNameForUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (!parsed.hostname) return null;
    return 'chrome';
  } catch {
    return null;
  }
}

export function buildDesktopSnapshotScript(): string {
  return [
    typeLoadCommand('throw "DESKTOP_HOST_MISSING"'),
    '[JarvisSee]::Snapshot()',
  ].join('; ');
}

export async function enumerateTopLevelWindows(
  runner: DisplayHostRunner = runPowerShell,
): Promise<WindowSnapshot[]> {
  if (runner === runPowerShell) await ensureDesktopHostAssembly(runner);
  try {
    return parseWindowSnapshotList(await runner(buildDesktopSnapshotScript()));
  } catch {
    return [];
  }
}

export function buildFocusWindowScript(windowHandle: string): string | null {
  if (!/^[0-9]+$/u.test(windowHandle)) return null;
  return [
    typeLoadCommand('throw "DESKTOP_HOST_MISSING"'),
    `$hwnd = [IntPtr]${windowHandle}`,
    'if ([JarvisSee]::IsIconic($hwnd)) { [void][JarvisSee]::ShowWindow($hwnd, 9) } else { [void][JarvisSee]::ShowWindow($hwnd, 5) }',
    '[void][JarvisSee]::SetForegroundWindow($hwnd)',
    'Start-Sleep -Milliseconds 150',
    '$fg = [JarvisSee]::GetForegroundWindow()',
    '[pscustomobject]@{ Handle = [int64]$hwnd; Foreground = ([int64]$fg -eq [int64]$hwnd) } | ConvertTo-Json -Compress',
  ].join('; ');
}

export type FocusWindowResult =
  | { ok: true; verified: boolean; windowHandle: string }
  | { ok: false; reasonCode: 'WINDOW_NOT_FOUND' | 'FOCUS_UNVERIFIED' | 'PROCESS_NOT_ALLOWLISTED' };

export class WindowsDesktopPerception implements DesktopPerceptionProvider {
  public constructor(private readonly runner: DisplayHostRunner = runPowerShell) {}

  public async snapshot(): Promise<DesktopPerceptionSnapshot> {
    if (this.runner === runPowerShell) await ensureDesktopHostAssembly(this.runner);
    const [displays, windows] = await Promise.all([
      enumerateWindowsDisplays(this.runner),
      enumerateTopLevelWindows(this.runner),
    ]);
    return buildPerceptionSnapshot({
      displays,
      windows,
      cachedHost: desktopHostUsesCachedAssembly() || this.runner !== runPowerShell,
    });
  }

  public async getWindow(handle: string): Promise<WindowSnapshot | null> {
    const snapshot = await this.snapshot();
    return snapshot.windows.find(item => item.windowHandle === handle) ?? null;
  }
}

export async function focusAllowlistedWindow(
  input: { windowHandle: string },
  runner: DisplayHostRunner = runPowerShell,
): Promise<FocusWindowResult> {
  if (runner === runPowerShell) await ensureDesktopHostAssembly(runner);
  const script = buildFocusWindowScript(input.windowHandle);
  if (!script) return { ok: false, reasonCode: 'WINDOW_NOT_FOUND' };
  try {
    const raw = await runner(script);
    const parsed = JSON.parse(raw) as { Handle?: number; Foreground?: boolean };
    const handle = String(parsed.Handle ?? input.windowHandle);
    return { ok: true, verified: parsed.Foreground === true, windowHandle: handle };
  } catch {
    return { ok: false, reasonCode: 'FOCUS_UNVERIFIED' };
  }
}

export function windowPlacementAgainstDisplay(
  window: WindowRect | null | undefined,
  displays: DisplayInfo[],
  intendedDisplayId?: string,
) {
  const classified = classifyWindowOnDisplays(window, displays);
  const intended = intendedDisplayId
    ? displays.find(item => item.id === intendedDisplayId)
    : undefined;
  const overlap = window && intended ? classifyWindowOnDisplays(window, [intended]).overlapRatio ?? 0 : 0;
  return {
    ...classified,
    verifiedOnIntended: Boolean(intended && overlap >= 0.5),
  };
}

function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `powershell exited ${code}`));
    });
  });
}
