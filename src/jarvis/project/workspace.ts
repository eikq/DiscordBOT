import fs from 'node:fs';
import path from 'node:path';
import type { BuildPlan } from '../build/types';
import { defaultBuildRoot } from '../build/sandbox';
import {
  listWorkspaceFiles,
  resolveWorkspaceFile,
  resolveWorkspaceRoot,
} from './pathGuard';

const MAX_FILE_BYTES = 200_000;

export class ProjectWorkspace {
  public constructor(public readonly sandboxRoot = defaultBuildRoot()) {}

  public create(plan: Pick<BuildPlan, 'slug' | 'title'>): { dir: string; created: boolean } {
    const dir = resolveWorkspaceRoot(plan.slug, this.sandboxRoot);
    const created = !fs.existsSync(dir);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
    return { dir, created };
  }

  public writeFile(slug: string, relativePath: string, contents: string): { path: string; bytes: number } {
    if (Buffer.byteLength(contents, 'utf8') > MAX_FILE_BYTES) {
      throw new Error('Project file is too large for a bounded write.');
    }
    const file = resolveWorkspaceFile({ slug, relativePath, root: this.sandboxRoot });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents, 'utf8');
    return { path: path.relative(resolveWorkspaceRoot(slug, this.sandboxRoot), file).replace(/\\/gu, '/'), bytes: Buffer.byteLength(contents, 'utf8') };
  }

  public readFile(slug: string, relativePath: string, max = 32_000): string {
    const file = resolveWorkspaceFile({ slug, relativePath, root: this.sandboxRoot });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      throw new Error('That project file does not exist.');
    }
    return fs.readFileSync(file, 'utf8').slice(0, max);
  }

  public listFiles(slug: string): string[] {
    return listWorkspaceFiles(slug, this.sandboxRoot);
  }

  public rootOf(slug: string): string {
    return resolveWorkspaceRoot(slug, this.sandboxRoot);
  }

  public exists(slug: string): boolean {
    const dir = resolveWorkspaceRoot(slug, this.sandboxRoot);
    return fs.existsSync(path.join(dir, 'package.json')) || fs.existsSync(path.join(dir, 'index.html'));
  }
}

export function writeTodoWebsite(plan: BuildPlan, workspace: ProjectWorkspace): string[] {
  const files: Array<[string, string]> = [
    ['README.md', todoReadme(plan)],
    ['package.json', todoPackageJson(plan)],
    ['vite.config.js', todoViteConfig()],
    ['index.html', todoIndexHtml(plan)],
    ['src/main.jsx', todoMain()],
    ['src/App.jsx', todoApp(plan)],
    ['src/styles.css', todoStyles()],
    ['tests/smoke.test.mjs', todoSmoke(plan)],
  ];
  workspace.create(plan);
  for (const [relative, contents] of files) {
    workspace.writeFile(plan.slug, relative, contents);
  }
  return files.map(([relative]) => relative);
}

function todoReadme(plan: BuildPlan): string {
  return [
    `# ${plan.title}`,
    '',
    plan.summary,
    '',
    'Jarvis-generated project workspace. PLAN != EXECUTION PERMISSION.',
    'Dependencies and scripts stay inside this folder. No unrestricted shell.',
    '',
  ].join('\n');
}

function todoPackageJson(plan: BuildPlan): string {
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
    dependencies: {
      react: '^19.1.0',
      'react-dom': '^19.1.0',
    },
    devDependencies: {
      '@vitejs/plugin-react': '^4.5.2',
      vite: '^6.3.5',
    },
  }, null, 2)}\n`;
}

function todoViteConfig(): string {
  return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', strictPort: true },
  preview: { host: '127.0.0.1', strictPort: true },
});
`;
}

function todoIndexHtml(plan: BuildPlan): string {
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

function todoMain(): string {
  return `import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
`;
}

function todoApp(plan: BuildPlan): string {
  return `import { useMemo, useState } from 'react';

const STARTER = [
  { id: '1', title: 'Review the plan', done: true },
  { id: '2', title: 'Add a modern task', done: false },
];

export default function App() {
  const [items, setItems] = useState(STARTER);
  const [draft, setDraft] = useState('');
  const remaining = useMemo(() => items.filter(item => !item.done).length, [items]);

  return (
    <main className="todo">
      <p className="todo__kicker">JARVIS · LOCAL</p>
      <h1>${escapeJs(plan.title)}</h1>
      <p className="todo__lead">A modern local todo board. \${remaining} open.</p>
      <form
        className="todo__form"
        onSubmit={event => {
          event.preventDefault();
          const title = draft.trim();
          if (!title) return;
          setItems(current => [{ id: String(Date.now()), title, done: false }, ...current]);
          setDraft('');
        }}
      >
        <input
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder="Add a task"
          aria-label="New todo"
        />
        <button type="submit">Add</button>
      </form>
      <ul>
        {items.map(item => (
          <li key={item.id} data-done={item.done ? 'true' : 'false'}>
            <label>
              <input
                type="checkbox"
                checked={item.done}
                onChange={() => setItems(current => current.map(entry => (
                  entry.id === item.id ? { ...entry, done: !entry.done } : entry
                )))}
              />
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

function todoStyles(): string {
  return `:root { color-scheme: dark; font-family: "Segoe UI", sans-serif; }
body { margin: 0; background: radial-gradient(circle at top, #16324a, #070b12 58%); color: #e7f6ff; }
.todo { max-width: 42rem; margin: 8vh auto; padding: 2rem; border: 1px solid rgb(94 231 255 / 0.18); border-radius: 1.4rem; background: rgb(4 10 18 / 0.72); }
.todo__kicker { letter-spacing: 0.18em; font-size: 0.72rem; color: #7ddcff; }
h1 { margin: 0.2rem 0 0.6rem; font-size: clamp(2rem, 6vw, 3.4rem); }
.todo__lead { color: #9fb8c8; }
.todo__form { display: flex; gap: 0.6rem; margin: 1.2rem 0; }
input, button { font: inherit; }
input[type="text"], .todo__form input { flex: 1; border-radius: 999px; border: 1px solid rgb(94 231 255 / 0.28); background: rgb(2 8 14 / 0.8); color: inherit; padding: 0.7rem 1rem; }
button { border: 0; border-radius: 999px; padding: 0.7rem 1.1rem; background: #5ee7ff; color: #041018; font-weight: 700; }
ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.55rem; }
li { padding: 0.75rem 0.9rem; border-radius: 0.9rem; background: rgb(12 24 36 / 0.8); }
li[data-done="true"] span { text-decoration: line-through; color: #7d97a8; }
label { display: flex; gap: 0.7rem; align-items: center; }
@media (max-width: 640px) { .todo { margin: 0; border-radius: 0; min-height: 100vh; } }
`;
}

function todoSmoke(plan: BuildPlan): string {
  return `import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const project = path.join(root, '..');
const html = fs.readFileSync(path.join(project, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(project, 'src/App.jsx'), 'utf8');
assert.match(html, /${escapeRegex(plan.title)}/);
assert.match(app, /todo/i);
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
