import { spawn } from 'node:child_process';
import type { DisplayInfo } from './monitorTopology';

export type DisplayHostRunner = (script: string) => Promise<string>;

const ENUM_SCRIPT = [
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
        primary: Boolean(item.Primary),
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

export async function enumerateWindowsDisplays(runner: DisplayHostRunner = runPowerShell): Promise<DisplayInfo[]> {
  try {
    return parseDisplayJson(await runner(ENUM_SCRIPT));
  } catch {
    return [];
  }
}

export type PlaceWindowInput = {
  processName: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const ALLOWED_PROCESS = /^(Cursor|Code|chrome|msedge|explorer|notepad|Spotify|Discord|ApplicationFrameHost)$/u;

export function buildPlaceWindowScript(input: PlaceWindowInput): string | null {
  if (!ALLOWED_PROCESS.test(input.processName)) return null;
  if (![input.x, input.y, input.width, input.height].every(value => Number.isInteger(value))) return null;
  if (input.width < 200 || input.height < 200 || input.width > 10000 || input.height > 10000) return null;
  return [
    `$proc = '${input.processName}'`,
    `$x = ${input.x}; $y = ${input.y}; $w = ${input.width}; $h = ${input.height}`,
    'Add-Type @"',
    'using System; using System.Runtime.InteropServices;',
    'public class JarvisWin {',
    '  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr h, int x, int y, int cx, int cy, uint u);',
    '}',
    '"@',
    '$p = Get-Process -Name $proc -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1',
    'if (-not $p) { throw "WINDOW_NOT_FOUND" }',
    '[void][JarvisWin]::SetWindowPos($p.MainWindowHandle, [IntPtr]::Zero, $x, $y, $w, $h, 0x0040)',
  ].join('; ');
}

export async function placeAllowlistedWindow(
  input: PlaceWindowInput,
  runner: DisplayHostRunner = runPowerShell,
): Promise<{ ok: true } | { ok: false; reasonCode: 'WINDOW_NOT_FOUND' | 'PROCESS_NOT_ALLOWLISTED' | 'PLACE_FAILED' }> {
  const script = buildPlaceWindowScript(input);
  if (!script) return { ok: false, reasonCode: 'PROCESS_NOT_ALLOWLISTED' };
  try {
    await runner(script);
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.includes('WINDOW_NOT_FOUND')) return { ok: false, reasonCode: 'WINDOW_NOT_FOUND' };
    return { ok: false, reasonCode: 'PLACE_FAILED' };
  }
}

export function processNameForApplication(applicationId: string): string | null {
  switch (applicationId) {
    case 'cursor': return 'Cursor';
    case 'vscode': return 'Code';
    case 'chrome':
    case 'browser': return 'msedge';
    case 'msedge': return 'msedge';
    case 'explorer': return 'explorer';
    case 'notepad': return 'notepad';
    case 'spotify': return 'Spotify';
    case 'discord': return 'Discord';
    default: return null;
  }
}

export function processNameForUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    if (host.endsWith('youtube.com') || host === 'youtu.be') return 'msedge';
  } catch {
    return null;
  }
  return null;
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
