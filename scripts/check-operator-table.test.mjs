// Unit tests of the operator-table guard (dcupl-plugins#27). No network, no sibling checkout:
// run with `node --test` from the repo root.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  diffOperatorTable,
  parseOperatorDescriptions,
  parseOperatorTable,
  renderOperatorTable,
  SKILL_FILE,
} from './check-operator-table.mjs';

const schemaSource = `
export const DcuplQueryOperatorSchema = z.enum(DcuplQueryOperatorValues);

const operatorDescriptions: Record<DcuplQueryOperator, string> = {
  eq: 'eq: attribute equals value (the whole value, no substring match).',
  find: 'find: plain string = exact whole value; "/…/" = JS regex.',
  isTruthy:
    'isTruthy: value true = non-empty; false = null, undefined, "" or 0 (the \\'empty\\' filter).',
};

const other = { eq: 'not this one' };
`;

const table = (rows) =>
  [
    'Text before.',
    '',
    '<!-- operator-semantics:start (generated, see scripts/check-operator-table.mjs) -->',
    '| Op | Semantics | Example |',
    '|---|---|---|',
    ...rows,
    '<!-- operator-semantics:end -->',
    '',
    'Text after.',
  ].join('\n');

const inSync = table([
  '| `eq` | attribute equals value (the whole value, no substring match). | `{"operator":"eq"}` |',
  '| `find` | plain string = exact whole value; "/…/" = JS regex. | `{"operator":"find"}` |',
  '| `isTruthy` | value true = non-empty; false = null, undefined, "" or 0 (the \'empty\' filter). | |',
]);

test('parses the operatorDescriptions record without the "<operator>: " prefix', () => {
  const descriptions = parseOperatorDescriptions(schemaSource);
  assert.deepEqual([...descriptions.keys()], ['eq', 'find', 'isTruthy']);
  assert.equal(descriptions.get('eq'), 'attribute equals value (the whole value, no substring match).');
  assert.equal(
    descriptions.get('isTruthy'),
    'value true = non-empty; false = null, undefined, "" or 0 (the \'empty\' filter).',
  );
});

test('refuses a source without the record instead of passing on nothing', () => {
  assert.throws(() => parseOperatorDescriptions('export const nothing = 1;'), /operatorDescriptions/);
  assert.throws(() => parseOperatorDescriptions('const operatorDescriptions = {\n};'), /no entries/);
});

test('parses the marked table of the skill', () => {
  const rows = parseOperatorTable(inSync);
  assert.deepEqual([...rows.keys()], ['eq', 'find', 'isTruthy']);
  assert.equal(rows.get('find').semantics, 'plain string = exact whole value; "/…/" = JS regex.');
  assert.equal(rows.get('find').example, '`{"operator":"find"}`');
});

test('refuses a document without the marked table', () => {
  assert.throws(() => parseOperatorTable('| `eq` | exact equality | |'), /operator-semantics:start/);
});

test('a table that states the schema wording has no differences', () => {
  assert.deepEqual(diffOperatorTable(parseOperatorDescriptions(schemaSource), parseOperatorTable(inSync)), []);
});

test('reports a row whose semantics differ from the schema', () => {
  const drifted = inSync.replace('plain string = exact whole value', 'plain string = substring match');
  const problems = diffOperatorTable(parseOperatorDescriptions(schemaSource), parseOperatorTable(drifted));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /find/);
  assert.match(problems[0], /substring match/);
  assert.match(problems[0], /exact whole value/);
});

test('reports an operator the table misses and a row the schema does not know', () => {
  const rows = parseOperatorTable(
    table([
      '| `eq` | attribute equals value (the whole value, no substring match). | |',
      '| `find` | plain string = exact whole value; "/…/" = JS regex. | |',
      '| `contains` | substring match. | |',
    ]),
  );
  const problems = diffOperatorTable(parseOperatorDescriptions(schemaSource), rows);
  assert.equal(problems.length, 2);
  assert.match(problems.join('\n'), /isTruthy.*missing/);
  assert.match(problems.join('\n'), /contains.*not a built-in operator/);
});

test('--write renders the schema wording and keeps the hand-written examples', () => {
  const drifted = inSync.replace('plain string = exact whole value', 'plain string = substring match');
  const written = renderOperatorTable(drifted, parseOperatorDescriptions(schemaSource));
  assert.equal(written, inSync);
});

test('the skill carries a marked operator table', () => {
  const rows = parseOperatorTable(readFileSync(SKILL_FILE, 'utf8'));
  assert.ok(rows.size >= 10, `expected the built-in operators, got ${rows.size} rows`);
});
