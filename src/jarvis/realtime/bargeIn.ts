import { isTerminalStatus } from '../agent/transitions';
import type { WorkTask } from '../agent/types';
import type { BargeInDecision, InterruptionKind, VoiceTurnState } from './types';

export function isMutatingWork(task: WorkTask | undefined): boolean {
  if (!task || isTerminalStatus(task.status)) return false;
  return task.plan.some(step => (
    (step.status === 'running' || step.status === 'retrying')
    && step.kind === 'apply'
    && step.riskLevel !== 'LOW'
  ));
}

export function workIsWaitingOwner(task: WorkTask | undefined): boolean {
  return task?.status === 'WAITING_PERMISSION';
}

/**
 * Barge-in never blindly cancels mutating WorkAgent actions.
 * Playback may stop. Task state is always preserved.
 */
export function decideBargeIn(input: {
  kind: InterruptionKind;
  speaking: boolean;
  task?: WorkTask;
}): BargeInDecision {
  const mutating = isMutatingWork(input.task);
  const waiting = workIsWaitingOwner(input.task);
  const hasActiveWork = Boolean(input.task && !isTerminalStatus(input.task.status));
  const cancelPlayback = input.speaking;
  let workAction: BargeInDecision['workAction'] = 'none';
  let nextState: VoiceTurnState = 'INTERRUPTED';
  let reason = 'barge_in_playback';

  if (waiting) {
    nextState = 'WAITING_OWNER';
    reason = 'permission_wait_preserved';
  } else if (mutating) {
    workAction = 'none';
    reason = 'mutating_work_preserved';
    nextState = input.kind === 'stop' ? 'LISTENING' : 'INTERRUPTED';
  } else if (input.kind === 'stop') {
    workAction = hasActiveWork ? 'pause' : 'none';
    nextState = 'LISTENING';
    reason = hasActiveWork ? 'stop_paused_non_mutating' : 'stop_playback';
  } else if (input.kind === 'new_command' && hasActiveWork) {
    workAction = 'pause';
    nextState = 'INTERRUPTED';
    reason = 'new_command_paused_non_mutating';
  } else if (input.kind === 'question' || input.kind === 'correction') {
    workAction = 'none';
    nextState = 'INTERRUPTED';
    reason = 'interrupt_keep_work';
  }

  return {
    kind: input.kind,
    cancelPlayback,
    workAction,
    preserveTask: true,
    mutatingWork: mutating,
    nextState,
    reason,
  };
}
