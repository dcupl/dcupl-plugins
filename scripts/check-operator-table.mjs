#!/usr/bin/env node
// Guard for the dcupl skill's operator table (dcupl-plugins#27).
//
// The table between the `operator-semantics` markers in references/querying.md states each
// built-in query operator in the wording of `operatorDescriptions` in @dcupl/common-internal
// (the shared query schema, the one REST and the MCP tools validate with). This script fails
// when the two differ; `--write` copies the schema wording into the table.
//
//   node scripts/check-operator-table.mjs            check
//   node scripts/check-operator-table.mjs --write    rewrite the Semantics column from the schema
//
// Exit codes: 0 the table matches; 1 the table differs or is malformed; 2 the check could not
// run (unreadable schema, unknown flag).
//
// What "matches" means: one row per operator of the schema, in schema order, no other rows, the
// Semantics cell equal to the schema's description without its "<operator>: " prefix. Between the
// markers there is the table only (header, separator, rows): a note belongs outside them.
// `--write` rewrites wording and order, adds missing rows (empty example) and drops duplicate
// rows; it never deletes the row of an operator the schema does not list — remove that by hand.
//
// The schema source is read without network access, in this order:
//   --schema <file> | DCUPL_SCHEMA_FILE   a copy of query-api.schemas.ts
//   --dcupl-repo <dir> | DCUPL_REPO       a dcupl/dcupl checkout (default: the `dcupl` folder next
//                                         to this repo's main checkout), read at
//   --ref <ref> | DCUPL_REF               this git ref (default origin/main; `git fetch` it first)
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
const USAGE =
  'usage: node scripts/check-operator-table.mjs [--write] [--schema <file> | --dcupl-repo <dir> [--ref <ref>]] [--skill <file>]';

const ESCAPES = { n: '\n', t: '\t', r: '\r', 0: '\0' };

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

  const readLiteral = (key) => {
    const quote = source[at];
    if (!`'"\``.includes(quote) || at >= source.length) {
      throw new Error(`entry "${key}": its value is not a string literal (or literals joined with +), at ${rest()}`);
    }
    let text = '';
    for (at += 1; source[at] !== quote; at += 1) {
      if (at >= source.length) {
        throw new Error(`entry "${key}": its string never ends`);
      }
      if (quote === '`' && source.startsWith('${', at)) {
        throw new Error(`entry "${key}": its value is a template with \${…}, not a plain string`);
      }
      if (source[at] === '\\') {
        at += 1;
        const unicode = /^u([0-9a-fA-F]{4})/.exec(source.slice(at));
        text += unicode ? String.fromCharCode(parseInt(unicode[1], 16)) : (ESCAPES[source[at]] ?? source[at]);
        at += unicode ? 4 : 0;
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

/**
 * The `operatorDescriptions` record of the schema source as operator → semantics, in source
 * order. Each description starts with "<operator>: "; the table has the operator in its own
 * column, so the prefix is dropped. Throws when the record is missing, empty or has an entry
 * that is not a plain string.
 */
export function parseOperatorDescriptions(source) {
  const declaration = /\b(?:const|let|var)\s+operatorDescriptions\b[^=;]*=\s*\{/.exec(source);
  if (!declaration) {
    throw new Error('no `operatorDescriptions` record in the schema source');
  }
  const descriptions = new Map();
  for (const [operator, description] of readRecord(source, declaration.index + declaration[0].length - 1)) {
    const prefix = `${operator}: `;
    descriptions.set(operator, description.startsWith(prefix) ? description.slice(prefix.length) : description);
  }
  if (descriptions.size === 0) {
    throw new Error('the `operatorDescriptions` record has no entries');
  }
  return descriptions;
}

const tableBounds = (markdown) => {
  const start = markdown.indexOf(START);
  const end = markdown.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`no table between "${START} …" and "${END}"`);
  }
  return { bodyStart: markdown.indexOf('\n', start) + 1, bodyEnd: end };
};

const cellsOf = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replaceAll('\\|', '|'));

const isTableLine = (line) => line.trim().startsWith('|');
const isSeparator = (line) => /^\|(\s*:?-+:?\s*\|)+$/.test(line.trim());
const isRow = (line) => /^\|\s*`[^`]+`\s*\|/.test(line.trim());

/** The lines between the markers: header, separator, then one line per row. */
const tableLines = (markdown) => {
  const { bodyStart, bodyEnd } = tableBounds(markdown);
  const lines = markdown.slice(bodyStart, bodyEnd).split(/\r?\n/);
  if (lines.at(-1) === '') {
    lines.pop();
  }
  const [header, separator, ...rows] = lines;
  if (!header || !isTableLine(header) || isRow(header) || !separator || !isSeparator(separator)) {
    throw new Error('the table between the markers must start with a header and a separator line (|---|---|---|)');
  }
  const strays = rows.map((line, index) => ({ line, number: index + 3 })).filter(({ line }) => !isRow(line));
  if (strays.length) {
    // A blank line is a stray too (it ends the table), but the text after it says more.
    const stray = strays.find(({ line }) => line.trim()) ?? strays[0];
    throw new Error(
      `line ${stray.number} between the markers is not an operator row (| \`operator\` | semantics | example |): ` +
        `${JSON.stringify(stray.line)}. Only the table may sit between the markers; move anything else outside them`,
    );
  }
  return { header, separator, rows };
};

