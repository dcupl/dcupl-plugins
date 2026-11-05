// The frontmatter limits of the skill format, for every SKILL.md in this repo: `name` at most
// 64 characters, `description` at most 1024. `claude plugin validate` does not check the lengths,
// and a client that truncates cuts the trigger phrases at the end of the description
// (dcupl-plugins#27, review of PR 31). Run with `node --test` from the repo root.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const NAME_MAX = 64;
export const DESCRIPTION_MAX = 1024;

const skillFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : skillFiles(join(dir, entry.name));
    }
    return entry.name === 'SKILL.md' ? [join(dir, entry.name)] : [];
  });

/** A single-line frontmatter value; a block or folded scalar is refused rather than mis-measured. */
export const frontmatterValue = (markdown, key) => {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1];
  assert.ok(frontmatter !== undefined, 'no frontmatter block');
  const line = frontmatter.split(/\r?\n/).find((candidate) => candidate.startsWith(`${key}:`));
  assert.ok(line !== undefined, `no "${key}" in the frontmatter`);
  const value = line.slice(key.length + 1).trim();
  assert.ok(!/^[>|]/.test(value), `"${key}" is a multi-line scalar: extend this check before using one`);
  return value.replace(/^(['"])(.*)\1$/, '$2');
};

test('frontmatterValue reads a plain and a quoted single-line value', () => {
  const markdown = '---\nname: demo\ndescription: "Use when: testing"\n---\n# Demo\n';
  assert.equal(frontmatterValue(markdown, 'name'), 'demo');
  assert.equal(frontmatterValue(markdown, 'description'), 'Use when: testing');
  assert.throws(() => frontmatterValue('---\nname: demo\ndescription: >\n  folded\n---\n', 'description'), /multi-line/);
  assert.throws(() => frontmatterValue('---\nname: demo\n---\n', 'description'), /no "description"/);
});

const files = skillFiles(REPO_ROOT);

test('the repo has at least one SKILL.md', () => {
  assert.ok(files.length >= 1);
});

for (const file of files) {
  const label = relative(REPO_ROOT, file);
  const markdown = readFileSync(file, 'utf8');

  test(`${label}: name is at most ${NAME_MAX} characters`, () => {
    const { length } = [...frontmatterValue(markdown, 'name')];
    assert.ok(length >= 1 && length <= NAME_MAX, `name is ${length} characters`);
  });

  test(`${label}: description is at most ${DESCRIPTION_MAX} characters`, () => {
    const { length } = [...frontmatterValue(markdown, 'description')];
    assert.ok(length <= DESCRIPTION_MAX, `description is ${length} characters, ${length - DESCRIPTION_MAX} too many`);
  });
}
