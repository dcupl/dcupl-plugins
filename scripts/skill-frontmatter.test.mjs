// The frontmatter limits of the skill format, for every SKILL.md in this repo: `name` at most
// 64 characters, `description` at most 1024. `claude plugin validate` does not check the lengths,
// and a client that truncates cuts the trigger phrases at the end of the description
// (dcupl-plugins#27, review of PR 31). Run with `node --test` from the repo root.
//
// The value is measured the way a YAML parser reads it (dcupl-plugins#33): the whole scalar,
// plain or quoted, on one line or wrapped onto further lines, or a block scalar (`>`, `|`).
// What this reader cannot measure (a nested map, a list, an anchor, a `: ` in an unquoted value)
// fails the test; it is never measured in part.
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

const isBlank = (line) => line.trim() === '';
const isComment = (line) => line.trim().startsWith('#');

/**
 * YAML line folding of a flow scalar: a line break is a space, n blank lines between two lines
 * are n line breaks. The last line is never a blank one (a quoted value may end with a break).
 */
const foldLines = (lines) => {
  let text = lines[0];
  let blanks = 0;
  for (const [index, line] of lines.entries()) {
    if (index === 0) {
      continue;
    }
    if (line === '' && index < lines.length - 1) {
      blanks += 1;
    } else {
      text += (blanks ? '\n'.repeat(blanks) : ' ') + line;
      blanks = 0;
    }
  }
  return text;
};

const DOUBLE_QUOTED_ESCAPES = {
  0: '\0',
  a: '\x07',
  b: '\b',
  t: '\t',
  '\t': '\t',
  n: '\n',
  v: '\v',
  f: '\f',
  r: '\r',
  e: '\x1b',
  ' ': ' ',
  '"': '"',
  '/': '/',
  '\\': '\\',
  N: '\x85',
  _: '\xa0',
  L: ' ',
  P: ' ',
};
const DOUBLE_QUOTED_ESCAPE = /\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|\n[ \t]*|[^])/y;

