# dcupl — Querying with `dcupl app`

The `dcupl app` CLI starts a per-app daemon that holds a dcupl instance in memory, then exposes the dcupl SDK (models, data, query, fn) as CLI commands. Once data is loaded, queries are fast because everything is indexed in memory. Use it for exploratory data analysis when there's a tabular dataset to investigate.

## When this applies

Trigger when the user has tabular data (CSV/JSON/NDJSON) and asks an analytical question, especially:

- **Counts and breakdowns** — "how many products are in each category?", "what's the distribution of status?"
- **Stats** — "what's the avg/min/max price?", "sum of revenue by region"
- **Filters** — "show me records where X matches Y", "find rows with price > 100"
- **Sampling and inspection** — "what columns are in this file?", "what values appear in column X?"
- **Anything in a dcupl project** where the user has data and wants to explore it

Also trigger when the user explicitly says "use dcupl" or references existing dcupl tooling.

Do NOT use `dcupl app` for:
- Pure file format conversion (use a Python script)
- Single-shot one-off pipes that read each row once (CSV → grep is fine)
- Streaming / very-large data that won't fit in memory
- Modifying source data files (this CLI only reads)

## Triage — quick lookup vs exploration

Before reaching for the profiling pass, classify the question:

- **Quick lookup** — one metric, one filter, a count, a single record. Run the single query that answers it, report the number in prose, cite the command. Skip the profile pass, skip follow-up suggestions. Most questions are this.
- **Exploration** — open-ended ("what's in this CSV?", "anything interesting?", "what's driving X?"). Run the profiling pass (principle 4), surface 1-2 patterns, offer follow-ups (principle 7).

When unsure, treat it as a quick lookup and expand only if the answer raises an obvious next question. Don't apply the full eight-principle ceremony to a question that just needs one `fn facets` call.

Even for a quick lookup, don't assume column names. Before picking `--key-property` or an `--attribute`, confirm the column exists — glance at the source file's header, or run `fn metadata` (which lists attributes) right after ingest. A wrong `--key-property` fails fast or silently collapses rows; a quick header check avoids both.

## Mental model

- **Per-app daemon.** `app create` spawns a Node process that holds the data; subsequent commands are HTTP requests to that daemon.
- **Lifecycle:** `create → (ingest data) → (analyze, possibly many times) → destroy`. Keep the daemon alive between follow-up questions in the same session; only destroy when the user is done. Idle shutdown (30 min default) cleans up automatically if the conversation moves on.
- **Build modes.** The CLI mirrors the SDK's declarative `init()`/`update()` split. By default a daemon is in *manual mode*: `data`/`models` mutations and loader `process` **stage** changes but don't rebuild indexes — queries won't see the new data until you run `dcupl app build`. For exploratory analysis, create the daemon with `--auto-update` so every ingest rebuilds automatically and results are immediately queryable. **This guide uses `--auto-update` throughout.** `app status` reports `pendingChanges: true` when a manual-mode daemon holds unbuilt changes, and data-mutation responses report `"built": false` in manual mode.
- **One daemon per task.** When you have multiple datasets to analyze, either reuse a single daemon with multiple models, or run multiple daemons (each gets its own appId).
- **Output modes.** Pass `--json` for machine-parseable JSON. Omit `--json` to get a friendlier view: arrays of records render as ASCII tables (via `console.table`), other shapes pretty-print as JSON. Use `--json` when piping or programmatically parsing; omit it when eyeballing results in a terminal.

## Working with the user

Eight principles that apply across every analysis session. Read these before reaching for commands.

**1. Keep the daemon alive across follow-ups.** Don't `destroy` after every question. Users typically ask a string of related questions about the same dataset. Recreating the daemon means re-ingest + re-index every time — slow and wasteful. Pattern: create once, leave running, destroy explicitly only when the user says "I'm done" / pivots to a different dataset / explicitly asks to clean up. Idle shutdown (30 min default) handles cleanup automatically.

If you've been exploring for a while and you're unsure, ask: *"Want me to keep this app running for follow-ups, or clean it up now?"*

**2. Reuse before recreate.** Before `app create`, run `app list --json` to see if a daemon for this dataset is already alive. If yes, reuse it (capture the existing appId; skip ingest). The current working directory is in each registry entry under `cwd` — match on that for project-aware reuse.

**3. Generated files: ask before writing.** When you need to write a `.dcupl.json`, a temp CSV, or any other supporting file to disk, treat it as a side effect the user might want to keep:

