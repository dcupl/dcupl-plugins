// Unit tests of the operator-table guard (dcupl-plugins#27, #33). No network, no sibling checkout:
// run with `node --test` from the repo root. The CLI tests work on temp copies (`--skill`), never
// on the real skill file, and remove their temp directories.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  diffOperatorTable,
  parseOperatorDescriptions,
  parseOperatorTable,
  renderOperatorTable,
  SCHEMA_PATH,
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

/** Hands a fresh temp directory to `use` and removes it afterwards, also when `use` throws. */
const withTempDir = (use) => {
  const dir = mkdtempSync(join(tmpdir(), 'operator-table-'));
  try {
    return use(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const node = (args, env = process.env) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env });

/** Runs the CLI once per flag list, one after the other, on temp copies of a skill file and a schema file. */
const cliRuns = (markdown, source, runs) =>
  withTempDir((dir) => {
    const skill = join(dir, 'querying.md');
    const schema = join(dir, 'query-api.schemas.ts');
    writeFileSync(skill, markdown);
    writeFileSync(schema, source);
    return runs.map((flags) => {
      const run = node(['--skill', skill, '--schema', schema, ...flags]);
      return { status: run.status, stderr: run.stderr, stdout: run.stdout, after: readFileSync(skill, 'utf8'), dir };
    });
  });

const cli = (markdown, source, ...flags) => cliRuns(markdown, source, [flags])[0];

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

// ---- dcupl-plugins#33: the gaps the second review of PR 31 found ----

const PIPE_EXAMPLE = '`{"operator":"find","attribute":"name","value":"/shoe\\|boot/"}`';
const withFindExample = (example) => ROWS.find.replace('`{"operator":"find"}`', () => example);
const DRIFT = ['plain string = exact whole value', 'plain string = substring match'];

// Finding 1: the first --write unescaped the pipe, the second truncated the example; exit 0 twice.
test('--write keeps an example with an escaped pipe byte-identical over two runs', () => {
  const synced = table([ROWS.eq, withFindExample(PIPE_EXAMPLE), ROWS.isTruthy]);
  const drifted = synced.replace(...DRIFT);
  for (const markdown of [synced, drifted]) {
    const [first, second] = cliRuns(markdown, schemaSource, [['--write'], ['--write']]);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.after, synced);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.after, synced);
  }
  assert.equal(parseOperatorTable(synced)[1].example, PIPE_EXAMPLE);
  assert.equal(renderOperatorTable(drifted, descriptions()), synced);
});

test('--write changes the Semantics cell of a drifted row and no other byte', () => {
  const rows = (find) => [
    // padded cells, a backslash in the example, spaces after the last pipe
    '|  `eq`  |   attribute equals value (the whole value, no substring match).   |  `{"operator":"eq","value":"a\\\\b"}`  |  ',
    // a backtick inside a code span, an escaped pipe inside inline code, padding before the last pipe
    `| \`find\` |  ${find}  | \`\`{"operator":"find","value":"a\`b"}\`\` or \`/\\d+\\|x/\`   |`,
    `${ROWS.isTruthy} `,
  ];
  const synced = table(rows('plain string = exact whole value; "/…/" = JS regex.'));
  assert.deepEqual(problemsOf(synced), []);
  assert.equal(renderOperatorTable(synced, descriptions()), synced);
  assert.equal(cli(synced, schemaSource, '--write').after, synced);

  const drifted = table(rows('plain  string = substring match.'));
  const written = renderOperatorTable(drifted, descriptions());
  assert.equal(
    written,
    table(
      rows('plain string = exact whole value; "/…/" = JS regex.').map((row, index) =>
        index === 1 ? row.replace('|  plain', '| plain').replace('regex.  |', 'regex. |') : row,
      ),
    ),
  );
  const [first, second] = cliRuns(drifted, schemaSource, [['--write'], ['--write']]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.after, written);
  assert.equal(second.after, written);
});

test('a pipe or a backslash in the schema wording is escaped in the cell and read back', () => {
  const source = schemaOf("  eq: 'eq: a | b, also a\\\\|b and a path C:\\\\x.',");
  const read = parseOperatorDescriptions(source);
  assert.equal(read.get('eq'), 'a | b, also a\\|b and a path C:\\x.');
  const written = renderOperatorTable(table(['| `eq` | old wording. | `{"operator":"eq"}` |']), read);
  assert.equal(written, table(['| `eq` | a \\| b, also a\\\\|b and a path C:\\x. | `{"operator":"eq"}` |']));
  assert.deepEqual(diffOperatorTable(read, parseOperatorTable(written)), []);
  assert.equal(renderOperatorTable(written, read), written);
});

