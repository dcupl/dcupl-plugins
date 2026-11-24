// The CLI's npm package is `@dcupl/cli`; the unscoped names `dcupl` and `create-dcupl` are not
// dcupl's packages (decision #599, 2026-11-24). `npx dcupl …` runs the project's local CLI when one
// is installed, but without one npx downloads whatever package owns the unscoped name, and in a
// session without a terminal (every agent) it does so without asking. So no file under
// `dcupl/skills/` runs `npx dcupl` or `npx create-dcupl` unless `--no --` stops the download:
// `npx --no -- dcupl --version` and `npx @dcupl/cli …` stay allowed. Run with `node --test`.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = join(REPO_ROOT, 'dcupl', 'skills');

// npx, then any flags that do not stop a download (-y, --yes, --quiet, --package=…), then the
// unscoped name as the command. `--no` (or `--yes=false`) anywhere before the name makes it safe.
const UNSCOPED_NPX = /\bnpx((?:\s+-[^\s]*)*)\s+(?:--\s+)?(dcupl|create-dcupl)(?![\w/@-])/g;
const STOPS_DOWNLOAD = /(?:^|\s)(?:--no|--yes=false)(?=\s|$)/;

/** Every unguarded `npx <unscoped name>` in one line of text. */
export const findUnscopedNpx = (line) =>
  [...line.matchAll(UNSCOPED_NPX)]
    .filter(([, flags]) => !STOPS_DOWNLOAD.test(flags))
    .map(([match]) => match.trim());

const filesUnder = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : filesUnder(path);
    }
    return [path];
  });

test('finds an npx of the unscoped names that can download', () => {
  assert.deepEqual(findUnscopedNpx('npx dcupl --version'), ['npx dcupl']);
  assert.deepEqual(findUnscopedNpx('run `npx -y dcupl app start`'), ['npx -y dcupl']);
  assert.deepEqual(findUnscopedNpx('npx --yes -- dcupl serve'), ['npx --yes -- dcupl']);
  assert.deepEqual(findUnscopedNpx('npx create-dcupl my-app'), ['npx create-dcupl']);
  assert.deepEqual(findUnscopedNpx('use bare `dcupl`, NOT `npx dcupl`.'), ['npx dcupl']);
});

test('leaves guarded and scoped forms alone', () => {
  for (const line of [
    'npx --no -- dcupl --version   # never downloads',
    'npx --no dcupl serve',
    'npx --yes=false -- dcupl app status',
    'npx @dcupl/cli init --name shop',
    'npx -y @dcupl/cli@latest --version',
    'npm i -g @dcupl/cli@latest',
    'dcupl --version',
    'npx downloads whatever package is named `dcupl`',
    'npx dcupl-schema-tools',
  ]) {
    assert.deepEqual(findUnscopedNpx(line), [], line);
  }
});

test('no file under dcupl/skills/ runs an unscoped npx that can download', () => {
  const offenders = filesUnder(SKILLS_DIR).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        findUnscopedNpx(line).map((match) => `${relative(REPO_ROOT, file)}:${index + 1}: "${match}"`),
      ),
  );
  assert.equal(
    offenders.length,
    0,
    `${offenders.length} unguarded npx of an unscoped name; write \`npx --no -- dcupl …\` or \`npx @dcupl/cli …\`:\n${offenders.join('\n')}`,
  );
});