- **Propose the path first.** Default to a `dcupl/` folder under the user's working directory (e.g. `dcupl/Product.dcupl.json`) — discoverable and reusable.
- **Ask explicitly:** *"I'd like to write the model to `dcupl/Product.dcupl.json` so you can adapt it later. OK to write?"*
- **Model-first principle.** If you know up front that you'll need numeric aggregations, write the model file FIRST, then ingest. The order is `app create → models set → data upsert`. Reversing it (autoGen, then `models set`) leaves existing rows with the inferred types and requires a `data set` (full replace) to re-type — `models set` will warn you about this in its response when records already exist.
- **For small data (<1KB)**, prefer `--content` inline over writing a temp file at all.

**4. Profile before deep-diving.** When the user has a fresh dataset and asks an open-ended question (*"what's in this CSV?"*, *"anything interesting?"*), run a quick recon pass before answering:

```bash
dcupl app fn metadata --model X --json   # row count + attribute list
```

Then pick the few attributes that matter — relevant to the user's question, or the most informative columns for a wide dataset (cap ~5). Don't fan out over every column; that floods context with data nobody asked for.

```bash
dcupl app fn facets --model X --attribute <attr> --limit 5 --json
dcupl app fn aggregate --model X --attribute <attr> --types distinct --json
```

Then summarize what you found and surface 1-2 notable patterns. Skip this for narrow questions — only profile when the user is in discovery mode.

**5. Translate results, don't dump JSON.** The CLI returns JSON. The user wants prose. After running queries, summarize. Always cite the command(s) you ran in a code block under the answer so the user can verify or rerun.

**6. Diagnose errors before recovering.** Don't blindly retry on failure — read the error code first.

- `MODEL_NOT_FOUND` doesn't mean "create the model"; the user might have typo'd a name. Run `app models keys --json` and confirm.
- `MULTIPLE_APPS` means there's >1 daemon running. Run `app list --json`, ask the user which they meant, or infer from `cwd` if you can.
- `NETWORK` (daemon unreachable) usually means a stale registry entry. `app list` auto-prunes dead pids — re-run it.
- `UNKNOWN_OPTION` / `PARSE_ERROR` / `PROJECTION_INVALID_SHAPE` are your fault — a mistyped flag, a missing argument, or a malformed `--projection`. `UNKNOWN_OPTION` usually carries a "Did you mean …?" hint; re-read the command's option requirements (`--help`).
- `TYPE_MISMATCH` (only from `fn aggregate`): the user asked for `avg`/`sum` on a non-numeric column. The error message names the column and its current type — fix is `models set` with the right type, then `data set` (full replace) to re-type existing rows.

**7. Suggest follow-ups.** After answering an analytical question, offer 1-2 natural next steps. This helps users discover what dcupl can do and surfaces follow-on insights they hadn't considered.

**8. Project awareness.** If the user is in a dcupl repo — i.e. `dcupl.config.json` exists or `package.json` lists `@dcupl/*` deps — prefer their existing data and model files over creating new ones. Look in `data/` or `dcupl/data/` for source data, `models/` or `dcupl/models/` for model definitions, and `dcupl.lc.json` for existing loader resources.

## Sanity-check results before reporting

The CLI can return a well-formed but wrong answer. Before turning a result into prose, check:

