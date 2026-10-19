// Fails if a screen or component uses a colour directly instead of a theme token,
// so dark mode can't quietly break. The palette and theme are where colours live.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const allowed = new Set(['palette.ts', 'theme.ts']);
const HEX = /['"`(\s]#[0-9a-fA-F]{3,8}\b/;

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });

const problems = [];
for (const file of walk(root)) {
  if (allowed.has(relative(root, file))) continue;
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (HEX.test(line)) problems.push(`${relative(root, file)}:${i + 1}: ${line.trim()}`);
    });
}
if (problems.length) {
  console.error('Use a colour from src/palette.ts (through colors in theme.ts) instead of these:\n' + problems.join('\n'));
  process.exit(1);
}
console.log('No hard-coded colours.');
