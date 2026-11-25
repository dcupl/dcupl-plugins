// The CLI's npm package is `@dcupl/cli`; the unscoped names `dcupl` and `create-dcupl` are not
// dcupl's packages (decision #599, 2026-11-24). `npx dcupl …` runs the project's local CLI when one
// is installed, but without one npx downloads whatever package owns the unscoped name, and in a
// session without a terminal (every agent) it does so without asking. So no file under
// `dcupl/skills/` fetches one of those names through a package manager, unless `--no --` stops the
// download: `npx --no -- dcupl --version` and `npx @dcupl/cli …` stay allowed.
// Run with `node --test`.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = join(REPO_ROOT, 'dcupl', 'skills');

const NAMES = new Set(['dcupl', 'create-dcupl']);

// What each way of calling a package manager does with a package name (npm 11, pnpm 10, Yarn 4,
// Bun 1):
// - `exec`: npx, `npm exec`, `npm x`. They download a missing package unless `yes` ends up false
//   (`--no`, `--no-yes`, `--yes=false`, and for npx `--no-install`; a later `-y`/`--yes` wins).
//   Without `--` right before the command, npm reads the command's own flags as its own
//   (`npx --no dcupl --version` prints npm's version), so the one safe form is: the last of those
//   flags stops the download, then `--`, then the name.
// - `dlx`: pnpx, bunx, `bun x`, `pnpm dlx`, `yarn dlx`. No flag stops the download.
// - `create`: `npm init|innit|create dcupl`, `pnpm|yarn|bun create dcupl` run `create-dcupl`.
//   `npm init --no dcupl` would not download it, but the skill has no use for that form, so the
//   guard flags every create of the name.
// - `install`: `npm i|install|add`, `pnpm|yarn|bun add`, `yarn global add`. Installing the unscoped
//   `dcupl` puts another package's `dcupl` bin on PATH, where the skill's bare `dcupl` finds it.
const BINS = /^(?:(?:~|\.{1,2})?\/(?:[\w.@-]+\/)*)?(npx|pnpx|bunx)(?:\.cmd|\.ps1|\.exe)?$/;
const BIN_KINDS = new Map([
  ['npx', 'exec'],
  ['pnpx', 'dlx'],
  ['bunx', 'dlx'],
]);
const SUBCOMMANDS = new Map([
  ['npm', new Map([['exec', 'exec'], ['x', 'exec'], ['init', 'create'], ['innit', 'create'], ['create', 'create'], ['install', 'install'], ['i', 'install'], ['add', 'install']])],
  ['pnpm', new Map([['dlx', 'dlx'], ['create', 'create'], ['add', 'install'], ['install', 'install'], ['i', 'install']])],
  ['yarn', new Map([['dlx', 'dlx'], ['create', 'create'], ['add', 'install'], ['global', 'install']])],
  ['bun', new Map([['x', 'dlx'], ['create', 'create'], ['add', 'install'], ['install', 'install'], ['i', 'install']])],
]);

