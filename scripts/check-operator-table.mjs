#!/usr/bin/env node
// Guard for the dcupl skill's operator table (dcupl-plugins#27, #33).
//
// A table between `operator-semantics` markers in references/querying.md states each built-in
// query operator in the wording of `operatorDescriptions` in @dcupl/common-internal (the shared
// query schema, the one REST and the MCP tools validate with). This script fails when the two
// differ; `--write` copies the schema wording into the table.
//
//   node scripts/check-operator-table.mjs            check
//   node scripts/check-operator-table.mjs --write    rewrite the Semantics column from the schema
//
// Exit codes: 0 every marked table matches; 1 a table differs or is malformed; 2 the check could
// not run (unreadable schema, unreadable skill file, unknown flag).
//
// What "matches" means, for every pair of markers in the file: one row per operator of the
// schema, in schema order, no other rows, three cells per row, the Semantics cell equal to the
// schema's description without its "<operator>: " prefix, the Example cell empty or a `code`
// example (a JSON example names the row's operator). Between the markers there is the table only
// (header, separator, rows): a note belongs outside them, and a table row belongs inside them.
// A `|` inside a cell is written `\|`, also inside `code`.
//
// `--write` rewrites wording and order, adds missing rows (empty example) and drops duplicate
// rows. It replaces the Semantics cell of a row that differs and leaves every other byte of the
// row alone (the example, padding); a row that matches is kept as it is. It never deletes the row
// of an operator the schema does not list — remove that by hand.
//
// The schema source is read without network access, in this order:
//   --schema <file> | DCUPL_SCHEMA_FILE   a copy of query-api.schemas.ts
//   --dcupl-repo <dir> | DCUPL_REPO       a dcupl/dcupl checkout (default: the `dcupl` folder next
//                                         to this repo's main checkout), read at
//   --ref <ref> | DCUPL_REF               this git ref (default origin/main; `git fetch` it first:
//                                         the output names the commit that was read and its date)
// `--skill <file>` checks another markdown file than the skill's querying.md (used by the tests).
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SKILL_FILE = resolve(REPO_ROOT, 'dcupl/skills/dcupl/references/querying.md');
export const SCHEMA_PATH = 'packages/common-internal/src/query-api/query-api.schemas.ts';
const START = '<!-- operator-semantics:start';
const END = '<!-- operator-semantics:end -->';
const COLUMNS = 3;
const USAGE =
  'usage: node scripts/check-operator-table.mjs [--write] [--schema <file> | --dcupl-repo <dir> [--ref <ref>]] [--skill <file>]';

const ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };

/**
 * A reader over the text of the `operatorDescriptions` object literal. It accepts exactly
 * `key: 'literal' (+ 'literal')*` entries separated by commas (comments allowed) and throws on
 * anything else, so an entry is never dropped without a word.
 */
function readRecord(source, open) {
  let at = open + 1;
  const entries = new Map();
  const rest = () => JSON.stringify(source.slice(at, at + 40).split('\n')[0]);

  const skipBlank = () => {
    for (;;) {
      const blank = /^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)/.exec(source.slice(at));
      if (!blank) {
        return;
      }
      at += blank[0].length;
    }
  };

  /** The text of the escape whose first character (after the backslash) is at `at`; leaves `at` on its last one. */
  const readEscape = (key) => {
    const tail = source.slice(at, at + 10);
    const hex = /^(?:u\{([0-9a-fA-F]{1,6})\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2}))/.exec(tail);
    const code = hex ? parseInt(hex[1] ?? hex[2] ?? hex[3], 16) : undefined;
    if (hex && code <= 0x10ffff) {
      at += hex[0].length - 1;
      return String.fromCodePoint(code);
    }
    // A wrong guess here would end up in the table with --write: refuse instead.
    if (/^[ux1-9]|^0[0-9]/.test(tail)) {
      throw new Error(
        `entry "${key}": cannot decode the escape ${JSON.stringify(`\\${tail.slice(0, 6)}`)} (\\xNN, \\uNNNN and \\u{…} are read)`,
      );
    }
    const lineBreak = /^\r?\n/.exec(tail);
    if (lineBreak) {
      at += lineBreak[0].length - 1;
      return '';
    }
    return ESCAPES[source[at]] ?? source[at];
  };

  const readLiteral = (key) => {
    const quote = source[at];
    if (!`'"\``.includes(quote) || at >= source.length) {
      throw new Error(`entry "${key}": its value is not a string literal (or literals joined with +), at ${rest()}`);
    }
    let text = '';
    for (at += 1; source[at] !== quote; at += 1) {
      if (at >= source.length || (quote !== '`' && source[at] === '\n')) {
        throw new Error(`entry "${key}": its string never ends`);
      }
      if (quote === '`' && source.startsWith('${', at)) {
        throw new Error(`entry "${key}": its value is a template with \${…}, not a plain string`);
      }
      if (source[at] === '\\') {
        at += 1;
        text += readEscape(key);
      } else {
        text += source[at];
      }
    }
    at += 1;
    return text;
  };

  for (;;) {
    skipBlank();
    if (source[at] === '}') {
      return entries;
    }
    const name = /^(?:([A-Za-z_$][\w$]*)|'([^'\\\n]*)'|"([^"\\\n]*)")\s*:/.exec(source.slice(at));
    if (!name) {
      throw new Error(`cannot read the entry at ${rest()} of \`operatorDescriptions\``);
    }
    const key = name[1] ?? name[2] ?? name[3];
    at += name[0].length;
    let description = '';
    do {
      skipBlank();
      description += readLiteral(key);
      skipBlank();
    } while (source[at] === '+' && (at += 1));
    if (source[at] === ',') {
      at += 1;
    } else if (source[at] !== '}') {
      throw new Error(`entry "${key}": unexpected ${rest()} after its value`);
    }
    if (entries.has(key)) {
      throw new Error(`entry "${key}": listed twice in \`operatorDescriptions\``);
    }
    entries.set(key, description);
  }
}

