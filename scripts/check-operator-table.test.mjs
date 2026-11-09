// Unit tests of the operator-table guard (dcupl-plugins#27). No network, no sibling checkout:
// run with `node --test` from the repo root. The CLI tests work on temp copies (`--skill`), never
// on the real skill file.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  diffOperatorTable,
  parseOperatorDescriptions,
  parseOperatorTable,
  renderOperatorTable,
  SKILL_FILE,
} from './check-operator-table.mjs';

const SCRIPT = fileURLToPath(new URL('./check-operator-table.mjs', import.meta.url));

const schemaOf = (entries) => `
export const DcuplQueryOperatorSchema = z.enum(DcuplQueryOperatorValues);

/** What each built-in operator does. */
const operatorDescriptions: Record<DcuplQueryOperator, string> = {
${entries}
};

const other = { eq: 'not this one' };
`;

const schemaSource = schemaOf(`  eq: 'eq: attribute equals value (the whole value, no substring match).',
  find: 'find: plain string = exact whole value; "/…/" = JS regex.',
  isTruthy:
    'isTruthy: value true = non-empty; false = null, undefined, "" or 0 (the \\'empty\\' filter).',`);

const ROWS = {
  eq: '| `eq` | attribute equals value (the whole value, no substring match). | `{"operator":"eq"}` |',
  find: '| `find` | plain string = exact whole value; "/…/" = JS regex. | `{"operator":"find"}` |',
  isTruthy: '| `isTruthy` | value true = non-empty; false = null, undefined, "" or 0 (the \'empty\' filter). | |',
};

const table = (rows) =>
  [
    'Text before.',
    '',
    '<!-- operator-semantics:start (kept in sync by scripts/check-operator-table.mjs) -->',
    '| Op | Semantics | Example |',
    '|---|---|---|',
    ...rows,
    '<!-- operator-semantics:end -->',
    '',
    'Text after.',
    '',
  ].join('\n');

const inSync = table([ROWS.eq, ROWS.find, ROWS.isTruthy]);
const descriptions = () => parseOperatorDescriptions(schemaSource);
const problemsOf = (markdown) => diffOperatorTable(descriptions(), parseOperatorTable(markdown));

/** Runs the CLI on temp copies of a skill file and a schema file. */
const cli = (markdown, source, ...flags) => {
  const dir = mkdtempSync(join(tmpdir(), 'operator-table-'));
  const skill = join(dir, 'querying.md');
  const schema = join(dir, 'query-api.schemas.ts');
  writeFileSync(skill, markdown);
  writeFileSync(schema, source);
  const run = spawnSync(process.execPath, [SCRIPT, '--skill', skill, '--schema', schema, ...flags], {
    encoding: 'utf8',
  });
  return { status: run.status, stderr: run.stderr, stdout: run.stdout, after: readFileSync(skill, 'utf8') };
};

test('parses the operatorDescriptions record without the "<operator>: " prefix', () => {
  assert.deepEqual([...descriptions().keys()], ['eq', 'find', 'isTruthy']);
  assert.equal(descriptions().get('eq'), 'attribute equals value (the whole value, no substring match).');
  assert.equal(
    descriptions().get('isTruthy'),
    'value true = non-empty; false = null, undefined, "" or 0 (the \'empty\' filter).',
  );
});

test('refuses a source without the record instead of passing on nothing', () => {
  assert.throws(() => parseOperatorDescriptions('export const nothing = 1;'), /operatorDescriptions/);
  assert.throws(() => parseOperatorDescriptions('const operatorDescriptions = {\n};'), /no entries/);
});

// Review finding 3: an entry the parser could not read was dropped without a word.
test('reads a last entry without a trailing comma and a description joined with +', () => {
  const read = parseOperatorDescriptions(
    schemaOf(`  eq: 'eq: attribute equals value.', // a comment, with a comma
  find:
    'find: plain string = exact whole value; ' +
    "\\"/…/\\" = JS regex.",
  size: \`size: array (or string) length equals value, a number.\``),
  );
  assert.deepEqual([...read.keys()], ['eq', 'find', 'size']);
  assert.equal(read.get('find'), 'plain string = exact whole value; "/…/" = JS regex.');
  assert.equal(read.get('size'), 'array (or string) length equals value, a number.');
});

test('fails on an entry it cannot read, naming it, instead of dropping it', () => {
  assert.throws(
    () => parseOperatorDescriptions(schemaOf("  eq: 'eq: equals.',\n  size: SIZE_DESCRIPTION,")),
    /entry "size"/,
  );
  assert.throws(
    () => parseOperatorDescriptions(schemaOf("  eq: 'eq: equals.',\n  size: `size: ${what} length`,")),
    /entry "size"/,
  );
  assert.throws(
    () => parseOperatorDescriptions(schemaOf("  eq: 'eq: equals.',\n  ...moreOperators,")),
    /cannot read the entry at "\.\.\.moreOperators/,
  );
});

