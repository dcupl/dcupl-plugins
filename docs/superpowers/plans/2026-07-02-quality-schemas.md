# Quality Schemas Exposure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dcupl's quality/validator system discoverable (CLI schema registry + curated examples), honest (narrow the over-broad `ModelQualityConfig` type), and safely usable by agents (skill guidance + two-axis restrictiveness question).

**Architecture:** Three sequential deliverables across three repos: (1) type-only narrowing in `@dcupl/common`, (2) two new `SCHEMA_REGISTRY` entries + example JSONs in `dcupl-cli` (auto-typechecked by existing spec infrastructure), (3) new "Quality rules & validators" section in the dcupl skill. No runtime behavior changes anywhere.

**Tech Stack:** TypeScript, vitest (both code repos), lodash `merge` semantics (context only), markdown (skill).

**Spec:** `docs/superpowers/specs/2026-07-02-quality-schemas-design.md` (this repo)

## Global Constraints

- Repos (absolute paths): SDK = `/Users/dominikstrasser/Desktop/dcupl/dcupl`, CLI = `/Users/dominikstrasser/Desktop/dcupl/dcupl-cli`, skill = `/Users/dominikstrasser/Desktop/dcupl/dcupl-plugins`.
- Engine facts (verified, do not re-derive): defaults are `enabled: true`, `required: true`, `nullable: false`, `forceStrictDataType: false`, `validatorHandling: 'loose'`. `'strict'` drops failing values from loaded data; `unique` deletes duplicate values. Validators run per-attribute only (`model.ts:442` reads `property.quality?.validators` directly).
- Available validators: `email`, `enum`, `pattern`, `min`, `max`, `minLength`, `maxLength`, `startsWith`, `endsWith`, `includes`, `unique`. Each config is `{ value?: any }`; `email`/`unique` ignore the value.
- The enriched `ModelDefinition.example.json` MUST NOT use model-level `validators` (it must typecheck against both the current broad type and the narrowed type).
- Skill floor version is `@dcupl/cli 1.4.0-beta.0` — the new registry entries only exist in later releases; skill text must say so.
- Commit at the end of every task, in that task's repo. Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Do NOT publish/release any package; releases are a manual follow-up for the user.

---

### Task 1: Narrow `ModelQualityConfig` in `@dcupl/common` (repo: dcupl)

**Files:**
- Modify: `/Users/dominikstrasser/Desktop/dcupl/dcupl/packages/common/src/types/model.types.ts:422-461` (the `ModelQualityConfig` and `AttributeQualityConfig` type declarations)
- Temp (created then deleted): `/Users/dominikstrasser/Desktop/dcupl/dcupl/packages/common/quality-type-check.tmp.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ModelQualityConfig.attributes` typed as `Omit<AttributeQualityConfig, 'validators'>`; JSDoc on both types (this JSDoc is emitted verbatim by `dcupl schemas get` — it is user-facing docs). Tasks 2–5 rely on the semantics documented here, not on this release being published.

- [ ] **Step 1: Write the failing type assertion (temp file)**

Create `/Users/dominikstrasser/Desktop/dcupl/dcupl/packages/common/quality-type-check.tmp.ts`:

```ts
import type { ModelQualityConfig } from './src/types/model.types';

// Flags at model level must stay allowed.
export const flagsOk: ModelQualityConfig = {
  enabled: true,
  attributes: { required: false, nullable: true, forceStrictDataType: false, validatorHandling: 'strict' },
};

// Model-level validators must be rejected after narrowing.
export const validatorsRejected: ModelQualityConfig = {
  attributes: {
    // @ts-expect-error validators are per-attribute only
    validators: { email: {} },
  },
};
```

- [ ] **Step 2: Run tsc to verify it fails**

```bash
cd /Users/dominikstrasser/Desktop/dcupl/dcupl && npx tsc --noEmit --strict --skipLibCheck --target es2022 --module esnext --moduleResolution bundler packages/common/quality-type-check.tmp.ts
```

Expected: FAIL with `error TS2578: Unused '@ts-expect-error' directive` (the broad type still permits `validators`, so the suppressed error never fires).

- [ ] **Step 3: Narrow the type and add JSDoc**

In `packages/common/src/types/model.types.ts`, replace the current declaration:

```ts
export type ModelQualityConfig = {
  enabled?: boolean;
  attributes?: AttributeQualityConfig;
};
```

with:

