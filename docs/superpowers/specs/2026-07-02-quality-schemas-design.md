# Quality rules: schema exposure, skill guidance, restrictiveness convention

**Date:** 2026-07-02
**Repos touched:** `dcupl` (@dcupl/common), `dcupl-cli`, `dcupl-plugins` (dcupl skill)

## Problem

The dcupl engine has a full quality/validation system (`ModelQualityConfig`,
`AttributeQualityConfig`, `AttributeValidatorConfig`), but:

1. **Not discoverable.** No standalone entry in the CLI's `SCHEMA_REGISTRY` — the types
   only appear buried inside `dcupl schemas get ModelDefinition` output, and the curated
   `ModelDefinition.example.json` contains zero quality usage.
2. **The skill misleads.** `references/model-authoring.md` says "Enable quality rules
   (`quality.enabled: true`)" — but quality is **on by default**.
3. **The type lies.** `ModelQualityConfig.attributes` advertises model-level `validators`,
   but the engine ignores them (`handleValidators` reads `property.quality?.validators`
   directly, bypassing the merged config — `packages/core/src/libs/model-parser/model/model.ts:442`).
4. **No convention for restrictiveness.** `validatorHandling: 'strict'` silently drops
   invalid values from loaded data; an agent authoring quality rules never asks the user
   whether that's wanted.

## Verified engine semantics (floor: @dcupl/* 2.0.0-beta.6)

- **Defaults** (`model.ts:70-80`): `enabled: true`, `required: true`, `nullable: false`,
  `forceStrictDataType: false`, `validatorHandling: 'loose'`.
- **Two-tier enablement**: checks run only when the global quality controller is enabled
  (error tracking / `--quality`) AND the model's `quality.enabled` is true (both default on).
- **Merge order** (`model.ts:166-170`): built-in defaults ← model `quality.attributes`
  ← per-attribute `quality`. Flags (`required`/`nullable`/`forceStrictDataType`/
  `validatorHandling`) respect the merge; **`validators` do not** — per-attribute only.
- **loose vs strict**: `loose` reports `InvalidValidator` (group `PropertyDataError`) and
  keeps the value; `strict` reports AND drops the value from loaded data (`unique` deletes
  duplicate values post-init). `forceStrictDataType: true` disables coercion — wrong-typed
  raw values become `WrongDataType` + dropped.
- **Validators available**: `email`, `enum`, `pattern`, `min`, `max`, `minLength`,
  `maxLength`, `startsWith`, `endsWith`, `includes`, `unique`. Shape:
  `{ "<name>": { "value": <any> } }`. `custom` exists in source but is commented out.

## Decisions

| Decision | Choice |
|---|---|
| Registry exposure | Both `ModelQualityConfig` and `AttributeQualityConfig` entries + curated example |
| Model-level validators | Narrow the type in @dcupl/common (type-only, no behavior change) |
| Restrictiveness UX | Two axes asked separately (handling, coverage) |

## Deliverable 1 — `dcupl` (@dcupl/common): narrow `ModelQualityConfig`

In `packages/common/src/types/model.types.ts` (~line 424):

```ts
export type ModelQualityConfig = {
  enabled?: boolean;
  /** Model-wide defaults for attribute quality FLAGS. Concrete validators are
   *  per-attribute only and are not applied from here. */
  attributes?: Omit<AttributeQualityConfig, 'validators'>;
};
```

- Add JSDoc on `AttributeQualityConfig` documenting defaults and loose/strict semantics
  (this text is what `dcupl schemas get` emits — it is user-facing documentation).
- No runtime change. Ships with the next `2.0.0-beta.x` release.

## Deliverable 2 — `dcupl-cli`: registry entries + examples

In `src/functions/schemas/registry.ts`, add to group `Models` (package `@dcupl/common`,
file `dist/esm/types/model.types.d.ts`):

1. **`ModelQualityConfig`** — description: "Model-level quality: `enabled` (default true)
   plus flag defaults for all attributes. Validators are per-attribute — see
   AttributeQualityConfig." No example file.
2. **`AttributeQualityConfig`** — description: "Per-attribute quality: required/nullable/
   forceStrictDataType, validators (email, enum, pattern, min/max, minLength/maxLength,
   startsWith/endsWith, includes, unique), validatorHandling: loose (report) vs strict
   (drop value)." With `exampleFile: 'AttributeQualityConfig.example.json'`.

New `src/functions/schemas/examples/AttributeQualityConfig.example.json`: a realistic
quality block with 2–3 validators and explicit `validatorHandling`.

Enrich `ModelDefinition.example.json`: model-level `quality` with flag defaults (e.g.
`{ "attributes": { "nullable": true } }`) + one property carrying per-attribute
`validators` — shows placement in context. Both examples are auto-typechecked by
`examples-typecheck.spec.ts` (no new test wiring needed; the ModelDefinition example must
NOT use model-level validators or it will fail typecheck once Deliverable 1 lands).

Transitive extraction means `AttributeQualityConfig` automatically emits
`AttributeValidatorConfig`, `ValidatorConfig`, `ValidatorErrorType`.

## Deliverable 3 — `dcupl-plugins`: skill update

### New section in `dcupl/skills/dcupl/references/model-authoring.md` — "Quality rules & validators"

- Fix line 75 ("Enable quality rules (`quality.enabled: true`)…") to reflect the
  on-by-default reality; point it at the new section.
- Defaults table (quality ON by default; every attribute required + non-nullable by default).
- Two-tier enablement.
- loose vs strict semantics — **strict drops values from loaded data**; never default to
  strict silently.
- Validator list + `{ "min": { "value": 0 } }` shape; errors surface as `InvalidValidator`
  in `PropertyDataError`.
- ⚠️ Validators are per-attribute only. Model-level `quality.attributes.validators` never
  ran; on `@dcupl/common` versions before the narrowing, the type still (wrongly) permits
  them.
- **Restrictiveness convention** — before adding quality rules to a model, ask the user
  two questions, separately:
  1. *Handling:* "Should invalid values be dropped from the loaded data (`strict`) or kept
     and just reported (`loose`, the default)?"
  2. *Coverage:* "How aggressively should I add validators — none (just required/nullable
     flags), obvious ones (email/enum/pattern where data clearly implies them), or
     everything inferable (min/max ranges, lengths, uniqueness)?"

### `SKILL.md` edits

- Discovery section: add cheatsheet line for `dcupl schemas get AttributeQualityConfig` /
  `ModelQualityConfig` (note: requires the CLI release that registers them).
- Routing table: quality-rule authoring routes to `references/model-authoring.md`.
- Error-taxonomy section: one clause noting `InvalidValidator` = a quality validator
  failed (loose keeps the value, strict dropped it).

## Sequencing

1. `dcupl`: type narrowing + JSDoc.
2. `dcupl-cli`: registry entries + examples (works against current beta; independent of 1
   as long as the ModelDefinition example avoids model-level validators).
3. `dcupl-plugins`: skill update last — documents final state, notes version floors.

## Out of scope

- Making the engine honor model-level validators (rejected: semantic footgun).
- Re-enabling the `custom` validator.
- Changing engine defaults (`required: true` is noisy on sparse data, but that's existing
  behavior — the skill documents it instead).
