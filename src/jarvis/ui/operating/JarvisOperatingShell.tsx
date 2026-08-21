import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  Bot,
  Boxes,
  BrainCircuit,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Clapperboard,
  Command,
  Cpu,
  FileSearch,
  Files,
  FlaskConical,
  FolderCode,
  Home,
  Laptop,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react';
import EmergencyStop from './TrustedOperator';

export type JarvisPageId =
  | 'home'
  | 'assistant'
  | 'tasks'
  | 'research'
  | 'documents'
  | 'workspace'
  | 'content'
  | 'devices'
  | 'automations'
  | 'evolution'
  | 'security'
  | 'system'
  | 'activity'
  | 'settings';

type PageDefinition = {
  id: JarvisPageId;
  label: string;
  description: string;
  icon: LucideIcon;
  section: 'daily' | 'build' | 'control';
  keywords: string[];
};

export const JARVIS_PAGES: PageDefinition[] = [
  { id: 'home', label: 'Home', description: 'Jarvis at a glance', icon: Home, section: 'daily', keywords: ['status', 'overview', 'ask'] },
  { id: 'assistant', label: 'Assistant', description: 'Conversation and voice', icon: Bot, section: 'daily', keywords: ['ask', 'chat', 'voice', 'microphone'] },
  { id: 'tasks', label: 'Tasks', description: 'WorkAgent task center', icon: Boxes, section: 'daily', keywords: ['work', 'plan', 'dag', 'queue'] },
  { id: 'research', label: 'Research', description: 'Sources and claims', icon: Search, section: 'daily', keywords: ['web', 'sources', 'evidence'] },
  { id: 'documents', label: 'Documents', description: 'Document intelligence', icon: Files, section: 'build', keywords: ['pdf', 'mineru', 'ocr', 'docx'] },
  { id: 'workspace', label: 'Workspace', description: 'Local project intelligence', icon: FolderCode, section: 'build', keywords: ['code', 'files', 'tokei', 'search'] },
  { id: 'content', label: 'Content', description: 'Content production studio', icon: Clapperboard, section: 'build', keywords: ['youtube', 'video', 'script', 'seo'] },
  { id: 'devices', label: 'Devices', description: 'Computers and sensors', icon: Laptop, section: 'build', keywords: ['pc', 'phone', 'cctv', 'screen'] },
  { id: 'automations', label: 'Automations', description: 'Reminders and routines', icon: CalendarClock, section: 'build', keywords: ['schedule', 'reminder', 'night'] },
  { id: 'evolution', label: 'Evolution', description: 'Experience and growth', icon: BrainCircuit, section: 'build', keywords: ['fluctlight', 'skills', 'reflection', 'learning'] },
  { id: 'security', label: 'Security', description: 'Owner control center', icon: ShieldCheck, section: 'control', keywords: ['permission', 'risk', 'lease', 'autonomy'] },
  { id: 'system', label: 'System', description: 'Runtime and capabilities', icon: Cpu, section: 'control', keywords: ['model', 'gpu', 'service', 'capability'] },
  { id: 'activity', label: 'Activity', description: 'Audit and operations', icon: Activity, section: 'control', keywords: ['events', 'audit', 'logs', 'timeline'] },
  { id: 'settings', label: 'Settings', description: 'Experience preferences', icon: Settings, section: 'control', keywords: ['persona', 'quality', 'preferences'] },
];

export function parseJarvisPage(pathname: string): JarvisPageId {
  const segment = pathname.split('/').filter(Boolean)[1]?.toLowerCase();
  return JARVIS_PAGES.some(page => page.id === segment) ? segment as JarvisPageId : 'home';
}

type QuickCommand = {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  page?: JarvisPageId;
  action?: 'ask' | 'emergency';
  keywords: string[];
};

