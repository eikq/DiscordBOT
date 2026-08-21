import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Ban, CheckCircle2, CircleStop, Clock3, RotateCcw, ShieldAlert, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import type { CommandCenterClientSnapshot } from '../../standalone/commandCenterView';
import type { PrivilegeLeaseInventoryItem } from '../../security/types';

export type RiskBriefModel = {
  action: string;
  why: string;
  risk: string;
  possibleImpact?: string[];
  changes?: string[];
  protection?: string[];
  rollback: 'available' | 'limited' | 'unavailable' | 'not_required' | 'not_declared';
  permissionScope: string[];
  target?: string;
  affectedTargets?: string[];
  privilegeRequired?: string;
  reversible?: boolean;
};

export function RiskBrief({ model }: { model: RiskBriefModel }) {
  const riskTone = /critical|high|blocked/iu.test(model.risk) ? 'red' : /confirm|medium|warning/iu.test(model.risk) ? 'amber' : 'green';
  return (
    <div className="jai-risk-brief" data-tone={riskTone}>
      <div className="jai-risk-brief__lead">
        <ShieldAlert size={22} />
        <div><span>Risk brief</span><h3>{model.action}</h3></div>
        <em>{model.risk.replaceAll('_', ' ')}</em>
      </div>
      <dl>
        <div><dt>Why</dt><dd>{model.why}</dd></div>
        <div><dt>Possible impact</dt><dd>{model.possibleImpact?.length ? model.possibleImpact.join(' · ') : 'The current provider did not declare additional impact.'}</dd></div>
        <div><dt>Changes</dt><dd>{model.changes?.length ? model.changes.join(' · ') : 'No persistent change was declared.'}</dd></div>
        <div><dt>Affected targets</dt><dd>{model.affectedTargets?.length ? model.affectedTargets.join(' · ') : model.target || 'No target declared.'}</dd></div>
        <div><dt>Protection</dt><dd>{model.protection?.length ? model.protection.join(' · ') : 'Request remains scoped and owner-gated.'}</dd></div>
        <div><dt>Rollback</dt><dd><RollbackStatus status={model.rollback} /></dd></div>
        <div><dt>Permission scope</dt><dd>{model.permissionScope.join(' · ') || 'Not supplied'}</dd></div>
        <div><dt>Privilege required</dt><dd>{model.privilegeRequired?.replaceAll('_', ' ') || 'Not supplied'}</dd></div>
        <div><dt>Reversibility</dt><dd>{model.reversible === undefined ? 'Not declared' : model.reversible ? 'Declared reversible' : 'Limited or irreversible'}</dd></div>
        {model.target ? <div><dt>Target</dt><dd>{model.target}</dd></div> : null}
      </dl>
    </div>
  );
}

export function PermissionCard({ snapshot, onDeny, onAllow, busy }: {
  snapshot: CommandCenterClientSnapshot | null;
  onDeny: () => void;
  onAllow: () => void;
  busy: boolean;
}) {
  if (!snapshot?.permission.waiting) return null;
  return (
    <section className="jai-permission-card">
      <div><Clock3 size={20} /><span><strong>Waiting for owner</strong><small>{snapshot.permission.capability || 'Scoped task permission'}</small></span></div>
      <p>Jarvis will not continue this step without a request-bound owner decision.</p>
      {snapshot.permission.preflight ? <RiskBrief model={riskBriefFromPreflight(snapshot.permission.preflight)} /> : null}
      <div className="jai-action-row">
        <button type="button" className="jai-button jai-button--danger" disabled={busy} onClick={onDeny}><Ban size={16} /> Deny</button>
        <button type="button" className="jai-button jai-button--primary" disabled={busy} onClick={onAllow}><ShieldCheck size={16} /> Allow once</button>
      </div>
    </section>
  );
}

export function VerificationReport({ task }: { task: CommandCenterClientSnapshot['task'] }) {
  if (!task) return <p className="jai-muted">No task selected for verification.</p>;
  const completed = !task.active && !task.waitingPermission;
  const verification = task.verification;
  const verified = verification?.state === 'VERIFIED' || verification?.state === 'NOT_APPLICABLE';
  return (
    <div className="jai-verification">
      <div className="jai-verification__state">
        {completed && verified ? <CheckCircle2 size={21} /> : <AlertTriangle size={21} />}
        <span><strong>{verification?.state || task.outcome || task.status}</strong><small>{verification?.summary || (completed ? 'Terminal without a structured verification record' : 'Verification is not complete')}</small></span>
      </div>
      <dl>
        <div><dt>Requested</dt><dd>{task.objective}</dd></div>
        <div><dt>Executed</dt><dd>{task.steps.filter(step => step.state === 'done').length} of {task.steps.length} steps completed</dd></div>
        <div><dt>Verified evidence</dt><dd>{verification?.evidence.length ? verification.evidence.join(' · ') : task.evidence.length ? task.evidence.join(' · ') : 'No verification evidence recorded yet.'}</dd></div>
        <div><dt>Failed checks</dt><dd>{verification?.failedChecks.length ? verification.failedChecks.join(' · ') : task.errors.length ? task.errors.join(' · ') : 'None recorded.'}</dd></div>
        <div><dt>Rollback</dt><dd>{task.rollback ? `${task.rollback.state}: ${task.rollback.strategy}` : 'No rollback record.'}</dd></div>
      </dl>
    </div>
  );
}

export function RollbackStatus({ status }: { status: RiskBriefModel['rollback'] }) {
  const labels = {
    available: 'Available',
    limited: 'Limited',
    unavailable: 'Unavailable',
    not_required: 'Not required',
    not_declared: 'Not declared',
  } as const;
  return <span className={`jai-rollback is-${status}`}><RotateCcw size={14} /> {labels[status]}</span>;
}

