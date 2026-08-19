import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { PrivateRouteComponent, PrivateRouteHealth } from './types';

const execFileAsync = promisify(execFile);

export type RouteHealthDeps = {
  vboxManage?: string | null;
  listVms?: () => Promise<string>;
  listRunning?: () => Promise<string>;
  showVm?: (name: string) => Promise<string>;
  detectVBox?: () => Promise<boolean>;
  checkTor?: () => Promise<boolean | PrivateRouteComponent>;
};

const GATEWAY_NAME = /Whonix-Gateway/iu;
const WORKSTATION_NAME = /Whonix-Workstation/iu;

const WINDOWS_VBOX_CANDIDATES = [
  path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Oracle', 'VirtualBox', 'VBoxManage.exe'),
  path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Oracle', 'VirtualBox', 'VBoxManage.exe'),
];

export class PrivateRouteHealthChecker {
  constructor(private readonly deps: RouteHealthDeps = {}) {}

  public async check(): Promise<PrivateRouteHealth> {
    const present = this.deps.vboxManage === null
      ? false
      : await (this.deps.detectVBox ?? detectVBoxManage)();
    if (!present) {
      return box(
        'missing',
        'missing',
        'missing',
        'unknown',
        false,
        false,
        'VIRTUALBOX_MISSING',
        'VirtualBox is not installed. PRIVATE_BROWSER is unavailable.',
      );
    }

    const bin = this.deps.vboxManage || (await resolveVBoxManage()) || 'VBoxManage';
    let vms = '';
    let running = '';
    try {
      vms = await (this.deps.listVms ?? (() => runVBox(bin, ['list', 'vms'])))();
      running = await (this.deps.listRunning ?? (() => runVBox(bin, ['list', 'runningvms'])))();
    } catch {
      return box(
        'unknown',
        'unknown',
        'unknown',
        'unknown',
        false,
        false,
        'VIRTUALBOX_CHECK_FAILED',
        'VirtualBox could not be queried. PRIVATE_BROWSER is unavailable.',
      );
    }

    const gateway = component(GATEWAY_NAME.test(vms), GATEWAY_NAME.test(running));
    const workstation = component(WORKSTATION_NAME.test(vms), WORKSTATION_NAME.test(running));
    let isolationOk = true;
    let isolationDetail = 'No Workstation direct-route adapter was detected.';
    const workstationName = firstName(vms, WORKSTATION_NAME);
    if (workstationName) {
      const info = await (this.deps.showVm ?? ((name: string) => runVBox(bin, ['showvminfo', name])))(workstationName);
      if (hasDirectInternetAdapter(info)) {
        isolationOk = false;
        isolationDetail = 'Whonix Workstation appears to have a direct Internet adapter. PRIVATE_BROWSER stays unavailable.';
      }
    }

    let tor: PrivateRouteComponent = 'unknown';
    if (this.deps.checkTor) {
      try {
        const torResult = await this.deps.checkTor();
        tor = typeof torResult === 'string' ? torResult : torResult ? 'up' : 'down';
      } catch {
        tor = 'unknown';
      }
    }

    const routeReady = gateway === 'up' && workstation === 'up' && isolationOk;
    const available = routeReady && tor === 'up';
    return box(
      'up',
      gateway,
      workstation,
      tor,
      isolationOk,
      available,
      available
        ? 'PRIVATE_BROWSER_AVAILABLE'
        : isolationOk
          ? routeReady && tor !== 'up'
            ? 'LIVE_TOR_CHECK_REQUIRED'
            : 'PRIVATE_BROWSER_UNAVAILABLE'
          : 'WORKSTATION_DIRECT_ROUTE',
      available
        ? 'Whonix Gateway, Workstation, and live Tor check passed.'
        : isolationOk
          ? routeReady && tor !== 'up'
            ? 'Whonix VMs are present. PRIVATE_BROWSER stays unavailable until a live Tor check passes.'
            : `Gateway=${gateway} Workstation=${workstation}. PRIVATE_BROWSER stays unavailable.`
          : isolationDetail,
    );
  }
}

export function hasDirectInternetAdapter(vmInfo: string): boolean {
  if (/nic\d+="(nat|natnetwork|bridged|hostonly)"/iu.test(vmInfo)) return true;
  return /Attachment(?:Type)?:\s*(Bridged(?: Adapter)?|NAT(?: Network)?|NATNetwork|Host-Only(?: Adapter)?)\b/iu.test(vmInfo);
}

export async function resolveVBoxManage(): Promise<string | null> {
  try {
    await runVBox('VBoxManage', ['--version']);
    return 'VBoxManage';
  } catch {
    const found = WINDOWS_VBOX_CANDIDATES.find(candidate => existsSync(candidate));
    if (!found) return null;
    try {
      await runVBox(found, ['--version']);
      return found;
    } catch {
      return null;
    }
  }
}

export async function detectVBoxManage(): Promise<boolean> {
  return (await resolveVBoxManage()) !== null;
}

async function runVBox(bin: string | undefined, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(bin || 'VBoxManage', args, { windowsHide: true });
  return stdout;
}

function component(installed: boolean, running: boolean): PrivateRouteComponent {
  if (!installed) return 'missing';
  return running ? 'up' : 'down';
}

function firstName(list: string, pattern: RegExp): string | undefined {
  const line = list.split(/\r?\n/).find(item => pattern.test(item));
  return line?.match(/"([^"]+)"/)?.[1];
}

function box(
  virtualBox: PrivateRouteComponent,
  gateway: PrivateRouteComponent,
  workstation: PrivateRouteComponent,
  tor: PrivateRouteComponent,
  isolationOk: boolean,
  available: boolean,
  reasonCode: string,
  detail: string,
): PrivateRouteHealth {
  return { virtualBox, gateway, workstation, tor, isolationOk, available, reasonCode, detail };
}
