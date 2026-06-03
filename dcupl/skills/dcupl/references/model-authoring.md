# dcupl — Model authoring from a data file

`dcupl generate model --from <file>` reads a CSV, JSON, or NDJSON file, infers a typed `ModelDefinition`, and writes a `*.dcupl.json` to the project's `modelsBasePath`. Use it to skip the blank-page problem and to get correct types for numeric aggregation. **Runs inside a dcupl project only** (requires `dcupl.config.json`).

> Canonical doc: `dcupl-cli/docs/flows/workflow-model-authoring.md`

## Flags

| Flag | Default | Purpose |
|---|---|---|
| `--from <file>` | required | Source file: `.csv`, `.json`, or `.ndjson` |
| `--name <key>` | filename basename, lowercased | Override the model key |
| `--register` | off | Also writes a `model` + `data` resource pair to `dcupl.lc.json` |
| `--sample-size <n>` | all rows | Limit rows scanned for type inference |

```bash
# Minimal
dcupl generate model --from products.csv

# All flags
dcupl generate model --from products.csv --name products --register --sample-size 500
```

## Type inference rules

| Value seen in data | Inferred type | Notes |
|---|---|---|
| `"42"` (integer string) | `int` | Whole numbers only. |
| `"3.14"`, `"9.99"` | `float` | Any decimal. |
| `"true"` / `"false"` | `boolean` | Exact strings, case-sensitive. |
| `"2024-01-31"` or `"2024-01-31T10:00:00Z"` | `date` | Strict ISO-8601 only. |
| Mixed int + float | `float` | Silent promotion; no warning. |
| `"[\"a\",\"b\"]"` (JSON array string) | `json` | Opaque JSON; no element typing. |
| Genuinely mixed types (e.g. int + string) | `any` | Needs manual resolution. |
| Ambiguous date (`"01/07/2024"`) | `string` + date-like warning | Promote with `inputFormat`. |
| Anything else | `string` | Safe default. |

## Diagnostics warnings

- **Mixed types → `any`** — column holds incompatible primitives (e.g. int + string). Pin an explicit `type`; use `valueMappings` to normalise if needed.
- **Sparse column (≥ 50% empty)** — valid type but many blank cells. Add `quality.required: true` for mandatory fields, or `quality.nullable: true` for genuinely optional ones.
- **Non-ISO date-like column** — looks like a date but isn't strict ISO-8601. Promote manually with `inputFormat`:

  ```json
  { "key": "created", "type": "date", "inputFormat": "MM/dd/yyyy", "UTC": true }
  ```

  Common formats: `"yyyy-MM-dd"`, `"dd.MM.yyyy"`, `"MM/dd/yyyy"`, `"ts_seconds"`, `"ts_milliseconds"`.

## What `--register` writes into `dcupl.lc.json`

Two resource entries are appended — one `model` and one `data`:

```json
{
  "resources": [
    { "url": "${baseUrl}/models/products.dcupl.json", "type": "model" },
    { "url": "products.csv", "type": "data", "model": "products" }
  ]
}
```

