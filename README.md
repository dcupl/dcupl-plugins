# dcupl-plugins

Claude Code plugin marketplace for the dcupl ecosystem.

This repo is a **plugin marketplace**: a catalog of one or more Claude Code
plugins that teammates can install with the `/plugin` command. It works in both
Claude Code (CLI) and the Claude desktop app.

## Installation

> This repo is private — you need read access to the `dcupl` GitHub org, and your
> local `git`/`gh` auth must be able to clone it.

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
└── dcupl/                              # the "dcupl" plugin
    ├── .claude-plugin/plugin.json      # plugin manifest
    └── skills/dcupl/                   # the "dcupl" skill (SKILL.md + references/)
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