const QUICK_COMMANDS: QuickCommand[] = [
  { id: 'ask', label: 'Ask Jarvis', hint: 'Open the conversation', icon: Sparkles, page: 'assistant', action: 'ask', keywords: ['chat', 'question', 'voice'] },
  { id: 'research', label: 'Start research', hint: 'Open Research Center', icon: Search, page: 'research', keywords: ['web', 'sources'] },
  { id: 'workspace', label: 'Open workspace', hint: 'Search the local project', icon: FolderCode, page: 'workspace', keywords: ['code', 'files'] },
  { id: 'documents', label: 'Analyze document', hint: 'Review parser readiness', icon: FileSearch, page: 'documents', keywords: ['pdf', 'ocr'] },
  { id: 'system', label: 'Run system check', hint: 'Open runtime health', icon: Cpu, page: 'system', keywords: ['health', 'gpu', 'model'] },
  { id: 'tasks', label: 'Show current tasks', hint: 'Open Task Center', icon: Boxes, page: 'tasks', keywords: ['work', 'queue'] },
  { id: 'permissions', label: 'Show permissions', hint: 'Open Owner Control', icon: ShieldCheck, page: 'security', keywords: ['risk', 'lease'] },
  { id: 'evolution', label: 'Open evolution', hint: 'Experiences and Night Cycle', icon: BrainCircuit, page: 'evolution', keywords: ['skills', 'growth'] },
  { id: 'capabilities', label: 'Search capabilities', hint: 'Open Capability Explorer', icon: FlaskConical, page: 'system', keywords: ['tools', 'providers'] },
  { id: 'emergency', label: 'Emergency stop', hint: 'Open the stop contract', icon: CircleStop, action: 'emergency', keywords: ['halt', 'cancel', 'revoke'] },
];

export type ShellStatus = {
  label: string;
  value: string;
  tone: 'active' | 'healthy' | 'warning' | 'critical' | 'neutral' | 'simulation';
};

type Props = {
  activePage: JarvisPageId;
  statuses: ShellStatus[];
  pendingApprovals: number;
  simulation: boolean;
  children: ReactNode;
  onNavigate: (page: JarvisPageId) => void;
  onFocusAsk: () => void;
};

