import type { BuildPlan } from '../build/types';
import { ProjectWorkspace } from './workspace';

export function writeWebsite(plan: BuildPlan, workspace: ProjectWorkspace, mode: 'create' | 'revise' = 'create'): string[] {
  const files = plan.projectType === 'WEBSITE' ? portfolioFiles(plan) : todoFiles(plan);
  workspace.create(plan);
  const written: string[] = [];
  for (const [relative, contents] of files) {
    if (mode === 'revise' && relative === 'package.json' && workspace.exists(plan.slug)) continue;
    let next = contents;
    if (mode === 'revise') {
      try {
        const existing = workspace.readFile(plan.slug, relative);
        next = preserveConstrained(relative, contents, existing, plan);
        if (next === existing && constrainedSkip(relative, plan)) continue;
      } catch {
        // File may not exist yet on first revise of a new path.
      }
    }
    workspace.writeFile(plan.slug, relative, next);
    written.push(relative);
  }
  return written;
}

function todoFiles(plan: BuildPlan): Array<[string, string]> {
  return [
    ['README.md', readme(plan)],
    ['package.json', packageJson(plan)],
    ['vite.config.js', viteConfig()],
    ['index.html', indexHtml(plan)],
    ['src/main.jsx', mainJsx()],
    ['src/App.jsx', todoApp(plan)],
    ['src/styles.css', todoStyles(plan)],
    ['tests/smoke.test.mjs', smokeTest(plan, 'todo')],
  ];
}

function portfolioFiles(plan: BuildPlan): Array<[string, string]> {
  return [
    ['README.md', readme(plan)],
    ['package.json', packageJson(plan)],
    ['vite.config.js', viteConfig()],
    ['index.html', indexHtml(plan)],
    ['src/main.jsx', mainJsx()],
    ['src/App.jsx', portfolioApp(plan)],
    ['src/styles.css', portfolioStyles(plan)],
    ['tests/smoke.test.mjs', smokeTest(plan, 'portfolio')],
  ];
}

function pagesOf(plan: BuildPlan): string[] {
  const blob = `${plan.brief}\n${plan.requirements.join('\n')}`.toLocaleLowerCase();
  const pages = ['home'];
  if (/about/.test(blob)) pages.push('about');
  if (/project|work|ผลงาน/.test(blob)) pages.push('projects');
  if (/skill/.test(blob)) pages.push('skills');
  if (/contact|ติดต่อ/.test(blob)) pages.push('contact');
  if (pages.length === 1) pages.push('projects', 'contact');
  const unique = [...new Set(pages)];
  if (/ก่อน projects|before projects/i.test(blob) && unique.includes('skills') && unique.includes('projects')) {
    return unique.filter(page => page !== 'skills').flatMap(page => page === 'projects' ? ['skills', 'projects'] : [page]);
  }
  return unique;
}

function paletteOf(plan: BuildPlan): { bg: string; ink: string; accent: string; mist: string } {
  const blob = `${plan.brief}\n${plan.requirements.join('\n')}`;
  if (/ดำ|ฟ้า|ม่วง|black|blue|purple/iu.test(blob)) {
    return { bg: '#07060d', ink: '#e8f4ff', accent: '#7b6cff', mist: '#4fd2ff' };
  }
  return { bg: '#081018', ink: '#e7f6ff', accent: '#5ee7ff', mist: '#9fb8c8' };
}

function wantsLightMotion(plan: BuildPlan): boolean {
  const blob = `${plan.brief}\n${plan.requirements.join('\n')}`;
  if (/ไม่(?:เอา|ต้อง) animation|no animation/iu.test(blob)) return false;
  return /animation|framer|motion|hover/iu.test(blob);
}

function wantsDark(plan: BuildPlan): boolean {
  return /dark mode|ทั้งเว็บ/iu.test(`${plan.brief}\n${plan.requirements.join('\n')}`);
}

function constraintsOf(plan: BuildPlan): string[] {
  return plan.requirements.filter(item => /อย่าแตะ|ไม่ต้องเปลี่ยนสี|ไม่เอาส่วน|navbar ยัง|ไม่เอาหน้า/iu.test(item));
}

function constrainedSkip(relative: string, plan: BuildPlan): boolean {
  const blob = constraintsOf(plan).join('\n');
  if (/navbar/iu.test(blob) && relative === 'src/App.jsx') return true;
  if (/ไม่ต้องเปลี่ยนสี|อย่าเปลี่ยนสี/iu.test(blob) && relative === 'src/styles.css') return true;
  return false;
}

