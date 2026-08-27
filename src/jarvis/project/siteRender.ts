import type { BuildPlan } from '../build/types';
import { ProjectWorkspace } from './workspace';

export function writeWebsite(plan: BuildPlan, workspace: ProjectWorkspace, mode: 'create' | 'revise' = 'create'): string[] {
  const files = wantsPresentation(plan)
    ? presentationFiles(plan)
    : plan.projectType === 'WEBSITE' ? portfolioFiles(plan) : todoFiles(plan);
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

function wantsPresentation(plan: BuildPlan): boolean {
  return /slide|deck|สไลด์|พรีเซนต์|capability deck|เว็บพรีเซนต์/iu.test(
    `${plan.brief}\n${plan.requirements.join('\n')}\n${plan.slug}\n${plan.title}`,
  );
}

function presentationFiles(plan: BuildPlan): Array<[string, string]> {
  return [
    ['README.md', readme(plan)],
    ['package.json', packageJson(plan)],
    ['vite.config.js', viteConfig()],
    ['index.html', indexHtml(plan)],
    ['src/main.jsx', mainJsx()],
    ['src/App.jsx', presentationApp(plan)],
    ['src/styles.css', presentationStyles()],
    ['tests/smoke.test.mjs', smokeTest(plan, 'presentation')],
  ];
}

function presentationApp(plan: BuildPlan): string {
  const slides = [
    {
      kicker: '01 / IDENTITY',
      title: 'JARVIS ตอนนี้',
      body: 'นี่คือ JARVIS บนเครื่องคุณ ไม่ใช่คลาวด์เอเจนต์ไร้ขอบเขต วางแผน ขอ permission แล้วสร้างโปรเจกต์ใน ProjectWorkspace ได้',
    },
    {
      kicker: '02 / PLAN',
      title: 'วางแผนก่อนลงมือ',
      body: 'BuildPlan มาก่อนไฟล์ ผมอธิบายสแต็ก ขอบเขต และสิ่งที่จะทำ แผนไม่ใช่สิทธิ์รัน',
    },
    {
      kicker: '03 / PERMISSION',
      title: 'Permission ไม่ใช่การเดา',
      body: 'สร้างไฟล์ ติดตั้ง dependency รัน build/test และเปิด preview ได้เมื่อคุณอนุญาตงานนี้ ไม่มี unrestricted shell',
    },
    {
      kicker: '04 / WORKSPACE',
      title: 'ProjectWorkspace จริง',
      body: 'งานสร้างเว็บอยู่ใต้โฟลเดอร์โปรเจกต์ที่จำกัดขอบเขต ไม่เขียนทั้งเครื่อง และไม่ถือว่าพิมพ์แล้วแปลว่าสร้างเสร็จ',
    },
    {
      kicker: '05 / VERIFY',
      title: 'ติดตั้ง / build / test',
      body: 'หลังอนุญาต ผมติดตั้ง dependency, รัน build, แล้วตรวจ smoke test ก่อนบอกว่าพร้อมดู',
    },
    {
      kicker: '06 / PREVIEW',
      title: 'localhost preview',
      body: 'เมื่อผ่านการตรวจ ผมเปิด dev server บน 127.0.0.1 ให้คุณดูของจริง ไม่ใช่แค่อธิบายในแชท',
    },
    {
      kicker: '07 / LIMITS',
      title: 'สิ่งที่ยังไม่ทำ',
      body: 'ยังไม่ deploy สาธารณะ ไม่คลิก/พิมพ์แทนคุณ และไม่สร้างไฟล์ก่อนคุณอนุมัติแผน',
    },
  ];
  return `import { useEffect, useMemo, useState } from 'react';

const TITLE = '${escapeJs(plan.title)}';
const SLIDES = ${JSON.stringify(slides, null, 2)};

export default function App() {
  const [index, setIndex] = useState(0);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const slide = SLIDES[index];
  const reduced = useMemo(() => (
    typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ), []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'ArrowRight' || event.key === ' ') {
        event.preventDefault();
        setIndex(current => Math.min(SLIDES.length - 1, current + 1));
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setIndex(current => Math.max(0, current - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <main
      className="deck"
      data-deck="jarvis"
      onPointerMove={event => {
        if (reduced) return;
        const box = event.currentTarget.getBoundingClientRect();
        setTilt({
          x: ((event.clientY - box.top) / box.height - 0.5) * -10,
          y: ((event.clientX - box.left) / box.width - 0.5) * 14,
        });
      }}
      onPointerLeave={() => setTilt({ x: 0, y: 0 })}
    >
      <div className="deck__grain" aria-hidden="true" />
      <header className="deck__top">
        <p className="deck__mark">JARVIS · LOCAL CAPABILITY DECK</p>
        <p className="deck__count">{String(index + 1).padStart(2, '0')} / {String(SLIDES.length).padStart(2, '0')}</p>
      </header>
      <section
        className="slide"
        data-slide={index + 1}
        style={{
          transform: reduced
            ? 'none'
            : 'rotateX(' + tilt.x + 'deg) rotateY(' + tilt.y + 'deg)',
        }}
      >
        <p className="slide__kicker">{slide.kicker}</p>
        <h1>{index === 0 ? TITLE : slide.title}</h1>
        <p className="slide__body">{slide.body}</p>
      </section>
      <nav className="deck__nav" aria-label="สไลด์">
        <button type="button" onClick={() => setIndex(current => Math.max(0, current - 1))} disabled={index === 0}>ก่อนหน้า</button>
        <ol>
          {SLIDES.map((_, itemIndex) => (
            <li key={itemIndex}>
              <button
                type="button"
                className={itemIndex === index ? 'is-active' : undefined}
                aria-current={itemIndex === index ? 'true' : undefined}
                onClick={() => setIndex(itemIndex)}
              >
                {itemIndex + 1}
              </button>
            </li>
          ))}
        </ol>
        <button type="button" onClick={() => setIndex(current => Math.min(SLIDES.length - 1, current + 1))} disabled={index === SLIDES.length - 1}>ถัดไป</button>
      </nav>
    </main>
  );
}
`;
}

function presentationStyles(): string {
  return `:root {
  color-scheme: dark;
  --void: #05070d;
  --ink: #f4efe2;
  --amber: #f4c56d;
  --ice: #8be7ff;
  --plate: rgba(10, 14, 24, 0.78);
  font-family: "IBM Plex Sans Thai", "Sora", "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(circle at 18% 12%, rgba(244, 197, 109, 0.16), transparent 32%),
    radial-gradient(circle at 82% 88%, rgba(139, 231, 255, 0.12), transparent 36%),
    var(--void);
  color: var(--ink);
}
.deck {
  min-height: 100vh;
  padding: 6vh 7vw 8vh;
  perspective: 1400px;
  overflow: hidden;
  position: relative;
}
.deck__grain {
  pointer-events: none;
  position: absolute;
  inset: 0;
  opacity: 0.16;
  background-image: repeating-linear-gradient(
    180deg,
    transparent 0 2px,
    rgba(255,255,255,0.03) 2px 3px
  );
}
.deck__top, .deck__nav {
  position: relative;
  z-index: 2;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}
.deck__mark, .deck__count, .slide__kicker {
  letter-spacing: 0.22em;
  font-size: 0.72rem;
  color: var(--ice);
  text-transform: uppercase;
}
.slide {
  position: relative;
  z-index: 1;
  margin: 8vh auto;
  max-width: 52rem;
  min-height: 48vh;
  padding: 8vh 6vw;
  border: 1px solid rgba(244, 197, 109, 0.32);
  background:
    linear-gradient(180deg, rgba(244, 197, 109, 0.08), transparent 28%),
    var(--plate);
  box-shadow: 0 40px 90px rgb(0 0 0 / 0.45), inset 0 0 0 1px rgb(139 231 255 / 0.08);
  transform-style: preserve-3d;
  transition: transform 160ms ease;
}
.slide::before {
  content: "";
  position: absolute;
  inset: 14px;
  border: 1px solid rgba(139, 231, 255, 0.14);
  pointer-events: none;
}
h1 {
  margin: 0.6rem 0 1.2rem;
  font-size: clamp(2.4rem, 8vw, 5.6rem);
  line-height: 0.92;
  max-width: 12ch;
  color: var(--amber);
}
.slide__body {
  max-width: 38ch;
  font-size: 1.12rem;
  line-height: 1.7;
  color: #d7d0c2;
}
.deck__nav button {
  font: inherit;
  border: 1px solid rgba(139, 231, 255, 0.28);
  background: transparent;
  color: var(--ink);
  padding: 0.65rem 1rem;
  border-radius: 999px;
}
.deck__nav button:disabled { opacity: 0.35; }
.deck__nav ol {
  display: flex;
  gap: 0.4rem;
  list-style: none;
  padding: 0;
  margin: 0;
}
.deck__nav ol button {
  width: 2rem;
  height: 2rem;
  padding: 0;
  border-radius: 0.4rem;
}
.deck__nav ol button.is-active {
  background: var(--amber);
  color: #160f05;
  border-color: var(--amber);
}
@media (prefers-reduced-motion: reduce) {
  .slide { transition: none; }
}
@media (max-width: 720px) {
  .slide { margin: 4vh 0; padding: 6vh 7vw; }
  .deck__nav { flex-wrap: wrap; }
}
`;
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

function smokeTest(plan: BuildPlan, kind: 'todo' | 'portfolio' | 'presentation'): string {
  const marker = kind === 'todo' ? 'todo' : kind === 'presentation' ? 'slide' : 'site';
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