const DECLARATION = /(?:const|let|var)\s+operatorDescriptions\b[^=;]*=\s*\{/;

/**
 * The index of the `{` that opens the `operatorDescriptions` record. The source is walked as
 * code, so a declaration inside a comment or a string is not one. Throws when there is none, or
 * more than one.
 */
function findRecord(source) {
  const declaration = new RegExp(DECLARATION.source, 'y');
  const found = [];
  let at = 0;
  while (at < source.length) {
    const char = source[at];
    if (source.startsWith('//', at)) {
      const end = source.indexOf('\n', at);
      at = end === -1 ? source.length : end;
    } else if (source.startsWith('/*', at)) {
      const end = source.indexOf('*/', at + 2);
      at = end === -1 ? source.length : end + 2;
    } else if (`'"\``.includes(char)) {
      // A string: to its closing quote; a ' or " string ends at the line break at the latest.
      for (at += 1; at < source.length && source[at] !== char && (char === '`' || source[at] !== '\n'); at += 1) {
        at += source[at] === '\\' ? 1 : 0;
      }
      at += 1;
    } else if (/[A-Za-z_$]/.test(char)) {
      declaration.lastIndex = at;
      const match = declaration.exec(source);
      if (match) {
        found.push(at + match[0].length - 1);
      }
      at += match ? match[0].length : /^[\w$]+/.exec(source.slice(at, at + 200))[0].length;
    } else {
      at += 1;
    }
  }
  if (found.length === 0) {
    throw new Error(
      DECLARATION.test(source)
        ? '`operatorDescriptions` is declared only in a comment or a string of the schema source'
        : 'no `operatorDescriptions` record in the schema source',
    );
  }
  if (found.length > 1) {
    throw new Error(`\`operatorDescriptions\` is declared ${found.length} times in the schema source`);
  }
  return found[0];
}

/**
 * The `operatorDescriptions` record of the schema source as operator → semantics, in source
 * order. Each description starts with "<operator>: "; the table has the operator in its own
 * column, so the prefix is dropped. Throws when the record is missing, empty or has an entry
 * that is not a plain string.
 */
export function parseOperatorDescriptions(source) {
  const descriptions = new Map();
  for (const [operator, description] of readRecord(source, findRecord(source))) {
    const prefix = `${operator}: `;
    descriptions.set(operator, description.startsWith(prefix) ? description.slice(prefix.length) : description);
  }
  if (descriptions.size === 0) {
    throw new Error('the `operatorDescriptions` record has no entries');
  }
  return descriptions;
}

const PIPE = /(?<!\\)\|/;
const escapePipes = (text) => text.replaceAll('|', '\\|');
const unescapePipes = (text) => text.replaceAll('\\|', '|');

/** The cells of a table line as written (trimmed, `\|` kept), without the outer pipes. */
const cellsOf = (line) => {
  const cells = line.split(PIPE).slice(1);
  if (cells.length && cells.at(-1).trim() === '') {
    cells.pop();
  }
  return cells.map((cell) => cell.trim());
};

const isTableLine = (line) => line.trim().startsWith('|');
const isSeparator = (line) => /^\|(\s*:?-+:?\s*\|)+$/.test(line.trim());
const isRow = (line) => /^\|\s*`[^`]+`\s*\|/.test(line.trim());

/**
 * Every marked table of the document, in order: the line of its start marker and the offsets of
 * the text between its markers. Throws when the markers do not pair up or a table line sits
 * right outside them (it would render as part of the table and not be checked).
 */
const markedTables = (markdown) => {
  const lines = markdown.split('\n');
  const lineOf = (index) => markdown.slice(0, index).split('\n').length;
  const tables = [];
  let open;
  for (const marker of markdown.matchAll(/<!-- operator-semantics:(?:start|end -->)/g)) {
    const line = lineOf(marker.index);
    if (marker[0] !== END) {
      if (open) {
        throw new Error(`the start marker at line ${line} comes before the end marker of the table at line ${open.line}`);
      }
      if (isTableLine(lines[line - 2] ?? '')) {
        throw new Error(`line ${line - 1}, right before the start marker, is a table line: a row belongs between the markers`);
      }
      const lineEnd = markdown.indexOf('\n', marker.index);
      open = { line, bodyStart: lineEnd === -1 ? markdown.length : lineEnd + 1 };
    } else {
      if (!open) {
        throw new Error(`the end marker at line ${line} has no start marker before it`);
      }
      if (isTableLine(lines[line] ?? '')) {
        throw new Error(`line ${line + 1}, right after the end marker, is a table line: a row belongs between the markers`);
      }
      tables.push({ ...open, bodyEnd: Math.max(open.bodyStart, marker.index) });
      open = undefined;
    }
  }
  if (open) {
    throw new Error(`the table at line ${open.line} has no end marker ("${END}")`);
  }
  if (tables.length === 0) {
    throw new Error(`no table between "${START} …" and "${END}"`);
  }
  return tables;
};

/** The lines between a pair of markers: header, separator, then one line per row. */
const tableLines = (markdown, { bodyStart, bodyEnd }) => {
  const lines = markdown.slice(bodyStart, bodyEnd).split(/\r?\n/);
  if (lines.at(-1) === '') {
    lines.pop();
  }
  const [header, separator, ...rows] = lines;
  if (!header || !isTableLine(header) || isRow(header) || !separator || !isSeparator(separator)) {
    throw new Error('the table between the markers must start with a header and a separator line (|---|---|---|)');
  }
  if (cellsOf(header).length !== COLUMNS || cellsOf(separator).length !== COLUMNS) {
    throw new Error('the table between the markers must have three columns: operator, semantics, example');
  }
  const numbered = rows.map((line, index) => ({ line, number: index + 3 }));
  const strays = numbered.filter(({ line }) => !isRow(line));
  if (strays.length) {
    // A blank line is a stray too (it ends the table), but the text after it says more.
    const stray = strays.find(({ line }) => line.trim()) ?? strays[0];
    throw new Error(
      `line ${stray.number} between the markers is not an operator row (| \`operator\` | semantics | example |): ` +
        `${JSON.stringify(stray.line)}. Only the table may sit between the markers; move anything else outside them`,
    );
  }
  const uneven = numbered.find(({ line }) => cellsOf(line).length !== COLUMNS);
  if (uneven) {
    throw new Error(
      `line ${uneven.number} between the markers has ${cellsOf(uneven.line).length} cells, not ${COLUMNS} ` +
        `(| \`operator\` | semantics | example |): ${JSON.stringify(uneven.line)}. A | inside a cell is written \\|, also inside \`code\``,
    );
  }
  return { header, separator, rows };
};

