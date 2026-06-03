---
name: dcupl
description: Use when working with the dcupl ecosystem in any way — authoring data models, app loader configurations (`dcupl.lc.json`), or workflow templates (v3); querying tabular data via the `dcupl app` daemon (facets, aggregations, group-bys, filtered queries); scaffolding projects via `dcupl init` / `dcupl generate`; wiring credentials via `dcupl config set` / `dcupl config get`; or syncing files with the dcupl cloud via `dcupl files <subcommand>` (status/push/pull/read/write/list/move/copy/delete + `files versions` management). Trigger on phrases like "write a model", "build a workflow", "configure a loader", "what fields does a ModelDefinition have", "how many X are there", "breakdown by Y", "push files to dcupl", "pull from dcupl", "what changed", "configure my dcupl credentials", "set up apiKey", or whenever the user is in a dcupl repo working with `*.dcupl.json`, `dcupl.lc.json`, or workflow templates.
---

# dcupl

The dcupl ecosystem in one skill. Identify the task, then read the matching reference file.

## Orient first: are you in a dcupl workspace?

Before anything else, determine whether the current directory is a dcupl workspace — look for `dcupl.config.json`, `dcupl.lc.json`, or an installed `@dcupl/*` package. This changes how you work:

- **In a workspace** — new apps and data are wired through the **Loader**. Whenever you add a data file, model, or link, you must also register it in `dcupl.lc.json`, or the loader won't see it.
- **Not in a workspace** — don't start authoring loosely. Ask the user whether there's a related workspace or dcupl console project elsewhere, and guide them through a proper setup (`dcupl init`, or bootstrap from an existing console project) before adding data.

## Then: confirm the CLI version you're about to use is ≥ 1.3.4

It is common for a workspace to have a `@dcupl/cli` pinned in `node_modules` that lags behind the user's globally installed `dcupl`. **Everything under `dcupl app *` in this skill (and `dcupl serve list` / `dcupl serve stop`) requires CLI ≥ 1.3.4.** Older versions (e.g. 1.3.2) don't ship the `app` subcommand at all — and instead of erroring on the unknown subcommand, they **silently exit 0 with no output**, which looks identical to success. You'll only notice when `dcupl app list` then reports "No apps running".

Check both before running any `dcupl app` recipe:

```bash
dcupl --version          # what's on PATH (typically the global install)
npx dcupl --version      # what the project's node_modules resolves
```

