import { Ban, ShieldCheck } from 'lucide-react';
import { RiskBrief, type RiskBriefModel } from '../operating/TrustedOperator';
import type { LabPendingConfirmation } from '../labUiState';

export function PresenceApproval(props: {
  model: RiskBriefModel;
  busy: boolean;
  spokenPrompt?: string;
  proposal?: LabPendingConfirmation['permissionProposal'];
  onDeny: () => void;
  onAllow: () => void;
  onAllowOnce?: () => void;
}) {
  const { model } = props;
  const proposal = props.proposal;
  return (
    <aside className="jp-approve" role="dialog" aria-modal="true" aria-label="Owner approval">
      <header>
        <span>Permission requested</span>
        <em>{model.risk.replaceAll('_', ' ')}</em>
      </header>
      {proposal ? (
        <>
          <p className="jp-approve__goal">{proposal.goal}</p>
          <p className="jp-approve__ask">{proposal.summary}</p>
          <ul className="jp-approve__effects">
            {proposal.effects.map(effect => (
              <li key={effect}>{effect.replaceAll('_', ' ').toLowerCase()}</li>
            ))}
          </ul>
          <p className="jp-approve__note">ใช้จนกว่างานนี้จะจบ</p>
        </>
      ) : (
        <>
          <dl>
            <div><dt>Action</dt><dd>{model.action}</dd></div>
            <div><dt>Risk</dt><dd>{model.risk.replaceAll('_', ' ')}</dd></div>
            <div><dt>Target</dt><dd>{model.target || model.affectedTargets?.[0] || 'Not declared'}</dd></div>
            <div><dt>Changes</dt><dd>{model.changes?.length ? model.changes.join(' · ') : 'No persistent change declared.'}</dd></div>
            <div><dt>Rollback</dt><dd>{model.rollback.replaceAll('_', ' ')}</dd></div>
          </dl>
          <p className="jp-approve__ask">{props.spokenPrompt || 'Proceed once for this exact request? This binds only this request.'}</p>
        </>
      )}
      <div className="jp-approve__row">
        <button type="button" className="jp-btn jp-btn--deny" disabled={props.busy} onClick={props.onDeny}>
          <Ban size={15} /> ไม่
        </button>
        {props.onAllowOnce ? (
          <button type="button" className="jp-btn" disabled={props.busy} onClick={props.onAllowOnce}>
            ครั้งเดียว
          </button>
        ) : null}
        <button type="button" className="jp-btn jp-btn--allow" disabled={props.busy} onClick={props.onAllow}>
          <ShieldCheck size={15} /> อนุญาตงานนี้
        </button>
      </div>
      <p className="jp-approve__once">Allow once remains available as a single-use grant and binds only this request.</p>
      <details className="jp-approve__more">
        <summary>รายละเอียด</summary>
        <RiskBrief model={model} />
      </details>
    </aside>
  );
}