The `url` of the data resource is the raw `--from` path as passed. The full data-resource shape (part of `AppLoaderConfiguration`'s Resource union — there is no standalone `DataResource` schema; see `dcupl schemas get AppLoaderConfiguration --example`) also accepts `options.keyProperty`, `options.autoGenerateKey`, and `options.csvParserOptions` (`delimiter`, `quoteChar`, `escapeChar`, `commentChar`).

> ⚠ **Always rewrite data URLs to `${baseUrl}/...` after `--register`.** The generator currently writes the raw path it was passed (e.g. `"url": "dcupl/data/articles.csv"`) — model resources get `${baseUrl}/models/...` correctly, but data resources do not. The unprefixed path then fails under `--auto-serve` with `InvalidResource` / `Failed to parse URL from dcupl/data/...` (visible in `$DcuplErrorTrackingErrors`), and the loader silently reports `data: 0 resources processed` while the build still looks green. Fix by editing `dcupl.lc.json` so each data resource reads:
>
> ```json
> { "type": "data", "model": "articles", "url": "${baseUrl}/data/articles.csv" }
> ```
>
> Re-run `dcupl app create --load` — `processed` should now report `data: N` instead of `data: 0`.

⚠ Only set `keyProperty` to a column you have verified is unique — collisions overwrite rows silently with no error. See "Keying data resources" in `SKILL.md`.

## After generation

The generated file is a starting point — inference does not set `filter: true` on any property and does not add references. Edit the draft to:

- Add `filter: true` (and `aggregate: true`) on columns you will query or aggregate.
- Replace `string` columns that are actually foreign keys with `singleValued` / `multiValued` references — see "Authoring references" below.
- Enable quality rules (`quality.enabled: true`) and per-property validators.
- Fix any `any`-typed columns flagged by the diagnostics.

## Authoring references

The generator never adds references — it only types columns. Foreign-key columns come out as `string`/`int` and you upgrade them by hand. Three rules cover the vast majority of mistakes.

### Rule 1 — `Reference.key` is the local data column, not the remote model

A simple `Reference` joins on the local column whose value holds the foreign key. `key` must equal that column name; `model` names the target.

```json
// Article → Vendor via the local `vendorId` column
"references": [
  { "key": "vendorId", "type": "singleValued", "model": "Vendor" }
]

// Article → many Tags via the local `tagIds` column (array)
"references": [
  { "key": "tagIds", "type": "multiValued", "model": "Tag" }
]
```

A `Reference` has no `property` field; the `key` *is* the local column. Confusion with `model` (the remote target) is the most common mistake.

### Rule 2 — Reference key types must match across the join

The resolver does not coerce. If `Vendor.key` is `int` and `Article.vendorId` is `string`, every join fails with `RemoteReferenceKeyNotFound` — even on rows where the values look identical.

Fix at the source by pinning both columns to the same type in their model definitions, or transform the data before load. After fixing, re-run the `$DcuplErrorTrackingErrors` query from [Validate a workspace](../SKILL.md#validate-a-workspace) — the errors should disappear.

> **Heads up — mixed CSV + JSON sources.** When the same FK appears in a CSV on one side and a JSON file on the other, types diverge silently: `dcupl generate model` infers numeric-looking CSV columns as `int`, while JSON FKs are usually stringly typed (`"customerId": "65"`). The join then fails silently. **When sources mix CSV and JSON for the same FK, normalize both sides to `string` early** — pin both `key` and the local FK column to `type: "string"` in their model definitions before loading. Don't trust the generator's per-file inference here; cross-file FK consistency is on you.

### Rule 3 — `derive` is for values, not relationships

`derive: { localReference, remoteReference }` does **not** declare a relationship. It *pulls a value across an existing relationship* — the local model must already have a Reference named `localReference`, and the foreign model must already have a Reference (or attribute) named `remoteReference`.

```json
// OrderLine already has a Reference to Article; Article has a Reference to Vendor.
// This pulls Vendor onto OrderLine without explicitly hopping each query.
{
  "key": "vendor",
  "type": "singleValued",
  "model": "Vendor",
  "derive": { "localReference": "article", "remoteReference": "vendor" }
}
```

Using `derive` to *create* a relationship (e.g. with `localReference` set to a raw column name instead of an existing Reference key) produces misleading errors that look like the FK itself is broken.

### Promoting a property to a Reference — drop the property entry

`dcupl generate model --from` types every column as a primitive (`string`/`int`/etc.). When you promote one of those columns into a Reference, **remove the original property entry**. The Reference's `key` field *is* the column declaration — keeping both makes `fn metadata` list the attribute twice (once as `{type: "singleValued", model: "<X>"}`, once as the underlying primitive) and confuses anyone reading `app models get` output.

```json
// BEFORE — generated by `dcupl generate model`
{
  "key": "Order",
  "properties": [
    { "key": "orderId",    "type": "string" },
    { "key": "customerId", "type": "string" }   // ← drop this when promoting
  ]
}

// AFTER — customerId promoted to a Reference
{
  "key": "Order",
  "properties": [
    { "key": "orderId", "type": "string" }       // customerId entry removed
  ],
  "references": [
    { "key": "customerId", "type": "singleValued", "model": "Customer" }
  ]
}
```

Leaving both entries in place does not error, but it is the canonical "looks weird, works fine, hides intent" footgun.

### Sanity-check after editing

After adding or changing references, re-validate the workspace — [Validate a workspace](../SKILL.md#validate-a-workspace) loads the loader config in a daemon and surfaces `RemoteReferenceKeyNotFound`, `MissingReference`, and friends from `$DcuplErrorTrackingErrors`. A green result is the only proof the references resolve.
