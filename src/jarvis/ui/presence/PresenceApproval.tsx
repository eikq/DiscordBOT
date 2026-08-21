import { Ban, ShieldCheck } from 'lucide-react';
import { RiskBrief, type RiskBriefModel } from '../operating/TrustedOperator';

export function PresenceApproval(props: {
  model: RiskBriefModel;
  busy: boolean;
  spokenPrompt?: string;
  onDeny: () => void;
  onAllow: () => void;
}) {
  const { model } = props;
  return (
    <aside className="jp-approve" role="dialog" aria-modal="true" aria-label="Owner approval">
      <header>
        <span>Owner authority required</span>
        <em>{model.risk.replaceAll('_', ' ')}</em>
      </header>
      <dl>
        <div><dt>Action</dt><dd>{model.action}</dd></div>
        <div><dt>Risk</dt><dd>{model.risk.replaceAll('_', ' ')}</dd></div>
        <div><dt>Target</dt><dd>{model.target || model.affectedTargets?.[0] || 'Not declared'}</dd></div>
        <div><dt>Changes</dt><dd>{model.changes?.length ? model.changes.join(' · ') : 'No persistent change declared.'}</dd></div>
        <div><dt>Rollback</dt><dd>{model.rollback.replaceAll('_', ' ')}</dd></div>
      </dl>
      <p className="jp-approve__ask">{props.spokenPrompt || 'Proceed once for this exact request?'}</p>
      <div className="jp-approve__row">
        <button type="button" className="jp-btn jp-btn--deny" disabled={props.busy} onClick={props.onDeny}>
          <Ban size={15} /> Deny
        </button>
        <button type="button" className="jp-btn jp-btn--allow" disabled={props.busy} onClick={props.onAllow}>
          <ShieldCheck size={15} /> Allow once
        </button>
      </div>
      <details className="jp-approve__more">
        <summary>Advanced details</summary>
        <RiskBrief model={model} />
      </details>
      <p className="jp-approve__note">Yes or Allow Once binds only this request. It is not a global grant.</p>
    </aside>
  );
}
