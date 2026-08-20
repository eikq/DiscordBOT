import type { ResourcePriority } from '../ops/types';
import type { VoiceTurnState } from './types';

const RANK: Record<ResourcePriority, number> = {
  realtime_voice: 3,
  owner_task: 2,
  background_evolution: 1,
};

/**
 * Scheduler/resource signal only. Does not change OS process priority.
 */
export function resourcePriorityForVoice(state: VoiceTurnState): ResourcePriority {
  if (
    state === 'LISTENING'
    || state === 'TRANSCRIBING'
    || state === 'SPEAKING'
    || state === 'INTERRUPTED'
  ) {
    return 'realtime_voice';
  }
  if (state === 'THINKING' || state === 'WORKING' || state === 'WAITING_OWNER' || state === 'ERROR') {
    return 'owner_task';
  }
  return 'background_evolution';
}

export function higherResourcePriority(a: ResourcePriority, b: ResourcePriority): ResourcePriority {
  return RANK[a] >= RANK[b] ? a : b;
}

export class VoicePriorityBroker {
  private state: VoiceTurnState = 'IDLE';

  public setVoiceState(state: VoiceTurnState): ResourcePriority {
    this.state = state;
    return this.current();
  }

  public current(): ResourcePriority {
    return resourcePriorityForVoice(this.state);
  }
}
