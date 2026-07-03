# dcupl — Cloud sync with `dcupl files <subcommand>`

All cloud-sync verbs live under the `files` namespace. The three core sync commands are `status`, `push`, and `pull`; per-file operations and version management round it out.

> **TL;DR:** `dcupl files status` to preview, `dcupl files push` / `pull` to sync. Per-file ops (`read`/`write`/`copy`/`move`/`delete`/`list`) and version management (`files versions`) below. Runs inside a workspace only — needs `dcupl.config.json` + `dcupl.secrets.json` (create them with `dcupl config set`, see [Configuring credentials](#configuring-credentials)).

> **Heads up on the legacy commands.** `dcupl files:push` / `files:pull` / `files:copy` / `files:versions` (colon-style) still work but are **deprecated** and print a warning. Prefer the new space-separated form below. The one current caveat: the new `push`/`pull` pair only round-trips text/UTF-8 files. For projects that contain binary files originally uploaded with `files:push`, keep using the legacy pair until binary support lands.

## Configuring credentials

Cloud-sync commands need three pieces of config split across two files at the project root. The fastest way to wire them is **`dcupl config set`** (interactive by default, or flag-driven for CI). The two files are:

**`dcupl.config.json`** — project + endpoint, safe to commit:

```json
{
  "projectId": "1hRknAQvMEDq90JXpxVc",
  "loaderPath": "dcupl/dcupl.lc.json",
  "baseFolder": "dcupl"
}
```

- **`projectId`** (required) — the dcupl console project the workspace syncs against.
- **`consoleApiUrl`** (optional) — overrides the console API base URL. Defaults to the production endpoint when omitted; set it explicitly only for self-hosted or `localhost` instances (primarily a dcupl-internal-dev concern). Not scaffolded by default — discover it via `dcupl config set --help`, the interactive `dcupl config set` prompt, or `dcupl schemas get DcuplCliConfig --example`.
- **`loaderPath`**, **`baseFolder`**, plus optional `modelsBasePath`, `dataBasePath`, `filesUpload.{include,exclude}` — paths the CLI walks for uploads.

**`dcupl.secrets.json`** — API key only, **add to `.gitignore`**:

```json
{
  "apiKey": "<your-api-key>"
}
```

> The CLI sends this key as a `?apikey=<key>` **query param** on every console/files API request (not an `Authorization` header). A `401`/`403` from a cloud-sync command therefore means the key is wrong, expired, or unset — not a header problem.

### Environment variables & `.env` (CI / automation)

You don't have to write JSON files at all — `apiKey` and `projectId` also resolve from the environment. The full precedence, highest first, is:

**`--flag` > env var > `.env` > JSON file.**

- Env vars are **`DCUPL_API_KEY`** and **`DCUPL_PROJECT_ID`**.
- A workspace **`.env`** at the project root is auto-loaded at startup; real environment variables win over `.env` values.
- `consoleApiUrl` is **file-only** (read from `dcupl.config.json`, not env-overridable).

This makes CI/automation possible without committing (or even creating) `dcupl.secrets.json` — inject `DCUPL_API_KEY` as a secret env var and every cloud-sync command picks it up.

### `dcupl config set` — create or update credentials

```bash
dcupl config set                                            # interactive: prompts for projectId / apiKey / consoleApiUrl, defaulting to current values
dcupl config set --project-id <id> --api-key <key> --yes    # non-interactive (CI / scripts)
dcupl config set --console-api-url https://internal/api     # set only the URL; other fields prompt (or use existing if --yes)
dcupl config set --console-api-url "" --yes                 # remove consoleApiUrl from the config
```

Preserves unrelated fields in `dcupl.config.json` (paths, upload globs, etc.) **and user comments** (`comment-json` round-trip). `--yes` enables non-interactive mode and errors if `projectId` or `apiKey` are missing from both flags and files. The `apiKey` lands in `dcupl.secrets.json` if that file already exists, **otherwise it's written to `.env`** (which `config set` also adds to `.gitignore`).

### `dcupl config get` — inspect current credentials

```bash
dcupl config get                  # apiKey redacted as ***last4
dcupl config get --show-secrets   # full apiKey
```

Diagnostic command — runs even if files don't exist (shows `(unset)`). Prints the resolved **source** for each field (`env` vs the specific file), so you can tell whether a value came from `DCUPL_API_KEY`/`.env` or from `dcupl.secrets.json`.

### Error messages

The auth precondition fires before any cloud sync command and distinguishes the three failure modes:
- **`dcupl.config.json not found. Run 'dcupl config set' to create it.`** — config file absent (checked first).
- **`Missing dcupl.secrets.json. Run 'dcupl config set' to create it.`** — file absent.
- **`apiKey missing in dcupl.secrets.json. Run 'dcupl config set --api-key <key>' or 'dcupl config set' to set it.`** — file present, `apiKey` empty or absent.

## Version resolution (HEAD-aware default)

Most file commands take an optional `--version <id>`. The resolution order is:

1. Explicit `--version` arg, if passed.
2. The local **HEAD** — the last version this workspace synced against (tracked in `.dcupl/sync-state/HEAD`).
3. Fallback: `'draft'`.

This means after a `dcupl files pull --version staging`, subsequent commands (`files status`/`push`/`pull`, `files read`, `files write`, etc.) default to `staging` until you sync against another version. You generally don't need to pass `--version` repeatedly.

## Output mode

Files commands print human-readable output by default — colorized status lines for mutations (e.g. `✓ Copied a.json → b.json  (version: draft)`), table-like summaries for `status`/`push`/`pull`, plain text for `read`, a flat sorted path list for `list`. Pass `--json` for machine-parseable output — match the same rule as `dcupl app`: omit `--json` when eyeballing in a terminal, add it when piping or programmatically parsing. Every `files` subcommand honors the flag.

`files list` defaults to a flat sorted path list (one per line, pipe-friendly), with `--tree` for a nested directory view, and `--json` for machine output.

## Flag convention

Single-target subcommands (`read`, `write`, `delete`) take `--path`. Source-and-target subcommands (`copy`, `move`, `versions copy`) take `--from` and `--to`. `push`/`pull`/`status` take a repeatable `--path` flag that scopes the operation to specific files/folders/globs. `versions delete <id>` is the lone positional.

## Destructive remote ops — `--yes` / `--dry-run`

`delete`, `move`, `versions copy`, and `versions delete` are destructive: they mutate or remove server-side state. They prompt for confirmation by default and accept two safety flags:

- `--dry-run` — print what would happen (e.g. `Would delete a.json  (version: draft)`) and exit without calling the API. Also honored by the JSON output.
- `--yes` — skip the confirmation prompt (for CI / non-interactive use).

In non-TTY environments (CI pipes, scripts) **without** `--yes`, the destructive command refuses with `NON_TTY_UNCONFIRMED` rather than silently proceeding. `push --strict` follows the same rule — pass `--yes` for non-interactive deletion runs.

`copy` and `write` are not gated this way — `copy` only creates, and `write` overwrite-confirmation is out of scope (today's `write` silently overwrites). Treat them carefully in scripts that target existing paths.

## Incremental sync: `status`, `push`, `pull`

These do a 3-way diff between the local workspace, the server, and the persisted **baseline** (the last agreed state for that version). Only changed files are transferred; per-file conflict detection prevents silent overwrites.

```bash
dcupl files status                       # what would change vs server (no transfer)
dcupl files push                         # upload local changes (additive by default)
dcupl files pull                         # download server changes (additive by default)
dcupl files push --strict                # also delete server files no longer present locally
dcupl files pull --strict                # also delete local files no longer present on server
dcupl files push --version staging       # operate against a specific version
dcupl files push --path models/ --path data/products.csv   # scope to subset
```

**Key flags:**

- `--version <id>` — target version; defaults to HEAD then `'draft'`.
- `--strict` — opt into deletions. Default is **additive** (never deletes). `--strict` combined with `--path` confines deletion to that scope. A `--strict` run prompts before deleting; pass `--yes` to skip (same semantics as the other destructive ops — see **Destructive remote ops** above). For `push --strict` (and delete/move/versions), non-TTY without `--yes` fails fast with `NON_TTY_UNCONFIRMED`. Note `pull --strict` currently lacks that guard — it falls through to an interactive prompt and does **not** emit `NON_TTY_UNCONFIRMED` — so always pass `--yes` for non-interactive pull deletions.
- `--force` — resolve all conflicts in one direction: `push --force` uploads local over server, `pull --force` overwrites local with server, and `pull --force` also overrides the dirty-workspace version-switch refusal.
- `--path <glob>` — repeatable. Restricts the operation to a subset of files/folders/globs relative to `baseFolder`. Works on all three of `status`, `push`, and `pull` — so `dcupl files status --path models/` previews exactly the scope a `push --path models/` would transfer. Composes with the config-level `filesUpload.include` / `filesUpload.exclude` rules. Use it when you want to sync only `models/`, only one file, etc.
- `--json` — JSON output (default is human-readable).

**Guardrails.** `push` rejects `--version production` — publish there via `files versions copy` instead. `pull` refuses to switch to a different version when the workspace is dirty unless you pass `--force`.

**Conflict handling.** If both sides changed a file since the baseline, the command reports it as a conflict and skips it — no auto-merge. Re-run with `--force` to resolve all conflicts in one direction, or resolve individual files with `files write` / `files read` and re-run plain sync.

**Server-side drift.** If the server has lost a file since the last sync (e.g. another collaborator deleted it, the version was wiped, or any out-of-band change), additive `push` re-uploads it from the local workspace — the baseline is treated as a record of what the server *should* still have, not as ground truth. `status` shows the file under uploads with the reason `server diverged from baseline (file missing on server, re-uploading from local)`. Use this to recover from server-side wipes without manually clearing `.dcupl/`. If you instead want to mirror the server-side deletion locally, run `pull --strict` (which prompts before deleting). The symmetric case — a local file you deleted while the server is unchanged — is not auto-restored by additive `pull`; use `pull --strict` if you want server-side state to win.

**Sync state.** Lives under `.dcupl/sync-state/` (there is no `baselines/` directory):
- `.dcupl/sync-state/HEAD` — last version synced against.
- `.dcupl/sync-state/<versionId>.json` — per-version baseline manifest used for 3-way diff (e.g. `draft.json`).
- `.dcupl/.gitignore` — auto-written on first sync so the `.dcupl/` internals don't get committed. Don't touch this manually.

## Per-file operations

For one-off file ops without a full sync. See **Flag convention** above for the `--path` vs `--from`/`--to` split.

```bash
dcupl files list                                # flat sorted path list in HEAD (or --version)
dcupl files list --tree                         # nested directory view
dcupl files list --search query                 # filter by search query
dcupl files read --path <path>                  # print file contents
dcupl files write --path <path> --content "..." # write/overwrite a file
dcupl files write --path <path> --file <local>  # upload from a local file
dcupl files delete --path <path>                # delete a file (prompts; --yes to skip; --dry-run to preview)
dcupl files move --from <path> --to <path>      # rename/move within a version (prompts; --yes / --dry-run)
dcupl files copy --from <path> --to <path>      # copy a file within a version
dcupl files create-folder --path <path>         # create an empty folder
```

All accept `--version <id>` (defaults to HEAD then `'draft'`) and `--json`. `files write --content` takes a literal string — there is no stdin (`-`) sentinel for this command. See **Destructive remote ops** above for `--yes` / `--dry-run` semantics on `delete` and `move`.

## Version management — `files versions`

```bash
dcupl files versions list                       # list all versions (alias: `dcupl files versions`)
dcupl files versions copy --from <v> --to <v>   # snapshot one version into another (prompts; target is wiped if it exists; --yes / --dry-run)
dcupl files versions delete <id>                # delete a version (prompts; refuses 'production' and 'draft'; --yes / --dry-run)
```

`versions copy` and `versions delete` are destructive — see **Destructive remote ops** above for the `--yes` / `--dry-run` / non-TTY semantics. The protected-version check on `versions delete` runs before any other flag, so `--yes --dry-run` won't bypass it.
