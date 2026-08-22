import type { ActionSource } from '../capabilities/actions/types';
import type { OwnerDecisionSource } from '../security/persistentPermission';
import type { PermissionDuration } from '../security/permissionProposal';

export function ownerConfirmationVisibleText(input: {
  decision: 'allow' | 'deny';
  duration?: PermissionDuration;
  visibleText?: string;
  source: OwnerDecisionSource;
}): string {
  const expressed = input.visibleText?.trim();
  if (expressed && input.source !== 'ui_action') return expressed.slice(0, 240);
  if (input.decision === 'deny') return '[ไม่อนุญาต]';
  return input.duration === 'ONCE' ? '[อนุญาตครั้งนี้]' : '[อนุญาตงานนี้]';
}

export function ownerDecisionSourceFrom(actionSource?: ActionSource | 'ui_action'): OwnerDecisionSource {
  if (actionSource === 'voice') return 'voice';
  if (actionSource === 'text') return 'text';
  return 'ui_action';
}
