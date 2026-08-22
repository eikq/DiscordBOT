import type { PendingConfirmation } from '../capabilities/actions/types';
import type { BuildPlan } from '../build/types';
import type { PreviewArtifact } from '../project/types';
import type { PersistentPermissionRecord } from './persistentPermission';
import type { PrivilegeLeaseInventoryItem } from './types';
import type { VisualWorkflowNode } from '../build/types';

export type PermissionRuntimeSnapshot = {
  pendingPermission: PendingConfirmation | null;
  permissionRecord: PersistentPermissionRecord | null;
  lease: PrivilegeLeaseInventoryItem | null;
  plan: Pick<BuildPlan, 'id' | 'goalId' | 'title' | 'slug' | 'status' | 'summary' | 'updatedAt'> | null;
  stage: VisualWorkflowNode | null;
  preview: PreviewArtifact | null;
};

export function emptyPermissionRuntimeSnapshot(): PermissionRuntimeSnapshot {
  return {
    pendingPermission: null,
    permissionRecord: null,
    lease: null,
    plan: null,
    stage: null,
    preview: null,
  };
}
