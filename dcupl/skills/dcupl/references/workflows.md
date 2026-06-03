# dcupl — Workflow v3 build / test / deploy

This reference covers the full loop: authoring a `TemplateV3` file, validating it locally and remotely, exercising it against a dev runner, and deploying to production.

> **Schema first.** Before authoring any node, run `dcupl schemas get <NodeTypeConfig>` to read the exact field names. The schema is the source of truth — do not guess field names from memory.

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

## Build → validate → test → deploy loop

### 1. Author the workflow file

Start from the canonical `TemplateV3` example:

```bash
dcupl schemas get TemplateV3 --example
```

Write the result to `workflows/<key>.workflow-v3.json`. Convention: one file per workflow, filename matches the template `key`. Before authoring each node's `config`, always read the relevant node config schema first (see catalog above).

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

#### Supply a trigger key (when workflow has multiple triggers):

```bash
dcupl workflow test workflows/my-workflow.workflow-v3.json \
  --runner <devRunnerUid> \
  --trigger-key <k>
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

---

## Dev vs production runner — the key distinction

| Runner role | Use with | Behaviour |
|---|---|---|
| Dev runner | `dcupl workflow test` | `test` overwrites the runner's current deployment on every run. Treat as ephemeral. |
| Production runner | `dcupl workflow deploy` | `deploy` is confirm-gated (`--yes` for CI). Do not point `test` here. |

Always run `dcupl workflow runners` to confirm UIDs before running `test` or `deploy`. There is no "dry-run" or draft state — every `test` is a live deploy on that runner.

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
- **Forgetting to push the file before deploying.** `deploy` operates on the file you pass — it does not auto-sync from cloud. Push first if needed, or pass the local file path directly.
