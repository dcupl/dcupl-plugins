# dcupl-plugins

Claude Code plugin marketplace for the dcupl ecosystem.

This repo is a **plugin marketplace**: a catalog of one or more Claude Code
plugins that teammates can install with the `/plugin` command. It works in both
Claude Code (CLI) and the Claude desktop app.

## Installation

In Claude Code or the Claude app, run:

```
/plugin marketplace add dcupl/dcupl-plugins
/plugin install dcupl@dcupl-plugins
```

The first command registers this marketplace; the second installs the `dcupl`
plugin from it. After installing, the plugin's skills are available
automatically (e.g. the `dcupl` skill triggers when you work in a dcupl repo).

## Available plugins

| Plugin | Install | Description |
| ------ | ------- | ----------- |
| `dcupl` | `/plugin install dcupl@dcupl-plugins` | Skills for the dcupl ecosystem — data model authoring, app-loader configs (`dcupl.lc.json`), workflow templates, querying via the `dcupl app` daemon, project scaffolding, credential config, and cloud file sync. |

## Managing & updating

Plugins are versioned by git commit SHA (no pinned version), so **every push to
`main` is an update** for installed users. To pull the latest:

```
/plugin marketplace update dcupl-plugins
```

Other useful commands:

```
/plugin                          # interactive plugin manager
/plugin disable dcupl@dcupl-plugins
/plugin enable  dcupl@dcupl-plugins
/plugin uninstall dcupl@dcupl-plugins
/plugin marketplace remove dcupl-plugins
```

## Repository structure

```
dcupl-plugins/                          # the marketplace (this repo)
├── .claude-plugin/marketplace.json     # marketplace catalog — lists the plugins
├── dcupl/                              # the "dcupl" plugin
│   ├── .claude-plugin/plugin.json      # plugin manifest
│   └── skills/dcupl/                   # the "dcupl" skill (SKILL.md + references/)
└── scripts/                            # repo checks (see "Checks"), not part of a plugin
```

Add more plugins as sibling folders under the repo root (e.g. `dcupl-pm/`), each
with its own `.claude-plugin/plugin.json`, then add an entry to
`.claude-plugin/marketplace.json`. They install as `<plugin>@dcupl-plugins`.

## Local development

The `dcupl` skill is symlinked into `~/.claude/skills/dcupl`, so edits here are
picked up live by Claude Code (no reinstall, no restart):

```
~/.claude/skills/dcupl -> ~/Desktop/dcupl/dcupl-plugins/dcupl/skills/dcupl
```

Edit files in this repo and the running skill reflects changes immediately. To
test the packaged plugin (not the symlink) against the marketplace flow, install
from a local path:

```
/plugin marketplace add ./path/to/dcupl-plugins
/plugin install dcupl@dcupl-plugins
```

## Checks

The operator table in `dcupl/skills/dcupl/references/querying.md` (between the
`operator-semantics` markers) states each built-in query operator in the wording
of `operatorDescriptions` in `@dcupl/common-internal`
(`packages/common-internal/src/query-api/query-api.schemas.ts` in `dcupl/dcupl`),
the schema REST and the MCP tools validate with. Run the guard before pushing a
change to the skill and whenever that schema changes:

```
git -C ../dcupl fetch origin                   # the guard reads origin/main of the checkout next to this repo
node scripts/check-operator-table.mjs          # exit 1 and one line per difference when the table drifted
node scripts/check-operator-table.mjs --write  # copy the schema wording into the table, examples kept
node --test                                    # the guard's own unit tests
```

It needs Node 20+ and no install or network: the schema is read with `git show`
from the `dcupl` checkout (`--dcupl-repo <dir>` / `DCUPL_REPO`, `--ref` /
`DCUPL_REF`), or from a file with `--schema <query-api.schemas.ts>` /
`DCUPL_SCHEMA_FILE`. `scripts/` is outside the plugin folder and is not installed
with the plugin. There is no CI job: `dcupl/dcupl` is private, so a workflow in
this public repo cannot read the schema without a secret.