test('--write refuses a schema description a table cell cannot hold, and writes nothing', () => {
  const markdown = table(['| `eq` | old wording. | `{"operator":"eq"}` |']);
  const run = cli(markdown, schemaOf("  eq: 'eq: first line\\nsecond line.',"), '--write');
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /eq.*line break/);
  assert.equal(run.after, markdown);
});

// Finding 3: only the first three cells were read.
test('a row with more or fewer than three cells is refused, and --write leaves it alone', () => {
  for (const [row, complaint] of [
    [withFindExample('`{"operator":"find","value":"/shoe|boot/"}`'), /line 4 .*4 cells.*\\\|/s],
    [`${ROWS.find} a fourth cell |`, /line 4 .*4 cells/s],
    ['| `find` | plain string = exact whole value; "/…/" = JS regex. |', /line 4 .*2 cells/s],
  ]) {
    const markdown = table([ROWS.eq, row, ROWS.isTruthy]);
    assert.throws(() => parseOperatorTable(markdown), complaint);
    const run = cli(markdown, schemaSource, '--write');
    assert.equal(run.status, 1, run.stderr);
    assert.equal(run.after, markdown);
  }
  assert.throws(() => parseOperatorTable(inSync.replace('| Op | Semantics | Example |', '| Op | Semantics |')), /three columns/);
});

test('reports an Example cell that is prose or an example of another operator', () => {
  const prose = problemsOf(table([ROWS.eq, withFindExample('a plain string is a substring match'), ROWS.isTruthy]));
  assert.equal(prose.length, 1);
  assert.match(prose[0], /find: .*Example.*a plain string is a substring match/);
  const other = problemsOf(table([ROWS.eq, withFindExample('`{"operator":"eq","value":"x"}`'), ROWS.isTruthy]));
  assert.equal(other.length, 1);
  assert.match(other[0], /find: .*"eq"/);
  assert.equal(cli(table([ROWS.eq, withFindExample('`{"operator":"eq"}`'), ROWS.isTruthy]), schemaSource).status, 1);
});

// Finding 4: only the first pair of markers was read.
const secondTable = (rows) =>
  [
    '',
    '<!-- operator-semantics:start (a second copy) -->',
    '| Op | Semantics | Example |',
    '|---|---|---|',
    ...rows,
    '<!-- operator-semantics:end -->',
    '',
  ].join('\n');

test('checks and writes every marked table, not only the first', () => {
  const two = inSync + secondTable([ROWS.eq, ROWS.find, ROWS.isTruthy]);
  const ok = cli(two, schemaSource);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /2 marked tables/);

  const drifted = inSync + secondTable([ROWS.eq, ROWS.find.replace(...DRIFT), ROWS.isTruthy]);
  const run = cli(drifted, schemaSource);
  assert.equal(run.status, 1, run.stdout);
  assert.match(run.stderr, /table at line 13: find: the table says "plain string = substring match/);
  assert.equal(run.after, drifted);

  const written = cli(drifted, schemaSource, '--write');
  assert.equal(written.status, 0, written.stderr);
  assert.equal(written.after, two);
  assert.equal(
    renderOperatorTable(inSync.replace(...DRIFT) + secondTable([ROWS.isTruthy, ROWS.eq]), descriptions()),
    inSync + secondTable([ROWS.eq, '| `find` | plain string = exact whole value; "/…/" = JS regex. | |', ROWS.isTruthy]),
  );
});

test('refuses markers that do not pair up and a table row right outside them', () => {
  const wrong = '| `find` | plain string = substring match. | |';
  for (const [markdown, complaint] of [
    [
      `${inSync}\n<!-- operator-semantics:start (never closed) -->\n| Op | Semantics | Example |\n|---|---|---|\n${wrong}\n`,
      /line 13.*no end marker/s,
    ],
    [`${inSync}\n${wrong}\n<!-- operator-semantics:end -->\n`, /line 14.*no start marker/s],
    [inSync.replace(ROWS.find, `${ROWS.find}\n<!-- operator-semantics:start -->`), /line 8.*before the end marker/s],
    [
      inSync.replace('<!-- operator-semantics:end -->', `<!-- operator-semantics:end -->\n${wrong}`),
      /line 10.*after the end marker/s,
    ],
    [
      inSync.replace('<!-- operator-semantics:start', `${wrong}\n<!-- operator-semantics:start`),
      /line 3.*before the start marker/s,
    ],
  ]) {
    assert.throws(() => parseOperatorTable(markdown), complaint);
    const run = cli(markdown, schemaSource, '--write');
    assert.equal(run.status, 1, run.stderr);
    assert.equal(run.after, markdown);
  }
});

