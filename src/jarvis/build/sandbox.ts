import fs from 'node:fs';
import path from 'node:path';
import type { BuildPlan } from './types';

export function defaultBuildRoot(): string {
  return path.join(process.cwd(), 'data', 'jarvis', 'builds');
}

export function sandboxPathFor(slug: string, root = defaultBuildRoot()): string {
  const safe = slug.replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 40) || 'project';
  const resolved = path.resolve(root, safe);
  const base = path.resolve(root);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error('Sandbox path escaped the Jarvis build root.');
  }
  return resolved;
}

export function sandboxExists(input: { slug: string }, root = defaultBuildRoot()): boolean {
  const dir = sandboxPathFor(input.slug, root);
  return fs.existsSync(path.join(dir, 'index.html')) || fs.existsSync(path.join(dir, 'package.json'));
}

export function writeApprovedSandbox(plan: BuildPlan, root = defaultBuildRoot()): { dir: string; files: string[] } {
  const dir = sandboxPathFor(plan.slug, root);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  const files: Array<[string, string]> = [
    ['README.md', readme(plan)],
    ['package.json', packageJson(plan)],
    ['index.html', indexHtml(plan)],
    ['src/main.jsx', mainJsx()],
    ['src/App.jsx', appJsx(plan)],
    ['tests/smoke.test.mjs', smokeTest(plan)],
  ];
  for (const [relative, contents] of files) {
    fs.writeFileSync(path.join(dir, relative), contents, 'utf8');
  }
  return { dir, files: files.map(([relative]) => relative) };
}

function readme(plan: BuildPlan): string {
  return [
    `# ${plan.title}`,
    '',
    plan.summary,
    '',
    `Stack: ${plan.suggestedStack}`,
    '',
    'This folder is a Jarvis sandbox artifact. PLAN != EXECUTION PERMISSION.',
    'Do not treat these files as an unrestricted project root.',
    '',
  ].join('\n');
}

function packageJson(plan: BuildPlan): string {
  return `${JSON.stringify({
    name: plan.slug,
    private: true,
    version: '0.0.1',
    type: 'module',
    scripts: {
      test: 'node tests/smoke.test.mjs',
    },
  }, null, 2)}\n`;
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
    <div id="root">
      <main>
        <h1>${escapeHtml(plan.title)}</h1>
        <p>${escapeHtml(plan.brief.slice(0, 180))}</p>
        <section><h2>Intro</h2><p>Placeholder intro.</p></section>
        <section><h2>Work</h2><p>Placeholder work.</p></section>
        <section><h2>Contact</h2><p>Placeholder contact.</p></section>
      </main>
    </div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`;
}

function mainJsx(): string {
  return `import { createRoot } from 'react-dom/client';
import App from './App.jsx';

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
`;
}

function appJsx(plan: BuildPlan): string {
  return `export default function App() {
  return (
    <main>
      <h1>${escapeJs(plan.title)}</h1>
      <p>${escapeJs(plan.projectType === 'WEBSITE' ? 'Responsive website skeleton' : 'Software skeleton')}</p>
    </main>
  );
}
`;
}

function smokeTest(plan: BuildPlan): string {
  return `import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const project = path.join(root, '..');
assert.equal(fs.existsSync(path.join(project, 'index.html')), true);
assert.match(fs.readFileSync(path.join(project, 'index.html'), 'utf8'), /${escapeRegex(plan.title)}/);
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
