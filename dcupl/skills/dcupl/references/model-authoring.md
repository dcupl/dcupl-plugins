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
| `--key-property <col>` | inferred / prompted | Use this column as the record key — skips key inference and its interactive prompt |
| `--dry-run` | off | Preview the inferred model (and `--register` resources) without writing anything |

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
| `"[\"a\",\"b\"]"` (JSON array *string* in a CSV cell) | `string` | A stringified array is just a string; only a native object/array value infers as `json`. |
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
    { "url": "${baseUrl}/data/products.csv", "type": "data", "model": "products" }
  ]
}
```

`--register` appends a `model` resource (`${baseUrl}/models/<file>`) and a `data` resource (`${baseUrl}/data/<basename>`), both correctly prefixed. The full data-resource shape (part of `AppLoaderConfiguration`'s Resource union — there is no standalone `DataResource` schema; see `dcupl schemas get AppLoaderConfiguration --example`) also accepts `options.keyProperty`, `options.autoGenerateKey`, and `options.csvParserOptions` (`delimiter`, `quoteChar`, `escapeChar`, `commentChar`).

⚠ Only set `keyProperty` to a column you have verified is unique — collisions overwrite rows silently with no error. See "Keying data resources" in `SKILL.md`.

## After generation

The generated file is a starting point — inference does not set `filter: true` on any property and does not add references. Edit the draft to:

- Add `filter: true` (and `aggregate: true`) on columns you will query or aggregate.
- Replace `string` columns that are actually foreign keys with `singleValued` / `multiValued` references — see "Authoring references" below.
- Tune quality rules and add per-property validators where the data warrants them — see "Quality rules & validators" below. Quality is ON by default; you are tuning it, not enabling it.
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

### Rule 2 — Reference keys are string-coerced at join time

The resolver `String()`-coerces both the FK value and the remote keys at join time, so a numeric-string FK (e.g. `"65"`) resolves fine against an `int`-keyed model (key `65`). Mismatched *declared types* alone do not break the join. A `RemoteReferenceKeyNotFound` (carrying `meta.remoteModel` / `meta.remoteKey`) means the key genuinely doesn't exist — almost always because the two sides have different *string representations*: zero-padding, `"65.0"` vs `65`, or stray whitespace.

Fix at the source by normalizing the key's string form on both sides in their model definitions, or transform the data before load. After fixing, re-run [`dcupl validate`](../SKILL.md#validate-a-workspace) — the errors should disappear.

> **Heads up — mixed CSV + JSON sources.** When the same FK appears in a CSV on one side and a JSON file on the other, the values can take different string forms: `dcupl generate model` infers numeric-looking CSV columns as `int`, while JSON FKs are often stringly typed (`"customerId": "65"`). Coercion handles plain `int` vs numeric-string, but it won't paper over `"65.0"` vs `65` or padded/whitespaced variants. **Normalize keys early** — settle on one consistent string representation for the FK across sources before loading. Don't trust the generator's per-file inference for cross-file FK consistency; that's on you.

### Rule 3 — `derive` is for hopping across an existing relationship, not declaring one

`derive` does **not** declare a relationship. It *reaches across an existing one* — the local model must already have a Reference named `localReference`. There are two distinct shapes, and they use **different remote field names** (easy to get wrong):

**Property `derive`** — pulls a scalar VALUE across the existing Reference onto a property. Uses **`remoteProperty`** (plus an optional `separator`):

```json
// Article already has a Reference `vendorId` → Vendor.
// This copies Vendor's companyName onto Article as a plain property.
{
  "key": "vendorName",
  "type": "string",
  "derive": { "localReference": "vendorId", "remoteProperty": "companyName" }
}
```

**Reference `derive`** — derives a REFERENCE across the existing Reference. Uses **`remoteReference`**:

```json
// OrderLine already has a Reference to Article; Article has a Reference to Vendor.
// This pulls the Vendor reference onto OrderLine without explicitly hopping each query.
{
  "key": "vendor",
  "type": "singleValued",
  "model": "Vendor",
  "derive": { "localReference": "article", "remoteReference": "vendor" }
}
```

Properties use **`remoteProperty`**; references use **`remoteReference`**. Swapping them is a common silent mistake.

Using `derive` to *create* a relationship (e.g. with `localReference` set to a raw column name instead of an existing Reference key) produces misleading errors that look like the FK itself is broken.

### Composite keys — referencing INTO a composite-keyed model

A model can be keyed by several columns (`"keyProperty": ["masterCategory", "subCategory", "articleType"]` → internal keys like `"Apparel::Topwear::Shirts"`; see "Keying data resources" in SKILL.md). There is **no declarative composite FK** — a basic Reference joins on exactly one local column. The working bridge (resolves tens of thousands of rows against a small remote model in seconds at build):

**The solution: a QueryReference.** The `Reference` union accepts a `query` in place of a plain column join (`dcupl schemas get Reference`). The query is template-evaluated **per row**, with `${column}` placeholders filled from the raw data entry — so it can match several local columns against the remote model's properties:

```json
{
  "key": "category",
  "type": "singleValued",
  "model": "Category",
  "query": {
    "groupKey": "categoryLookup",
    "groupType": "and",
    "queries": [
      { "operator": "eq", "attribute": "masterCategory", "value": "${masterCategory}" },
      { "operator": "eq", "attribute": "subCategory",   "value": "${subCategory}" },
      { "operator": "eq", "attribute": "articleType",   "value": "${articleType}" }
    ]
  }
}
```

Fully declarative, performs fine at scale, and dotted traversal works exactly like any other reference (`fn groupBy --attribute category.masterCategory`, `--attribute category.key`).

> ⚠️ **QueryReference misses are SILENT.** Unlike a basic reference, a query that matches zero records produces NO `RemoteReferenceKeyNotFound` and no `_dcupl_ref_: "miss"` — the attribute is simply never assigned. After wiring one, probe for dangles explicitly:
> `dcupl app fn metadata --model <M> --query '{"operator":"isTruthy","attribute":"category","value":false}'` — `currentSize` is your miss count.

**Alternative: an `expression`-computed key column.** `PropertyBase.expression` is a real (if under-documented) feature — `{"key": "categoryKey", "type": "string", "expression": "${masterCategory}::${subCategory}::${articleType}"}` materializes a computed column on every row that mirrors the remote composite key, handy as a filter/inspection convenience. A basic reference keyed on that computed column does resolve (an earlier build-ordering bug that left the reference `undefined` no longer reproduces). **Still prefer the QueryReference above** — it's the cleaner, single-artifact declarative bridge and doesn't depend on an intermediate materialized column.

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

After adding or changing references, re-validate the workspace — [`dcupl validate`](../SKILL.md#validate-a-workspace) loads the loader config in a daemon and surfaces `RemoteReferenceKeyNotFound`, `MissingReference`, and friends (as `ReferenceDataError` warnings). A green result is the only proof the references resolve.

## Quality rules & validators

Quality checks are **on by default** — when error tracking is enabled (the default in `dcupl validate` and `dcupl app create --load`), every model is checked with no `quality` block at all. Two tiers must both be on: the global quality controller (CLI `--quality`, default true) AND the model's `quality.enabled` (default true).

Per-attribute defaults (no config needed):

| Flag | Default | Meaning when violated |
|---|---|---|
| `required` | `true` | missing value → `UndefinedValue` error |
| `nullable` | `false` | null value → `NullValue` error |
| `forceStrictDataType` | `false` | `false` = coerce (`String()` / `parseInt`); `true` = wrong-typed raw value → `WrongDataType` + value dropped |
| `validatorHandling` | `'loose'` | `'loose'` = report + keep value; `'strict'` = report + **drop the value from loaded data** |

So an unconfigured model already reports missing/null values (this is why sparse data produces `UndefinedValue` warnings). A `quality` block is for *tuning*: relaxing flags on sparse columns, or adding validators.

### Where quality config lives

- **Model level** — `"quality": { "enabled": true, "attributes": { …flags… } }` sets flag defaults for ALL attributes. ⚠️ Only the four flags work here. **Validators are per-attribute only** — on `@dcupl/common` ≤ 2.0.0-beta.6 the type still permits `attributes.validators`, but the engine silently ignores them (never ran; the type is narrowed since 2.0.0-beta.7).
- **Attribute level** — `"quality": { …flags…, "validators": { … } }` on a property or reference; overrides the model-level flags.

```json
{
  "key": "Product",
  "quality": { "attributes": { "nullable": true } },
  "properties": [
    {
      "key": "sku",
      "type": "string",
      "quality": {
        "validators": { "pattern": { "value": "^[A-Z]{2}-\\d{4}$" }, "unique": {} },
        "validatorHandling": "loose"
      }
    }
  ]
}
```

### Available validators

`email`, `enum`, `pattern`, `min`, `max`, `minLength`, `maxLength`, `startsWith`, `endsWith`, `includes`, `unique` — each configured as `{ "value": <arg> }` (`email` and `unique` ignore the value; `{}` is the canonical form). Failures land in `$DcuplErrorTrackingErrors` as errorType `InvalidValidator`, group `PropertyDataError`. Schemas: `dcupl schemas get AttributeQualityConfig --example` and `dcupl schemas get ModelQualityConfig` (registered since CLI **1.4.0-beta.1**; on older CLIs the types are visible inside `dcupl schemas get ModelDefinition`).

### Ask the user how restrictive to be — BEFORE adding quality rules

Restrictiveness is a data-mutation decision, not a style choice. Ask two questions, separately:

1. **Handling** — "When a value fails validation, should it be **dropped** from the loaded data (`validatorHandling: 'strict'`) or **kept and just reported** (`'loose'`, the default)?" Never choose `strict` silently — strict deletes failing values from the loaded app (under strict, `unique` even deletes duplicate values).
2. **Coverage** — "How aggressively should I add validators?"
   - **none** — only tune `required` / `nullable` flags to match the data
   - **obvious** — add validators the data clearly implies (email columns, enum-like status columns, ID patterns)
   - **everything inferable** — also min/max ranges, string lengths, uniqueness derived from the observed data

After adding rules, re-run `dcupl validate` and compare against the pre-change baseline (see SKILL.md → "Validate a workspace").
