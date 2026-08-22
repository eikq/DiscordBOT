import { jarvisWorkspaceLogicalPath } from '../edition/resolve';

export type PermissionDuration = 'ONCE' | 'THIS_GOAL';

export type PermissionEffect =
  | 'READ_PROJECT'
  | 'WRITE_PROJECT'
  | 'RUN_PROJECT_COMMANDS'
  | 'INSTALL_PROJECT_DEPENDENCIES'
  | 'NETWORK_FETCH'
  | 'OPEN_APPLICATION'
  | 'START_DEV_SERVER';

export type PermissionProposal = {
  goal: string;
  summary: string;
  reason: string;
  scope: string;
  duration: PermissionDuration;
  effects: PermissionEffect[];
  capabilityId: string;
  planId?: string;
  goalId?: string;
};

export const BUILD_GOAL_EFFECTS: PermissionEffect[] = [
  'WRITE_PROJECT',
  'INSTALL_PROJECT_DEPENDENCIES',
  'RUN_PROJECT_COMMANDS',
  'START_DEV_SERVER',
];

export function permissionProposalFromBuild(input: {
  title: string;
  slug: string;
  capabilityId: string;
  planId?: string;
  goalId?: string;
}): PermissionProposal {
  return {
    goal: input.title,
    summary: `ขอสิทธิ์สร้าง/แก้ไฟล์ ติดตั้ง dependencies รัน build/test และเปิด preview localhost ในโปรเจกต์ ${input.slug}`,
    reason: 'เพื่อสร้างตามแผนที่คุณอนุมัติ',
    scope: jarvisWorkspaceLogicalPath(input.slug),
    duration: 'THIS_GOAL',
    effects: [...BUILD_GOAL_EFFECTS],
    capabilityId: input.capabilityId,
    planId: input.planId,
    goalId: input.goalId,
  };
}