export function ActivePrivilegeLease({ lease, busy, onRevoke }: {
  lease?: PrivilegeLeaseInventoryItem;
  busy?: boolean;
  onRevoke?: (leaseId: string) => void;
}) {
  if (!lease) {
    return (
      <div className="jai-lease jai-lease--prepared">
        <span className="jai-badge jai-badge--neutral">REAL</span>
        <strong>No active privilege leases</strong>
        <p>The runtime inventory currently contains no ACTIVE lease.</p>
      </div>
    );
  }
  return (
    <div className="jai-lease">
      <ShieldCheck size={19} />
      <span><strong>{lease.capabilityIds.join(' · ')}</strong><small>{lease.resourceScopes.join(' · ')} · {lease.remainingActions} actions · expires {lease.expiresAt}</small></span>
      <span className="jai-badge jai-badge--neutral">{lease.state}</span>
      <code>{lease.id}</code>
      {lease.state === 'ACTIVE' && onRevoke ? <button type="button" className="jai-button jai-button--danger" disabled={busy} onClick={() => onRevoke(lease.id)}>Revoke</button> : null}
    </div>
  );
}

export function OwnerApprovalDialog({ open, model, busy, onDeny, onModify, onAllow }: {
  open: boolean;
  model: RiskBriefModel | null;
  busy: boolean;
  onDeny: () => void;
  onModify: () => void;
  onAllow: () => void;
}) {
  if (!open || !model) return null;
  return (
    <div className="jai-modal-layer jai-modal-layer--approval" role="presentation">
      <section className="jai-approval-dialog" role="dialog" aria-modal="true" aria-label="Owner approval">
        <RiskBrief model={model} />
        <div className="jai-approval-dialog__actions">
          <button type="button" className="jai-button jai-button--danger" disabled={busy} onClick={onDeny}><Ban size={16} /> Deny</button>
          <button type="button" className="jai-button" disabled={busy} onClick={onModify}><SlidersHorizontal size={16} /> Modify</button>
          <button type="button" className="jai-button jai-button--primary" disabled={busy} onClick={onAllow}><ShieldCheck size={16} /> Allow once</button>
        </div>
        <p>Approval is single-use and request-bound. No permanent broad grant is created.</p>
      </section>
    </div>
  );
}

export function EmergencyStop({ open, available, active, busy, onClose, onActivate, onResume }: {
  open: boolean;
  available: boolean;
  active: boolean;
  busy?: boolean;
  onClose: () => void;
  onActivate?: () => void;
  onResume?: () => void;
}) {
  const [phrase, setPhrase] = useState('');
  useEffect(() => { setPhrase(''); }, [open, active]);
  if (!open) return null;
  const confirmed = phrase.trim().toUpperCase() === 'STOP';
  return (
    <div className="jai-modal-layer jai-modal-layer--stop" role="presentation">
      <section className="jai-stop-dialog" role="dialog" aria-modal="true" aria-label="Emergency stop">
        <button type="button" className="jai-stop-dialog__close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <CircleStop size={34} />
        <span className={`jai-badge ${available ? 'jai-badge--real' : 'jai-badge--neutral'}`}>{available ? 'REAL RUNTIME' : 'NOT CONNECTED'}</span>
        <h2>{active ? 'Emergency stop is active' : 'Emergency stop'}</h2>
        <p>{active ? 'New autonomous actions and lease grants remain blocked. Evidence is preserved until the owner explicitly resumes.' : 'Stops new actions, requests cancellation of owned work, revokes active leases, and preserves audit evidence.'}</p>
        {!available ? (
          <div className="jai-stop-dialog__notice">
            <AlertTriangle size={17} /> The owner-only runtime endpoint is unavailable. This dialog cannot claim that work was stopped.
          </div>
        ) : null}
        <label><span>Type {active ? 'RESUME' : 'STOP'} to confirm</span><input value={phrase} onChange={event => setPhrase(event.target.value)} placeholder={active ? 'RESUME' : 'STOP'} autoComplete="off" /></label>
        <button type="button" className={`jai-button ${active ? 'jai-button--primary' : 'jai-button--danger'} jai-stop-dialog__activate`} disabled={!available || busy || (active ? phrase.trim().toUpperCase() !== 'RESUME' : !confirmed)} onClick={active ? onResume : onActivate}>
          <CircleStop size={17} /> {active ? 'Owner resume' : 'Activate emergency stop'}
        </button>
      </section>
    </div>
  );
}

export default EmergencyStop;

export function TrustedOperatorNote({ children }: { children: ReactNode }) {
  return <p className="jai-trust-note"><ShieldCheck size={15} /> {children}</p>;
}

export function riskBriefFromPreflight(preflight: import('../../safety/types').ActionPreflight): RiskBriefModel {
  return {
    action: preflight.action,
    why: preflight.why,
    risk: preflight.risk,
    possibleImpact: preflight.possibleImpact,
    changes: preflight.expectedChanges,
    protection: preflight.protection,
    rollback: preflight.rollback.state === 'AVAILABLE'
      ? 'available'
      : preflight.rollback.state === 'PARTIAL'
        ? 'limited'
      : preflight.rollback.state === 'NOT_REQUIRED'
          ? 'not_required'
          : 'unavailable',
    permissionScope: preflight.permissionScope,
    affectedTargets: preflight.affectedTargets,
    privilegeRequired: preflight.privilegeRequired,
    reversible: preflight.reversible,
    target: preflight.affectedTargets[0],
  };
}
