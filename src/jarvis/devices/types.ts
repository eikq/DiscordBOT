export type DeviceKind = 'cctv' | 'phone' | 'sensor' | 'smart_device' | 'pc';

export type DeviceCapabilityClass = 'VIEW' | 'CONTROL' | 'CONFIGURE' | 'ADMIN';

export type DeviceStatus = 'online' | 'offline' | 'warning' | 'unknown';

export type DeviceRecord = {
  id: string;
  kind: DeviceKind;
  label: string;
  status: DeviceStatus;
  capabilities: DeviceCapabilityClass[];
  simulated: boolean;
  distribution: Array<'OWNER_ONLY' | 'COMMUNITY_EXCLUDED' | 'DEMO_EXCLUDED'>;
  detail?: string;
};

export type DeviceProvider = {
  list(): DeviceRecord[];
  capability(deviceId: string, cls: DeviceCapabilityClass): boolean;
};