```ts
export type ModelQualityConfig = {
  /**
   * Master switch for quality checks on this model. Default: true.
   * Checks only run when error tracking is also enabled globally
   * (two-tier enablement).
   */
  enabled?: boolean;
  /**
   * Model-wide defaults for the attribute quality FLAGS
   * (required / nullable / forceStrictDataType / validatorHandling),
   * merged under each attribute's own `quality`.
   * Concrete `validators` are per-attribute only and cannot be set here.
   */
  attributes?: Omit<AttributeQualityConfig, 'validators'>;
};
```

And replace the current declaration:

```ts
export type AttributeQualityConfig = {
  required?: boolean;
  nullable?: boolean;
  forceStrictDataType?: boolean;
  validators?: AttributeValidatorConfig;
  validatorHandling?: ValidatorErrorType;
};
```

with:

```ts
/**
 * Quality rules for a single property or reference.
 *
 * Defaults: required: true, nullable: false, forceStrictDataType: false,
 * validatorHandling: 'loose'.
 *
 * validatorHandling decides what happens when a validator fails:
 * 'loose' (default) reports an InvalidValidator error and keeps the value;
 * 'strict' reports AND drops the value from the loaded data.
 * forceStrictDataType: true disables type coercion — wrong-typed raw
 * values are reported as WrongDataType and dropped.
 */
export type AttributeQualityConfig = {
  required?: boolean;
  nullable?: boolean;
  forceStrictDataType?: boolean;
  validators?: AttributeValidatorConfig;
  validatorHandling?: ValidatorErrorType;
};
```

- [ ] **Step 4: Run tsc to verify the assertion passes**

```bash
cd /Users/dominikstrasser/Desktop/dcupl/dcupl && npx tsc --noEmit --strict --skipLibCheck --target es2022 --module esnext --moduleResolution bundler packages/common/quality-type-check.tmp.ts
```

Expected: PASS (exit 0, no output). If it fails on unrelated resolution errors inside `model.types.ts` imports, fix the tsc flags, not the source.

- [ ] **Step 5: Verify nothing else in the monorepo breaks**

```bash
cd /Users/dominikstrasser/Desktop/dcupl/dcupl && npm run build -w packages/common && npm test
```

Expected: build succeeds; full test suite passes (test fixtures only use model-level flags like `required: false` — verified during design — so nothing references the removed capability).

- [ ] **Step 6: Delete the temp file and commit**

