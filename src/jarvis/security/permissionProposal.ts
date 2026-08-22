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

export function permissionProposalFromBuild(input: {
  title: string;
  slug: string;
  capabilityId: string;
  planId?: string;
  goalId?: string;
}): PermissionProposal {
  return {
    goal: input.title,
    summary: `ขอสิทธิ์สร้าง/แก้ไฟล์และรัน build/test ในโปรเจกต์ ${input.slug}`,
    reason: 'เพื่อสร้างตามแผนที่คุณอนุมัติ',
    scope: `data/jarvis/builds/${input.slug}`,
    duration: 'THIS_GOAL',
    effects: ['WRITE_PROJECT', 'RUN_PROJECT_COMMANDS'],
    capabilityId: input.capabilityId,
    planId: input.planId,
    goalId: input.goalId,
  };
}
