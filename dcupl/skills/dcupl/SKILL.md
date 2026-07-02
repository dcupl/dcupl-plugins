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
- **Version it in git.** A dcupl workspace is source — models, loader config, workflows, and data all benefit from history. If the workspace isn't a git repo (`git rev-parse --is-inside-work-tree` fails), suggest `git init` before you start changing things, so the user can review and roll back. See "Wrapping up every turn" for committing as you go.

## Then: confirm the CLI version is ≥ 1.4.0-beta.0

This skill is written and verified against **`@dcupl/cli` 1.4.0-beta.1** (`@dcupl/* 2.0.0-beta.7`). That's the assumed floor — bump it once dcupl leaves beta. A workspace often pins an older `@dcupl/cli` in `node_modules` that lags the user's global `dcupl`, and older CLIs lack newer subcommands/flags (and some pre-1.3.4 versions silently exit 0 on an unknown subcommand rather than erroring — success-looking no-ops). So check what you're actually running before relying on any recipe here:

```bash
dcupl --version          # what's on PATH (typically the global install)
npx dcupl --version      # what the project's node_modules resolves
```

- **Both current** → either works. Prefer bare `dcupl` to keep commands short.
- **Only the global is current** → use bare `dcupl`, NOT `npx dcupl`. The repo's `package.json` scripts (e.g. `npm run serve`) still hit the older local CLI — fine for `dcupl serve`, not for `dcupl app`.
- **Both old** → tell the user; recommend `npm i -g @dcupl/cli@latest` (or upgrading the workspace dependency). Don't try to work around it.

Unknown flags and subcommands on a current CLI fail loudly — `dcupl app query execute --queries …` returns `{"code":"UNKNOWN_OPTION", …}`, usually with a "Did you mean --query?" hint — so a mistyped flag errors rather than silently returning unfiltered data. If a command instead does nothing and exits 0, suspect an old CLI and re-check the version.

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
| Adding quality rules / validators to a model (ask the user how restrictive first) | `references/model-authoring.md` → "Quality rules & validators" |
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