/** A quoted scalar that starts at the first character of `text` and may run over several lines. */
const readQuoted = (text, key) => {
  const quote = text[0];
  // Per line the characters of the value; an escaped one is `literal`: folding does not trim it.
  const lines = [[]];
  let at = 1;
  for (; at < text.length; at += 1) {
    const char = text[at];
    if (quote === '"' && char === '\\' && at + 1 < text.length) {
      DOUBLE_QUOTED_ESCAPE.lastIndex = at;
      const [pair, escape] = DOUBLE_QUOTED_ESCAPE.exec(text);
      at += pair.length - 1;
      if (escape[0] === '\n') {
        continue; // an escaped line break joins two lines without a space
      }
      assert.ok(escape.length > 1 || escape in DOUBLE_QUOTED_ESCAPES, `"${key}": cannot decode the escape ${pair}`);
      const decoded = escape.length > 1 ? String.fromCodePoint(parseInt(escape.slice(1), 16)) : DOUBLE_QUOTED_ESCAPES[escape];
      lines.at(-1).push({ char: decoded, literal: true });
    } else if (quote === "'" && text.startsWith("''", at)) {
      at += 1;
      lines.at(-1).push({ char: "'", literal: true });
    } else if (char === quote) {
      break;
    } else if (char === '\n') {
      lines.push([]);
    } else {
      lines.at(-1).push({ char, literal: false });
    }
  }
  assert.ok(at < text.length, `"${key}": the quoted value never ends`);
  const after = text.slice(at + 1).split('\n');
  assert.ok(
    /^(?:[ \t]+#.*|[ \t]*)$/.test(after[0]) && after.slice(1).every((line) => isBlank(line) || isComment(line)),
    `"${key}": text after the closing quote`,
  );
  const isSpace = (item) => !item.literal && /[ \t]/.test(item.char);
  return foldLines(
    lines.map((line, index) => {
      const from = index === 0 ? 0 : line.findIndex((item) => !isSpace(item));
      const to = index === lines.length - 1 ? line.length : line.findLastIndex((item) => !isSpace(item)) + 1;
      return (from === -1 ? [] : line.slice(from, Math.max(from, to))).map((item) => item.char).join('');
    }),
  );
};

/** An unquoted scalar: its lines folded, a ` #` comment ends it. */
const readPlain = (lines, key) => {
  assert.ok(
    !/^(?:[-?:](?:[ \t]|$)|[,[\]{}#&*!|>%@`])/.test(lines[0].trimStart()),
    `"${key}" is not a plain or quoted scalar (a list, a map, an anchor, a tag?): ${JSON.stringify(lines[0].trim())}`,
  );
  const parts = [];
  let ended = false;
  for (const raw of lines) {
    if (ended) {
      assert.ok(isBlank(raw) || isComment(raw), `"${key}": text after a comment: ${JSON.stringify(raw.trim())}`);
      continue;
    }
    const comment = /(?:^|[ \t])#/.exec(raw.trimStart());
    const line = (comment ? raw.trimStart().slice(0, comment.index) : raw).trim();
    ended = Boolean(comment);
    assert.ok(
      !/:(?:[ \t]|$)/.test(line),
      `"${key}": ": " in an unquoted value is a nested map or not YAML; quote the value: ${JSON.stringify(line)}`,
    );
    parts.push(line);
  }
  while (parts.length > 1 && parts.at(-1) === '') {
    parts.pop();
  }
  return foldLines(parts);
};

/** A block scalar: `|` keeps the line breaks, `>` folds them; `-` and `+` set the final line breaks. */
const readBlock = (header, more, key) => {
  const match = /^([|>])([1-9]?[+-]?|[+-][1-9])(?:[ \t]+#.*)?$/.exec(header.trim());
  assert.ok(match, `"${key}": cannot read the block scalar header ${JSON.stringify(header.trim())}`);
  const [, style, indicators] = match;
  const chomp = /[+-]/.exec(indicators)?.[0];
  const firstText = more.find((line) => !isBlank(line));
  const indent = /[1-9]/.test(indicators) ? Number(/[1-9]/.exec(indicators)[0]) : /^ */.exec(firstText ?? '')[0].length;
  const lines = more.map((line) => {
    assert.ok(
      isBlank(line) || /^ */.exec(line)[0].length >= indent,
      `"${key}": a line of the block is indented less than its first`,
    );
    return line.slice(indent);
  });
  let trailing = 0;
  while (lines.length && isBlank(lines.at(-1)) && lines.at(-1).length === 0) {
    lines.pop();
    trailing += 1;
  }
  let text = '';
  if (style === '|') {
    text = lines.join('\n');
  } else {
    let blanks = 0;
    let previous;
    for (const line of lines) {
      if (line === '') {
        blanks += 1;
        continue;
      }
      const foldable = previous !== undefined && !/^[ \t]/.test(previous) && !/^[ \t]/.test(line);
      const breaks = previous === undefined ? blanks : foldable ? blanks : blanks + 1;
      text += (foldable && !blanks ? ' ' : '\n'.repeat(breaks)) + line;
      previous = line;
      blanks = 0;
    }
  }
  if (chomp === '-') {
    return text;
  }
  const last = lines.length ? 1 : 0;
  return text + '\n'.repeat(chomp === '+' ? last + trailing : last);
};

/**
 * The value of a top-level frontmatter key as a YAML parser reads it. A key inside a nested map
 * or inside another value is not the key. Throws (fails the test) when the key is missing or
 * listed twice and when the value is not a scalar this reader can measure as a whole.
 */
export const frontmatterValue = (markdown, key) => {
  const frontmatter = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown)?.[1];
  assert.ok(frontmatter !== undefined, 'no frontmatter block');
  const lines = frontmatter.split(/\r?\n/);
  const keyAt = new RegExp(`^(?:${key}|'${key}'|"${key}")[ \\t]*:(?:[ \\t]+|$)`);
  const starts = lines.flatMap((line, index) => (keyAt.test(line) ? [index] : []));
  assert.ok(starts.length > 0, `no "${key}" in the frontmatter`);
  assert.equal(starts.length, 1, `"${key}" is in the frontmatter ${starts.length} times`);
  // The value runs on while the lines are indented or blank.
  let end = starts[0] + 1;
  while (end < lines.length && /^(?:[ \t]|$)/.test(lines[end])) {
    end += 1;
  }
  const first = lines[starts[0]].replace(keyAt, '');
  const more = lines.slice(starts[0] + 1, end);
  if (/^[|>]/.test(first)) {
    return readBlock(first, more, key);
  }
  // `key:` or `key: # comment`: the value starts on a following line, or there is none.
  const value = [first.startsWith('#') ? '' : first, ...more];
  while (value.length && (isBlank(value[0]) || (value.length <= more.length && isComment(value[0])))) {
    value.shift();
  }
  if (value.length === 0) {
    return '';
  }
  const text = value.join('\n').trimStart();
  return text[0] === '"' || text[0] === "'" ? readQuoted(text, key) : readPlain(value, key);
};

const doc = (yaml) => `---\nname: demo\n${yaml}\n---\n# Demo\n`;
const description = (yaml) => frontmatterValue(doc(yaml), 'description');

test('frontmatterValue reads a plain and a quoted single-line value', () => {
  assert.equal(frontmatterValue(doc('description: "Use when: testing"'), 'name'), 'demo');
  assert.equal(description('description: "Use when: testing"'), 'Use when: testing');
  assert.equal(description('description: Use when testing'), 'Use when testing');
  assert.equal(description("description: 'It''s here: now'"), "It's here: now");
  assert.equal(description('description: "tab\\there \\u00e9 \\x41 \\"q\\" \\\\"'), 'tab\there é A "q" \\');
  assert.equal(description('description: http://example.com/a?b=c'), 'http://example.com/a?b=c');
  assert.equal(description('"description": quoted key'), 'quoted key');
  assert.equal(description('description:'), '');
  assert.throws(() => frontmatterValue('---\nname: demo\n---\n', 'description'), /no "description"/);
  assert.throws(() => frontmatterValue('# no frontmatter\n', 'description'), /no frontmatter/);
});

// dcupl-plugins#33 (second review of PR 31, finding 2): only the first line of the value was
// measured, so a wrapped description passed at any length.
test('reads a value wrapped onto further lines as a whole', () => {
  assert.equal(
    description('description: first line\n  second line\n\n  after a blank line'),
    'first line second line\nafter a blank line',
  );
  assert.equal(description('description: "first line\n  second \\\n  line\n\n  end"'), 'first line second line\nend');
  assert.equal(description("description: 'first\n  second ''q'''"), "first second 'q'");
  assert.equal(description('description:\n  first\n  second'), 'first second');
  assert.equal(description('description: # why\n  "first\n  second"'), 'first second');

  const head = 'x'.repeat(1016);
  const more = 'y'.repeat(200);
  for (const yaml of [
    `description: ${head}\n  ${more}`,
    `description: "${head}\n  ${more}"`,
    `description: '${head}\n  ${more}'`,
  ]) {
    assert.equal([...description(yaml)].length, 1217, yaml.slice(0, 20));
  }
});

test('reads a block scalar: folded or literal, with its final line break', () => {
  assert.equal(description('description: >\n  folded\n  text\n\n  next'), 'folded text\nnext\n');
  assert.equal(description('description: >-\n  folded\n  text'), 'folded text');
  assert.equal(description('description: |\n  literal\n  text'), 'literal\ntext\n');
  assert.equal(description('description: |-\n  literal\n    indented\n'), 'literal\n  indented');
  assert.equal(description('description: >\n  folded\n    kept\n  text'), 'folded\n  kept\ntext\n');
  assert.equal(description('description: |+ # keep\n  literal\n'), 'literal\n\n');
  assert.equal([...description(`description: >-\n  ${'x'.repeat(1016)}\n  ${'y'.repeat(200)}`)].length, 1217);
  assert.throws(() => description('description: >x\n  text'), /block scalar header/);
});

test('a comment is not part of the value, a # inside it is', () => {
  assert.equal(description('description: text # a comment'), 'text');
  assert.equal(description('description: "text" # a comment'), 'text');
  assert.equal(description('description: a#b C# and "#"'), 'a#b C# and "#"');
  assert.equal(description("description: 'a # b'"), 'a # b');
  assert.equal(description('description: first\n  second # a comment'), 'first second');
});

test('a description key in a nested map or inside another value is not the description', () => {
  assert.equal(description('metadata:\n  description: nested\ndescription: top'), 'top');
  assert.equal(description('summary: |\n  description: inside a block scalar\ndescription: top'), 'top');
  assert.equal(description('descriptions: other\ndescription: top'), 'top');
  assert.throws(() => description('metadata:\n  description: nested'), /no "description"/);
  assert.throws(() => description('description:value'), /no "description"/);
  assert.throws(() => description('description: one\ndescription: two'), /2 times/);
});

test('refuses a value it cannot measure as a whole instead of measuring a part', () => {
  assert.throws(() => description('description: Use when: testing'), /quote the value/);
  assert.throws(() => description('description: first\n  then: more'), /quote the value/);
  assert.throws(() => description('description:\n  short: a nested map'), /quote the value/);
  assert.throws(() => description('description: [a, b]'), /not a plain or quoted scalar/);
  assert.throws(() => description('description:\n  - a\n  - b'), /not a plain or quoted scalar/);
  assert.throws(() => description('description: &anchor text'), /not a plain or quoted scalar/);
  assert.throws(() => description('description: "never closed'), /never ends/);
  assert.throws(() => description('description: "closed" and more'), /after the closing quote/);
  assert.throws(() => description('description: "closed"\n  and more'), /after the closing quote/);
  assert.throws(() => description('description: text # a comment\n  more text'), /after a comment/);
  assert.throws(() => description('description: "bad \\q escape"'), /escape/);
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
    assert.ok(
      length >= 1 && length <= DESCRIPTION_MAX,
      `description is ${length} characters, ${length - DESCRIPTION_MAX} too many`,
    );
  });
}
