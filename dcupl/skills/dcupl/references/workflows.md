# dcupl — Workflow v3 build / test / deploy

This reference covers the full loop: authoring a `TemplateV3` file, validating it locally and remotely, exercising it against a dev runner, and deploying to production.

> **Schema first.** Before authoring any node, run `dcupl schemas get <NodeTypeConfig>` to read the exact field names. The schema is the source of truth for `config` field names — do not guess from memory.

> **Start from a real example, and distrust prose docs.** The fastest, least error-prone way to author a v3 workflow is to copy one already working *in this project*: `dcupl files list`, then `dcupl files read --path workflows/<existing>.workflow-v3.json`. That gives you exact node shapes, a valid `apiKey`, and templating that is known to run on the runner — far more reliable than building from scratch. `dcupl schemas get <X> [--example]` is authoritative for `config` field *names*, but it does NOT describe runtime behavior (how data flows between nodes, the script sandbox API, what a node emits) — for that, read "Authoring node logic" below. Do **not** trust `dcupl-internal/docs/reference/workflow-nodes.md`: it is stale and contradicts the live schema (wrong `dcupl-files` shape, response types that don't exist).

---

## Node-type catalog

| `type` in JSON | Config schema | Schema command | Purpose |
|---|---|---|---|
| `trigger-request` | `TriggerRequestConfig` | `dcupl schemas get TriggerRequestConfig --example` | HTTP trigger: `path`, `methods[]`, optional `auth`. |
| `trigger-cron` | `TriggerCronConfig` | `dcupl schemas get TriggerCronConfig` | Cron trigger: `cronTime` (cron expression), optional `timezone`. |
| `request` | `RequestStepConfig` | `dcupl schemas get RequestStepConfig --example` | Outbound HTTP call: url, method, body, headers, autoParse, responseType. |
| `script` | `ScriptStepConfig` | `dcupl schemas get ScriptStepConfig --example` | User code in isolated sandbox. Config field is **`script`** (a string of code). |
| `data-mapper` | `DataMapperStepConfig` | `dcupl schemas get DataMapperStepConfig --example` | Field-mapping: origin→target mappings, optional model. |
| `dcupl-instance` | `DcuplInstanceStepConfig` | `dcupl schemas get DcuplInstanceStepConfig` | Loads a dcupl instance for in-workflow querying. |
| `dcupl-files` | `DcuplFilesStepConfig` | `dcupl schemas get DcuplFilesStepConfig` | Read/write files in dcupl cloud storage. |
| `s3-files` | `S3FilesStepConfig` | `dcupl schemas get S3FilesStepConfig` | Read/write objects in an S3 bucket. |
| `azure-files` | `AzureFilesStepConfig` | `dcupl schemas get AzureFilesStepConfig` | Read/write blobs in Azure storage. |
| `git-files` | `GitFilesStepConfig` | `dcupl schemas get GitFilesStepConfig` | Read/write files in a git repository. |
| `response-script` | `ResponseScriptConfig` | `dcupl schemas get ResponseScriptConfig --example` | Code shaping the HTTP response. Config field is **`script`** (a string of code). |
| `response-status` | `ResponseStatusConfig` | `dcupl schemas get ResponseStatusConfig` | Derive HTTP status from workflow completion state. **Config is an empty object `{}`** — no fields. |

To see the discriminated-union of all node shapes in one place: `dcupl schemas get WorkflowNode`.

> **Critical field names:**
> - `script` and `response-script` nodes: the code field is **`script`**, NOT `code`.
> - `response-status` nodes: `config` must be `{}` — the HTTP status is derived from completion state; there are no configurable fields.
> - `trigger-cron`: `cronTime` (not `cron`, not `expression`) + optional `timezone`.

---

## Authoring node logic — data flow, the script sandbox, and `dcupl-files`

`dcupl schemas get` gives you the *shape* of a node's `config`, but not how data moves between nodes at runtime or what a node actually emits. That runtime model is where most authoring time is lost — none of it is in the schemas, so it's documented here.

### How data flows between nodes

Every step receives an array of **items**, each `{ json: {...} }`, and emits the same shape on an output port. Edges wire one node's output port to the next node's input port (usually `main`). You reach incoming data two ways:

- **Inside a `script` node:** the input is exposed through `$json` — `$json.first()` is the first input item's `json`, `$json.last()` the last, `$json.at(i)` the i-th (see fan-in below). `$json` exposes only `first` / `last` / `at` / `fromPort` — there is **no** global `items` array and **no** `$json.all()` (both are `undefined`; verified on `@dcupl/* 2.0.0-beta.5`).
- **Inside config string fields** (`request.url`, `dcupl-files` path/content, …): template expressions, evaluated against the first input item:
  - `{{$json.field}}` — one field of the incoming json (coerced to string)
  - `{{$json}}` — the entire incoming json, stringified
  - `{{variables.name}}` — a workflow/global variable
  - `{{request.field}}` — data from the triggering HTTP request

A node's output json becomes the next node's `{{$json}}`. To pass a value downstream, `return` it from a script under a known key, then reference `{{$json.thatKey}}`.

#### Each node sees only its immediate predecessor — fan in to combine

Output does **not** accumulate down the chain. A node reads only what its incoming edge(s) deliver — there is no way to reach back to an earlier node (no `$node`, no `$('name')`, no merged history). Two consequences to plan around:

- **Some step nodes replace the json wholesale.** A `dcupl-files` node emits `{ files: [...], ok }` and drops every upstream key — so a `report` your cleaning script built two nodes back is *gone* by the time a later node runs. (Verified: a script returning `{csv, report}` followed by a `dcupl-files` write yields just `{files, ok}` downstream.)
- **To combine outputs from non-adjacent nodes, fan in.** Wire an edge from *each* source node into the same target node. The target then receives an ordered multi-input collection — `$json.at(0)`, `$json.at(1)`, … in **`edges[]` declaration order** (also `.first()` / `.last()`). Since the order is positional, it's more robust to pick each input **by shape** than by index:

```js
// response node fed by BOTH the dcupl-files write node AND the cleaning script
const a = $json.at(0), b = $json.at(1);
const write  = (a && a.files)  ? a : b;   // the write output  { files, ok }
const report = (a && a.report) ? a : b;   // the script's      { report, ... }
return { status: 200, body: { ok: write.ok, written: write.files, report: report.report } };
```

Fan-in is the **only** way to surface a value (a report, a row count, the original request) past a node that rewrites the json — there is no global accumulator to fall back on.

### The `script` node sandbox

Script runs in an isolated VM — not plain Node. The available globals are a curated set:

- **I/O:** `$json.first()` / `$json.last()` / `$json.at(i)` (and `$items()` for the full input array); `return value` → `main` port; `throw new Error(...)` → `error` port; `return _output.route({ portA: [...], portB: [...] })` for explicit multi-port routing.
- **Helpers are namespaced** (this is the part that surprises people — they are NOT bare functions):
  - `_csv` — `toJSON(csvString)`, `fromJSON(rows, { headers, delimiter })`, `headers(csv)`, `validate(...)`. `toJSON` parses (handles quoting/escaping); `fromJSON` serializes (escapes fields; pass an explicit `headers` array to fix column order or drop columns).
  - `_json` — `distinct`, `groupBy`, `flatten`, `merge`, `pick`, `omit`
  - `_array` — `chunk`, `unique`, `flatten`, `groupBy`, `sortBy`, `sum`, `avg`
  - `_string` — `slugify`, `camelCase`, `snakeCase`, `template`, `toBase64`
  - `_datetime`, `_output`, `_object`, `_xml` — also available. (The `_http` and `_crypto` namespaces exist but are **blocked** — they throw on use.)
- **Plus:** `console` (note: `console.log` output is only captured when the run is triggered with `?dataTrace=true` — on a normal run it's a no-op), `Math`, `Date`, `JSON`. **HTTP is blocked inside script nodes** (no `fetch`; `_http.*` throws) — to make an outbound HTTP call use a `request` node. No filesystem; use file nodes for I/O.

> ⚠️ **There is no bare `csvToJson` / `jsonToCsv`** — calling them throws `ReferenceError: csvToJson is not defined`. Use `_csv.toJSON` / `_csv.fromJSON`. (You may find bare names in the runner source under `runner-instance-api/workers` — that's a *different*, non-v3 path. The live v3 node executor injects the `_`-namespaced helpers from `libs/process-isolation`. Trust the namespaced ones.)

When in doubt about a helper, plain JS in the script always works (the data is yours to parse) — but `_csv`/`_json` are more robust (correct escaping) and worth preferring.

### `dcupl-files` — read/write cloud files

Config (per `dcupl schemas get DcuplFilesStepConfig`) is `{ auth: { apiKey }, version, files: [ <entry> ] }`, each entry a discriminated union on `action`: `read | write | delete | move | copy`.

- **Paths are cloud paths** with the workspace `baseFolder` (e.g. `dcupl/`) stripped: local `dcupl/data/x.csv` is `data/x.csv`. Confirm with `dcupl files list`.
- **`version`** is the cloud version, normally `"draft"`.
- **`auth.apiKey` is a *project workflow* api-key UUID, NOT your CLI `dcupl.secrets.json` apiKey** (that's a console UUID for the sync API). It is an *identifier* (looks like `I92DyxNTHBRff3TmlEEO`), not the secret credential itself, so it is safe to write into the template and commit. **When authoring a `dcupl-files` node, ask the user for the api-key UUID** and write it straight into `auth.apiKey`. Do **not** ask for, or pass, an actual api-key value — only the UUID. The user can get it from the console's Global Workflow Variables or by reading an existing deployed workflow (`dcupl files read --path workflows/<x>.workflow-v3.json`) and reusing its key. **If the user can't supply a UUID, don't block** — leave `auth.apiKey` empty and tell them to set it on the node in the dcupl console. (A run that 403s on the files node almost always means a wrong/absent UUID.)

**Read output shape** (not in any schema): a read emits one item whose json is
```json
{ "files": [ { "action": "read", "path": "...", "ok": true, "status": 200, "data": "<file content>" } ], "ok": true }
```
So the content is at `$json.first().files[0].data` in the next script. A CSV file comes back as the raw CSV string → `_csv.toJSON(data)`. Be defensive (handle string vs already-parsed).

**Write**: a `write` entry's `content` is a string, usually templated from the prior script: `"content": "{{$json.csv}}"`. Most reliable pattern: build the exact output string in the script (`_csv.fromJSON(...)` or `JSON.stringify(...)`) and write that string — don't rely on the node to serialize an object for you. Each `write` also takes an optional `type` hint (`auto` | `json` | `csv` | `text`). Write emits the same `{ files: [...], ok }` shape, so a downstream `response-script` can report `$json.first().files`.

**Multiple files per node.** `files[]` is an array, so a single `dcupl-files` node can perform several ops at once — e.g. emit both a CSV and a JSON variant from one script's output. Have the script `return` one key per file and template each into its own entry:
```json
"files": [
  { "action": "write", "path": "data/articles.cleaned.csv",  "type": "csv",  "content": "{{$json.csv}}" },
  { "action": "write", "path": "data/articles.cleaned.json", "type": "json", "content": "{{$json.json}}" }
]
```
The node's output `files[]` then has one `{ action, path, ok, status }` entry per write. (The same applies to batching reads, deletes, moves, and copies in one node.)

### Worked skeleton — read a CSV, transform, write a variant

```
trigger-request → dcupl-files(read) → script(transform) → dcupl-files(write) → response-script
```
- **read:** `{ "action": "read", "path": "data/articles.csv" }`
- **script:** `const raw = $json.first().files[0].data; const rows = _csv.toJSON(raw); /* …transform… */ return { csv: _csv.fromJSON(rows, { headers }) };`
- **write:** `{ "action": "write", "path": "data/articles.cleaned.csv", "content": "{{$json.csv}}" }`
- **response:** `return { status: 200, body: { ok: $json.first().ok, written: $json.first().files } };`

### Canvas annotations — `ui.notes[]`

A `TemplateV3` can carry sticky notes in `ui.notes[]` (sibling of `ui.positions`, the node-position map). These are **editor-only annotations** — no runtime effect — but useful for documenting a workflow inline on the canvas. Each note:

```json
"ui": {
  "positions": { "trigger": { "x": 100, "y": 100 } },
  "notes": [
    {
      "id": "note-overview",
      "position": { "x": 100, "y": 260 },
      "size": { "width": 1400, "height": 170 },
      "content": "Plain-text note body, \\n for line breaks.",
      "color": "yellow"
    }
  ]
}
```

`color` is one of `yellow | blue | green | pink | gray | purple`. They survive `deploy` (the runner echoes them back), so **preserve `ui.notes` when round-tripping a template** you read with `dcupl files read`. Confirm the exact shape any time with `dcupl schemas get TemplateV3`.

---

## Build → validate → test → deploy loop

> **The reliable loop in practice: edit → `deploy` (to a reachable runner) → trigger via `curl`** (see "Debugging a failing run"). `dcupl workflow test` bundles deploy+trigger but is opaque on failure. Two gotchas: (1) a trigger fired in the same breath as `deploy` can still hit the *previous* deployment — the runner's swap lags the command returning, so if a fix seems ignored, re-trigger after a moment or re-deploy before concluding the code is wrong; (2) `deploy`/`test` send your local file, but they do NOT sync it to the console — run `dcupl files push` separately to keep the cloud copy current.

### 1. Author the workflow file

Start from the canonical `TemplateV3` example:

```bash
dcupl schemas get TemplateV3 --example
```

Write the result to `workflows/<key>.workflow-v3.json`. Convention: one file per workflow, filename matches the template `key`. Before authoring each node's `config`, read the relevant node config schema (catalog above) and the "Authoring node logic" section for runtime behavior. Better yet, start from a working workflow in the project (`dcupl files read --path workflows/<existing>.workflow-v3.json`) and adapt it.

**`deploy`/`test` read this local file directly** — no push is required for your code to ship — but they don't sync it to the console, so run `dcupl files push` to keep the cloud copy current. Be aware the runner's swap can lag a just-returned `deploy` (see Common mistakes).

### 2. Validate locally

```bash
dcupl workflow validate workflows/my-workflow.workflow-v3.json
```

Local validation checks: valid `TemplateV3` shape, node configs match their declared types, no structural errors. No network required, no credentials needed.

### 3. Validate remotely (optional but recommended before test/deploy)

```bash
# Discover available runners first:
dcupl workflow runners

# Remote validation adds: cycle detection, expression checks, feature-limit checks.
dcupl workflow validate workflows/my-workflow.workflow-v3.json --runner <runnerUid>
```

`--local-only` forces local-only even when a runner is given (useful in CI steps that can't reach the runner).

### 4. Find runner UIDs

```bash
dcupl workflow runners
```

Prints a table: `uid`, `runnerKey`, `type`, `url`. Pick a **dev runner** UID for the `test` command and a **production runner** UID for `deploy`. These are different runners — `test` is intentionally destructive (it overwrites the runner's current deployment), so never point it at a production runner.

### 5. Test — deploy to dev runner and exercise

> **Deploy-to-test reality:** `dcupl workflow test` deploys the workflow to the given runner before running it. There is no local executor, no draft state, and no sandbox mode. The console-api does not proxy full execution — the full run is triggered by calling the runner URL directly. **A live runner is required.**

#### Full-run (exercise the trigger-request path):

```bash
dcupl workflow test workflows/my-workflow.workflow-v3.json --runner <devRunnerUid>
```

This validates locally, deploys to the dev runner, then triggers the workflow via the trigger-request node's configured `path` and first `method`. The response and a per-node trace are printed.

#### Single-node test (exercise one node in isolation):

```bash
dcupl workflow test workflows/my-workflow.workflow-v3.json \
  --runner <devRunnerUid> \
  --node <nodeId> \
  --input input.json        # payload for the node under test
  # --state state.json      # optional: workflow state for context
```

`--node` routes to the console-api test-node endpoint, running just that node against the provided input without executing the full workflow.

#### Authenticate against an auth-protected trigger:

Use `--trigger-key <apiKey>` to pass the api-key the runner requires when the trigger is auth-protected. It is the credential sent to authenticate against that trigger — not a selector among triggers.

```bash
dcupl workflow test workflows/my-workflow.workflow-v3.json \
  --runner <devRunnerUid> \
  --trigger-key <apiKey>
```

### 6. Deploy to production

```bash
# Interactive (prompts for confirmation):
dcupl workflow deploy workflows/my-workflow.workflow-v3.json --runner <prodRunnerUid>

# Non-interactive / CI (skip confirm):
dcupl workflow deploy workflows/my-workflow.workflow-v3.json --runner <prodRunnerUid> --yes
```

`deploy` runs remote validation first, then prompts once before going live. Use `--yes` in CI pipelines.

### 7. Undeploy

```bash
# Get deployed workflow UIDs:
dcupl workflow runners   # to recall which runner hosts which workflow

# Undeploy by deployed workflow UID:
dcupl workflow undeploy <workflowUid>
# or skip confirm:
dcupl workflow undeploy <workflowUid> --yes
```

---

## Reading a trace

`dcupl workflow test` renders a per-node trace after each run. Each row shows:

- **Node id** and type
- **Status** — `ok` / `error` / `skipped`
- **Timing** — duration in ms
- **Console logs** — any `console.log` output from script nodes
- **Errors** — error message + stack if the node failed

A non-zero exit code is returned when any node errored. The command prints `PASS` / `FAIL` at the end.

For structured output (e.g. when driving from an agent or CI script), pass `--json`:

```bash
dcupl workflow test workflows/my-workflow.workflow-v3.json --runner <devRunnerUid> --json
```

The JSON result includes the full trace as a structured object — easier to parse than terminal output and unambiguous on pass/fail.

> ⚠️ **On failure, the CLI is often opaque.** When a run fails at the runner (bad script, auth, etc.), `dcupl workflow test` frequently prints only `Error: Request failed with status code 500` (or 403) with no per-node detail — the failure happened over HTTP and the CLI doesn't unwrap it. Don't try to debug from that line. Use the direct-trigger technique below.

---

## Debugging a failing run — trigger the runner directly

The CLI is good for validate/deploy but opaque on run failures. To see the **real per-node error**, deploy and then hit the runner URL directly with `?dataTrace=true`:

```bash
# 1. deploy to a reachable runner (a local one is ideal). deploy ships this local file;
#    `dcupl files push` only syncs the console copy — it's not required to deploy.
dcupl workflow deploy workflows/<key>.workflow-v3.json --runner <runnerUid> --yes

# 2. trigger the runner directly — dataTrace surfaces per-node errors
curl -s -X POST \
  'http://<runnerUrl>/v3/workflow/<projectId>-<key>/<triggerPath>?dataTrace=true' \
  -H 'Content-Type: application/json' -d '{}'
```

URL parts: `<runnerUrl>` from `dcupl workflow runners`; `<projectId>` from `dcupl.config.json`; `<key>` is the template key; `<triggerPath>` is the trigger-request node's `path` **without its leading slash**. A node failure returns exactly what you need:

```json
{"error":{"message":"csvToJson is not defined","errorType":"ReferenceError","nodeId":"clean"}}
```

and a success returns your `response-script` body. This **deploy → curl** loop is more reliable and more legible than `dcupl workflow test`, and works against any runner you can reach (including a local `http://localhost:3003`). Add `&async=true` for fire-and-forget.

---

## Dev vs production runner — the key distinction

| Runner role | Use with | Behaviour |
|---|---|---|
| Dev runner | `dcupl workflow test` | `test` overwrites the runner's current deployment on every run. Treat as ephemeral. |
| Production runner | `dcupl workflow deploy` | `deploy` is confirm-gated (`--yes` for CI). Do not point `test` here. |

Always run `dcupl workflow runners` to confirm UIDs before running `test` or `deploy`. There is no "dry-run" or draft state — every `test` is a live deploy on that runner.

This table is about *caution*, not a hard binding: `deploy` works to **any** runner, and deploying to a **dev** runner and then triggering it with `curl` (see "Debugging a failing run") is the recommended iterate loop — more legible than `test`. The rule that still holds firm: never point `test` (or a throwaway `deploy`) at a runner serving production.

---

## Syncing workflow files to the cloud

Workflow JSON files (`workflows/*.workflow-v3.json`) are plain project files. Sync them to the dcupl console using the standard `dcupl files` commands:

```bash
dcupl files status    # see what's changed
dcupl files push      # push local changes to the cloud
dcupl files pull      # pull cloud changes locally
```

See `references/cloud-sync.md` for the full file-sync reference.

---

## Common mistakes

- **Using `code` instead of `script`** in a script or response-script node config. The field is always `script`.
- **Setting fields on `response-status` config.** The config must be `{}`. Status is derived from workflow completion; any fields are ignored or cause a validation error.
- **Pointing `test` at a production runner.** `test` deploys unconditionally. Use a dedicated dev runner.
- **Running `test` without `--runner`.** Remote test requires a runner UID — there is no local executor.
- **A fix that "doesn't take" after `deploy`.** `deploy`/`test` send the local file's content (verified in the CLI), so your edits *do* ship — but the runner's hot-swap can lag the command returning, so a trigger fired immediately after may still hit the previous deployment and reproduce the old error. If a fix seems ignored, re-trigger after a moment or re-deploy before concluding the code is wrong. (Separately, `deploy` does not push to the console — run `dcupl files push` to keep the cloud copy in sync.)
- **Reaching for bare `csvToJson`/`jsonToCsv` in a script node.** They aren't in the sandbox — use the namespaced `_csv.toJSON` / `_csv.fromJSON` (see "Authoring node logic").
- **Confusing the two apiKeys.** `dcupl-files` `auth.apiKey` is a project *workflow* key, not the console UUID in `dcupl.secrets.json`. A 403 on a files node almost always means the wrong key.