test('the CLI answers exit 2 for an unreadable entry, and --write leaves the table alone', () => {
  const source = schemaSource.replace(/find: 'find: [^\n]*/, 'find: FIND_DESCRIPTION,');
  for (const flags of [[], ['--write']]) {
    const run = cli(inSync, source, ...flags);
    assert.equal(run.status, 2, run.stderr);
    assert.match(run.stderr, /entry "find"/);
    assert.equal(run.after, inSync);
  }
});

test('--write never deletes a row: an operator the schema does not list is left for a human', () => {
  const withoutFind = schemaSource.replace(/  find: 'find: [^\n]*\n/, '');
  assert.throws(() => renderOperatorTable(inSync, parseOperatorDescriptions(withoutFind)), /find.*does not delete/s);
  const run = cli(inSync, withoutFind, '--write');
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /does not delete/);
  assert.equal(run.after, inSync);
});

test('parses the marked table of the skill, in row order', () => {
  const rows = parseOperatorTable(inSync);
  assert.deepEqual(
    rows.map((row) => row.operator),
    ['eq', 'find', 'isTruthy'],
  );
  assert.equal(rows[1].semantics, 'plain string = exact whole value; "/…/" = JS regex.');
  assert.equal(rows[1].example, '`{"operator":"find"}`');
});

test('refuses a document without the marked table', () => {
  assert.throws(() => parseOperatorTable('| `eq` | exact equality | |'), /operator-semantics:start/);
});

test('a table that states the schema wording has no differences', () => {
  assert.deepEqual(problemsOf(inSync), []);
});

test('reports a row whose semantics differ from the schema', () => {
  const problems = problemsOf(inSync.replace('plain string = exact whole value', 'plain string = substring match'));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /find/);
  assert.match(problems[0], /substring match/);
  assert.match(problems[0], /exact whole value/);
});

test('reports an operator the table misses and a row the schema does not know', () => {
  const problems = problemsOf(table([ROWS.eq, ROWS.find, '| `contains` | substring match. | |']));
  assert.equal(problems.length, 2);
  assert.match(problems.join('\n'), /isTruthy.*missing/);
  assert.match(problems.join('\n'), /contains.*not a built-in operator/);
});

// Review finding 2: the rows went into a Map, so the last row of an operator won.
test('reports a duplicate row, also when the wrong one comes first', () => {
  const wrong = '| `find` | plain string = substring match. | |';
  for (const rows of [
    [ROWS.eq, wrong, ROWS.find, ROWS.isTruthy],
    [ROWS.eq, ROWS.find, wrong, ROWS.isTruthy],
    [ROWS.eq, ROWS.find, ROWS.find, ROWS.isTruthy],
  ]) {
    const problems = problemsOf(table(rows));
    assert.match(problems.join('\n'), /find: 2 rows/);
  }
  assert.equal(cli(table([ROWS.eq, wrong, ROWS.find, ROWS.isTruthy]), schemaSource).status, 1);
});

// Review finding 5: the rows are in schema order.
test('reports rows that are not in schema order, and --write restores the order', () => {
  const reordered = table([ROWS.find, ROWS.isTruthy, ROWS.eq]);
  const problems = problemsOf(reordered);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /order.*find, isTruthy, eq.*eq, find, isTruthy/);
  assert.equal(renderOperatorTable(reordered, descriptions()), inSync);
});

// Review finding 4: --write moved such a line between the header and the first row.
test('refuses anything but the table between the markers, and --write leaves it alone', () => {
  for (const [rows, complaint] of [
    [[ROWS.eq, ROWS.find, ROWS.isTruthy, '', 'A note about the operators.'], /line 7.*A note about the operators/s],
    [[ROWS.eq, 'A note in the middle.', ROWS.find, ROWS.isTruthy], /line 4.*A note in the middle/s],
    [[ROWS.eq, '| find | no backticks | |', ROWS.find, ROWS.isTruthy], /line 4.*no backticks/s],
    [[ROWS.eq, ROWS.find, ROWS.isTruthy, ''], /line 6 .*""/s],
  ]) {
    const markdown = table(rows);
    assert.throws(() => parseOperatorTable(markdown), complaint);
    const run = cli(markdown, schemaSource, '--write');
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /between the markers/);
    assert.equal(run.after, markdown);
  }
  assert.throws(() => parseOperatorTable(inSync.replace('|---|---|---|\n', '')), /header and a separator/);
});

test('--write renders the schema wording and keeps the hand-written examples', () => {
  const drifted = inSync.replace('plain string = exact whole value', 'plain string = substring match');
  assert.equal(renderOperatorTable(drifted, descriptions()), inSync);
  const run = cli(drifted, schemaSource, '--write');
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.after, inSync);
});

test('--write adds a row for a new operator and removes a duplicate', () => {
  const written = renderOperatorTable(table([ROWS.eq, ROWS.eq, ROWS.isTruthy]), descriptions());
  assert.equal(written, inSync.replace(ROWS.find, '| `find` | plain string = exact whole value; "/…/" = JS regex. | |'));
});

// Review finding 7.
test('--write keeps CRLF line endings', () => {
  const crlf = (text) => text.replaceAll('\n', '\r\n');
  const drifted = crlf(inSync.replace('plain string = exact whole value', 'plain string = substring match'));
  const written = renderOperatorTable(drifted, descriptions());
  assert.equal(written, crlf(inSync));
  assert.deepEqual(problemsOf(written), []);
});

// Review finding 6: exit 1 is "the table drifted"; a mistyped flag is not that.
test('an unknown flag or a stray argument is exit 2 with a usage line, no stack trace', () => {
  for (const flag of ['--wrte', 'write']) {
    const run = cli(inSync, schemaSource, flag);
    assert.equal(run.status, 2, run.stderr);
    assert.match(run.stderr, /usage: node scripts\/check-operator-table\.mjs/);
    assert.doesNotMatch(run.stderr, /^\s+at /m);
    assert.equal(run.after, inSync);
  }
});

test('the CLI passes on a table in sync (exit 0) and fails on drift (exit 1)', () => {
  assert.equal(cli(inSync, schemaSource).status, 0);
  const run = cli(inSync.replace('plain string = exact whole value', 'plain string = substring match'), schemaSource);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /find: the table says/);
});

test('the skill carries a marked operator table', () => {
  const rows = parseOperatorTable(readFileSync(SKILL_FILE, 'utf8'));
  assert.ok(rows.length >= 10, `expected the built-in operators, got ${rows.length} rows`);
});
