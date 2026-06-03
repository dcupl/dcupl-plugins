# dcupl-plugins

Claude Code plugins for the dcupl ecosystem.

## Structure

```
dcupl-plugins/                      # this repo (future marketplace)
└── dcupl/                          # the "dcupl" plugin
    ├── .claude-plugin/plugin.json
    └── skills/dcupl/               # the "dcupl" skill (SKILL.md + references)
```

Add more plugins as sibling folders under the repo root (e.g. `dcupl-pm/`).

## Local development

The `dcupl` skill is symlinked into `~/.claude/skills/dcupl`, so edits here are
picked up live by Claude Code (no restart, no `--plugin-dir` flag needed):

```
~/.claude/skills/dcupl -> ~/Desktop/dcupl/dcupl-plugins/dcupl/skills/dcupl
```

Edit files in this repo; the running skill reflects changes immediately.

## Distribution (later)

To share with the team, add `.claude-plugin/marketplace.json` at the repo root
listing the plugins, push to GitHub, then teammates run:

```
/plugin marketplace add <org>/dcupl-plugins
/plugin install dcupl@<marketplace-name>
```