// Where a command written in running text ends: a code span, a shell operator, a bracket. Quotes,
// commas and square brackets do not end it, so `"command": "npx", "args": ["-y", "dcupl"]` (an MCP
// server config), `CMD ["npx", "dcupl"]` and `npx 'dcupl@^2'` read as the command they run.
const COMMAND_END = /[`|;&()<>{}]/;
// A JSON key (`"args":`) or YAML `args:` between a runner and its arguments.
const KEY = /^(?:["'][\w-]+["']|args):$/;
const ODD_SPACES = /&nbsp;|&#160;| |\t/g;
const PROSE_END = /[.,:;!?…]+$/;
// Prose that ends an install command written in running text: "npm install and then …".
const CONNECTORS = new Set(
  'and or then to the for with in if before after once but not first'.split(' '),
);

const PACKAGE_OPTIONS = new Set(['-p', '--package']);
const YES_OPTIONS = new Set(['-y', '--yes', '--no', '--no-yes']);
// Options that take the next word as their value.
const VALUE_OPTIONS = new Set(
  '-C -c -w --call --workspace --registry --cache --prefix --userconfig --globalconfig --loglevel --node-options --script-shell --tag --scope --before --omit --include --location --proxy --https-proxy'.split(
    ' ',
  ),
);
// Options that never take a value.
const SWITCHES = new Set(
  '-q --quiet -s --silent -d --verbose -g --global -D --save-dev -S --save -E --save-exact -O --save-optional -P --save-prod --no-save -f --force -ws --workspaces --include-workspace-root --ignore-scripts --offline --prefer-offline --prefer-online --legacy-peer-deps --dry-run'.split(
    ' ',
  ),
);

// Quotes, brackets and Markdown emphasis around a word, also around an option's value (`--package='x'`).
const cleanWord = (raw) =>
  raw
    .replace(/^["'*_~[\]]+/, '')
    .replace(/["'*_~[\]]+$/, '')
    .replace(/^(-[\w-]+=)["']/, '$1');
const wordsOf = (segment) =>
  segment
    .split(/[\s,]+/)
    .filter((raw) => raw && !KEY.test(raw))
    .map(cleanWord)
    .filter(Boolean);
const splitOption = (word) => word.split(/=(.*)/s);

// `dcupl@latest` → `dcupl`; a scoped name (`@dcupl/cli@2`) is never unscoped.
const unscopedName = (word) => {
  const name = word.replace(PROSE_END, '');
  if (name.startsWith('@')) return undefined;
  const bare = name.split('@')[0];
  return NAMES.has(bare) ? bare : undefined;
};

/** `yes` after a yes-related option and how many following words it takes; else undefined. */
const yesOption = (option, value, next, bin) => {
  if (option === '--no-install' && bin === 'npx' && value === undefined) return { yes: false, taken: 0 };
  if (!YES_OPTIONS.has(option)) return undefined;
  let set = true;
  let taken = 0;
  if (value !== undefined) set = value !== 'false';
  else if (next === 'true' || next === 'false') {
    set = next === 'true';
    taken = 1;
  }
  return { yes: option === '--no' || option === '--no-yes' ? !set : set, taken };
};

/**
 * Every way npm can read the words of one call: what `yes` ends up as, the `-p` packages, where
 * the command is and whether `--` comes right before it. An option it may or may not know takes
 * the next word as its value or leaves it as the command; both readings are returned.
 */
const readings = (words, bin) => {
  const out = [];
  const walk = (start, yesStart, packagesStart) => {
    let yes = yesStart;
    let packages = packagesStart;
    let i = start;
    for (; i < words.length; i += 1) {
      const word = words[i];
      if (word === '--') {
        out.push({ yes, packages, at: i + 1, dashDash: true });
        return;
      }
      if (!word.startsWith('-') || word === '-') break;
      const [option, value] = splitOption(word);
      const yesValue = yesOption(option, value, words[i + 1], bin);
      if (yesValue) {
        yes = yesValue.yes;
        i += yesValue.taken;
      } else if (PACKAGE_OPTIONS.has(option)) {
        const at = value === undefined ? i + 1 : i;
        if (words[at] !== undefined) packages = [...packages, { name: value ?? words[at], at }];
        i = at;
      } else if (value === undefined && !SWITCHES.has(option)) {
        if (VALUE_OPTIONS.has(option) || option.startsWith('--init-')) i += 1;
        else if (words[i + 1] !== undefined && !words[i + 1].startsWith('-')) {
          walk(i + 2, yes, packages);
        }
      }
    }
    out.push({ yes, packages, at: i, dashDash: false });
  };
  walk(0, undefined, []);
  return out;
};

/** Indexes into `words` of the unscoped names one exec, dlx or create call can download. */
const runHits = (kind, words, bin) => {
  const hits = new Set();
  for (const { yes, packages, at, dashDash } of readings(words, bin)) {
    if (kind === 'exec' && yes === false && dashDash) continue;
    for (const pkg of packages) if (unscopedName(pkg.name)) hits.add(pkg.at);
    // With `-p` the command is a bin of those packages, not a package itself.
    const name = packages.length || words[at] === undefined ? undefined : unscopedName(words[at]);
    // `create dcupl` runs `create-dcupl`; `create create-dcupl` would run `create-create-dcupl`.
    if (name !== undefined && (kind !== 'create' || name === 'dcupl')) hits.add(at);
  }
  return [...hits].sort((a, b) => a - b);
};

/** Indexes into `words` of the unscoped names one install call installs. */
const installHits = (words) => {
  const hits = [];
  let options = true;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (options && word === '--') options = false;
    else if (options && word.startsWith('-')) {
      const [option, value] = splitOption(word);
      if (value === undefined && (VALUE_OPTIONS.has(option) || option.startsWith('--init-'))) i += 1;
    } else if (CONNECTORS.has(word.toLowerCase())) break;
    else if (unscopedName(word)) hits.push(i);
  }
  return hits;
};

/** Every package-manager call in one line of text that can fetch an unscoped name. */
export const findUnscopedRuns = (line) => {
  const hits = [];
  for (const segment of line.replace(ODD_SPACES, ' ').split(COMMAND_END)) {
    const words = wordsOf(segment);
    const quote = (start, at) =>
      [...words.slice(start, at), words[at].replace(PROSE_END, '')].join(' ');
    for (let i = 0; i < words.length; i += 1) {
      const word = words[i];
      // `deno run npm:dcupl`, `bun run npm:dcupl`.
      if (/^npm:(?:dcupl|create-dcupl)(?:@|$)/.test(word.replace(PROSE_END, ''))) {
        hits.push(word.replace(PROSE_END, ''));
      }
      const bin = BINS.exec(word)?.[1];
      if (bin) {
        const callWords = words.slice(i + 1);
        for (const at of runHits(BIN_KINDS.get(bin), callWords, bin)) hits.push(quote(i, i + 1 + at));
        continue;
      }
      const subcommands = SUBCOMMANDS.get(word);
      if (!subcommands) continue;
      // Global options may come before the subcommand: `npm --yes exec …`, `pnpm --package=x dlx …`.
      let j = i + 1;
      while (j < words.length && words[j].startsWith('-') && words[j] !== '--') {
        const [option, value] = splitOption(words[j]);
        const takesValue =
          value === undefined &&
          !SWITCHES.has(option) &&
          !YES_OPTIONS.has(option) &&
          words[j + 1] !== undefined &&
          !subcommands.has(words[j + 1]);
        j += takesValue ? 2 : 1;
      }
      const kind = subcommands.get(words[j]);
      if (!kind) continue;
      // The call's words: the global options, then the subcommand's own words.
      const globals = j - i - 1;
      const callWords = [...words.slice(i + 1, j), ...words.slice(j + 1)];
      const toLine = (at) => (at < globals ? i + 1 + at : at + i + 2);
      const found = kind === 'install' ? installHits(callWords) : runHits(kind, callWords, word);
      for (const at of found) hits.push(quote(i, toLine(at)));
    }
  }
  return hits;
};

// An MCP-style config whose `args` sit on the line after its `command` (JSON, TOML, YAML flow).
const COMMAND_THEN_ARGS =
  /(["']?)command\1\s*[:=]\s*["']?([^\s"',]+)["']?\s*,?[ \t]*\r?\n\s*(["']?)args\3\s*[:=]\s*\[([^\]]*)\]/g;

/** Every hit in a file's text, with its line; a command continued with `\` counts from its first line. */
export const scanText = (text) => {
  const lines = text.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    const first = i + 1;
    let line = lines[i];
    while (/\\\s*$/.test(line) && i + 1 < lines.length) {
      i += 1;
      line = `${line.replace(/\\\s*$/, ' ')}${lines[i]}`;
    }
    for (const match of findUnscopedRuns(line)) hits.push({ line: first, match });
  }
  for (const found of text.matchAll(COMMAND_THEN_ARGS)) {
    const line = text.slice(0, found.index).split('\n').length;
    for (const match of findUnscopedRuns(`${found[2]} ${found[4]}`)) hits.push({ line, match });
  }
  return hits.sort((a, b) => a.line - b.line);
};

const filesUnder = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : filesUnder(path);
    }
    return [path];
  });

const finds = (line, expected) => assert.deepEqual(findUnscopedRuns(line), expected, line);

test('finds an npx of the unscoped names that can download', () => {
  finds('npx dcupl --version', ['npx dcupl']);
  finds('run `npx -y dcupl app start`', ['npx -y dcupl']);
  finds('npx --yes -- dcupl serve', ['npx --yes -- dcupl']);
  finds('npx create-dcupl my-app', ['npx create-dcupl']);
  finds('use bare `dcupl`, NOT `npx dcupl`.', ['npx dcupl']);
  finds('then npx dcupl.', ['npx dcupl']);
  finds('Never run **npx dcupl** in an agent session.', ['npx dcupl']);
  finds('__npx dcupl__ and *npx create-dcupl*', ['npx dcupl', 'npx create-dcupl']);
  finds('npx dcupl; npm  exec dcupl', ['npx dcupl', 'npm exec dcupl']);
  finds('npx&nbsp;dcupl serve', ['npx dcupl']);
  finds('npx dcupl serve', ['npx dcupl']);
});

test('finds a pinned or quoted unscoped name', () => {
  finds('npx dcupl@latest serve', ['npx dcupl@latest']);
  finds('npx create-dcupl@latest my-app', ['npx create-dcupl@latest']);
  finds('`npx dcupl@0.1.0`', ['npx dcupl@0.1.0']);
  finds('npx -y dcupl@^2 --version', ['npx -y dcupl@^2']);
  finds("npx 'create-dcupl@latest' my-app", ['npx create-dcupl@latest']);
  finds('npx "dcupl@^2" serve', ['npx dcupl@^2']);
  finds("npx --yes -- 'dcupl' serve", ['npx --yes -- dcupl']);
});

test('finds commands written as configs and argument arrays', () => {
  finds('"serve": "npx dcupl serve"', ['npx dcupl']);
  finds('{ "command": "npx", "args": ["-y", "dcupl", "mcp"] }', ['npx -y dcupl']);
  finds('{"mcpServers": {"dcupl": {"command": "npx", "args": ["-y","dcupl"]}}}', ['npx -y dcupl']);
  finds('{command: npx, args: [-y, dcupl, mcp]}', ['npx -y dcupl']);
  finds('CMD ["npx", "dcupl", "serve"]', ['npx dcupl']);
  finds('ENTRYPOINT ["npx", "--yes", "dcupl"]', ['npx --yes dcupl']);
  finds("execFileSync('npx', ['-y', 'create-dcupl', 'my-app'])", ['npx -y create-dcupl']);
  finds('claude mcp add dcupl -- npx -y dcupl mcp', ['npx -y dcupl']);
});

test('`--no` stops a download only as the last such flag with `--` right after it', () => {
  finds('npx --no dcupl serve', ['npx --no dcupl']);
  finds('npx --yes=false dcupl serve', ['npx --yes=false dcupl']);
  finds('npx --no-install dcupl --version', ['npx --no-install dcupl']);
  finds('npx --no --yes -- dcupl', ['npx --no --yes -- dcupl']);
  finds('npx --no -y -- dcupl', ['npx --no -y -- dcupl']);
  finds('npx --yes=false --yes -- dcupl', ['npx --yes=false --yes -- dcupl']);
  finds('npx --no --no-yes=false -- dcupl', ['npx --no --no-yes=false -- dcupl']);
  finds('npm exec --no -y=true -- dcupl', ['npm exec --no -y=true -- dcupl']);
  finds('npm exec --no false -- dcupl --version', ['npm exec --no false -- dcupl']);
  finds('npm exec --no-install -- dcupl', ['npm exec --no-install -- dcupl']);
  finds('npx -- dcupl --no', ['npx -- dcupl']);
});

test('reads the value of an option as its value, also one it does not know', () => {
  finds('npx --before 2026-01-01 dcupl serve', ['npx --before 2026-01-01 dcupl']);
  finds('npx -C ./app dcupl serve', ['npx -C ./app dcupl']);
  finds('npx --omit dev dcupl', ['npx --omit dev dcupl']);
  finds('npx --some-new-option value dcupl', ['npx --some-new-option value dcupl']);
});

test('finds the unscoped names in `--package`', () => {
  finds('npx -p dcupl dcupl --version', ['npx -p dcupl']);
  finds('npx --package=create-dcupl -- create-dcupl', ['npx --package=create-dcupl']);
  finds('npx --package dcupl@latest -c "dcupl --version"', ['npx --package dcupl@latest']);
  finds("npm exec --package='dcupl@latest' -- dcupl", ['npm exec --package=dcupl@latest']);
});

test('finds the other package runners, also behind global options', () => {
  finds('npm exec dcupl -- --version', ['npm exec dcupl']);
  finds('npm x -y -- dcupl', ['npm x -y -- dcupl']);
  finds('npm --yes exec dcupl -- --version', ['npm --yes exec dcupl']);
  finds('npm -w packages/app exec dcupl', ['npm -w packages/app exec dcupl']);
  finds('pnpm dlx dcupl serve', ['pnpm dlx dcupl']);
  finds('pnpm dlx --no -- dcupl', ['pnpm dlx --no -- dcupl']);
  finds('pnpm --package=dcupl dlx dcupl --version', ['pnpm --package=dcupl']);
  finds('yarn dlx -p dcupl dcupl', ['yarn dlx -p dcupl']);
  finds('pnpx create-dcupl app', ['pnpx create-dcupl']);
  finds('bunx dcupl@latest', ['bunx dcupl@latest']);
  finds('bun x dcupl', ['bun x dcupl']);
  finds('/usr/local/bin/npx dcupl serve', ['/usr/local/bin/npx dcupl']);
  finds('./node_modules/.bin/npx dcupl', ['./node_modules/.bin/npx dcupl']);
  finds('npx.cmd dcupl serve', ['npx.cmd dcupl']);
  finds('deno run -A npm:dcupl serve', ['npm:dcupl']);
});

test('finds create commands that run create-dcupl', () => {
  finds('npm init dcupl', ['npm init dcupl']);
  finds('npm innit dcupl', ['npm innit dcupl']);
  finds('npm create dcupl@latest my-app', ['npm create dcupl@latest']);
  finds('npm init -y dcupl', ['npm init -y dcupl']);
  finds('npm -y create dcupl', ['npm -y create dcupl']);
  finds('npm init --yes=false dcupl', ['npm init --yes=false dcupl']);
  finds('yarn create dcupl', ['yarn create dcupl']);
  finds('pnpm create dcupl', ['pnpm create dcupl']);
  finds('bun create dcupl', ['bun create dcupl']);
});

test('finds installs of the unscoped names', () => {
  finds('npm i -g dcupl', ['npm i -g dcupl']);
  finds('npm install --save-dev dcupl', ['npm install --save-dev dcupl']);
  finds('npm i -D @dcupl/cli dcupl', ['npm i -D @dcupl/cli dcupl']);
  finds('pnpm add -g create-dcupl', ['pnpm add -g create-dcupl']);
  finds('yarn global add dcupl', ['yarn global add dcupl']);
  finds('bun add dcupl@latest', ['bun add dcupl@latest']);
});

test('leaves guarded and scoped forms and prose alone', () => {
  for (const line of [
    'npx --no -- dcupl --version   # never downloads',
    'npx --no-yes -- dcupl serve',
    'npx --yes=false -- dcupl app status',
    'npx --yes --no -- dcupl',
    'npx --no-install -- dcupl --version',
    'npx --no --quiet -- dcupl --version',
    'npx --no --loglevel silent -- dcupl',
    'npx --no --some-flag value -- dcupl',
    'npx --no -- create-dcupl@latest my-app',
    'npx --no -p dcupl -- dcupl --version',
    'npx --no -C dcupl -- dcupl --version',
    'npm exec --no -- dcupl --version',
    'npm x --yes=false -- dcupl',
    'npm --yes=false exec -- dcupl --version',
    '{ "command": "npx", "args": ["--no", "--", "dcupl", "mcp"] }',
    'npx @dcupl/cli init --name shop',
    'npx -y @dcupl/cli@latest --version',
    'npx -p @dcupl/cli dcupl --version',
    'npx -c "dcupl --version"',
    'npx --registry https://registry.npmjs.org @dcupl/cli --version',
    'npm i -g @dcupl/cli@latest',
    'npm i -D @dcupl/cli',
    'npm install',
    'npm install and then run dcupl init',
    'npm init @dcupl',
    'npm init -y',
    'npm init -y --init-author-name dcupl --init-license UNLICENSED',
    'npm create vite@latest',
    'npm run serve',
    'dcupl --version',
    'npx downloads whatever package is named `dcupl`',
    'use bare `dcupl`, not the `npx` form.',
    'npx dcupl-schema-tools',
    'npx dcupl/cli',
    'pnpm exec dcupl --version',
    'yarn dcupl --version',
    'npx --no -- dcupl <command>',
    'https://www.npmjs.com/package/dcupl',
  ]) {
    finds(line, []);
  }
});

test('reads a command continued over lines and an MCP config split over lines', () => {
  assert.deepEqual(scanText('npx --yes \\\n  create-dcupl my-app\nnpx --no -- dcupl'), [
    { line: 1, match: 'npx --yes create-dcupl' },
  ]);
  assert.deepEqual(scanText('{\n  "command": "npx",\n  "args": ["-y", "dcupl", "mcp"]\n}'), [
    { line: 2, match: 'npx -y dcupl' },
  ]);
  assert.deepEqual(scanText('command = "npx"\nargs = ["--no", "--", "dcupl"]'), []);
});

test('no file under dcupl/skills/ fetches an unscoped name', () => {
  const offenders = filesUnder(SKILLS_DIR).flatMap((file) =>
    scanText(readFileSync(file, 'utf8')).map(
      ({ line, match }) => `${relative(REPO_ROOT, file)}:${line}: "${match}"`,
    ),
  );
  assert.equal(
    offenders.length,
    0,
    `${offenders.length} call(s) that can fetch an unscoped name; write \`npx --no -- dcupl …\` or \`npx @dcupl/cli …\`:\n${offenders.join('\n')}`,
  );
});
