import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Ban, CheckCircle2, CircleStop, Clock3, RotateCcw, ShieldAlert, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import type { CommandCenterClientSnapshot } from '../../standalone/commandCenterView';

export type RiskBriefModel = {
  action: string;
  why: string;
  risk: string;
  possibleImpact?: string[];
  changes?: string[];
  protection?: string[];
  rollback: 'available' | 'limited' | 'unavailable' | 'not_declared';
  permissionScope: string[];
  target?: string;
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
        <div><dt>Protection</dt><dd>{model.protection?.length ? model.protection.join(' · ') : 'Request remains scoped and owner-gated.'}</dd></div>
        <div><dt>Rollback</dt><dd><RollbackStatus status={model.rollback} /></dd></div>
        <div><dt>Permission scope</dt><dd>{model.permissionScope.join(' · ') || 'Not supplied'}</dd></div>
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
  return (
    <div className="jai-verification">
      <div className="jai-verification__state">
        {completed && task.errors.length === 0 ? <CheckCircle2 size={21} /> : <AlertTriangle size={21} />}
        <span><strong>{task.outcome || task.status}</strong><small>{completed ? 'Execution reached a terminal state' : 'Verification is not complete'}</small></span>
      </div>
      <dl>
        <div><dt>Requested</dt><dd>{task.objective}</dd></div>
        <div><dt>Executed</dt><dd>{task.steps.filter(step => step.state === 'done').length} of {task.steps.length} steps completed</dd></div>
        <div><dt>Verified evidence</dt><dd>{task.evidence.length ? task.evidence.join(' · ') : 'No verification evidence recorded yet.'}</dd></div>
        <div><dt>Failed checks</dt><dd>{task.errors.length ? task.errors.join(' · ') : 'None recorded.'}</dd></div>
      </dl>
    </div>
  );
}

export function RollbackStatus({ status }: { status: RiskBriefModel['rollback'] }) {
  const labels = {
    available: 'Available',
    limited: 'Limited',
    unavailable: 'Unavailable',
    not_declared: 'Not declared',
  } as const;
  return <span className={`jai-rollback is-${status}`}><RotateCcw size={14} /> {labels[status]}</span>;
}

export function ActivePrivilegeLease({ lease }: { lease?: { id: string; scope: string; expiresAt: string; remainingActions: number } }) {
  if (!lease) {
    return (
      <div className="jai-lease jai-lease--prepared">
        <span className="jai-badge jai-badge--neutral">PREPARED</span>
        <strong>Active privilege lease inventory</strong>
        <p>The lease store exists, but the lab has no read-only lease inventory endpoint. No active lease is being claimed.</p>
      </div>
    );
  }
  return (
    <div className="jai-lease">
      <ShieldCheck size={19} />
      <span><strong>{lease.scope}</strong><small>{lease.remainingActions} actions · expires {lease.expiresAt}</small></span>
      <code>{lease.id}</code>
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

export function EmergencyStop({ open, available, onClose, onActivate }: {
  open: boolean;
  available: boolean;
  onClose: () => void;
  onActivate?: () => void;
}) {
  const [phrase, setPhrase] = useState('');
  useEffect(() => { if (!open) setPhrase(''); }, [open]);
  if (!open) return null;
  const confirmed = phrase.trim().toUpperCase() === 'STOP';
  return (
    <div className="jai-modal-layer jai-modal-layer--stop" role="presentation">
      <section className="jai-stop-dialog" role="dialog" aria-modal="true" aria-label="Emergency stop">
        <button type="button" className="jai-stop-dialog__close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <CircleStop size={34} />
        <span className="jai-badge jai-badge--neutral">PREPARED CONTRACT</span>
        <h2>Emergency stop</h2>
        <p>Designed to stop new actions, cancel cancellable work, revoke active leases, suspend autonomy, and preserve audit evidence.</p>
        {!available ? (
          <div className="jai-stop-dialog__notice">
            <AlertTriangle size={17} /> Runtime activation is not connected on this branch. This dialog cannot claim that owner-machine work was stopped.
          </div>
        ) : null}
        <label><span>Type STOP to confirm</span><input value={phrase} onChange={event => setPhrase(event.target.value)} placeholder="STOP" autoComplete="off" /></label>
        <button type="button" className="jai-button jai-button--danger jai-stop-dialog__activate" disabled={!available || !confirmed} onClick={onActivate}>
          <CircleStop size={17} /> Activate emergency stop
        </button>
      </section>
    </div>
  );
}

export default EmergencyStop;

export function TrustedOperatorNote({ children }: { children: ReactNode }) {
  return <p className="jai-trust-note"><ShieldCheck size={15} /> {children}</p>;
}
