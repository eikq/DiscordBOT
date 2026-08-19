import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { EncryptionStatus, HostControlState, HostSecuritySnapshot } from './types';

const execFileAsync = promisify(execFile);

export type HostProbeDeps = {
  queryReg?: (key: string) => Promise<string>;
  whoami?: () => Promise<string>;
  now?: () => number;
};

export async function probeHostSecurity(deps: HostProbeDeps = {}): Promise<HostSecuritySnapshot> {
  const queryReg = deps.queryReg ?? defaultQueryReg;
  const whoami = deps.whoami ?? defaultWhoami;
  const now = deps.now ?? Date.now;

  const [bitLocker, defender, rtp, features, domainFw, standardFw, publicFw, deviceGuard, hvci, uac, secureBoot, groups] = await Promise.all([
    queryReg('HKLM\\SYSTEM\\CurrentControlSet\\Control\\BitLocker'),
    queryReg('HKLM\\SOFTWARE\\Microsoft\\Windows Defender'),
    queryReg('HKLM\\SOFTWARE\\Microsoft\\Windows Defender\\Real-Time Protection'),
    queryReg('HKLM\\SOFTWARE\\Microsoft\\Windows Defender\\Features'),
    queryReg('HKLM\\SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy\\DomainProfile'),
    queryReg('HKLM\\SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy\\StandardProfile'),
    queryReg('HKLM\\SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy\\PublicProfile'),
    queryReg('HKLM\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard'),
    queryReg('HKLM\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity'),
    queryReg('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System'),
    queryReg('HKLM\\SYSTEM\\CurrentControlSet\\Control\\SecureBoot\\State'),
    whoami(),
  ]);

  const encryption = classifyEncryption(bitLocker);
  const firewallOn = [domainFw, standardFw, publicFw].every(text => dword(text, 'EnableFirewall') === 1);
  const elevated = /High Mandatory Level/iu.test(groups);
  const standard = /Medium Mandatory Level/iu.test(groups);

  return {
    probedAt: new Date(now()).toISOString(),
    privilege: elevated ? 'elevated' : standard ? 'standard_user' : 'unknown',
    encryption: {
      status: encryption.status,
      method: 'read-only registry; manage-bde/WMI not required and not used to change state',
      modified: false,
      ownerActionRequired: encryption.status === 'ON',
      note: encryption.note,
    },
    defender: {
      state: dword(defender, 'DisableAntiSpyware') === 1 ? 'OFF' : dword(rtp, 'DisableRealtimeMonitoring') === 1 ? 'OFF' : 'ON',
      detail: `DisableAntiSpyware=${dword(defender, 'DisableAntiSpyware') ?? 'absent'} PassiveMode=${dword(defender, 'PassiveMode') ?? 'absent'}`,
    },
    firewall: {
      state: firewallOn ? 'ON' : 'UNKNOWN',
      detail: `Domain/Standard/Public EnableFirewall=${dword(domainFw, 'EnableFirewall')}/${dword(standardFw, 'EnableFirewall')}/${dword(publicFw, 'EnableFirewall')}`,
    },
    tamperProtection: {
      state: flagState(dword(features, 'TamperProtection'), 1),
      detail: `TamperProtection=${dword(features, 'TamperProtection') ?? 'absent'}`,
    },
    memoryIntegrity: {
      state: flagState(dword(hvci, 'Enabled'), 1),
      detail: `HVCI Enabled=${dword(hvci, 'Enabled') ?? 'absent'}`,
    },
    virtualizationBasedSecurity: {
      state: flagState(dword(deviceGuard, 'EnableVirtualizationBasedSecurity'), 1),
      detail: `EnableVirtualizationBasedSecurity=${dword(deviceGuard, 'EnableVirtualizationBasedSecurity') ?? 'absent'}`,
    },
    secureBoot: {
      state: flagState(dword(secureBoot, 'UEFISecureBootEnabled'), 1),
      detail: `UEFISecureBootEnabled=${dword(secureBoot, 'UEFISecureBootEnabled') ?? 'absent'}`,
    },
    uac: {
      state: flagState(dword(uac, 'EnableLUA'), 1),
      detail: `EnableLUA=${dword(uac, 'EnableLUA') ?? 'absent'} ConsentPromptBehaviorAdmin=${dword(uac, 'ConsentPromptBehaviorAdmin') ?? 'absent'}`,
    },
    weakenedByJarvis: false,
  };
}

function classifyEncryption(bitLocker: string): { status: EncryptionStatus; note: string } {
  if (/Protection\s*Status\s*[:=]\s*On/iu.test(bitLocker) || /ConversionStatus\s+REG_\w+\s+0x2/iu.test(bitLocker)) {
    return {
      status: 'ON',
      note: 'OWNER ACTION REQUIRED: Device encryption is already enabled. Jarvis did not modify or decrypt it.',
    };
  }
  if (/Protection\s*Status\s*[:=]\s*Off/iu.test(bitLocker) || /ConversionStatus\s+REG_\w+\s+0x0/iu.test(bitLocker)) {
    return {
      status: 'OFF',
      note: 'Encryption is off. Jarvis left it off and will not enable BitLocker or Device Encryption.',
    };
  }
  return {
    status: 'UNKNOWN',
    note: 'Read-only probe could not classify drive encryption. AutoDE evaluation keys may exist without proving the volume is encrypted. Jarvis did not enable, disable, or decrypt anything.',
  };
}

function flagState(value: number | undefined, onValue: number): HostControlState {
  if (value === undefined) return 'UNKNOWN';
  return value === onValue ? 'ON' : 'OFF';
}

function dword(text: string, name: string): number | undefined {
  const match = text.match(new RegExp(`${name}\\s+REG_DWORD\\s+0x([0-9a-f]+)`, 'iu'));
  if (!match?.[1]) return undefined;
  return Number.parseInt(match[1], 16);
}

async function defaultQueryReg(key: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync('reg', ['query', key], { windowsHide: true });
    return `${stdout}\n${stderr}`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function defaultWhoami(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('whoami', ['/groups'], { windowsHide: true });
    return stdout;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
