import type { ResourcePriority } from '../ops/types';
import { higherResourcePriority } from '../ops/resourcePriority';
import type { VoiceTurnState } from './types';

export { higherResourcePriority };

/**
 * Voice maps onto the five-level resource ladder without inventing
 * scheduled_action or monitoring (those come from the coordinator).
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
