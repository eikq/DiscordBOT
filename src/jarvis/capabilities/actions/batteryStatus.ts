import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type BatterySnapshot = {
  status: 'ok' | 'unavailable';
  percent?: number;
  charging?: boolean;
  pluggedIn?: boolean;
  state?: string;
  reason?: string;
};

let cache: { at: number; value: BatterySnapshot } | null = null;
const BATTERY_TTL_MS = 15_000;

export async function readBatteryStatus(): Promise<BatterySnapshot> {
  const now = Date.now();
  if (cache && now - cache.at < BATTERY_TTL_MS) return cache.value;
  const value = await readBatteryFresh();
  cache = { at: now, value };
  return value;
}

async function readBatteryFresh(): Promise<BatterySnapshot> {
  const wmic = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wbem', 'WMIC.exe');
  if (!fs.existsSync(wmic)) {
    return { status: 'unavailable', reason: 'WMIC is not available on this machine.' };
  }
  try {
    const { stdout } = await execFileAsync(wmic, [
      'path',
      'Win32_Battery',
      'get',
      'EstimatedChargeRemaining,BatteryStatus',
      '/format:list',
    ], { timeout: 2_000, windowsHide: true, windowsVerbatimArguments: false });
    return parseBatteryWmic(stdout);
  } catch {
    return { status: 'unavailable', reason: 'Battery telemetry is unavailable.' };
  }
}

export function parseBatteryWmic(stdout: string): BatterySnapshot {
  const percent = numberField(stdout, 'EstimatedChargeRemaining');
  const rawStatus = numberField(stdout, 'BatteryStatus');
  if (percent === undefined && rawStatus === undefined) {
    return { status: 'unavailable', reason: 'No battery is reported.' };
  }
  const charging = rawStatus === 6 || rawStatus === 7 || rawStatus === 8 || rawStatus === 9;
  const pluggedIn = rawStatus === 2 || charging;
  return {
    status: 'ok',
    ...(percent !== undefined ? { percent } : {}),
    charging,
    pluggedIn,
    state: charging ? 'charging' : pluggedIn ? 'plugged_in' : 'discharging',
  };
}

function numberField(text: string, name: string): number | undefined {
  const match = text.match(new RegExp(`${name}=(\\d+)`, 'iu'));
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}