```bash
rm /Users/dominikstrasser/Desktop/dcupl/dcupl/packages/common/quality-type-check.tmp.ts
cd /Users/dominikstrasser/Desktop/dcupl/dcupl && git add packages/common/src/types/model.types.ts && git commit -m "fix(common): narrow ModelQualityConfig — validators are per-attribute only

The engine ignores model-level quality.attributes.validators (handleValidators
reads property.quality.validators directly), so the type advertised a capability
that never ran. Flags (required/nullable/forceStrictDataType/validatorHandling)
still work as model-wide defaults. Type-only change; adds user-facing JSDoc
emitted by 'dcupl schemas get'.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Register quality schemas + `AttributeQualityConfig` example (repo: dcupl-cli)

**Files:**
- Modify: `/Users/dominikstrasser/Desktop/dcupl/dcupl-cli/src/functions/schemas/registry.ts:52` (insert after the `Reference` entry, before `AppLoaderConfiguration`)
- Create: `/Users/dominikstrasser/Desktop/dcupl/dcupl-cli/src/functions/schemas/examples/AttributeQualityConfig.example.json`
- Test: `/Users/dominikstrasser/Desktop/dcupl/dcupl-cli/src/functions/schemas/registry.spec.ts`

**Interfaces:**
- Consumes: `SchemaEntry` shape from `registry.ts` (fields: name, group, kind, package, file, exportPath, exampleFile?, description). The types `ModelQualityConfig`/`AttributeQualityConfig` already exist in the installed `@dcupl/common`'s `dist/esm/types/model.types.d.ts` — no dependency on Task 1 being published.
- Produces: registry entries named exactly `ModelQualityConfig` and `AttributeQualityConfig` (Task 5's skill text references these names verbatim).

- [ ] **Step 1: Write the failing registry test**

Append to `src/functions/schemas/registry.spec.ts` (top-level, after the existing `describe` blocks; `findSchema` is already imported):

```ts
describe('schema registry — quality', () => {
  it('registers the quality schemas in the Models group', () => {
    for (const name of ['ModelQualityConfig', 'AttributeQualityConfig']) {
      const entry = findSchema(name);
      expect(entry, `missing ${name}`).toBeDefined();
      expect(entry?.group).toBe('Models');
      expect(entry?.kind).toBe('ts');
      expect(entry?.package).toBe('@dcupl/common');
      expect(entry?.file).toBe('dist/esm/types/model.types.d.ts');
    }
    expect(findSchema('AttributeQualityConfig')?.exampleFile).toBe('AttributeQualityConfig.example.json');
    expect(findSchema('ModelQualityConfig')?.exampleFile).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/dominikstrasser/Desktop/dcupl/dcupl-cli && npx vitest run src/functions/schemas/registry.spec.ts
```

Expected: FAIL with `missing ModelQualityConfig`.

- [ ] **Step 3: Add the two registry entries**

In `src/functions/schemas/registry.ts`, insert after the `Reference` entry's closing `},` (line 52) and before the `AppLoaderConfiguration` entry:

```ts
  {
    name: 'ModelQualityConfig',
    group: 'Models',
    kind: 'ts',
    package: '@dcupl/common',
    file: 'dist/esm/types/model.types.d.ts',
    exportPath: 'ModelQualityConfig',
    description: 'Model-level quality: enabled (default true) plus flag defaults for all attributes. Validators are per-attribute — see AttributeQualityConfig.',
  },
  {
    name: 'AttributeQualityConfig',
    group: 'Models',
    kind: 'ts',
    package: '@dcupl/common',
    file: 'dist/esm/types/model.types.d.ts',
    exportPath: 'AttributeQualityConfig',
    exampleFile: 'AttributeQualityConfig.example.json',
    description: 'Per-attribute quality: required/nullable/forceStrictDataType, validators (email, enum, pattern, min/max, minLength/maxLength, startsWith/endsWith, includes, unique), validatorHandling loose (report) vs strict (drop value).',
  },
```

- [ ] **Step 4: Create the curated example**

Create `src/functions/schemas/examples/AttributeQualityConfig.example.json`:

```json
{
  "required": true,
  "nullable": false,
  "validators": {
    "minLength": { "value": 2 },
    "pattern": { "value": "^[A-Z]{2}-\\d{4}$" },
    "unique": {}
  },
  "validatorHandling": "loose"
}
```

(`unique` ignores its `value` — an empty config object is the canonical form.)

- [ ] **Step 5: Run the full schemas test suite**

```bash
cd /Users/dominikstrasser/Desktop/dcupl/dcupl-cli && npx vitest run src/functions/schemas
```

Expected: PASS, including a NEW auto-generated case in `examples-typecheck.spec.ts` ("AttributeQualityConfig example is assignable to AttributeQualityConfig") — that spec iterates all ts-kind entries with an `exampleFile`, no wiring needed.

- [ ] **Step 6: Smoke-test the built CLI**

```bash
cd /Users/dominikstrasser/Desktop/dcupl/dcupl-cli && npm run build && node bin/dcupl schemas get AttributeQualityConfig --example
```

Expected: prints the type source (including `AttributeValidatorConfig`, `ValidatorConfig`, `ValidatorErrorType` pulled in transitively) followed by the example JSON. Also run `node bin/dcupl schemas list` and confirm both new names appear under Models.

- [ ] **Step 7: Commit**

```bash
cd /Users/dominikstrasser/Desktop/dcupl/dcupl-cli && git add src/functions/schemas/registry.ts src/functions/schemas/registry.spec.ts src/functions/schemas/examples/AttributeQualityConfig.example.json && git commit -m "feat(schemas): register ModelQualityConfig + AttributeQualityConfig with example

Quality types were only reachable buried inside 'schemas get ModelDefinition'.
Standalone entries make them discoverable in 'schemas list'.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Enrich `ModelDefinition.example.json` with quality usage (repo: dcupl-cli)

**Files:**
- Modify: `/Users/dominikstrasser/Desktop/dcupl/dcupl-cli/src/functions/schemas/examples/ModelDefinition.example.json`
- Test: existing `/Users/dominikstrasser/Desktop/dcupl/dcupl-cli/src/functions/schemas/examples-typecheck.spec.ts` (no changes)

**Interfaces:**
- Consumes: nothing from other tasks. CONSTRAINT: no model-level `validators` (must typecheck against the currently installed broad `@dcupl/common` AND the Task-1-narrowed type).
- Produces: the canonical in-context quality example the skill (Task 4) points users at.

- [ ] **Step 1: Replace the example content**

Overwrite `src/functions/schemas/examples/ModelDefinition.example.json` with:

```json
{
  "key": "Product",
  "quality": {
    "enabled": true,
    "attributes": { "nullable": true }
  },
  "properties": [
    { "key": "id", "type": "string" },
    {
      "key": "name",
      "type": "string",
      "quality": {
        "required": true,
        "nullable": false,
        "validators": { "minLength": { "value": 2 } }
      }
    },
    {
      "key": "price",
      "type": "float",
      "quality": {
        "validators": { "min": { "value": 0 } },
        "validatorHandling": "loose"
      }
    },
    { "key": "tags", "type": "Array<string>" },
    { "key": "createdAt", "type": "date" }
  ],
  "references": [
    {
      "key": "category",
      "type": "singleValued",
      "model": "Category",
      "origin": "categoryId"
    }
  ],
  "data": [
    { "id": "p1", "name": "Widget", "price": 9.99, "tags": ["new"], "createdAt": "2026-01-15T00:00:00Z", "categoryId": "c1" }
  ]
}
```

(Everything except the `quality` blocks is unchanged from the current example. Model level shows flag defaults only; validators appear per-property.)

- [ ] **Step 2: Run the typecheck spec to verify it passes**

```bash
cd /Users/dominikstrasser/Desktop/dcupl/dcupl-cli && npx vitest run src/functions/schemas/examples-typecheck.spec.ts
```

Expected: PASS ("ModelDefinition example is assignable to ModelDefinition").

- [ ] **Step 3: Smoke-test the rendered example**

```bash
cd /Users/dominikstrasser/Desktop/dcupl/dcupl-cli && npm run build && node bin/dcupl schemas get ModelDefinition --example
```

Expected: output ends with the enriched example including both `quality` blocks.

- [ ] **Step 4: Commit**

```bash
cd /Users/dominikstrasser/Desktop/dcupl/dcupl-cli && git add src/functions/schemas/examples/ModelDefinition.example.json && git commit -m "docs(schemas): show quality rules in the ModelDefinition example

Model-level flag defaults + per-property validators, matching what the
engine actually honors.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Skill — "Quality rules & validators" section in model-authoring.md (repo: dcupl-plugins)

**Files:**
- Modify: `/Users/dominikstrasser/Desktop/dcupl/dcupl-plugins/dcupl/skills/dcupl/references/model-authoring.md` (fix line 75 bullet; append new `##` section at end of file, after "Sanity-check after editing")

**Interfaces:**
- Consumes: schema names `AttributeQualityConfig` / `ModelQualityConfig` from Task 2, exactly as registered.
- Produces: section heading `## Quality rules & validators` — Task 5's SKILL.md routing row references this heading verbatim.

- [ ] **Step 1: Fix the wrong "After generation" bullet**

In `references/model-authoring.md`, replace:

```markdown
- Enable quality rules (`quality.enabled: true`) and per-property validators.
```

with:

```markdown
- Tune quality rules and add per-property validators where the data warrants them — see "Quality rules & validators" below. Quality is ON by default; you are tuning it, not enabling it.
```

- [ ] **Step 2: Append the new section at the end of the file**

```markdown
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

- **Model level** — `"quality": { "enabled": true, "attributes": { …flags… } }` sets flag defaults for ALL attributes. ⚠️ Only the four flags work here. **Validators are per-attribute only** — on `@dcupl/common` ≤ 2.0.0-beta.6 the type still permits `attributes.validators`, but the engine silently ignores them (never ran; the type was narrowed in later versions).
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
        "validatorHandling": "strict"
      }
    }
  ]
}
```

### Available validators

`email`, `enum`, `pattern`, `min`, `max`, `minLength`, `maxLength`, `startsWith`, `endsWith`, `includes`, `unique` — each configured as `{ "value": <arg> }` (`email` and `unique` ignore the value; `{}` is the canonical form). Failures land in `$DcuplErrorTrackingErrors` as errorType `InvalidValidator`, group `PropertyDataError`. Schemas: `dcupl schemas get AttributeQualityConfig --example` and `dcupl schemas get ModelQualityConfig` (registered in CLI releases **after 1.4.0-beta.0**; on older CLIs the types are visible inside `dcupl schemas get ModelDefinition`).

### Ask the user how restrictive to be — BEFORE adding quality rules

Restrictiveness is a data-mutation decision, not a style choice. Ask two questions, separately:

1. **Handling** — "When a value fails validation, should it be **dropped** from the loaded data (`validatorHandling: 'strict'`) or **kept and just reported** (`'loose'`, the default)?" Never choose `strict` silently — strict deletes failing values (and `unique` deletes duplicate values) from the loaded app.
2. **Coverage** — "How aggressively should I add validators?"
   - **none** — only tune `required` / `nullable` flags to match the data
   - **obvious** — add validators the data clearly implies (email columns, enum-like status columns, ID patterns)
   - **everything inferable** — also min/max ranges, string lengths, uniqueness derived from the observed data

After adding rules, re-run `dcupl validate` and compare against the pre-change baseline (see SKILL.md → "Validate a workspace").
```

- [ ] **Step 3: Verify anchors and rendering**

```bash
cd /Users/dominikstrasser/Desktop/dcupl/dcupl-plugins && grep -n "Quality rules & validators\|quality.enabled: true" dcupl/skills/dcupl/references/model-authoring.md
```

Expected: the new `##` heading appears once; the old "Enable quality rules (`quality.enabled: true`)" phrasing appears **zero** times (the only `quality.enabled` mentions are in the new section's accurate context). Read the section once top-to-bottom for table rendering.

- [ ] **Step 4: Commit**

```bash
cd /Users/dominikstrasser/Desktop/dcupl/dcupl-plugins && git add dcupl/skills/dcupl/references/model-authoring.md && git commit -m "docs(dcupl skill): quality rules & validators — defaults, loose/strict, restrictiveness questions

Fixes the wrong 'enable quality.enabled: true' advice (quality is on by
default), documents strict-drops-values semantics and the per-attribute-only
validator rule, and adds the two-axis restrictiveness question convention.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Skill — SKILL.md discovery, routing, and error-taxonomy pointers (repo: dcupl-plugins)

**Files:**
- Modify: `/Users/dominikstrasser/Desktop/dcupl/dcupl-plugins/dcupl/skills/dcupl/SKILL.md` (three surgical edits)

**Interfaces:**
- Consumes: section heading `## Quality rules & validators` from Task 4; schema names from Task 2.
- Produces: nothing downstream — final task.

- [ ] **Step 1: Add the discovery cheatsheet bullet**

In SKILL.md's discovery section, directly after this existing bullet:

```markdown
- `dcupl schemas get ModelDefinition --example` — full property/reference/quality shape
```

add:

```markdown
- `dcupl schemas get AttributeQualityConfig --example` / `ModelQualityConfig` — quality flags & validators; per-attribute vs model-level split (standalone entries exist in CLI releases after 1.4.0-beta.0)
```

- [ ] **Step 2: Add the routing-table row**

In the `## Routing` table, directly after the row `| Generating a model from a data file (…) | references/model-authoring.md |`, add:

```markdown
| Adding quality rules / validators to a model (ask the user how restrictive first) | `references/model-authoring.md` → "Quality rules & validators" |
```

- [ ] **Step 3: Annotate `InvalidValidator` in the error taxonomy**

In the "Model & data errors" section, in the types list, replace the bare:

```markdown
`InvalidValidator`,
```

with:

```markdown
`InvalidValidator` (a quality validator failed — `loose` handling kept the value, `strict` dropped it),
```

- [ ] **Step 4: Verify anchors**

```bash
cd /Users/dominikstrasser/Desktop/dcupl/dcupl-plugins && grep -n "AttributeQualityConfig\|Quality rules & validators\|InvalidValidator (" dcupl/skills/dcupl/SKILL.md
```

Expected: one discovery bullet, one routing row, one annotated taxonomy entry.

- [ ] **Step 5: Commit**

```bash
cd /Users/dominikstrasser/Desktop/dcupl/dcupl-plugins && git add dcupl/skills/dcupl/SKILL.md && git commit -m "docs(dcupl skill): route + discovery pointers for quality schemas

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Manual follow-ups (not tasks)

- Publish `@dcupl/common` (next `2.0.0-beta.x`) and a new `@dcupl/cli` release so `schemas get AttributeQualityConfig` works outside the dev checkout. Until then the skill's "after 1.4.0-beta.0" caveat covers the gap.
- After the CLI release, optionally bump the skill's floor-version line in SKILL.md.
