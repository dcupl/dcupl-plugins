#!/usr/bin/env node
// Guard for the dcupl skill's operator table (dcupl-plugins#27).
//
// The table between the `operator-semantics` markers in references/querying.md states each
// built-in query operator in the wording of `operatorDescriptions` in @dcupl/common-internal
// (the shared query schema, the one REST and the MCP tools validate with). This script fails
// when the two differ; `--write` copies the schema wording into the table.
//
//   node scripts/check-operator-table.mjs            check (exit 1 on drift, 2 when it cannot check)
//   node scripts/check-operator-table.mjs --write    rewrite the Semantics column from the schema
//
// The schema source is read without network access, in this order:
//   --schema <file> | DCUPL_SCHEMA_FILE   a copy of query-api.schemas.ts
//   --dcupl-repo <dir> | DCUPL_REPO       a dcupl/dcupl checkout (default: the `dcupl` folder next
//                                         to this repo's main checkout), read at
//   --ref <ref> | DCUPL_REF               this git ref (default origin/main; `git fetch` it first)
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

/**
 * The `operatorDescriptions` record of the schema source as operator → semantics, in source
 * order. Each description starts with "<operator>: "; the table has the operator in its own
 * column, so the prefix is dropped.
 */
export function parseOperatorDescriptions(source) {
  const record = /\boperatorDescriptions\b[^=]*=\s*\{([\s\S]*?)\}\s*;/.exec(source);
  if (!record) {
    throw new Error('no `operatorDescriptions` record in the schema source');
  }
  const descriptions = new Map();
  for (const [, operator, , text] of record[1].matchAll(/(\w+)\s*:\s*(['"`])((?:\\.|(?!\2)[^\\])*)\2\s*,/g)) {
    const description = text.replace(/\\(.)/g, '$1');
    const prefix = `${operator}: `;
    descriptions.set(operator, description.startsWith(prefix) ? description.slice(prefix.length) : description);
  }
  if (descriptions.size === 0) {
    throw new Error('the `operatorDescriptions` record has no entries this script can read');
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

const isRow = (line) => /^\|\s*`[^`]+`\s*\|/.test(line.trim());

/** The marked table of the skill as operator → { semantics, example }. */
export function parseOperatorTable(markdown) {
  const { bodyStart, bodyEnd } = tableBounds(markdown);
  const rows = new Map();
  for (const line of markdown.slice(bodyStart, bodyEnd).split('\n').filter(isRow)) {
    const [operator, semantics = '', example = ''] = cellsOf(line);
    rows.set(operator.replaceAll('`', ''), { semantics, example });
  }
  return rows;
}

/** One line per difference between the schema and the table; empty when they agree. */
export function diffOperatorTable(descriptions, rows) {
  const problems = [];
  for (const [operator, semantics] of descriptions) {
    const row = rows.get(operator);
    if (!row) {
      problems.push(`${operator}: missing in the table (schema: "${semantics}")`);
    } else if (row.semantics !== semantics) {
      problems.push(`${operator}: the table says "${row.semantics}", the schema says "${semantics}"`);
    }
  }
  for (const operator of rows.keys()) {
    if (!descriptions.has(operator)) {
      problems.push(`${operator}: in the table, but not a built-in operator of the schema`);
    }
  }
  return problems;
}

/** The markdown with the table rows rewritten from the schema; examples are kept per operator. */
export function renderOperatorTable(markdown, descriptions) {
  const { bodyStart, bodyEnd } = tableBounds(markdown);
  const rows = parseOperatorTable(markdown);
  const head = markdown.slice(bodyStart, bodyEnd).split('\n').filter((line) => line.trim() && !isRow(line));
  const body = [...descriptions].map(([operator, semantics]) => {
    const example = rows.get(operator)?.example ?? '';
    return `| \`${operator}\` | ${semantics.replaceAll('|', '\\|')} |${example ? ` ${example} |` : ' |'}`;
  });
  return `${markdown.slice(0, bodyStart)}${[...head, ...body].join('\n')}\n${markdown.slice(bodyEnd)}`;
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

function main() {
  const { values: options } = parseArgs({
    options: {
      write: { type: 'boolean', default: false },
      schema: { type: 'string' },
      'dcupl-repo': { type: 'string' },
      ref: { type: 'string' },
    },
  });
  let schema;
  let descriptions;
  try {
    schema = readSchemaSource(options);
    descriptions = parseOperatorDescriptions(schema.source);
  } catch (error) {
    console.error(`check-operator-table: cannot read the schema: ${error.message.split('\n')[0]}`);
    console.error('Pass --schema <query-api.schemas.ts> or --dcupl-repo <dcupl checkout>; see the header of this script.');
    process.exit(2);
  }
  let markdown = readFileSync(SKILL_FILE, 'utf8');
  try {
    parseOperatorTable(markdown);
  } catch (error) {
    console.error(`check-operator-table: ${SKILL_FILE}: ${error.message}`);
    process.exit(1);
  }
  if (options.write) {
    writeFileSync(SKILL_FILE, renderOperatorTable(markdown, descriptions));
    markdown = readFileSync(SKILL_FILE, 'utf8');
  }
  const problems = diffOperatorTable(descriptions, parseOperatorTable(markdown));
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
