import { CCTV_ACTIONS, DEFAULT_CCTV_JARVIS_ACTIONS, type CctvAction, type PerceptualEvent } from './types';

export type CctvGrant = readonly CctvAction[];

export function defaultCctvGrant(): CctvGrant {
  return DEFAULT_CCTV_JARVIS_ACTIONS;
}

export function isCctvAction(value: string): value is CctvAction {
  return (CCTV_ACTIONS as readonly string[]).includes(value);
}

/**
 * Default Jarvis CCTV access is VIEW + searchEvents only.
 * Holding VIEW does not grant control, configure, or admin.
 */
export function cctvActionAllowed(action: CctvAction, grant: CctvGrant = defaultCctvGrant()): boolean {
  return grant.includes(action);
}

export type CctvPort = {
  view(deviceId: string): Promise<{ ok: boolean; events: PerceptualEvent[]; simulated: true }>;
  searchEvents(query: string): Promise<{ ok: boolean; events: PerceptualEvent[]; simulated: true }>;
  control(deviceId: string, command: string): Promise<{ ok: false; reasonCode: string }>;
  configure(deviceId: string): Promise<{ ok: false; reasonCode: string }>;
  admin(deviceId: string): Promise<{ ok: false; reasonCode: string }>;
};

export class MockCctvPort implements CctvPort {
  constructor(private readonly grant: CctvGrant = defaultCctvGrant()) {}

  public async view(deviceId: string): Promise<{ ok: boolean; events: PerceptualEvent[]; simulated: true }> {
    if (!cctvActionAllowed('cctv.view', this.grant)) return { ok: false, events: [], simulated: true };
    return { ok: true, simulated: true, events: [fixtureEvent(deviceId, 'empty doorway (simulation)')] };
  }

  public async searchEvents(query: string): Promise<{ ok: boolean; events: PerceptualEvent[]; simulated: true }> {
    if (!cctvActionAllowed('cctv.searchEvents', this.grant)) return { ok: false, events: [], simulated: true };
    return { ok: true, simulated: true, events: [fixtureEvent('cam_lab', `search:${query.slice(0, 80)}`)] };
  }

  public async control(_deviceId: string, _command: string): Promise<{ ok: false; reasonCode: string }> {
    return this.denyMutating('cctv.control');
  }

  public async configure(_deviceId: string): Promise<{ ok: false; reasonCode: string }> {
    return this.denyMutating('cctv.configure');
  }

  public async admin(_deviceId: string): Promise<{ ok: false; reasonCode: string }> {
    return this.denyMutating('cctv.admin');
  }

  private denyMutating(action: CctvAction): { ok: false; reasonCode: string } {
    if (!cctvActionAllowed(action, this.grant)) return { ok: false, reasonCode: 'PERMISSION_REQUIRED' };
    return { ok: false, reasonCode: 'SIMULATION_ONLY' };
  }
}

function fixtureEvent(deviceId: string, observation: string): PerceptualEvent {
  return {
    id: `perc-${deviceId}`,
    source: 'cctv',
    timestamp: new Date(0).toISOString(),
    observation,
    confidence: 0.4,
    regionRefs: [{ id: deviceId }],
    objectRefs: [],
    privacyClassification: 'sensitive',
    simulated: true,
    evidenceRefs: [`fixture:${deviceId}`],
  };
}