> ⚠️ `--example` only appends a curated example for a subset of schemas — `ModelDefinition`, `AppLoaderConfiguration`, `TemplateV3`, `WorkflowConfigV3`, and some workflow-node configs (e.g. `ScriptStepConfig`). For others (`DcuplCliConfig`, `Property`, `Reference`, `WorkflowVariable`) `--example` is a silent no-op that just prints the type/source. Don't rely on it for those.
>
> ⚠️ **Treat curated examples as shape guidance, not gospel — when an example and the schema disagree, the schema wins.** Examples have historically drifted from the live API (dcupl-cli#145); if one shows a field or sandbox global that the schema (or a reference file here) doesn't, trust the schema.

Schemas come from the project's installed `@dcupl/*` packages, so the output reflects the version actually in use. Confirm the live version with `dcupl version` if you suspect a mismatch.

**Reach for `dcupl schemas get <Type>` whenever you're stuck.** It's the highest-leverage diagnostic in the skill — in fresh-user testing it was the single most valuable escape hatch, used to discover undocumented config fields and resolve ambiguous shapes when docs were silent or wrong:

- `dcupl schemas get DcuplCliConfig` — what fields belong in `dcupl.config.json` (`consoleApiUrl`, `projectId`, paths, …)
- `dcupl schemas get AppLoaderConfiguration --example` — `dcupl.lc.json` shape, including the **Resource union** — data-resource `keyProperty` / `autoGenerateKey` / `csvParserOptions` live HERE, not in a standalone schema — plus `applications[].resourceTags`, `variables`, etc.
- `dcupl schemas get Reference` — `singleValued` / `multiValued` / `derive` / grouped references
- `dcupl schemas get ModelDefinition --example` — full property/reference/quality shape
- `dcupl schemas get AttributeQualityConfig --example` / `ModelQualityConfig` — quality flags & validators; per-attribute vs model-level split (standalone entries since CLI 1.4.0-beta.1)

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
- Key values are coerced at join time: a numeric-string FK (e.g. orders.json `customerId: "65"`) **resolves correctly** against an `int`-keyed model. A **basic** reference only "misses" when the key genuinely doesn't exist in the remote model, and that miss is **reported** as `RemoteReferenceKeyNotFound` (with `meta.remoteModel` / `meta.remoteKey` on the `$DcuplErrorTrackingErrors` record), not swallowed silently. So most `RemoteReferenceKeyNotFound` errors are real dangling references, not type mismatches. (Resolved refs show `_dcupl_ref_: "hit"`; dangling ones `"miss"`.) **QueryReference misses are NOT reported** — see the composite-key section below.
- `derive: { localReference, remoteReference }` pulls a value across an existing Reference — it does NOT declare the relationship itself.
- There is **no declarative composite FK**. To reference INTO a composite-keyed model, use a **QueryReference** (a `query` with `${localColumn}` templates, evaluated per row) — full pattern + traps in `references/model-authoring.md` → "Composite keys — referencing INTO a composite-keyed model".
- Validate after changes: see "Validate a workspace" below; check `$DcuplErrorTrackingErrors` for `RemoteReferenceKeyNotFound` / `MissingReference`.

A CSV (or JSON/NDJSON) data file can be wired straight into `dcupl.lc.json` as a `type: data` resource bound to a model — there is no need to convert it to JSON first. The loader parses the file and types its columns from the model definition.

### Workflows v3 — important version warning

`@dcupl/common-internal` exports both a legacy v2 workflow type (`Workflow.Template` namespace, with `trigger[]` and `steps[]` arrays) and the v3 schemas (`WorkflowConfigV3`, `TemplateV3`, with unified `nodes[]` and `edges[]`). **Always author against v3.** Do not produce v2 templates. If the user's existing files look like v2, flag it and ask before extending them.

To **author, build, validate, test, or deploy** a workflow, read `references/workflows.md`. Beyond the CLI loop it documents the parts schemas don't cover and that are easy to get wrong: how data flows between nodes, the `script` node sandbox (its `_csv`/`_json`/… helpers — note bare `csvToJson` does NOT exist), `dcupl-files` read/write output shapes and the project-workflow `apiKey`, the must-`push`-before-`deploy` rule, and how to debug a failing run by triggering the runner directly. Per-node config schemas live in `dcupl schemas` under the group "Workflow Nodes": `dcupl schemas list`, then `dcupl schemas get <NodeTypeConfig> [--example]` before authoring a node's `config`. **Fastest start: copy a workflow already deployed in the project** via `dcupl files read --path workflows/<x>.workflow-v3.json`.

## Validate a workspace

After authoring or changing a model, loader config, or data file, confirm the workspace actually loads. **`dcupl serve` does not validate** — it only serves the workspace files over HTTP; it never parses models or loads data, so a green `serve` says nothing about correctness.

**Validate before AND after you change anything.** Run `dcupl validate` (with `--app-key <key>` when the workspace has multiple app slices — see "Multi-app slices") *before* touching models/loader/data to capture a baseline, and again *after*. Comparing the two reports is what tells you whether your change fixed something, broke something, or merely shifted the error counts — a single after-the-fact run can't distinguish "this error was already here" from "I just introduced it." Once validate is clean (or no worse than baseline), **start the app locally and probe your actual change** with `dcupl app` queries / `fn` commands (see `references/querying.md`) — validate confirms the project *loads*, but only a real query confirms your model/data behaves the way you intended.

`dcupl validate` is the one-shot check: it loads the whole project through its loader in an ephemeral daemon, classifies what the loader + parser found, and tears everything (daemon + any auto-spawned serve) back down. Run from the workspace root:

```bash
dcupl validate --json
# remote console project instead of a local workspace:
dcupl validate --source remote --project-id <id> --api-key <key> --json
```

Requires a CLI new enough to include the command — run `dcupl validate --help` to confirm. On an older CLI, fall back to the manual daemon sequence: `dcupl app create --load --auto-serve` → `dcupl app build` → `dcupl app query execute --model '$DcuplErrorTrackingErrors'` → `dcupl app destroy` (quote `'$DcuplErrorTrackingErrors'` so the shell doesn't eat it).

**It's a report, not a gate.** `dcupl validate` exits `0` whenever it produced a report — *including a project that fails to load* (rendered as `Load FAILED — <reason>`; `load.ok:false` in JSON). A non-zero exit means validate itself couldn't run (e.g. the daemon wouldn't spawn), NOT that your project has errors. **Parse the JSON to decide pass/fail — don't rely on `$?`.**

The JSON shape: `{ ok, source, load:{ok,error?}, models:{total,empty[],autoGenerated[]}, errors:{ total, bySeverity:{critical,warning}, byGroup, byType, records[] }, summary:{critical,warnings} }`.
- **`load.ok:false`** → the workspace didn't load at all (bad lc.json, unreachable resource, fatal parse). Fix this first; the other signals are empty/unreliable until it loads.
- **`summary.critical`** = structural problems: `ModelDefinitionError` (a model is broken) + `ResourceError` (a resource didn't load). These are the ones that actually need fixing.
- **`summary.warnings`** = data-level findings: `ReferenceDataError` (dangling cross-model refs), `PropertyDataError` / `DataContainerError` (value/type nits). Frequently intentional — the running app resolves refs once more data loads — so a healthy project commonly still shows some. **Severity is the CLI's own classification (`ModelDefinitionError`/`ResourceError` = critical, the rest = warning, unknown groups = critical); the SDK emits no severity.**
- **`models.empty`** = defined models that loaded zero records (usually a wrong path or a resource that didn't load). **`models.autoGenerated`** = models whose schema was inferred rather than declared — intentional, or a symptom of a declared model file that didn't load.
- **`errors.records`** = capped at `--limit` (default 10); each names `model`, `attribute`, `errorGroup`, `errorType`, `title`. Counts (`byGroup`/`byType`) are always full; only the record list is capped. For the full taxonomy see "Model & data errors" below.

A `summary` of all zeros with `load.ok:true` and empty `models.empty`/`autoGenerated` is a clean workspace.

Notes:
- **Layout / `--auto-serve`.** For a local workspace, validate auto-spawns a throwaway `dcupl serve` (on by default; `--no-auto-serve` to opt out) and cleans it up afterward. `dcupl serve` roots its static files at `./dcupl/`, so this assumes `dcupl.lc.json` lives under `dcupl/`. For a **flat** layout (lc.json at the project root), `--auto-serve` spawns a serve rooted at `./dcupl/` and every loader fetch 404s (failing with a misleading `serve did not become reachable` / `applicationKey default does not exist`). Either move files under `dcupl/` (conventional), or start serve yourself first (`dcupl serve .`) and run `dcupl validate --no-auto-serve --lc-json dcupl.lc.json`. Inside a workspace, `--lc-json` otherwise auto-resolves from `dcupl.config.json`'s `loaderPath`.
- **Multi-app slices.** Pass `--app-key <key>` (and `--env` / `--tag` / `--var`) to validate one application slice's resource set — same flags as the daemon's process step. See "Multi-app slices" below.
- **Large datasets can OOM the internal daemon — raise the heap or skip error tracking with `dcupl validate --max-memory <MB>` / `--quality false`** (added in dcupl-cli#154, both passed through to the daemon). Error tracking materializes one record per problem cell — a wide/sparse dataset is millions of records and the build is heavy; if it crashes (`FATAL ERROR: Reached heap limit`), re-run with `dcupl validate --max-memory <MB>` to raise the heap. `--quality false` gives a structural-only load (parses + counts every row, skips error tracking) — a clean run is then your validation signal. (For ad-hoc digging you can still drop to the manual daemon `dcupl app create --load --auto-serve --max-memory <MB> [--quality false] …` and query `$DcuplErrorTrackingErrors`; see `dcupl app create --help` / `references/querying.md`. Background: dcupl/dcupl#178.)
- **Self-cleaning.** Every run tears down its own daemon and auto-serve; confirm nothing leaked with `dcupl app list` (`[]`). No `npm install` needed — the daemon ships its own `@dcupl/*`; error tracking is on by default.
- **The loader's CSV parser coerces values, and the resulting error type varies — sometimes there is no error at all.** A non-numeric cell on a **key** column surfaces as `WrongDataType` (with `expected` / `rawValue` / `typeof` in `meta`); a cell `parseInt` can *partially* read (e.g. `"12.5 kg"` → `12`, `"29.5 inches"` → `29`) is **silently coerced with NO error record** (the planned fix — `WrongDataType` + `meta.lossy` — is tracked in dcupl#196 / dcupl#203 and had not landed at the floor version). Likewise, an **empty cell in a numeric (`int`/`float`) column is silently dropped with no error record**, while the same empty cell in a `string` column IS reported as `UndefinedValue` — reporting coverage depends on the declared type. A column that is entirely non-numeric may null every cell yet emit only a single aggregate `UndefinedAttribute` rather than one error per row. **Don't assume a specific error *type*** — read the `errors` breakdown to see what's actually present, and for numeric columns sanity-check the loaded values against the source (a clean error list does NOT prove numeric values weren't silently mangled or dropped — start a daemon and probe with `isTruthy:false`, comparing aggregate counts).
- **For richer queries against the loaded app** — `fn aggregate` (requires a `--types` argument), `fn groupBy`, filters, sorting, pagination — `dcupl validate` is a one-shot report and leaves no daemon behind; start one with `dcupl app create --load` and use the `dcupl app` verbs documented in `references/querying.md`. Read that file for the full `fn` verb signatures rather than guessing.

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
  - **`existing`** (`existing console project`) — bootstraps from an existing dcupl console project (prompts for project, pulls files via the sync engine, writes config). Passing `--project-id <id>` skips the starter prompt and assumes this flow. For a fully non-interactive bootstrap pass **both** `--project-id <id>` and `--api-key <key>` (the key is written to the gitignored `dcupl.secrets.json`). `init --json` works, but its JSON result does not list the pulled files — run `dcupl files status` / `dcupl files list` afterwards to see what arrived.
  - By default `dcupl init` creates a new subfolder (`--name <folder>`, or a bare positional: `dcupl init <folder>`).
  - To scaffold **into the current directory** instead, use `dcupl init --here` or `dcupl init .` — useful when a folder already holds data files you want to turn into a workspace. In this mode pre-existing files are never overwritten (an existing `.gitignore` is kept as-is), and it refuses if the directory already contains a `dcupl.config.json`. **Prefer `--starter empty` with `--here`** — `minimal` would drop sample files the user then has to delete.
- `dcupl generate <type>` scaffolds one of (exact choices): `model`, `script`, `transformer`, `operator`, `typescript`, `json-schema`, `test-setup`, `test`, `test-config`. (Note: it's `typescript`/`json-schema`, NOT `type`/`schema`. `generate model --from <data file>` infers a model from CSV/JSON — see `references/model-authoring.md`.) **Caveat:** several `generate` subcommands are interactive and crash with a raw `ExitPromptError` stack trace in non-TTY/agent contexts (e.g. `generate test` has a prompt with no backing flag). But `generate model --from … --json` works well — it emits structured JSON including a `diagnostics[]` array (`inferredType`, `observedTypes`, `conflict`, `emptyRate` per column) and the chosen `keyStrategy` (it detects duplicate-key columns and falls back to `autoGenerateKey`); when scripting, read that JSON rather than re-parsing the file. `config get --json` also works (apiKey redacted). Only `config set` still ignores `--json` and prints human output.
- `dcupl serve` runs a local dev server (NestJS + Express, default port 8083). It is a managed resource: list every running serve (manual or `--auto-serve`-spawned) with `dcupl serve list`, and stop one with `dcupl serve stop --port <p>`. `dcupl app list` also shows which serve each daemon is talking to (SERVE column).

For exact options, prefer `dcupl <command> --help` over guessing.

## Important notes

Standalone rules that don't belong to one workflow but apply across the skill.

### Wrapping up every turn

These apply to **every** dcupl interaction — they're how you close out a turn so the user stays oriented and in control:

- **Summarize the CLI commands you ran.** If a task required `dcupl` commands, end your response with a short, copy-pasteable list of the key commands (in order, with placeholders filled in). The user should be able to read it and understand — and recreate — exactly what happened, without re-reading the whole transcript. Skip this only for pure conversation where you ran nothing.
- **End with meaningful follow-up questions.** Close by asking one or two concrete next steps phrased as questions the user can just say yes to — *"Want me to break this down by region too?"*, *"Should I wire this model into `dcupl.lc.json` and validate?"*, *"Ready to deploy this to the dev runner?"*. Make them specific to the data/task at hand, not generic ("let me know if you need anything"). Good follow-ups help the user discover what dcupl can do and surface insights they hadn't thought to ask for.
- **Suggest committing meaningful changes.** If you created or changed something worth keeping — a model, loader config, workflow, or a documented data fix — and the workspace is under git, offer to commit it with a clear message (or remind the user to). Don't commit unprompted; surface it as the natural next step. If the workspace isn't versioned yet, suggest `git init` first (see "Orient first").

### Data is not edited by hand

dcupl data should normally **not** be altered manually. Invalid, messy, or unnormalized data should flow through a **deterministic data workflow** so the transformation stays repeatable and reviewable. If you spot data that needs fixing or normalizing, suggest creating such a workflow in the dcupl console rather than editing the file. Only if the user insists may you alter data in place or create a "fixed" variant. If you do create a fixed variant, ask the user whether you should document the fixes in a separate `.md` file — so the workflow can be built from it afterwards.

### Keying data resources — `keyProperty` collisions are detected, but data is still lost

A `type: data` resource may set `options.keyProperty` to key records by a column. **dcupl detects key collisions and reports them in two places**: `dcupl app build --json` returns a top-level `collisions[]` array (`{ model, keyProperty, duplicateCount }`) summarizing duplicates per model, and `$DcuplErrorTrackingErrors` carries a `NonUniqueKey` record for each duplicated key. **The data loss is still last-wins**: colliding rows overwrite each other, and the dropped rows are not preserved. Before choosing a `keyProperty`, verify the column is genuinely unique: facet it, or compare the loaded record count to the input row count.

`keyProperty` accepts a string for a single column (`keyProperty: 'ID'`) or a non-empty array for a composite key (`keyProperty: ['ID', 'Language']`). Composite parts are joined into the internal `.key` with `keyPropertySeparator` (default `'::'`, configurable per resource/container/model). Each part is stringified via `String(value)`, so `null`/`undefined`/`''` produce distinct keys. Multi-variant data — one row per ID per language/region — is the canonical case for composite keys. If even the composite isn't unique, fall back to `autoGenerateKey: true` (random keys, all rows kept) or a transformer.

Prefer declaring `keyProperty` in **one place** — either the model or the data resource — for clarity about where the key comes from.

### Model & data errors — `$DcuplErrorTrackingErrors`

When error tracking is enabled, the internal Model `$DcuplErrorTrackingErrors` collects every error a Model or its Data may have. When diagnosing model/data problems, query this Model to see which errors are actually present rather than guessing. Each record carries `type`, `errorGroup`, `errorType`, `title`, and (where relevant) `model`, `itemKey`, `attribute`, `description`, `meta`.

> ⚠️ **Record cap.** The model stores at most **1000 records per error group** (`maxErrorsPerGroup`, an OOM guard) — and both `query execute` and `fn facets` against it present the capped number as if it were the total: a workspace with 44k identical errors facets as `count: 1000`. Treat any group sitting at exactly 1000 as "1000 **or more**" and quantify the real extent with a direct probe on the affected model (e.g. `fn metadata --query '{"operator":"isTruthy","attribute":"<attr>","value":false}'`). Tracked in dcupl#204. See **Validate a workspace** above for the exact commands to load a workspace and query this Model.

The error taxonomy lives in the SDK at `@dcupl/common` → `QualityAnalyzer` (`packages/common/src/types/quality.types.ts`):

- **Model errors** (`type: 'model'`)
  - groups: `ReferenceDataError`, `PropertyDataError`, `DataContainerError`, `ModelDefinitionError`
  - types: `UndefinedAttribute`, `InvalidValidator` (a quality validator failed — `loose` handling kept the value, `strict` dropped it), `UndefinedValue`, `NullValue`, `WrongDataType`, `NonUniqueKey`, `MissingModel`, `MissingProperty`, `MissingReference`, `UnknownExpressionVariable`, `RemoteReferenceKeyNotFound`, `InvalidModelDefinition`, `UnknownColumn` (a CSV column present in the data but not declared on the model; its values are silently dropped)
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