/**
 * The rows of the skill's marked table, in order, as { operator, semantics, example }. Throws
 * when the markers are missing or when anything but the table sits between them.
 */
export function parseOperatorTable(markdown) {
  return tableLines(markdown).rows.map((line) => {
    const [operator, semantics = '', example = ''] = cellsOf(line);
    return { operator: operator.replaceAll('`', ''), semantics, example };
  });
}

/** One line per difference between the schema and the table; empty when they agree. */
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
  return problems;
}

/**
 * The markdown with the table rows rewritten from the schema, in schema order; the example of an
 * operator is kept. Throws instead of deleting the row of an operator the schema does not list.
 */
export function renderOperatorTable(markdown, descriptions) {
  const { bodyStart, bodyEnd } = tableBounds(markdown);
  const { header, separator } = tableLines(markdown);
  const rows = parseOperatorTable(markdown);
  const unknown = [...new Set(rows.map((row) => row.operator).filter((operator) => !descriptions.has(operator)))];
  if (unknown.length) {
    throw new Error(
      `the table has rows the schema does not list (${unknown.join(', ')}): --write does not delete rows. ` +
        'Remove them by hand if the operator is gone, or check that the schema source is complete',
    );
  }
  const body = [...descriptions].map(([operator, semantics]) => {
    const example = rows.find((row) => row.operator === operator && row.example)?.example ?? '';
    return `| \`${operator}\` | ${semantics.replaceAll('|', '\\|')} |${example ? ` ${example} |` : ' |'}`;
  });
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
  return `${markdown.slice(0, bodyStart)}${[header, separator, ...body].join(eol)}${eol}${markdown.slice(bodyEnd)}`;
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
  return { source: git(repo, 'show', `${ref}:${SCHEMA_PATH}`), from: `${repo} at ${ref}` };
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
  let rows;
  try {
    let markdown = readFileSync(skillFile, 'utf8');
    if (options.write) {
      const written = renderOperatorTable(markdown, descriptions);
      if (written !== markdown) {
        writeFileSync(skillFile, written);
        markdown = written;
      }
    }
    rows = parseOperatorTable(markdown);
  } catch (error) {
    console.error(`check-operator-table: ${skillFile}: ${firstLine(error)}`);
    process.exit(1);
  }
  const problems = diffOperatorTable(descriptions, rows);
  if (problems.length) {
    console.error(`check-operator-table: ${problems.length} difference(s) between the skill and ${schema.from}:`);
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    console.error('Fix the table by hand or run this script with --write.');
    process.exit(1);
  }
  console.log(`check-operator-table: ${descriptions.size} operators match ${schema.from}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