- **Row count plausible?** `fn metadata` `currentSize` should match what you expected from the source file. A surprising count usually means a bad `--key-property` (duplicate keys collapse rows) or a partial ingest.
- **`avg`/`sum` not 0 or undefined?** That's the numeric-types gotcha — the column is `string`/`any`. Fix the model, then re-run; don't report the 0.
- **`distinct` count sane?** A distinct count equal to the row count on a column you expected to repeat means values aren't matching — check for stray whitespace or inconsistent casing.
- **Empty filter result?** Before reporting "zero matches", confirm it isn't a `find` pattern that needed slash-delimiters, or a numeric comparison silently running against a string column. **Also check the attribute name against `fn metadata`**: a typo'd attribute in a `--query` filter or `fn facets --attribute` returns a silent `[]` with exit 0 — indistinguishable from zero matches (only `fn groupBy`/`fn aggregate` hard-error on unknown attributes, and with a misleading `INTERNAL` code). The same silent `[]` happens when querying a column that was consumed by `keyProperty` — its values live under `key`, not the original column name.
- **Group/facet sizes sum to the total?** `fn groupBy` group sizes — and `fn facets` counts — should add up to `currentSize`. The subtlety: an **empty string** (e.g. a blank CSV cell) gets its own real `""` bucket and *does* count toward the total, but a **genuinely missing property** (an absent key in JSON, or a column the model doesn't declare) is silently excluded with no bucket. So a shortfall below `currentSize` signals missing *properties*, not blank cells. Quantify either with `{"operator":"isTruthy","attribute":"<attr>","value":false}` (which catches both empty and missing).

If a check fails, fix the cause and re-run — don't report a suspect number with a caveat.

## Quickstart — the full flow

Given a CSV at `/path/to/products.csv`:

```
id,name,category,price
1,Sneaker,shoes,89.99
2,Boot,shoes,149.0
3,Cap,hats,19.99
```

```bash
# 1. Create the daemon. --auto-update rebuilds indexes after every ingest so
#    queries see new data immediately. (Omit it for manual mode — then you must
#    run `dcupl app build` yourself before querying.) No inference flags here —
#    set them per ingest instead.
dcupl app create --auto-update --json
# → {"appId":"swift-otter-3a1f","port":52341}

# 2. Load the CSV. --auto-generate-sample-size 100 lets dcupl walk up to 100 rows when
#    inferring schema for *this* call — more reliable than the row-1-only default of
#    --auto-generate-properties. --key-property tells dcupl which column is the unique id.
dcupl app data upsert --file /path/to/products.csv --model Product --key-property id \
  --auto-generate-sample-size 100 --json
# → {"upserted":3,"model":"Product","built":true}

# 3. Now ask questions:

# Distribution of categories:
dcupl app fn facets --model Product --attribute category --json
# → [{"value":"shoes","count":2,"size":2,...},{"value":"hats","count":1,...}]

# Filtered records:
dcupl app query execute --model Product --query '{"operator":"eq","attribute":"category","value":"shoes"}' --json
# → [{"id":"1","name":"Sneaker",...},{"id":"2","name":"Boot",...}]

# How many total records?
dcupl app fn metadata --model Product --json
# → {"key":"Product","currentSize":3,...}

# 4. Clean up.
dcupl app destroy --json
```

## Inline data with `--content`

When the data is small or already in the agent's context, skip the temp-file dance:

```bash
# Inline JSON
dcupl app data upsert --content '[{"id":"1","name":"Alpha"},{"id":"2","name":"Beta"}]' \
  --model Item --key-property id --json

# Inline model definition
dcupl app models set --content '{"key":"Item","properties":[{"key":"id","type":"string"},{"key":"name","type":"string"}]}' --json

# Read from stdin (use "-")
some-tool | dcupl app data upsert --content - --model Item --key-property id --json
```

`--content` is mutually exclusive with `--file` and `--url`. Pass exactly one. Format is inferred from the first non-whitespace char (`[`/`{` → JSON, else CSV); override with `--format csv|json|ndjson` if needed.

## The five analytical verbs — picking the right one

Read the user's question, then pick:

| User asks | Use | Example |
|---|---|---|
| "What values appear in column X, and how often?" | `fn facets` | `--model M --attribute X [--limit 20]` |
| "What's the min/max/avg/sum of X?" | `fn aggregate` | `--model M --attribute X --types min,max,avg` |
| "How does X break down by Y?" | `fn groupBy` | `--model M --attribute Y` (sizes per group). Add `--aggregate price:avg` for per-group stats. **One attribute per call** — for X × Y cross-tabs see "Cross-tabs" under Common patterns. |
| "How many records match this filter?" | `fn metadata` (with `--query`) or count `query execute` | `--model M --query '{...}'` returns `currentSize` |
| "Show me records matching this filter, sorted, paginated" | `query execute` | `--model M --query '{...}' --sort price:DESC --limit 10` |
| "Get a single record by id" | `query one` | `--model M --item-key 123` |
| "What model/schema does dcupl have?" | `app models get` or `app models keys` | |
| "Daemon status / total record count" | `app status` | |

`fn facets` and `fn aggregate` look similar but answer different questions. Facets = "how many of each value?". Aggregate = "what's the statistical summary of this column?".

`fn aggregate --types` accepts: `distinct,count,sum,avg,min,max,group`.

## Mutating a running daemon — beyond `data upsert`

The `data` namespace has more verbs than `upsert`. Reach for these instead of destroying and recreating the daemon when the dataset needs to change mid-session:

| Verb | Use |
|---|---|
| `app data upsert` | Insert or update records (most common). |
| `app data update` | Update existing records only — no inserts. |
| `app data set` | Full replace — drops existing records for the model, ingests the new set. Re-types columns based on the current model. |
| `app data remove --model M --content '["k1","k2"]'` | Remove specific records by key (also takes `--file`). |
| `app data reset --model M` | Drop all records for one model; keeps the model definition. |

All stage in manual mode and require `dcupl app build` to be visible to queries. In `--auto-update` mode they apply immediately.

For workspace- or console-loaded apps, the `loaders` namespace lets you swap or re-process sources on a live daemon without recreating it:

```bash
dcupl app loaders list                                  # what loaders are attached
dcupl app loaders add --base-url <url>                  # add a remote loader
dcupl app loaders process --loader catalog --env prod   # re-resolve with different slice/env/tag/var
dcupl app loaders remove --loader catalog               # detach
```

`loaders process` is the verb to use when the user says "reload from console with a different env" mid-session — much cheaper than destroying the daemon.

## `fn groupBy --aggregate` for one-shot group-by-aggregate

A `fn groupBy` without flags returns the count of records per group value. The response is **not** a flat `[{value,count}]` array — it's `{ "_meta": {...}, "items": [ { "key", "value", "_meta": { "size" }, "_aggregates"? } ] }`, so each group's count is at `items[].​_meta.size` (and the group value at `items[].value`). To compute per-group stats in a single command, pass `--aggregate <attribute>:<type>` (repeatable):

```bash
# Avg price per category in one call
dcupl app fn groupBy --model Product --attribute category --aggregate price:avg --json

# Multiple aggregates per attribute, multiple attributes
dcupl app fn groupBy --model Order --attribute customer \
  --aggregate amount:avg,sum --aggregate items:max --json
```

Each group entry comes back with an `_aggregates` array containing the requested computations. Vastly more efficient than looping `fn aggregate --query` per group.

## `fn aggregate` flags

- `--types distinct,count,sum,avg,min,max,group` — comma-separated.
- `--query '<json>'` — scope the aggregation to a subset (e.g. avg price *of shoes only*).
- `--include-keys` — when computing `distinct`, include the matching record ids per value. Default is to omit them (the SDK can be expensive on sparse columns; default-compact saves bandwidth).

## `fn facets` output flags

The default response is compact: `[{value, count}, ...]`. That's almost always what you want. Four opt-outs:

- `--limit N` — return only N values. Pair with `--sort` for a deterministic top-N; without `--sort` these are the first N in iteration order (no guarantee).
- `--sort size-desc|size-asc|value-asc|value-desc` — opt-in deterministic ordering. Use `size-desc` for top-N-by-count. Omitting `--sort` keeps the SDK's fast path (insertion order, early-return on `--limit`); setting it makes the SDK walk all keys, compute full sizes, and sort before truncating.
- `--include-results` — keep `resultKeys` (the array of matching record ids per facet value). Use this when you want to fan out into per-group queries; otherwise it bloats the response.
- `--full` — pass through the SDK's full `DcuplFacet` shape (adds `selected`, `enabled`, `entry`, `resultKeys`, `key`). Rarely needed for analysis; useful if you're debugging the SDK.

Examples:

```bash
# Compact (default):
dcupl app fn facets --model Order --attribute customerId --json
# → [{"value":"alice","count":42},...]

# Top 10:
dcupl app fn facets --model Order --attribute customerId --limit 10 --json

# Compact + ids per value (for follow-up queries):
dcupl app fn facets --model Order --attribute customerId --include-results --json
# → [{"value":"alice","count":42,"resultKeys":["o1","o2",...]},...]
```

## The numeric-types gotcha — when `avg`/`sum` returns nothing

CSV files don't carry type information, so `parseCsv` produces strings for every field. With **row-1-only** inference (`--auto-generate-properties` and no sampling), dcupl types columns from that single row — typically `string`. **Numeric aggregations (`avg`, `sum`) only work on `int`/`float` columns.** (Multi-row sampling fixes this for CSV too — see the table below.) With string-typed columns:

- `min`, `max` — work, but lexicographic (`"100"` < `"99"`)
- `avg`, `sum` — return undefined or 0
- `distinct`, `count` — work fine

**Multi-row inference (`--auto-generate-sample-size N` / `--auto-generate-deep`).** These flags exist on both `app create` (daemon-wide default) and on `app data <verb>` (per-call override). They make the SDK walk up to N rows (or every row) when inferring schema, instead of looking at row 1 only. They help in *some* cases but won't rescue every CSV — the format of your input matters:

```bash
# Sample 100 rows for type inference
dcupl app create --auto-update --auto-generate-sample-size 100 --json

# Or walk every row (no cap)
dcupl app create --auto-update --auto-generate-deep --json
```

What you can expect:

| Input shape | Result |
|---|---|
| **JSON/NDJSON, all rows numeric** (`{"price": 99.99}`) | Inferred as `float`. Works without flags too. |
| **JSON/NDJSON, mixed empty/numeric** (`{"price": ""}` then `{"price": 99.99}`) | Inferred as `any` — SDK widens on mixed types rather than narrowing. `TYPE_MISMATCH` on `avg`/`sum`. |
| **CSV, clean numeric column, WITH multi-row sampling** (`--auto-generate-sample-size N` / `--auto-generate-deep`) | Inferred as `int`/`float` — `avg`/`sum`/`min`/`max` work with **NO explicit model** (`price` → `float`, `inStock` → `int`). |
| **CSV, default (row-1-only inference)** | Typically `string` — no sampling, so the SDK only sees row 1's stringified cell. |
| **CSV, mixed/sparse column** | Widened to `any` even with sampling — `TYPE_MISMATCH` on `avg`/`sum`; declare an explicit model. |

**Bottom line (corrected):** multi-row sampling (`--auto-generate-sample-size N` / `--auto-generate-deep`) **does** infer numeric types from **CSV** too, so `avg`/`sum` often work without an explicit model — the older "CSV is always string" guidance no longer holds. Still declare an explicit model when you need deterministic types regardless of sampling, or when a column is mixed/sparse enough that inference widens it to `any`.

The CLI catches the failure mode preflight: if you call `fn aggregate --types avg,sum` on a `string` or `any` column, it returns `code: 'TYPE_MISMATCH'` with a clear hint pointing at the explicit-model fix. So you'll get a fast, obvious failure rather than a silently-missing field.

**Fix:** declare a model explicitly. Write a JSON file:

```json
{
  "key": "Product",
  "properties": [
    { "key": "id", "type": "string" },
    { "key": "name", "type": "string" },
    { "key": "category", "type": "string" },
    { "key": "price", "type": "float" }
  ]
}
```

Then:

```bash
dcupl app create --auto-update --json
dcupl app models set --file Product.dcupl.json --json
dcupl app data upsert --file products.csv --model Product --key-property id --json
dcupl app fn aggregate --model Product --attribute price --types avg,sum,min,max --json
# Now avg and sum work correctly.
```

Property types: `string`, `int`, `float`, `boolean`, `date`, `json`, plus arrays like `Array<string>`.

## Query language

Queries are JSON objects passed to `--query` (or `--query-file <path>` for big ones). Both forms accept **a single condition, an array of conditions, or a full query group** — the daemon normalizes whatever you pass into a complete query group, so you never supply `queries`/`groupType`/`groupKey` yourself.

> **Flag names:** `--query` / `--query-file` are current. Older CLIs used `--filter` / `--filter-file`. An unknown flag now **errors** with `{"code":"UNKNOWN_OPTION"}` (often with a "Did you mean --query?" hint) rather than silently returning unfiltered data — so a mistyped flag fails loudly. Still, confirm flag names against `dcupl app query execute --help` when unsure.

**Single condition (most common):**

```json
{ "operator": "eq", "attribute": "category", "value": "shoes" }
```

The daemon wraps this into a full query group automatically.

**Operators:**

| Op | Meaning | Example |
|---|---|---|
| `eq` | exact equality | `{"operator":"eq","attribute":"status","value":"active"}` |
| `gt`, `gte`, `lt`, `lte` | numeric comparison | `{"operator":"gt","attribute":"price","value":100}` |
| `find` | **exact match** (bare string) or regex match (slashes) — see below | `{"operator":"find","attribute":"name","value":"/^Sneaker/"}` |
| `typeof` | value type check | `{"operator":"typeof","attribute":"x","value":"string"}` |
| `isTruthy` | truthy/falsy | `{"operator":"isTruthy","attribute":"x","value":true}` |
| `size` | array size | `{"operator":"size","attribute":"tags","value":3}` |

`gt`/`lt` etc. require a numeric column (see "numeric-types gotcha" above).

**Filter for null/empty values:** `{"operator":"isTruthy","attribute":"x","value":false}` matches `null`, `undefined`, empty string, and `0` (anything JS-falsy). There is no dedicated `isNull`/`isEmpty` operator — `isTruthy:false` is the canonical pattern.

**`find` has two modes** depending on the `value` shape:

- **Bare string** (e.g. `"Sneaker"`) — **exact-equality** match against the *whole* field value, NOT a substring. `find` with `"Ball"` does **not** match `"Soccer Ball"` — it returns `[]`. The characters `^`, `$`, `.`, etc. are not metacharacters here. **For substring matching, you must use a slash-delimited regex.**
- **Slash-delimited regex** (e.g. `"/^Sneaker/"`, `"/foo/i"`) — treated as a JS-style regex *literal*. Anchors, flags, and substring patterns work as you'd expect.

This means `value: "M"` only matches a field whose entire value is exactly `M`, `value: "/^M/"` matches any field *starting with* `M`, and `value: "/Ball/"` matches any field *containing* `Ball` (e.g. `Soccer Ball`, `Rugby Ball`). If a `find` returns zero unexpectedly, the usual cause is using a bare string where you needed a `/regex/` for substring/pattern matching.

**Combining multiple conditions** — pass a query group (or an array of conditions) inline via `--query`, or from a file via `--query-file` for big ones:

```bash
dcupl app query execute --model Product --query-file complex.json --json
```

Where `complex.json` is a query group. You do **not** need `groupKey` — the daemon supplies `groupKey:"root"` and defaults `groupType` to `"and"` during normalization. Provide only `groupType` (set it to `"or"` when you want OR) and `queries`:

```json
{
  "groupType": "and",
  "queries": [
    { "operator": "eq", "attribute": "category", "value": "shoes" },
    { "operator": "gte", "attribute": "price", "value": 50 }
  ]
}
```

For most exploratory work, a single condition via `--query` is enough. Use `--query-file` for large AND/OR groups; an array of bare conditions (ANDed together) also works in either form.

> **Note:** `fn metadata --query` — and the other `fn` verbs — honor **all** conditions in a multi-condition group. The earlier bug where conditions past the first were silently dropped is fixed: the daemon normalizes the query into a full group before applying it. The `fn` verbs also accept `--query-file`.

## Sorting, pagination, projection

`query execute` accepts:

- `--sort price:DESC,name:ASC` — comma-separated `attr:DIR` pairs (DIR is `ASC` or `DESC`, default `ASC`)
- `--limit 10` and `--start 20` — pagination. `--start` is a **0-based offset**: records 100–110 of a sorted result = `--start 100 --limit 11`
- `--projection` — pick which fields to return; three equivalent forms:
  - Object: `--projection '{"id":true,"name":true}'` (use `false` to exclude)
  - Array: `--projection '["id","name"]'`
  - Comma list: `--projection 'id,name'`
  - Nested object on a reference attribute inlines remote fields — see "Working with references in queries" below.
  - Unparseable JSON fails with `PROJECTION_INVALID_SHAPE` (not a silent partial result). A value that parses but isn't a sensible projection shape (e.g. `'42'`) is accepted and falls back to returning only `key` — so a result that's missing fields you expected usually means a wrong-shaped projection, not missing data.

## Working with references in queries

When a model declares a Reference (see `references/model-authoring.md` → "Authoring references"), the related records show up in query output as **resolution markers**, not inlined records.

### How references appear in `query execute` output

For each referenced item, the result contains `{ key, _dcupl_ref_ }`:

- `_dcupl_ref_: "hit"` — the foreign key resolved to a record on the remote model.
- `_dcupl_ref_: "miss"` — the foreign key has no matching record (dangling FK).
- `_dcupl_ref_: "auto_hit"` — an auto-resolved / auto-created remote reference.

This is a great quick visual signal of which joins landed and which dangle. By default — and with a plain array/comma projection (`--projection '["key","customerId"]'`) — a referenced attribute stays a `{ key, _dcupl_ref_ }` marker; the remote record's fields are **not** inlined.

**A nested-object projection inlines the remote fields.** When you project a reference attribute with a nested object selecting remote properties, `query execute` traverses the relationship and inlines those fields:

```bash
# Nested projection on a reference attribute pulls customerId.name into the result.
dcupl app query execute --model orders --query '{"operator":"eq","attribute":"orderId","value":"<id>"}' \
  --projection '{"orderId":true,"customerId":{"name":true,"country":true}}' --json
# → {"orderId":"<id>","customerId":{"key":"1","name":"John Doe","country":"USA"}}
```

So `query execute` with a nested projection is the most direct way to inline related fields. Two notes:
- This works on `query execute` only. **`query one` has no `--projection` flag** — passing one errors with `{"code":"UNKNOWN_OPTION"}`. Use `query execute` (with `--item-key` filtering or an `eq` on the key) if you need projection on a single record.
- The analytical verbs (`fn facets` / `fn groupBy`) traverse references via **dotted attribute** notation (see below) — use those for breakdowns by a remote field.

If you'd rather not project, you can still **hop manually**: `query execute` the local record, take each `key` from the reference, then `query one --model <RemoteModel> --item-key <key>`.

> **Filtering DOES traverse references.** A `--query` condition can use dotted notation across a singleValued reference: `{"operator":"eq","attribute":"vendorId.country","value":"Austria"}` filters records by their referenced vendor's country. Filtering on the reference attribute itself matches by remote key: `{"operator":"eq","attribute":"vendorId","value":"v-005"}`.

### Dotted-reference traversal in `fn facets` and `fn groupBy`

The analytical verbs **do** traverse references via dotted attribute notation. The engine walks the singleValued reference automatically and treats the remote property as the facet/group key:

```bash
# Orders broken down by their customer's country
dcupl app fn facets  --model orders --attribute customerId.country --json
dcupl app fn groupBy --model orders --attribute customerId.country --json

# Articles by vendor company name
dcupl app fn facets  --model articles --attribute vendorId.companyName --json
```

No extra setup — the reference is already declared on the local model. Chain as many hops as the reference graph allows.

> **Note on ordering for dotted-ref facets.** The empty-result regression where `--limit N` returned `[]` for most N (only `--limit 5` worked) was fixed in `dcupl@0c27b58` (#193) — dotted-ref facets now return entries reliably for any `--limit`. Ordering remains iteration-based, same as plain facets; see the "Don't trust the order blindly" note below if you need top-N-by-count.

## Common patterns

**"Profile this CSV — what's in it?"**

```bash
dcupl app create --auto-update --json
dcupl app data upsert --file data.csv --model Data --key-property <pk> \
  --auto-generate-properties --json
dcupl app fn metadata --model Data --json   # row count, attribute list
# For each interesting column:
dcupl app fn facets --model Data --attribute <col> --json   # value distribution
dcupl app fn aggregate --model Data --attribute <col> --types distinct,count --json
dcupl app destroy --json
```

**"How many distinct values are in column X?"**

```bash
dcupl app fn aggregate --model M --attribute X --types distinct --json
# → {"attribute":"X","types":["distinct"],"distinct":[{"value":"a","count":12},{"value":"b","count":7},...]}
```

`distinct` returns an **array of `{value, count}`** — there's no `.distinct.count` total. To get the number of distinct values, read `distinct.length` (or add `count` to `--types`). Under `--include-keys`, each entry also gets a `keys` array.

**"Top 10 most common values in X"**

```bash
dcupl app fn facets --model M --attribute X --sort size-desc --limit 10 --json
```

> **For guaranteed top-N-by-count, use `--sort size-desc`.** Without `--sort`, results are returned in inverse-index iteration order (no ordering guarantee) — `--limit N` alone has been observed to return entries whose top is not the true max. Pair `--sort size-desc` with `--limit N` for deterministic top-N: `dcupl app fn facets --model M --attribute X --sort size-desc --limit N --json`.

**"Filter then aggregate" — stats on a subset:**

`fn aggregate` and `fn facets` accept `--query` to scope the calculation:

```bash
dcupl app fn aggregate --model Product --attribute price --types avg \
  --query '{"operator":"eq","attribute":"category","value":"shoes"}' --json
# → avg price *of shoes only*
```

**Cross-tabs (X × Y) — loop scoped facets; multi-attribute groupBy does NOT exist:**

`fn groupBy` takes exactly one attribute. `--attribute season --attribute year` (and `--attribute season,year`) both fail with a misleading `{"error":"Attribute not found","code":"INTERNAL"}`. Build two-dimensional breakdowns by looping `fn facets --query` over the values of the smaller dimension:

```bash
# season × year: one scoped facet call per season value
for s in Summer Fall Winter Spring; do
  dcupl app fn facets --model Product --attribute year \
    --query '{"operator":"eq","attribute":"season","value":"'"$s"'"}' --json
done
```

Remember each scoped facet excludes blank cells of *both* attributes — reconcile the totals against `currentSize` (see "Sanity-check results").

**"Multiple datasets in one daemon":**

For batch ingest, *omit* `--auto-update` and use the default manual mode — each `data upsert` only stages, so you pay the index rebuild once via `dcupl app build` instead of after every file:

```bash
dcupl app create --json   # manual mode (default) — ingests stage, don't rebuild
# Pick the inference strategy per file.
dcupl app data upsert --file products.csv --model Product --key-property id \
  --auto-generate-properties --json
dcupl app data upsert --file orders.csv --model Order --key-property id \
  --auto-generate-sample-size 200 --json
dcupl app build --json    # one rebuild after both ingests
dcupl app fn groupBy --model Order --attribute customerId --json
```

This is the manual/auto-update trade-off in practice: `--auto-update` is convenient for a single dataset (every ingest immediately queryable); plain manual mode + one `dcupl app build` is cheaper when loading several files up front. Either way, **query before the build returns stale/empty results** — if that happens, run `dcupl app build` (or check `app status` for `pendingChanges: true`).

## Pitfalls

- **Manual mode stages; `dcupl app build` applies.** By default a daemon doesn't rebuild after `data`/`models`/`loaders process` — queries won't see new data until `dcupl app build`. Create with `--auto-update` to rebuild automatically (recommended for interactive analysis). If a query returns stale or empty results right after an ingest, you're in manual mode and forgot to build — `app status` shows `pendingChanges: true` when that's the case.
- **Always pass `--json`** for machine-parseable output. Bare `dcupl app status` prints pretty for humans.
- **Destroy at end of session, not after each question.** Daemons are cheap to leave running between follow-ups; recreating them is expensive. Idle shutdown (30 min) cleans up on its own. Destroy explicitly when the user signals they're done.
- **`--app <id>` when >1 running.** With multiple daemons alive, every command needs `--app <id>` or it errors with `MULTIPLE_APPS`. Capture the appId from `app create --json` output.
- **Numeric stats need explicit models.** Default to explicit models if `avg`/`sum` matters; auto-generate is fine for distributions and filters.
- **`--auto-generate-*` lives on both `app create` and `app data <verb>`.** Per-call flag overrides the daemon default (use `--no-auto-generate-properties` to force off). Inference still only runs once per model — later mutations on a model that already has a schema never re-infer.
- **Ingest into an unknown model is rejected up-front.** If you call `data {upsert,update,set}` on a model that isn't registered yet and isn't going to be auto-inferred, the daemon returns `MODEL_NOT_FOUND` with a hint suggesting `app models set` or one of the `--auto-generate-*` flags. Don't try to "force" the upsert through — fix the call.
- **`--query` accepts a single condition, an array, or a full group.** The daemon normalizes any of them; for large AND/OR groups, use `--query-file` with a query-group JSON.
- **`fn groupBy` returns group keys + sizes, not records inside each group.** If you want the records, follow up with `query execute --query` per group.
- **`--content` for small inline data, `--file` for anything substantial.** Inline payloads have shell-escaping pain at scale; over a few KB, write a temp file or use `--content -` to pipe.
- **Drop `--json` for table output.** When you're exploring interactively in a terminal, omitting `--json` renders arrays-of-records as ASCII tables. Add `--json` back the moment you start piping into another tool.
- **Reserved error codes:** `APP_NOT_FOUND`, `MULTIPLE_APPS`, `MODEL_NOT_FOUND`, `MISSING_APP_ID`, `NOT_FOUND`, `UNAUTHORIZED`, `INVALID_RESPONSE`, `NETWORK`, `INTERNAL`, `TYPE_MISMATCH`. Argument-parsing failures have their own finer-grained codes — `UNKNOWN_OPTION` (unrecognized flag, often with a "Did you mean" hint), `PARSE_ERROR` (missing/malformed argument), and `PROJECTION_INVALID_SHAPE` (unparseable `--projection`) — rather than a generic `BAD_INPUT`. Programmatic callers should match on `code`, not `message`.

## CLI invocation — finding `dcupl`

If `dcupl` isn't on PATH, the project's local bin is at `node_modules/.bin/dcupl`. Inside the dcupl-cli repo itself, use `node dist/index.js app ...` after `npm run build`.

```bash
which dcupl 2>/dev/null && echo "use: dcupl"
test -x ./node_modules/.bin/dcupl && echo "use: ./node_modules/.bin/dcupl"
test -f ~/Desktop/dcupl/dcupl-cli/dist/index.js && echo "use: node ~/Desktop/dcupl/dcupl-cli/dist/index.js"
```

## End-to-end example for an agent task

User: *"What's the breakdown of categories in /tmp/products.csv, and what's the avg price of shoes?"*

The agent's flow:

1. **Reuse before recreate.** Run `dcupl app list --json` to see if a daemon already holds this data. If yes, capture its appId and skip to step 4.

2. **Ask before writing.** Avg price means we need a `float` model. Tell the user: *"I'll write a model definition to `dcupl/Product.dcupl.json` so you can reuse it later. OK?"* Wait for their go-ahead. (For inline use without persisting, `--content` would also work.)

3. **Spin up daemon and ingest.**

   ```bash
   dcupl app create --auto-update --json
   # capture appId from output, e.g. swift-otter-7a2f

   dcupl app models set --file dcupl/Product.dcupl.json --json
   dcupl app data upsert --file /tmp/products.csv --model Product --key-property id --json
   ```

4. **Answer the questions.**

   ```bash
   dcupl app fn facets --model Product --attribute category --json
   dcupl app fn aggregate --model Product --attribute price --types avg \
     --query '{"operator":"eq","attribute":"category","value":"shoes"}' --json
   ```

5. **Sanity-check, then translate to prose** (don't dump JSON). Verify the facet counts sum to the row count and the avg isn't 0/undefined, then something like:

   > "Three categories: shoes is dominant with 312 items (47%), hats has 189 (29%), apparel has 150 (24%). Average price of shoes is $87.42."
   >
   > Commands run:
   > ```
   > dcupl app fn facets --model Product --attribute category --json
   > dcupl app fn aggregate --model Product --attribute price --types avg --query '...' --json
   > ```

6. **Leave the daemon running** for follow-ups. Don't `destroy` unless the user signals they're done. Optionally offer: *"Want me to drill into a specific category, or anything else? The daemon's still up — I can also clean it up now if you're done."*
