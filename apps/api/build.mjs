// Bundles the one-process server (src/all.ts) into dist/all.js for hosts with
// little memory, where compiling TypeScript at every start (tsx) is wasteful.
// The API's own npm dependencies stay external and load from node_modules; the
// workspace packages (@tagalong/db, @tagalong/shared) and their dependencies
// are bundled in, since pnpm doesn't link those into the API's node_modules.
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {})
  .filter((name) => !name.startsWith('@tagalong/'))
  .flatMap((name) => [name, `${name}/*`]);

await build({
  entryPoints: ['src/all.ts'],
  outfile: 'dist/all.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: [...external, ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  // Bundled CommonJS code may still call require().
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'info',
});
