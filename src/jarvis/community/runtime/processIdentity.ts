import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function pidIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function processExecutablePath(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform !== 'win32') {
    try {
      return fs.realpathSync(`/proc/${pid}/exe`);
    } catch {
      return null;
    }
  }
  try {
    const out = execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").ExecutablePath`,
    ], { encoding: 'utf8', timeout: 4000, windowsHide: true }).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function processRssBytes(pid: number): number | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  if (process.platform !== 'win32') {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
      const match = /VmRSS:\s+(\d+)\s+kB/.exec(stat);
      return match ? Number(match[1]) * 1024 : undefined;
    } catch {
      return undefined;
    }
  }
  try {
    const out = execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").WorkingSetSize`,
    ], { encoding: 'utf8', timeout: 4000, windowsHide: true }).trim();
    const value = Number(out);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function sameExecutable(left: string, right: string): boolean {
  const a = normalizeExe(left);
  const b = normalizeExe(right);
  return Boolean(a && b && a === b);
}

function normalizeExe(value: string): string {
  try {
    const real = fs.existsSync(value) ? fs.realpathSync.native(value) : path.resolve(value);
    return process.platform === 'win32' ? real.toLowerCase() : real;
  } catch {
    return process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  }
}
