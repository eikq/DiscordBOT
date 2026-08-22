import { COMMUNITY_SAMPLE_PROMPTS } from '../../edition/types';

export function communityModelBadge(health?: string) {
  return health === 'MODEL_READY' ? 'MODEL READY' : 'LOCAL MODEL OFFLINE';
}

export function communityWelcomeVisible(input: {
  edition?: string;
  ambient?: boolean;
  hasAnswer?: boolean;
  busy?: boolean;
  taskActive?: boolean;
  waitingPermission?: boolean;
}) {
  return input.edition === 'community'
    && !input.ambient
    && !input.hasAnswer
    && !input.busy
    && !input.taskActive
    && !input.waitingPermission;
}

type Props = {
  edition?: string;
  modelHealth?: string;
  modelName?: string;
  endpoint?: string;
  authConfigured?: boolean;
  welcome: boolean;
  setupOpen: boolean;
  onSetupOpen: (open: boolean) => void;
  onPrompt: (text: string) => void;
};

export default function CommunityPresenceChrome(props: Props) {
  if (props.edition !== 'community') return null;
  const offline = props.modelHealth !== 'MODEL_READY';
  return (
    <>
      {offline ? (
        <aside className="jp-setup" data-open={props.setupOpen ? 'true' : 'false'} aria-label="Local model setup">
          <header>
            <strong>LOCAL MODEL OFFLINE</strong>
            <button type="button" onClick={() => props.onSetupOpen(!props.setupOpen)}>
              {props.setupOpen ? 'Hide setup' : 'Setup'}
            </button>
          </header>
          <p>Configure an OpenAI-compatible local model to begin.</p>
          {props.setupOpen ? (
            <dl>
              <div><dt>Model endpoint</dt><dd>{props.endpoint || 'not configured'}</dd></div>
              <div><dt>Model name</dt><dd>{props.modelName || 'not configured'}</dd></div>
              <div><dt>Connection</dt><dd>Offline</dd></div>
              <div><dt>API key</dt><dd>{props.authConfigured ? 'configured' : 'not set'}</dd></div>
            </dl>
          ) : null}
          <small>Edit `.env.community` and restart Community JARVIS. The key is never shown.</small>
        </aside>
      ) : null}
      {props.welcome ? (
        <section className="jp-welcome" aria-label="Jarvis Community welcome">
          <p className="jp-welcome__kicker">JARVIS COMMUNITY</p>
          <h2>Local-first personal AI operating interface</h2>
          <p>Try a short command. Plans and file changes stay permission-first.</p>
          <ul>
            <li>สร้างเว็บ todo ให้ผม</li>
            <li>ช่วยวางแผน portfolio</li>
            <li>หาข้อมูล React animation</li>
            <li>ตอนนี้คุณทำอะไรได้บ้าง</li>
          </ul>
          <div className="jp-prompts">
            {COMMUNITY_SAMPLE_PROMPTS.map(item => (
              <button type="button" key={item.id} onClick={() => props.onPrompt(item.text)}>
                <small>{item.label}</small>
                {item.text}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