function preserveConstrained(relative: string, generated: string, existing: string, plan: BuildPlan): string {
  const blob = constraintsOf(plan).join('\n');
  if (relative === 'src/App.jsx' && /navbar|อย่าแตะ nav/iu.test(blob)) {
    const nav = existing.match(/<nav[\s\S]*?<\/nav>/iu)?.[0];
    if (nav && /<nav[\s\S]*?<\/nav>/iu.test(generated)) {
      return generated.replace(/<nav[\s\S]*?<\/nav>/iu, nav);
    }
    if (nav) return existing;
  }
  if (relative === 'src/styles.css' && /ไม่ต้องเปลี่ยนสี|อย่าเปลี่ยนสี/iu.test(blob)) {
    return existing;
  }
  return generated;
}

function readme(plan: BuildPlan): string {
  return `# ${plan.title}\n\n${plan.summary}\n\nSandbox project. PLAN != EXECUTION PERMISSION.\n`;
}

function packageJson(plan: BuildPlan): string {
  return `${JSON.stringify({
    name: plan.slug,
    private: true,
    version: '0.0.1',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build',
      test: 'node tests/smoke.test.mjs',
      preview: 'vite preview --host 127.0.0.1',
    },
    dependencies: { react: '^19.1.0', 'react-dom': '^19.1.0' },
    devDependencies: { '@vitejs/plugin-react': '^4.5.2', vite: '^6.3.5' },
  }, null, 2)}\n`;
}

function viteConfig(): string {
  return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', strictPort: true },
  preview: { host: '127.0.0.1', strictPort: true },
});
`;
}

function indexHtml(plan: BuildPlan): string {
  return `<!doctype html>
<html lang="th">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(plan.title)}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`;
}

function mainJsx(): string {
  return `import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
`;
}

function todoApp(plan: BuildPlan): string {
  const motion = wantsLightMotion(plan);
  return `import { useMemo, useState } from 'react';

const STARTER = [
  { id: '1', title: 'Review the plan', done: true },
  { id: '2', title: 'Add a modern task', done: false },
];

export default function App() {
  const [items, setItems] = useState(STARTER);
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState('all');
  const remaining = useMemo(() => items.filter(item => !item.done).length, [items]);
  const visible = items.filter(item => filter === 'completed' ? item.done : true);

  return (
    <main className="todo"${motion ? ' data-motion="light"' : ''}>
      <p className="todo__kicker">JARVIS · LOCAL</p>
      <h1>${escapeJs(plan.title)}</h1>
      <p className="todo__lead">{remaining} open.</p>
      <form className="todo__form" onSubmit={event => {
        event.preventDefault();
        const title = draft.trim();
        if (!title) return;
        setItems(current => [{ id: String(Date.now()), title, done: false }, ...current]);
        setDraft('');
      }}>
        <input value={draft} onChange={event => setDraft(event.target.value)} placeholder="Add a task" aria-label="New todo" />
        <button type="submit">Add</button>
      </form>
      <div className="todo__tools">
        <button type="button" onClick={() => setFilter(current => current === 'completed' ? 'all' : 'completed')}>Filter completed</button>
        <button type="button" onClick={() => setItems(current => current.filter(item => !item.done))}>Clear completed</button>
      </div>
      <ul>
        {visible.map(item => (
          <li key={item.id} data-done={item.done ? 'true' : 'false'}>
            <label>
              <input type="checkbox" checked={item.done} onChange={() => setItems(current => current.map(entry => (
                entry.id === item.id ? { ...entry, done: !entry.done } : entry
              )))} />
              <span>{item.title}</span>
            </label>
          </li>
        ))}
      </ul>
    </main>
  );
}
`;
}

function todoStyles(plan: BuildPlan): string {
  const palette = paletteOf(plan);
  return `:root { color-scheme: dark; font-family: "Segoe UI", sans-serif; }