- **Both ≥ 1.3.4** → either works. Prefer `dcupl` to keep commands short.
- **Only the global is current** → use bare `dcupl`, NOT `npx dcupl`. The repo's `package.json` scripts (e.g. `npm run serve`) will still hit the older local CLI — fine for `dcupl serve` but not for `dcupl app`.
- **Both old** → tell the user; recommend `npm i -g @dcupl/cli@latest` (or upgrading the workspace's `@dcupl/cli` dependency). Don't try to work around it.

Two further traps from the old-CLI shape:

- **`dcupl serve list` on a pre-1.3.4 CLI is parsed as `dcupl serve [path=list]`** — i.e. it *starts* a dev server rooted at `./list` instead of listing serves. Symptom: port 8083 is suddenly occupied and the daemon you wanted to spin up can't auto-serve. Fix: `lsof -ti tcp:8083 | xargs -r kill`, then use the global CLI.
- **Unknown flags on `dcupl app *` are silently ignored**, not rejected. A wrong flag name on `query execute` — e.g. `--queries` (plural) instead of `--query`, or the old `--filter` on a CLI that has since renamed it — doesn't error; it returns the *unfiltered* result (every record). When a query feels like it returned "too much", re-check the flag name against `dcupl app <verb> --help` before assuming the data is wrong.

## How to start a daemon — pick your source

`dcupl app create --load` loads a project; the source defaults to **local** inside a workspace. Use `--source` to choose explicitly.

| Goal | Where | Command |
|---|---|---|
| Ad-hoc data (no loader) | anywhere | `dcupl app create --json` → then `dcupl app data upsert …` |
| Local workspace files | in a workspace | `dcupl app create --load --auto-serve --json` |
| Local files | outside a workspace | `dcupl app create --load --lc-json <path> --auto-serve --json` |
| Remote console data | in a workspace | `dcupl app create --load --source remote --json` |
| Remote console data | outside a workspace | `dcupl app create --load --source remote --project-id <id> --api-key <key> --json` |
| Custom URL | anywhere | `dcupl app create --load --source url --base-url <url> --json` |

`--source remote` fills `projectId` from `dcupl.config.json` and `apiKey` from `dcupl.secrets.json` (version defaults to `draft`; override with `--version`).

## Routing

| Task | Read |
|---|---|
| Querying / analyzing tabular data with the `dcupl app` daemon (facets, aggregations, group-bys, filters, counts) | `references/querying.md` |
| Cloud sync — `dcupl files` status/push/pull, per-file ops, version management | `references/cloud-sync.md` |
| Generating a model from a data file (`dcupl generate model --from`) | `references/model-authoring.md` |
| Building, testing, or deploying a Workflow v3 (`dcupl workflow validate/test/deploy/undeploy/runners`) | `references/workflows.md` |
| Reviewing / auditing a workflow file (`*.workflow-v3.json`) — esp. before flagging anything as a leaked secret | `references/workflows.md` — a `dcupl-files` node's `auth.apiKey` is a **reference UUID (identifier), committed deliberately**, not a secret. Don't flag it. |
| Authoring a model, loader config, or workflow v3 | Stay here — see "Authoring playbook" below. |
| Validating that a workspace's loader, models, and data load cleanly | Stay here — see "Validate a workspace" below. |
| Project scaffolding (`init`, `generate`, `serve`) | Stay here — see "Project setup" below. |

Read a reference file with the Read tool only when the task calls for it — don't load all of them up front.

## Discovery rule — `dcupl schemas get` is your escape hatch

If you don't know what schemas exist, your first move is:

```bash
dcupl schemas list
```

It prints every authorable dcupl schema grouped by topic. To inspect one:

```bash
dcupl schemas get <Name>             # source, with JSDoc
dcupl schemas get <Name> --example   # source plus a curated example (only some schemas)
dcupl schemas get <Name> --json      # structured for piping
```

> ⚠️ `--example` only appends a curated example for a subset of schemas — as of CLI 1.3.4 / `@dcupl/* 2.0.0-beta.5` that's `ModelDefinition`, `AppLoaderConfiguration`, `TemplateV3`, and `WorkflowConfigV3`. For others (`DcuplCliConfig`, `Property`, `Reference`, `WorkflowVariable`) `--example` is a silent no-op that just prints the type/source. Don't rely on it for those.

Schemas come from the project's installed `@dcupl/*` packages, so the output reflects the version actually in use. Confirm the live version with `dcupl version` if you suspect a mismatch.

**Reach for `dcupl schemas get <Type>` whenever you're stuck.** It's the highest-leverage diagnostic in the skill — in fresh-user testing it was the single most valuable escape hatch, used to discover undocumented config fields and resolve ambiguous shapes when docs were silent or wrong:

- `dcupl schemas get DcuplCliConfig` — what fields belong in `dcupl.config.json` (`consoleApiUrl`, `projectId`, paths, …)
- `dcupl schemas get AppLoaderConfiguration --example` — `dcupl.lc.json` shape, including the **Resource union** — data-resource `keyProperty` / `autoGenerateKey` / `csvParserOptions` live HERE, not in a standalone schema — plus `applications[].resourceTags`, `variables`, etc.
- `dcupl schemas get Reference` — `singleValued` / `multiValued` / `derive` / grouped references
- `dcupl schemas get ModelDefinition --example` — full property/reference/quality shape

> Note: there is **no** `DataResource` schema in the registry (`dcupl schemas get DataResource` errors). The data-resource shape is part of `AppLoaderConfiguration`'s Resource union.

If a question can be answered by "what fields does <schema> support?", run `dcupl schemas get` before guessing or grepping source.

## Ecosystem map

- **Model** — A data shape the user authors as `*.dcupl.json`. Defines properties, references between models, optional sample data, and quality rules. Schema: `ModelDefinition`.
- **App Loader Configuration** — `dcupl.lc.json`. Tells the loader what models, data files, transformers, scripts, and operators belong to an app, plus environment-specific variables. Schema: `AppLoaderConfiguration`.
- **Workflow v3** — Node-graph workflow definition with triggers, steps (request, script, data-mapper, dcupl-instance, …), responses, and edges connecting them. Schemas: `WorkflowConfigV3` (the graph) and `TemplateV3` (template wrapping the graph with metadata).
- **`dcupl app` daemon** — A local in-memory engine for ad-hoc data analysis on CSV/JSON/NDJSON. See `references/querying.md`.
- **Cloud sync** — `dcupl files <subcommand>` (status/push/pull) does incremental, changed-only sync between the local workspace and a dcupl console version. See `references/cloud-sync.md`.

## Authoring playbook

For any artifact, the rule is the same:

1. `dcupl schemas list` — confirm which schema applies.
2. `dcupl schemas get <Name> --example` — read the canonical shape and a worked example.
3. Write the file. Match the field names exactly; the schema is the source of truth.

**References cheatsheet** (full guide: `references/model-authoring.md` → "Authoring references"):

- Simple FK: `{ "key": "<localColumn>", "type": "singleValued"|"multiValued", "model": "<RemoteModel>" }` — `key` is the local column, not the remote model name.
- Key values are coerced at join time: a numeric-string FK (e.g. orders.json `customerId: "65"`) **resolves correctly** against an `int`-keyed model — verified on `@dcupl/* 2.0.0-beta.5`. A reference only "misses" when the key genuinely doesn't exist in the remote model, and that miss is **reported** as `RemoteReferenceKeyNotFound` (with `meta.remoteModel` / `meta.remoteKey`), not swallowed silently. So most `RemoteReferenceKeyNotFound` errors are real dangling references, not type mismatches. (Resolved refs show `_dcupl_ref_: "hit"`; dangling ones `"miss"`.)
- `derive: { localReference, remoteReference }` pulls a value across an existing Reference — it does NOT declare the relationship itself.
- Validate after changes: see "Validate a workspace" below; check `$DcuplErrorTrackingErrors` for `RemoteReferenceKeyNotFound` / `MissingReference`.

A CSV (or JSON/NDJSON) data file can be wired straight into `dcupl.lc.json` as a `type: data` resource bound to a model — there is no need to convert it to JSON first. The loader parses the file and types its columns from the model definition.

### Workflows v3 — important version warning

`@dcupl/common-internal` exports both a legacy v2 workflow type (`Workflow.Template` namespace, with `trigger[]` and `steps[]` arrays) and the v3 schemas (`WorkflowConfigV3`, `TemplateV3`, with unified `nodes[]` and `edges[]`). **Always author against v3.** Do not produce v2 templates. If the user's existing files look like v2, flag it and ask before extending them.

To **author, build, validate, test, or deploy** a workflow, read `references/workflows.md`. Beyond the CLI loop it documents the parts schemas don't cover and that are easy to get wrong: how data flows between nodes, the `script` node sandbox (its `_csv`/`_json`/… helpers — note bare `csvToJson` does NOT exist), `dcupl-files` read/write output shapes and the project-workflow `apiKey`, the must-`push`-before-`deploy` rule, and how to debug a failing run by triggering the runner directly. Per-node config schemas live in `dcupl schemas` under the group "Workflow Nodes": `dcupl schemas list`, then `dcupl schemas get <NodeTypeConfig> [--example]` before authoring a node's `config`. **Fastest start: copy a workflow already deployed in the project** via `dcupl files read --path workflows/<x>.workflow-v3.json`.

## Validate a workspace

After authoring or changing a model, loader config, or data file, confirm the workspace actually loads. **`dcupl serve` does not validate** — it only serves the workspace files over HTTP; it never parses models or loads data, so a green `serve` says nothing about correctness.

Real validation comes from loading the workspace through its loader in a `dcupl app` daemon, then inspecting the errors it collected. Run from the workspace root:

> ⚠️ **Layout assumption.** `dcupl serve` defaults its static-file root to `./dcupl/` (the positional `path` arg defaults to `"dcupl"`), and this recipe — plus `--auto-serve` — assumes `dcupl.lc.json` lives inside that folder. If your workspace is **flat** (lc.json + data at the project root), `--auto-serve` will spawn a serve rooted at `./dcupl/` and every loader fetch 404s — the daemon then fails with a misleading `serve did not become reachable` or `applicationKey default does not exist`. Either:
> - **Move workspace files under `dcupl/`** (conventional layout), **or**
> - **Start serve manually first**: `dcupl serve .` in a separate terminal, then run the `dcupl app create` line below with `--lc-json dcupl.lc.json` (no folder prefix). The auto-detected running serve will be reused.

```bash
# 1. Create a daemon that loads the whole workspace via its loader config.
#    --max-memory (MB): raise it for large datasets — the default V8 heap OOMs.
#    --lc-json / --workspace are auto-resolved inside a workspace: workspace mode is
#    detected from dcupl.config.json, and the loader path defaults to that file's
#    `loaderPath`. Pass --lc-json only for a flat/non-conventional layout.
dcupl app create --app validate --load --app-key default --auto-serve --max-memory 8192 --json

# 2. Build. This processes models + data and collects error records.
dcupl app build --app validate --json

# 3. List every model/data error the loader and parser found.
dcupl app query execute --app validate --model '$DcuplErrorTrackingErrors' --json
# Distribution by error type:
dcupl app fn facets --app validate --model '$DcuplErrorTrackingErrors' --attribute errorType --json

# 4. Clean up.
dcupl app destroy --app validate --json
```

An empty result from step 3 means the workspace loads clean. Otherwise each record names the `model`, `itemKey`, `attribute`, and `errorType` — see "Model & data errors" below for the taxonomy.

Notes:
- **Check `built` before trusting the load.** With `--load` in a workspace (the recipe above), `dcupl app create` typically performs the build itself: its final JSON line reports `"built":true` with a populated app, and the explicit `dcupl app build` in step 2 is then a cheap no-op (`built:false, reason:"already up to date"`). This was verified on `@dcupl/* 2.0.0-beta.5` across multiple workspaces. **However**, a non-workspace `data upsert` flow (without `--auto-update`) returns `{"status":"processed", ...}` with `models:[]` and `pendingChanges:true`, and the first query fails `MODEL_NOT_FOUND` until you build. **Rule: if the `create` result isn't `"built":true`, run `dcupl app build` before querying** — running it anyway is always safe (it just no-ops).
- **Quote `'$DcuplErrorTrackingErrors'`** — an unquoted `$...` is eaten by the shell and silently becomes empty.
- **If `$DcuplErrorTrackingErrors` comes back empty but you expected errors**, first check `dcupl app build --json` for `built:false`. If the reason is `"already up to date"` and a rebuild is genuinely staged, a second `build` will surface it; otherwise the records you expected aren't actually being produced — don't rebuild reflexively.
- **`"built": false` is normal in steady state, not after `create --load`.** After the explicit post-`create` build, subsequent `build` calls report `built:false` with a `reason`: `"already up to date"` (no new changes staged) or `"nothing staged"` (you haven't upserted anything). Do not rebuild defensively on a `built:false` once the initial `create → build` sequence has run.
- **Large datasets OOM the daemon.** Error tracking materializes one record per problem cell — on a wide/sparse dataset that is millions of `UndefinedValue` records, and the second build is the heavy one. If the daemon crashes (`FATAL ERROR: Reached heap limit`) or `dcupl app status` reports `crashed`, raise `--max-memory`. If it still won't fit, recreate the daemon with `--quality false`: this gives a stable *structural* load (confirms the workspace parses and every row loads) but skips error tracking — a clean count is then your validation signal. (See dcupl/dcupl#178.) After a crash, `dcupl app logs --app <id>` tails the daemon's log file — useful when the process exited before printing the error.
- **`app create` has more knobs than shown here.** This recipe uses `--load`, `--app-key`, `--auto-serve`, `--max-memory`, `--json` — `--workspace` and `--lc-json` auto-resolve from `dcupl.config.json` inside a workspace. For other tuning (`--source`, `--clone`, `--cache`, `--logging-level`, `--logging-format`, `--max-body`, `--reference-metadata`, `--analytics`, `--auto-update`, `--quality`), see `dcupl app create --help`.
- **No `npm install` in the workspace** — the daemon ships its own `@dcupl/*`. `--auto-serve` hosts the workspace files so the loader can fetch them. Error tracking is on by default; nothing to enable.
- **Auto-spawned serves are ref-counted across daemons.** A serve spawned by `--auto-serve` survives until the *last* daemon using it is destroyed or idle-shuts-down, not when its first owner dies. So a second `dcupl app create --auto-serve` in the same workspace cheaply reuses the existing serve, and the serve cleans itself up once the last daemon goes. Use `dcupl serve list` to see what's running and `dcupl serve stop --port <p>` if you need to terminate one explicitly. A reachable serve hosting a *different* workspace is rejected via a `loaderHash` check and a fresh serve is spawned — so you don't silently attach to the wrong project.
- **The loader's CSV parser coerces values, and the resulting error type varies — sometimes there is no error at all.** Observed on `@dcupl/* 2.0.0-beta.5`: a non-numeric cell on a **key** column surfaces as `WrongDataType` (with `expected` / `rawValue` / `typeof` in `meta`); a cell `parseInt` can *partially* read (e.g. `"1.2 lbs"` → `1`, `"29.5 inches"` → `29`) is **silently coerced with NO error record** — lossy, watch for it (**version-specific**: a post-beta.5 change, dcupl#196, makes this lossy case emit a `WrongDataType` with `meta.lossy` instead — so on newer `@dcupl/*` it *is* reported; confirm against your installed version); a column that is entirely non-numeric may null every cell yet emit only a single aggregate `UndefinedAttribute` rather than one error per row. **Don't assume a specific error *type*** — query `$DcuplErrorTrackingErrors` to see what's actually present, and for numeric columns sanity-check the loaded values against the source (a clean error list does not prove the values weren't silently mangled).
- **For richer queries against the loaded app** — `fn aggregate` (requires a `--types` argument), `fn groupBy`, filters, sorting, pagination — it's the same daemon and the same `dcupl app` verbs documented in `references/querying.md`. Read that file for the full `fn` verb signatures rather than guessing.

## Multi-app slices — `applications[].resourceTags` + `--app-key`

A single workspace can expose **multiple apps**, each loading only a tagged subset of the resources. Use this when one project holds several conceptually distinct datasets (catalog vs sales, prod vs staging variants, …) and you want a daemon that holds only one slice at a time.

In `dcupl.lc.json`, declare each app under `applications[]` with the tags it should load, then tag each resource:

```json
{
  "applications": [
    { "key": "default", "name": "Default", "description": "All models" },
    { "key": "catalog", "name": "Catalog only", "resourceTags": ["catalog"] },
    { "key": "sales",   "name": "Sales only",   "resourceTags": ["sales"] }
  ],
  "resources": [
    { "type": "model", "url": "${baseUrl}/models/articles.dcupl.json",  "tags": ["catalog"] },
    { "type": "data",  "model": "articles",  "url": "${baseUrl}/data/articles.csv",  "tags": ["catalog"] },
    { "type": "model", "url": "${baseUrl}/models/customers.dcupl.json", "tags": ["sales"] },
    { "type": "data",  "model": "customers", "url": "${baseUrl}/data/customers.csv", "tags": ["sales"] }
  ]
}
```

`default` here has no `resourceTags` — it loads everything. Sliced apps load only resources whose `tags[]` intersects their `resourceTags[]`.

To spin up one slice, pass `--app-key`:

```bash
# Catalog only — loads articles + vendors
dcupl app create --app catalog --load --app-key catalog --auto-serve --max-memory 4096 --json

# Sales only — loads customers + orders
dcupl app create --app sales --load --app-key sales --auto-serve --max-memory 4096 --json
```

Each slice gets its own daemon (and its own `--app <id>` for downstream commands). Apps reuse the same `--auto-serve` host across daemons (ref-counted), so a second slice is cheap to spin up. The full `ApplicationConfiguration` shape (`key`, `name`, `description`, `resourceTags`, `variables`, …) is in `dcupl schemas get AppLoaderConfiguration`.

## Project setup

- `dcupl init` (alias `dcupl new`) scaffolds a project from a starter template (`--starter`):
  - **`minimal`** — sample model + data files and an example `dcupl.lc.json`.
  - **`empty`** — empty `data`/`models`/`workflows`/`api` folders and a bare `dcupl.lc.json` (no sample resources).
  - **`existing`** (`existing console project`) — bootstraps from an existing dcupl console project (prompts for project, pulls files via the sync engine, writes config). Passing `--project-id <id>` skips the starter prompt and assumes this flow.
  - By default `dcupl init` creates a new subfolder (`--name <folder>`, or a bare positional: `dcupl init <folder>`).
  - To scaffold **into the current directory** instead, use `dcupl init --here` or `dcupl init .` — useful when a folder already holds data files you want to turn into a workspace. In this mode pre-existing files are never overwritten (an existing `.gitignore` is kept as-is), and it refuses if the directory already contains a `dcupl.config.json`. **Prefer `--starter empty` with `--here`** — `minimal` would drop sample files the user then has to delete.
- `dcupl generate <type>` scaffolds one of (exact choices, CLI 1.3.4): `model`, `script`, `transformer`, `operator`, `typescript`, `json-schema`, `test-setup`, `test`, `test-config`. (Note: it's `typescript`/`json-schema`, NOT `type`/`schema`. `generate model --from <data file>` infers a model from CSV/JSON — see `references/model-authoring.md`.) **Caveat:** several `generate` subcommands are interactive and crash with a raw `ExitPromptError` stack trace in non-TTY/agent contexts (e.g. `generate test` has a prompt with no backing flag); and `--json` is currently ignored by `generate` and `config get` — they still print human output.
- `dcupl serve` runs a local dev server (NestJS + Express, default port 8083). It is a managed resource: list every running serve (manual or `--auto-serve`-spawned) with `dcupl serve list`, and stop one with `dcupl serve stop --port <p>`. `dcupl app list` also shows which serve each daemon is talking to (SERVE column).

For exact options, prefer `dcupl <command> --help` over guessing.

## Important notes

Standalone rules that don't belong to one workflow but apply across the skill.

### Data is not edited by hand

dcupl data should normally **not** be altered manually. Invalid, messy, or unnormalized data should flow through a **deterministic data workflow** so the transformation stays repeatable and reviewable. If you spot data that needs fixing or normalizing, suggest creating such a workflow in the dcupl console rather than editing the file. Only if the user insists may you alter data in place or create a "fixed" variant. If you do create a fixed variant, ask the user whether you should document the fixes in a separate `.md` file — so the workflow can be built from it afterwards.

### Keying data resources — `keyProperty` collisions are detected, but data is still lost

A `type: data` resource may set `options.keyProperty` to key records by a column. **dcupl detects key collisions and reports them in two places**: `dcupl app build --json` returns a top-level `collisions[]` array (`{ model, keyProperty, duplicateCount }`) summarizing duplicates per model, and `$DcuplErrorTrackingErrors` carries a `NonUniqueKey` record for each duplicated key. **The data loss is still last-wins**: colliding rows overwrite each other, and the dropped rows are not preserved. Before choosing a `keyProperty`, verify the column is genuinely unique: facet it, or compare the loaded record count to the input row count.

`keyProperty` accepts a string for a single column (`keyProperty: 'ID'`) or a non-empty array for a composite key (`keyProperty: ['ID', 'Language']`). Composite parts are joined into the internal `.key` with `keyPropertySeparator` (default `'::'`, configurable per resource/container/model). Each part is stringified via `String(value)`, so `null`/`undefined`/`''` produce distinct keys. Multi-variant data — one row per ID per language/region — is the canonical case for composite keys. If even the composite isn't unique, fall back to `autoGenerateKey: true` (random keys, all rows kept) or a transformer.

Composite-key support is available in `@dcupl/* 2.0.0-beta.5+`. **Caveat:** set `keyProperty` either on the model OR on the data resource, never both — duplicate declarations are silently applied twice and produce malformed keys (e.g. `"100::Foo::Foo"` instead of `"100::Foo"`).

### Model & data errors — `$DcuplErrorTrackingErrors`

When error tracking is enabled, the internal Model `$DcuplErrorTrackingErrors` collects every error a Model or its Data may have. When diagnosing model/data problems, query this Model to see which errors are actually present rather than guessing. Each record carries `type`, `errorGroup`, `errorType`, `title`, and (where relevant) `model`, `itemKey`, `attribute`, `description`, `meta`. See **Validate a workspace** above for the exact commands to load a workspace and query this Model.

The error taxonomy lives in the SDK at `@dcupl/common` → `QualityAnalyzer` (`packages/common/src/types/quality.types.ts`). As of `@dcupl/*` 2.0.0-beta.x:

- **Model errors** (`type: 'model'`)
  - groups: `ReferenceDataError`, `PropertyDataError`, `DataContainerError`, `ModelDefinitionError`
  - types: `UndefinedAttribute`, `InvalidValidator`, `UndefinedValue`, `NullValue`, `WrongDataType`, `NonUniqueKey`, `MissingModel`, `MissingProperty`, `MissingReference`, `UnknownExpressionVariable`, `RemoteReferenceKeyNotFound`, `InvalidModelDefinition`, `UnknownColumn` (a CSV column present in the data but not declared on the model; its values are silently dropped)
- **Loader errors** (`type: 'loader'`)
  - groups: `LoaderConfigError`, `ResourceError`
  - types: `InvalidConfig`, `InvalidResource`

This list tracks the bundled `@dcupl/common` version. Confirm the version actually resolved by the project with `dcupl version`; if it differs, re-check `quality.types.ts` in the project's `node_modules`.

## When to flag back to the user

- The user asks you to author a workflow and the existing files are v2.
- `dcupl schemas list` returns nothing or errors — likely the user isn't inside a project that has `@dcupl/*` installed; ask.
- A schema referenced in the user's files isn't in `dcupl schemas list` — flag a possible version mismatch.

## Commands to ignore

- **`dcupl test`** — registered in the CLI as "[experimental] Run generic tests" but its handler is currently a no-op stub. The command exits silently with no effect. Don't suggest it for anything; flag it as not-yet-implemented if the user asks.
