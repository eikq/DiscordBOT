import type { JarvisRequestRoute } from '../intent/requestRouter';
import type { WorkTaskOutcome, WorkTaskStatus } from '../agent/types';
import type { StreamingDecision } from './types';

/**
 * Conversation/information may start presenting before every UI detail lands.
 * Agentic work must not claim success early.
 */
export function decideStreaming(input: {
  route: JarvisRequestRoute | string;
  agentic: boolean;
  workStatus?: WorkTaskStatus;
  outcome?: WorkTaskOutcome;
  verificationPassed?: boolean;
}): StreamingDecision {
  if (!input.agentic && (input.route === 'CONVERSATION' || input.route === 'INFORMATION')) {
    return {
      mayBeginPresentation: true,
      claimSuccess: false,
      reason: 'safe_early_presentation',
    };
  }
  const terminal = input.workStatus === 'COMPLETED'
    || input.workStatus === 'FAILED'
    || input.workStatus === 'CANCELLED'
    || input.workStatus === 'BLOCKED'
    || input.workStatus === 'DEGRADED';
  if (!terminal) {
    return {
      mayBeginPresentation: false,
      claimSuccess: false,
      reason: 'agentic_wait_for_verification',
    };
  }
  const success = input.workStatus === 'COMPLETED'
    && input.outcome === 'success'
    && input.verificationPassed !== false;
  return {
    mayBeginPresentation: true,
    claimSuccess: success,
    reason: success ? 'verified_complete' : 'terminal_without_success',
  };
}