body { margin: 0; background: radial-gradient(circle at top, ${palette.accent}22, ${palette.bg} 58%); color: ${palette.ink}; }
.todo { max-width: 42rem; margin: 8vh auto; padding: 2rem; border: 1px solid rgb(94 231 255 / 0.18); border-radius: 1.4rem; background: rgb(4 10 18 / 0.72); }
.todo[data-motion="light"] { animation: rise 480ms ease; }
.todo__kicker { letter-spacing: 0.18em; font-size: 0.72rem; color: ${palette.mist}; }
h1 { margin: 0.2rem 0 0.6rem; font-size: clamp(2rem, 6vw, 3.4rem); }
.todo__lead, .todo__tools { color: ${palette.mist}; }
.todo__form, .todo__tools { display: flex; gap: 0.6rem; margin: 1.2rem 0; flex-wrap: wrap; }
input, button { font: inherit; }
.todo__form input { flex: 1; border-radius: 999px; border: 1px solid rgb(94 231 255 / 0.28); background: rgb(2 8 14 / 0.8); color: inherit; padding: 0.7rem 1rem; }
button { border: 0; border-radius: 999px; padding: 0.7rem 1.1rem; background: ${palette.accent}; color: #041018; font-weight: 700; }
ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.55rem; }
li { padding: 0.75rem 0.9rem; border-radius: 0.9rem; background: rgb(12 24 36 / 0.8); }
li[data-done="true"] span { text-decoration: line-through; color: #7d97a8; }
label { display: flex; gap: 0.7rem; align-items: center; }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@media (max-width: 640px) { .todo { margin: 0; border-radius: 0; min-height: 100vh; } }
`;
}

function portfolioApp(plan: BuildPlan): string {
  const pages = pagesOf(plan);
  const motion = wantsLightMotion(plan);
  const dark = wantsDark(plan);
  const nav = pages.map(page => `<a href="#${page}">${labelPage(page)}</a>`).join('');
  const sections = pages.map(page => sectionFor(page, plan)).join('\n');
  return `export default function App() {
  return (
    <main className="site" data-dark="${dark ? 'true' : 'false'}"${motion ? ' data-motion="light"' : ''}>
      <nav className="site__nav">${nav}</nav>
      ${sections}
    </main>
  );
}
`;
}

function sectionFor(page: string, plan: BuildPlan): string {
  if (page === 'about') {
    return `<section id="about"><h2>About</h2><p>A focused builder of local AI systems and cinematic interfaces.</p></section>`;
  }
  if (page === 'skills') {
    return `<section id="skills"><h2>Skills</h2><div className="cards"><article>React</article><article>Local AI</article><article>Product design</article></div></section>`;
  }
  if (page === 'contact') {
    const animateContact = !constraintsOf(plan).some(item => /contact/iu.test(item) && /ไม่เอา|อย่า/iu.test(item));
    return `<section id="contact"${animateContact ? '' : ' data-static="true"'}><h2>Contact</h2><p>Owner channel only. Local Jarvis sandbox.</p></section>`;
  }
  if (page === 'projects') {
    return `<section id="projects"><h2>Projects</h2><div className="cards"><article className="card">Jarvis Command Center</article><article className="card">Voice companion</article><article className="card">Night Agent</article></div></section>`;
  }
  return `<section id="home"><p className="kicker">PORTFOLIO</p><h1>${escapeJs(plan.title)}</h1><p>Futuristic, uncluttered work — selected projects first.</p></section>`;
}

function labelPage(page: string): string {
  return page[0]!.toUpperCase() + page.slice(1);
}

function portfolioStyles(plan: BuildPlan): string {
  const palette = paletteOf(plan);
  const columns = /3 column|three column/iu.test(`${plan.brief}\n${plan.requirements.join('\n')}`) ? 3 : 2;
  return `:root { color-scheme: dark; font-family: "Sora", "Segoe UI", sans-serif; }
body { margin: 0; background: ${palette.bg}; color: ${palette.ink}; }
.site { min-height: 100vh; }
.site[data-motion="light"] section { animation: rise 520ms ease both; }
.site__nav { display: flex; gap: 1rem; padding: 1rem 6vw; position: sticky; top: 0; background: rgb(7 6 13 / 0.86); }
.site__nav a { color: ${palette.mist}; text-decoration: none; letter-spacing: 0.08em; text-transform: uppercase; font-size: 0.72rem; }
section { padding: 8vh 6vw; }
h1 { font-size: clamp(2.4rem, 8vw, 5.4rem); max-width: 12ch; }
.kicker { letter-spacing: 0.22em; color: ${palette.accent}; font-size: 0.72rem; }
.cards { display: grid; grid-template-columns: repeat(${columns}, minmax(0, 1fr)); gap: 1rem; }
.card, .cards article { padding: 1.2rem; border: 1px solid rgb(123 108 255 / 0.28); background: rgb(12 10 24 / 0.8); }
.card:hover, .cards article:hover { transform: translateY(-3px); border-color: ${palette.mist}; }
@keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@media (max-width: 720px) { .cards { grid-template-columns: 1fr; } .site__nav { flex-wrap: wrap; } }
`;
}

function smokeTest(plan: BuildPlan, kind: 'todo' | 'portfolio'): string {
  const marker = kind === 'todo' ? 'todo' : 'site';
  return `import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const project = path.join(root, '..');
const html = fs.readFileSync(path.join(project, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(project, 'src/App.jsx'), 'utf8');
assert.match(html, /${escapeRegex(plan.title)}/);
assert.match(app, /${marker}/i);
assert.equal(fs.existsSync(path.join(project, 'package.json')), true);
console.log('smoke ok');
`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch));
}

function escapeJs(value: string): string {
  return value.replace(/[\\'`$]/gu, '\\$&');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
