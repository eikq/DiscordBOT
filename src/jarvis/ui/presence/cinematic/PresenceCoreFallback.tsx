import type { PresencePhase } from '../presenceRuntime';
import { presenceCoreMotion } from './coreMotion';

export function PresenceCoreFallback(props: { phase: PresencePhase }) {
  const motion = presenceCoreMotion(props.phase);
  return (
    <div className="jp-core-fallback" data-phase={props.phase} style={{ color: motion.primary }} aria-hidden="true">
      <i />
      <i />
      <i />
      <b />
    </div>
  );
}
