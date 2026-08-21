import type { DeviceCapabilityClass, DeviceProvider, DeviceRecord } from './types';

export class SimulatedDeviceProvider implements DeviceProvider {
  constructor(private readonly devices: DeviceRecord[] = defaultDevices()) {}

  public list(): DeviceRecord[] {
    return this.devices.map(item => ({ ...item, capabilities: [...item.capabilities], distribution: [...item.distribution] }));
  }

  public capability(deviceId: string, cls: DeviceCapabilityClass): boolean {
    const device = this.devices.find(item => item.id === deviceId);
    return Boolean(device?.capabilities.includes(cls));
  }
}

export function defaultDevices(): DeviceRecord[] {
  return [
    {
      id: 'cam_lab',
      kind: 'cctv',
      label: 'Lab camera',
      status: 'online',
      capabilities: ['VIEW'],
      simulated: true,
      distribution: ['OWNER_ONLY', 'COMMUNITY_EXCLUDED', 'DEMO_EXCLUDED'],
      detail: 'SIMULATION',
    },
    {
      id: 'cam_gate',
      kind: 'cctv',
      label: 'Gate camera',
      status: 'offline',
      capabilities: ['VIEW'],
      simulated: true,
      distribution: ['OWNER_ONLY', 'COMMUNITY_EXCLUDED', 'DEMO_EXCLUDED'],
      detail: 'SIMULATION',
    },
    {
      id: 'phone_owner',
      kind: 'phone',
      label: 'Owner phone',
      status: 'online',
      capabilities: ['VIEW'],
      simulated: true,
      distribution: ['OWNER_ONLY', 'COMMUNITY_EXCLUDED', 'DEMO_EXCLUDED'],
      detail: 'SIMULATION · status only',
    },
    {
      id: 'sensor_temp',
      kind: 'sensor',
      label: 'GPU thermals',
      status: 'warning',
      capabilities: ['VIEW'],
      simulated: true,
      distribution: ['OWNER_ONLY', 'COMMUNITY_EXCLUDED', 'DEMO_EXCLUDED'],
      detail: 'SIMULATION',
    },
  ];
}

export function cctvViewIsNotConfigure(): true {
  return true;
}
