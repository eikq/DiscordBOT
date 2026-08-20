import type { VisionAction, VisionPermissionState } from './types';

export function mayPerformVisionAction(action: VisionAction, permission: VisionPermissionState): boolean {
  if (action === 'see') return permission !== 'denied';
  return permission === 'granted';
}

export function visionActionAllowed(see: boolean, click: boolean, type: boolean, submit: boolean): {
  see: boolean;
  click: boolean;
  type: boolean;
  submit: boolean;
} {
  return {
    see,
    click: see && click,
    type: see && type,
    submit: see && click && type && submit,
  };
}