// Finding 5: exit 1 is "the table differs"; a file that is not there could not be checked.
test('a missing --skill file is exit 2', () => {
  withTempDir((dir) => {
    const schema = join(dir, 'query-api.schemas.ts');
    writeFileSync(schema, schemaSource);
    for (const flags of [[], ['--write']]) {
      const run = node(['--skill', join(dir, 'missing.md'), '--schema', schema, ...flags]);
      assert.equal(run.status, 2, run.stderr);
      assert.match(run.stderr, /cannot read .*missing\.md/);
      assert.equal(existsSync(join(dir, 'missing.md')), false);
    }
  });
});

// Finding 6: `match\x29` was read as `matchx29`.
test('decodes the \\xNN, \\u{…} and \\uNNNN escapes of the schema source and refuses what it cannot decode', () => {
  const read = parseOperatorDescriptions(
    schemaOf("  eq: 'eq: (match\\x29 \\u{1F600} \\u2026 \\uD83D\\uDE00 a\\\nb \\'q\\' \\\\ \\0.',"),
  );
  assert.equal(read.get('eq'), "(match) \u{1F600} \u2026 \u{1F600} ab 'q' \\ \0.");
  for (const bad of ['\\xZZ', '\\x4', '\\u{110000}', '\\u{}', '\\u12', '\\101', '\\08']) {
    assert.throws(() => parseOperatorDescriptions(schemaOf(`  eq: 'eq: ${bad} end.',`)), /entry "eq".*escape/, bad);
  }
  assert.throws(
    () => parseOperatorDescriptions(schemaOf("  eq: 'eq: never ends,\n  find: 'find: next.',")),
    /entry "eq".*never ends/,
  );
});

// Finding 7: the first textual match won, also inside a comment.
test('reads the real operatorDescriptions, not one in a comment or a string above it', () => {
  const real = "const operatorDescriptions: Record<DcuplQueryOperator, string> = {\n  eq: 'eq: the real one.',\n};\n";
  for (const decoy of [
    "// const operatorDescriptions = { eq: 'eq: commented out.' };\n",
    "/*\nconst operatorDescriptions = {\n  eq: 'eq: commented out.',\n};\n*/\n",
    "// it's the old one:\n// const operatorDescriptions = {\n//   eq: 'eq: commented out.',\n// };\n",
    "const note = 'const operatorDescriptions = { eq: 1 }';\n",
    "const note = `\nconst operatorDescriptions = { eq: 'eq: in a template.' };\n`;\n",
  ]) {
    assert.equal(parseOperatorDescriptions(decoy + real).get('eq'), 'the real one.', decoy);
  }
  assert.throws(
    () => parseOperatorDescriptions("// const operatorDescriptions = { eq: 'eq: commented out.' };\n"),
    /only in a comment or a string/,
  );
  assert.throws(() => parseOperatorDescriptions(real + real), /declared 2 times/);
});

// Finding 9: without `git fetch` the guard passed on a stale schema and did not say which.
test('names the commit of the schema it read from a checkout', () => {
  withTempDir((dir) => {
    const git = (...args) =>
      execFileSync(
        'git',
        ['-C', dir, '-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
        {
          encoding: 'utf8',
          stdio: 'pipe',
        },
      ).trim();
    git('init', '--quiet');
    mkdirSync(join(dir, dirname(SCHEMA_PATH)), { recursive: true });
    writeFileSync(join(dir, SCHEMA_PATH), schemaSource);
    git('add', SCHEMA_PATH);
    git('commit', '--quiet', '-m', 'schema');
    const named = new RegExp(`at HEAD \\(commit ${git('rev-parse', '--short', 'HEAD')} of \\d{4}-\\d{2}-\\d{2}\\)`);
    const skill = join(dir, 'querying.md');
    const env = { ...process.env };
    for (const name of ['DCUPL_SCHEMA_FILE', 'DCUPL_REPO', 'DCUPL_REF']) {
      delete env[name];
    }
    writeFileSync(skill, inSync);
    const ok = node(['--skill', skill, '--dcupl-repo', dir, '--ref', 'HEAD'], env);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, named);
    writeFileSync(skill, inSync.replace(...DRIFT));
    const drifted = node(['--skill', skill, '--dcupl-repo', dir, '--ref', 'HEAD'], env);
    assert.equal(drifted.status, 1, drifted.stdout);
    assert.match(drifted.stderr, named);
  });
});

// Finding 8: every run left a directory in the temp folder.
test('the CLI helper removes its temp directory', () => {
  const run = cli(inSync, schemaSource);
  assert.equal(typeof run.dir, 'string');
  assert.equal(existsSync(run.dir), false);
});