export default function JarvisOperatingShell({
  activePage,
  statuses,
  pendingApprovals,
  simulation,
  children,
  onNavigate,
  onFocusAsk,
}: Props) {
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const active = JARVIS_PAGES.find(page => page.id === activePage) ?? JARVIS_PAGES[0]!;

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(open => !open);
      } else if (event.key === 'Escape') {
        setPaletteOpen(false);
        setEmergencyOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (paletteOpen) window.setTimeout(() => searchRef.current?.focus(), 0);
    else setQuery('');
  }, [paletteOpen]);

  const commands = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return QUICK_COMMANDS;
    return QUICK_COMMANDS.filter(command =>
      `${command.label} ${command.hint} ${command.keywords.join(' ')}`.toLowerCase().includes(term));
  }, [query]);

  const runCommand = (command: QuickCommand) => {
    setPaletteOpen(false);
    if (command.action === 'emergency') {
      setEmergencyOpen(true);
      return;
    }
    if (command.page) onNavigate(command.page);
    if (command.action === 'ask') window.setTimeout(onFocusAsk, 0);
  };

  return (
    <div className={`jai-shell${navCollapsed ? ' is-nav-collapsed' : ''}`}>
      <aside className="jai-nav" aria-label="JARVIS primary navigation">
        <div className="jai-nav__brand">
          <div className="jai-mark" aria-hidden="true"><span>J</span></div>
          <div className="jai-nav__brand-copy">
            <strong>JARVIS</strong>
            <span>Personal AI</span>
          </div>
          <button type="button" className="jai-icon-button jai-nav__collapse" onClick={() => setNavCollapsed(value => !value)} aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}>
            {navCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        {(['daily', 'build', 'control'] as const).map(section => (
          <div className="jai-nav__group" key={section}>
            <p>{section === 'daily' ? 'Daily' : section === 'build' ? 'Intelligence' : 'Control'}</p>
            {JARVIS_PAGES.filter(page => page.section === section).map(page => {
              const Icon = page.icon;
              return (
                <button
                  type="button"
                  key={page.id}
                  className={activePage === page.id ? 'is-active' : ''}
                  aria-current={activePage === page.id ? 'page' : undefined}
                  title={navCollapsed ? page.label : undefined}
                  onClick={() => onNavigate(page.id)}
                >
                  <Icon size={18} strokeWidth={1.8} />
                  <span>{page.label}</span>
                  {page.id === 'security' && pendingApprovals > 0 ? <em>{pendingApprovals}</em> : null}
                </button>
              );
            })}
          </div>
        ))}

        <div className="jai-nav__footer">
          <button type="button" className="jai-emergency-link" onClick={() => setEmergencyOpen(true)} title="Emergency stop contract">
            <CircleStop size={18} />
            <span>Emergency stop</span>
          </button>
          <span className="jai-nav__local"><i /> Local-first runtime</span>
        </div>
      </aside>

      <div className="jai-workspace">
        <header className="jai-topbar">
          <div className="jai-topbar__title">
            <span>{active.label}</span>
            <small>{active.description}</small>
          </div>
          <div className="jai-topbar__statuses" aria-label="Jarvis summary status">
            {statuses.slice(0, 4).map(status => (
              <span key={status.label} className={`jai-status jai-status--${status.tone}`}>
                <i /> {status.label} <strong>{status.value}</strong>
              </span>
            ))}
            {simulation ? <span className="jai-badge jai-badge--simulation">Simulation</span> : null}
          </div>
          <button type="button" className="jai-topbar-stop" onClick={() => setEmergencyOpen(true)} aria-label="Open emergency stop contract" title="Emergency stop"><CircleStop size={17} /></button>
          <button type="button" className="jai-command-key" onClick={() => setPaletteOpen(true)}>
            <Command size={16} /> <span>Command</span> <kbd>⌘K</kbd>
          </button>
        </header>

        <main className="jai-main" id="jarvis-main">
          {children}
        </main>
      </div>

      {paletteOpen ? (
        <div className="jai-modal-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPaletteOpen(false); }}>
          <section className="jai-palette" role="dialog" aria-modal="true" aria-label="JARVIS command palette">
            <div className="jai-palette__search">
              <Search size={18} />
              <input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Ask, navigate, or find a capability…" />
              <button type="button" onClick={() => setPaletteOpen(false)} aria-label="Close"><X size={17} /></button>
            </div>
            <div className="jai-palette__results">
              {commands.map(command => {
                const Icon = command.icon;
                return (
                  <button type="button" key={command.id} onClick={() => runCommand(command)}>
                    <Icon size={19} />
                    <span><strong>{command.label}</strong><small>{command.hint}</small></span>
                  </button>
                );
              })}
              {commands.length === 0 ? <p>No matching commands.</p> : null}
            </div>
          </section>
        </div>
      ) : null}

      <EmergencyStop open={emergencyOpen} available={false} onClose={() => setEmergencyOpen(false)} />
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <header className="jai-page-header">
      <div>
        {eyebrow ? <p>{eyebrow}</p> : null}
        <h1>{title}</h1>
        <span>{description}</span>
      </div>
      {actions ? <div className="jai-page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function SectionCard({ title, description, tone = 'neutral', action, children, className = '' }: {
  title: string;
  description?: string;
  tone?: 'neutral' | 'cyan' | 'green' | 'violet' | 'amber' | 'red';
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`jai-card jai-card--${tone}${className ? ` ${className}` : ''}`}>
      <header className="jai-card__header">
        <div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function ExpertDetails({ summary = 'Expert details', children, open = false }: { summary?: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="jai-expert" open={open}>
      <summary><FlaskConical size={15} /> {summary}</summary>
      <div className="jai-expert__body">{children}</div>
    </details>
  );
}

export function EmptyState({ title, detail, badge }: { title: string; detail: string; badge?: string }) {
  return (
    <div className="jai-empty">
      {badge ? <span className="jai-badge jai-badge--neutral">{badge}</span> : null}
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

export function PreparedFeature({ label, title, detail, next }: { label: 'PREPARED' | 'NOT CONFIGURED' | 'BLOCKED_LOCAL_ACCEPTANCE' | 'REFERENCE ONLY' | 'BENCHMARK LATER'; title: string; detail: string; next?: string }) {
  return (
    <article className="jai-prepared">
      <span className="jai-badge jai-badge--neutral">{label}</span>
      <h3>{title}</h3>
      <p>{detail}</p>
      {next ? <small>{next}</small> : null}
    </article>
  );
}
