// The skills describe the stable releases only (Dominik, 2026-11-09, dcupl-plugins#30). Betas are
// dcupl's internal test channel; people who use a skill run the stable `@dcupl/cli` and `@dcupl/*`
// from npm `latest`. So no file under `dcupl/skills/` names a prerelease version, the betas as a
// channel, or an npm prerelease dist-tag. A difference between two stable releases (SDK 1.x vs 2.x)
// may still be named. Run with `node --test` from the repo root.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = join(REPO_ROOT, 'dcupl', 'skills');

/** What counts as a prerelease reference, with the reason a hit is reported under. */
export const PRERELEASE_PATTERNS = [
  // 1.4.0-beta.17, 2.0.0-rc.1, 3.1.0-next.2, 1.0.0-alpha
  { reason: 'prerelease version', pattern: /\b\d+\.\d+\.\d+-(?:alpha|beta|rc|next|canary|dev|pre)(?:\.\d+)?\b/i },
  // "beta.17" on its own, e.g. "up to beta.16"
  { reason: 'prerelease number', pattern: /\b(?:alpha|beta|rc)\.\d+\b/i },
  // "earlier betas", "on a beta", "the beta channel": the word is only ever a version here, so
  // sample data must not use it either
  { reason: 'beta as a version or channel', pattern: /\bbetas?\b/i },
  // npm i @dcupl/cli@next, @beta
  { reason: 'prerelease dist-tag', pattern: /@(?:next|beta|alpha|rc|canary)\b/i },
  // "the npm `next` dist-tag"
  { reason: 'prerelease dist-tag', pattern: /`next`\s+dist-tag/i },
];

/** Every `{ reason, match }` the patterns find in one line of text. */
export const findPrereleaseReferences = (line) =>
  PRERELEASE_PATTERNS.flatMap(({ reason, pattern }) => {
    const match = line.match(pattern);
    return match ? [{ reason, match: match[0] }] : [];
  });

const filesUnder = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : filesUnder(path);
    }
    return [path];
  });

test('finds the prerelease forms the rule names', () => {
  const hits = (line) => findPrereleaseReferences(line).map(({ match }) => match);
  assert.deepEqual(hits('since CLI 1.4.0-beta.17 the flag exists'), ['1.4.0-beta.17', 'beta.17', 'beta']);
  assert.deepEqual(hits('`@dcupl/*` 2.0.0-rc.1'), ['2.0.0-rc.1', 'rc.1']);
  assert.deepEqual(hits('On CLI betas up to beta.16 it crashed'), ['beta.16', 'betas']);
  assert.deepEqual(hits('earlier betas wrote it elsewhere'), ['betas']);
  assert.deepEqual(hits('a workspace that still runs a beta'), ['beta']);
  assert.deepEqual(hits('install `@dcupl/cli@next` instead'), ['@next']);
  assert.deepEqual(hits('published under the npm `next` dist-tag'), ['`next` dist-tag']);
  assert.deepEqual(hits('{"name":"Beta"}'), ['Beta']);
});

test('leaves stable versions and ordinary words alone', () => {
  for (const line of [
    'This skill is written against `@dcupl/cli` 1.4.1 (`@dcupl/*` 2.1.0).',
    'SDK 1.x answered undefined; SDK 2.x throws.',
    'npm i -g @dcupl/cli@latest',
    'the next call returns the second page',
    'alphabetical order, alphanumeric keys, betaine, Alphabet',
    'see dcupl/dcupl-cli#316 and dcupl/dcupl#485',
  ]) {
    assert.deepEqual(findPrereleaseReferences(line), [], line);
  }
});

test('no file under dcupl/skills/ references a prerelease', () => {
  const offenders = filesUnder(SKILLS_DIR).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        findPrereleaseReferences(line).map(
          ({ reason, match }) => `${relative(REPO_ROOT, file)}:${index + 1}: ${reason} "${match}"`,
        ),
      ),
  );
  const lines = new Set(offenders.map((offender) => offender.split(': ')[0]));
  assert.equal(
    offenders.length,
    0,
    `${lines.size} line(s) reference a prerelease; describe the stable release instead:\n${offenders.join('\n')}`,
  );
});