const rowsOf = (lines) =>
  lines.map((line) => {
    const [operator, semantics, example] = cellsOf(line);
    return { operator: operator.replaceAll('`', ''), semantics: unescapePipes(semantics), example, line };
  });

/**
 * Every marked table of the skill as { line, rows }: the line of its start marker and its rows,
 * in order, as { operator, semantics, example, line }. `example` is the cell as written (a `\|`
 * stays a `\|`), `line` the whole row. Throws when the markers are missing or do not pair up,
 * when anything but the table sits between them, or when a row does not have three cells.
 */
export function parseOperatorTables(markdown) {
  return markedTables(markdown).map((table) => {
    try {
      return { line: table.line, rows: rowsOf(tableLines(markdown, table).rows) };
    } catch (error) {
      throw new Error(`table at line ${table.line}: ${error.message}`);
    }
  });
}

/** The rows of the first marked table; every marked table is validated. */
export function parseOperatorTable(markdown) {
  return parseOperatorTables(markdown)[0].rows;
}

/** What is wrong with the Example cell of a row, if anything: it is empty or a `code` example of the row's operator. */
const exampleProblem = ({ operator, example }) => {
  if (!example) {
    return undefined;
  }
  const spans = [...example.matchAll(/(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/g)].map((match) => unescapePipes(match[2]).trim());
  if (spans.length === 0) {
    return `${operator}: the Example cell has no \`code\` example: "${example}"`;
  }
  for (const span of spans) {
    let named;
    try {
      named = JSON.parse(span)?.operator;
    } catch {
      continue; // not JSON (a regex, a CLI call): nothing to compare
    }
    if (typeof named === 'string' && named !== operator) {
      return `${operator}: its example is one for the operator "${named}"`;
    }
  }
  return undefined;
};

/** One line per difference between the schema and one table; empty when they agree. */
export function diffOperatorTable(descriptions, rows) {
  const problems = [];
  const operators = rows.map((row) => row.operator);
  for (const [operator, semantics] of descriptions) {
    const matching = rows.filter((row) => row.operator === operator);
    if (matching.length === 0) {
      problems.push(`${operator}: missing in the table (schema: "${semantics}")`);
    }
    if (matching.length > 1) {
      problems.push(`${operator}: ${matching.length} rows in the table, expected one`);
    }
    for (const row of matching.filter((candidate) => candidate.semantics !== semantics)) {
      problems.push(`${operator}: the table says "${row.semantics}", the schema says "${semantics}"`);
    }
  }
  for (const operator of new Set(operators.filter((candidate) => !descriptions.has(candidate)))) {
    problems.push(`${operator}: in the table, but not a built-in operator of the schema`);
  }
  const expected = [...descriptions.keys()];
  const sameSet = operators.length === expected.length && expected.every((operator) => operators.includes(operator));
  if (sameSet && operators.join() !== expected.join()) {
    problems.push(`row order: the table has ${operators.join(', ')}; the schema order is ${expected.join(', ')}`);
  }
  problems.push(...rows.map(exampleProblem).filter(Boolean));
  return problems;
}

/** The differences of every marked table; with more than one table each line names its table. */
const diffOperatorTables = (descriptions, tables) =>
  tables.flatMap(({ line, rows }) =>
    diffOperatorTable(descriptions, rows).map((problem) => (tables.length > 1 ? `table at line ${line}: ${problem}` : problem)),
  );

/** The row lines of one table, rewritten from the schema; `kept` are the example cells, as written. */
const renderRows = (rows, descriptions) => {
  const unknown = [...new Set(rows.map((row) => row.operator).filter((operator) => !descriptions.has(operator)))];
  if (unknown.length) {
    throw new Error(
      `the table has rows the schema does not list (${unknown.join(', ')}): --write does not delete rows. ` +
        'Remove them by hand if the operator is gone, or check that the schema source is complete',
    );
  }
  return [...descriptions].map(([operator, semantics]) => {
    const candidates = rows.filter((row) => row.operator === operator);
    const row = candidates.find((candidate) => candidate.example) ?? candidates[0];
    if (!row) {
      return { line: `| \`${operator}\` | ${escapePipes(semantics)} | |`, example: '' };
    }
    if (row.semantics === semantics) {
      return { line: row.line, example: row.example };
    }
    // Only the Semantics cell is replaced: the operator cell, the example and the padding stay as written.
    const segments = row.line.split(PIPE);
    segments[2] = ` ${escapePipes(semantics)} `;
    return { line: segments.join('|'), example: row.example };
  });
};

/**
 * The markdown with the rows of every marked table rewritten from the schema, in schema order.
 * A row that matches is kept byte for byte; in a row that differs only the Semantics cell
 * changes. Throws instead of deleting the row of an operator the schema does not list, and
 * instead of writing a table that would not read back as the schema wording and the examples.
 */
export function renderOperatorTable(markdown, descriptions) {
  for (const [operator, semantics] of descriptions) {
    if (/[\r\n]/.test(semantics) || semantics !== semantics.trim()) {
      throw new Error(`${operator}: the schema description has a line break or outer spaces; a table cell cannot state it`);
    }
  }
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
  const tables = markedTables(markdown).map((table) => {
    try {
      const { header, separator, rows } = tableLines(markdown, table);
      return { ...table, header, separator, rendered: renderRows(rowsOf(rows), descriptions) };
    } catch (error) {
      throw new Error(`table at line ${table.line}: ${error.message}`);
    }
  });
  let written = markdown;
  for (const { bodyStart, bodyEnd, header, separator, rendered } of [...tables].reverse()) {
    const lines = [header, separator, ...rendered.map((row) => row.line)].join(eol);
    // The end marker stays where it was: on its own line, or behind the last row.
    const tail = /\n$/.test(markdown.slice(bodyStart, bodyEnd)) ? eol : '';
    written = `${written.slice(0, bodyStart)}${lines}${tail}${written.slice(bodyEnd)}`;
  }
  const expected = [...descriptions];
  const readBack = parseOperatorTables(written);
  const same = tables.every(({ rendered }, index) => {
    const rows = readBack[index]?.rows ?? [];
    return (
      rows.length === expected.length &&
      rows.every(
        (row, at) =>
          row.operator === expected[at][0] && row.semantics === expected[at][1] && row.example === rendered[at].example,
      )
    );
  });
  if (!same || readBack.length !== tables.length) {
    throw new Error('--write would not read back as the schema wording with the examples kept; nothing was written');
  }
  return written;
}

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();

function readSchemaSource(options) {
  const file = options.schema ?? process.env.DCUPL_SCHEMA_FILE;
  if (file) {
    return { source: readFileSync(file, 'utf8'), from: file };
  }
  // A worktree shares the main checkout's .git, so its sibling is found from any worktree.
  const mainCheckout = dirname(git(REPO_ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
  const repo = options['dcupl-repo'] ?? process.env.DCUPL_REPO ?? resolve(mainCheckout, '..', 'dcupl');
  const ref = options.ref ?? process.env.DCUPL_REF ?? 'origin/main';
  // The commit is named in the output: a ref that was not fetched shows as an old commit.
  const [commit, short, date] = git(repo, 'log', '-1', '--format=%H %h %cs', ref, '--').split(' ');
  return { source: git(repo, 'show', `${commit}:${SCHEMA_PATH}`), from: `${repo} at ${ref} (commit ${short} of ${date})` };
}

const firstLine = (error) => String(error?.message ?? error).split('\n')[0];

function main() {
  let options;
  try {
    ({ values: options } = parseArgs({
      options: {
        write: { type: 'boolean', default: false },
        schema: { type: 'string' },
        'dcupl-repo': { type: 'string' },
        ref: { type: 'string' },
        skill: { type: 'string' },
      },
    }));
  } catch (error) {
    console.error(`check-operator-table: ${firstLine(error)}`);
    console.error(USAGE);
    process.exit(2);
  }
  let schema;
  let descriptions;
  try {
    schema = readSchemaSource(options);
    descriptions = parseOperatorDescriptions(schema.source);
  } catch (error) {
    console.error(`check-operator-table: cannot read the schema: ${firstLine(error)}`);
    console.error('Pass --schema <query-api.schemas.ts> or --dcupl-repo <dcupl checkout>; see the header of this script.');
    process.exit(2);
  }
  const skillFile = options.skill ?? SKILL_FILE;
  let markdown;
  try {
    markdown = readFileSync(skillFile, 'utf8');
  } catch (error) {
    console.error(`check-operator-table: cannot read ${skillFile}: ${firstLine(error)}`);
    process.exit(2);
  }
  let written = markdown;
  let tables;
  try {
    if (options.write) {
      written = renderOperatorTable(markdown, descriptions);
    }
    tables = parseOperatorTables(written);
  } catch (error) {
    console.error(`check-operator-table: ${skillFile}: ${firstLine(error)}`);
    process.exit(1);
  }
  if (written !== markdown) {
    try {
      writeFileSync(skillFile, written);
    } catch (error) {
      console.error(`check-operator-table: cannot write ${skillFile}: ${firstLine(error)}`);
      process.exit(2);
    }
  }
  const problems = diffOperatorTables(descriptions, tables);
  if (problems.length) {
    console.error(`check-operator-table: ${problems.length} difference(s) between the skill and ${schema.from}:`);
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    console.error('Fix the table by hand or run this script with --write.');
    process.exit(1);
  }
  const where = tables.length > 1 ? ` in ${tables.length} marked tables` : '';
  console.log(`check-operator-table: ${descriptions.size} operators match ${schema.from}${where}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
