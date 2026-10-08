# dcupl — Scripts and scripted endpoints

A dcupl **script** is customer JavaScript the SDK runs inside a `Dcupl` instance: one `.js` file, registered in `dcupl.lc.json` under a `scriptKey`, run in a **mode** the caller picks. The newest mode, `endpoint`, lets a deployed REST API instance answer HTTP routes from a script. This file covers the modes and their contracts, registration, the `endpoint` contract, how a REST API template declares `endpoints[]`, the served route, and how to try a script.

> **TL;DR:** write one function body that branches on `script_type`; register it as `{ "type": "script", "url": "${baseUrl}/scripts/<file>.js", "scriptKey": "<key>" }`; for an HTTP endpoint add `{ "path", "method", "scriptKey" }` to the template's `endpoints[]` and deploy — the runner serves it at `instance/<instanceKey>/endpoints/<path>`. Verified against `@dcupl/*` **2.0.0-beta.25** (dcupl/dcupl#312), app runner **3.1.0-beta.11** (dcupl/dcupl-app-runner#90), `@dcupl/cli` 1.4.0-beta.8 plus the `generate script --mode` / `generate api` scaffolds of **1.4.0-beta.11** (dcupl/dcupl-cli#255 — still open on 2026-10-08; the npm `beta` tag is 1.4.0-beta.10, which has neither flag, so check `dcupl --version` before relying on them). The `endpoint` mode and `endpoints[]` need those versions; older SDKs/runners ignore both.

Discovery first, as always: `dcupl schemas get AppLoaderConfiguration --example` has the Resource union (`script` / `operator` / `transformer`). There is **no `dcupl schemas` entry for the REST API template** — its shape is below (Zod `RestApiTemplateSchema` in `@dcupl/common-internal`); scaffold one with `dcupl generate api --name <key>` (CLI ≥ 1.4.0-beta.11) or start from a template already in the project (`dcupl files read --path api/<key>.api.json`) rather than from scratch.

## What a script file is

- **One function body**, not a module: no `export`, no `require`, no top-level `return` of a function. The SDK compiles it as `new Function('script_type', ...params, source)` (`"use strict"` is prepended) and calls it per invocation.
- **`script_type` is the first parameter.** It names the mode the caller chose. One file can serve several modes by branching on it; throw for the modes it does not support.
- **The rest of the parameters depend on the mode** (table below). Every mode also receives `context` — an alias of `options`, or `{}` — kept for old scripts; use `options`.
- **The registry is per instance and shared.** `dcupl.scripts.set(key, source)` is what the loader does for a `script` resource. Sorting, query operators, direct execution and endpoints all look up the same key space — a key collision or `scripts.remove(key)` affects all of them.

Three loader resource types carry JavaScript, and **only `script` uses the `script_type` dispatch**:

| Resource `type` | Key field | What the file must be | Runs |
|---|---|---|---|
| `script` | `scriptKey` | A function body branching on `script_type` (this file) | Per call, in the caller's mode |
| `operator` | `operator` | A body that **returns** `(query, item) => boolean` | Evaluated once at load; the function answers every query using that operator name |
| `transformer` | — (`applyTo` tags, `transformerType`) | A body that **returns** `(resource, input) => output` | Once per data resource at load (`rawFileTransformer` on the text, `parsedFileTransformer` on parsed rows; default parsed) |

The `dcupl generate operator --operator <name>` starter shows the operator-file shape (`return (op = (query, item) => { … });`). The rest of this file is about `script` resources.

## Script modes

| `script_type` | Who calls it | Parameters after `script_type` | Return |
|---|---|---|---|
| `script` | `dcupl.scripts.execute(key, options?)` | `dcupl` (the full instance), `options` | Any value, synchronous, handed back to the caller |
| `async_script` | `dcupl.scripts.executeAsync(key, options?)` | `dcupl`, `options`, `resolve`, `reject` | Nothing — call `resolve(value)` / `reject(err)`; a script that calls neither leaves the promise pending forever |
| `sort` | The sort pipeline when a query's `sort.script` is set | `options` (= `sort.script.options`), `items` | The **reordered array**; no `dcupl` handle |
| `operator` | The query engine for a non-built-in operator name | `query` (the condition: `attribute`, `operator`, `value`, …), `item` | `true` keeps the item, `false` drops it |
| `endpoint` | `dcupl.scripts.executeEndpoint(key, request, options?)` — the app runner, per HTTP request | `dcupl` (**read-only facade**), `request`, `options` | A plain value or a Promise → the JSON response body |

`validator` exists in the `ScriptType` union but no caller dispatches it (reserved). Parameters are positional in exactly this order — name them as above or the values land in the wrong variables.

### One file, several modes

```js
// scripts/orders.js
if (script_type === 'endpoint') {
  // GET …/endpoints/orders?customer=acme → request.query.customer
  const { customer } = request.query;
  const orders = dcupl.query.execute({
    modelKey: 'Order',
    queries: customer ? [{ attribute: 'customer', operator: 'eq', value: customer }] : [],
  });
  return { count: orders.length, items: orders.slice(0, 10) }; // becomes the JSON body
}

if (script_type === 'script') {
  // `dcupl` is the full instance here, `options` whatever the caller passed
  const modelKey = options.modelKey || dcupl.models.keys()[0];
  return dcupl.fn.metadata({ modelKey });
}

if (script_type === 'async_script') {
  try {
    resolve(dcupl.query.execute({ modelKey: options.modelKey }));
  } catch (e) {
    reject(e);
  }
  return;
}

if (script_type === 'sort') {
  // `items` is the array to reorder, `options` comes from sort.script.options
  const attribute = options.attribute || 'key';
  return items.sort((a, b) => (a[attribute] < b[attribute] ? -1 : a[attribute] > b[attribute] ? 1 : 0));
}

if (script_type === 'operator') {
  // return true to keep the item, false to drop it
  const value = item[query.attribute];
  return typeof value === 'string' && value.startsWith(String(query.value));
}

throw new Error('unsupported script type: ' + script_type);
```

Using the `sort` and `operator` branches from a query (the daemon, the SDK, or an endpoint script's `dcupl.query.execute`):

```json
{
  "modelKey": "Order",
  "queries": [{ "attribute": "customer", "operator": "orders", "value": "ac" }],
  "sort": { "attributes": ["key"], "order": ["ASC"], "script": { "key": "orders", "options": { "attribute": "amount" } } }
}
```

The operator name in a query **is the script key** (`"operator": "orders"` runs script `orders` in `operator` mode). Built-in operators (`eq`, `in`, `find`, `gt`, `gte`, `lt`, `lte`, `typeof`, `isTruthy`, `size`) are matched first and shadow a script of the same name; `invert` is **not** applied to script operators; an attribute value that is `undefined`/`null` never reaches them (the condition is `false` before dispatch); script operators always scan (no index). A `sort.script` whose key is not registered is silently skipped; an item the sort script drops disappears from the result, and an item without `.key` corrupts the result map — the script owns membership, not just order.

## Registering a script in `dcupl.lc.json`

```json
{
  "resources": [
    { "type": "script",      "url": "${baseUrl}/scripts/orders.js",             "scriptKey": "orders" },
    { "type": "operator",    "url": "${baseUrl}/operators/startsWith.operator.js", "operator": "startsWith" },
    { "type": "transformer", "url": "${baseUrl}/transformers/fix-dates.js",      "applyTo": ["orders"], "transformerType": "parsedFileTransformer" },
    { "type": "data", "url": "${baseUrl}/data/orders.json", "model": "Order", "tags": ["orders"] }
  ]
}
```

- `scriptKey` is the key everything else uses: `scripts.execute(key)`, a query's `operator`, `sort.script.key`, a template's `endpoints[].scriptKey`. Keep it URL-safe and stable.
- The loader **fetches the file as text** and stores it; it is compiled on first use per mode. A fetch failure is a `ResourceError` / `InvalidResource` on the resource (`dcupl validate` shows it), and the key stays unregistered. With `scripting.enabled: false` on the instance every `script`/`operator`/`transformer` resource is skipped with a `ScriptingDisabled` error.
- Tags and app slices apply as for any resource: a script without the slice's tag is not loaded for that app (`applications[].resourceTags` — see "Multi-app slices" in SKILL.md). The console's endpoint script picker greys those out as *not in this app*.
- **`dcupl generate script --file-name <name>.js --mode endpoint|script|operator|sort`** (CLI ≥ 1.4.0-beta.11) writes `dcupl/scripts/<name>.js` (`scriptsBasePath` in `dcupl.config.json`) with that mode's starter and appends the `script` resource. The **`scriptKey` is derived from the file name**: lower-cased, `.js` stripped, any character outside `[A-Za-z0-9_-]` → `_` (`orders.js` → `orders`, `My.Script.js` → `my_script`). `--mode` defaults to `operator` (the bare command keeps the old operator-shaped output and prints a hint naming `--mode`); pass the mode explicitly. The `endpoint` starter is model-agnostic — `?model=<modelKey>&limit=10` → `dcupl.query.execute` on the facade → `{ modelKey, count, items }` — so it serves a deployed endpoint without edits. Always pass `--file-name`: without it the command prompts in a terminal and exits with a line naming the flag in non-TTY/agent contexts. On older CLIs (≤ 1.4.0-beta.10) the command has no `--mode`, scaffolds an operator body and always registers `scriptKey: "my_custom_script"` — rename the key before adding a second script.
- Validate after wiring: `dcupl validate --json` (resource loads), then exercise the script — see "Trying a script" below.

## The `endpoint` contract

The runner calls `dcupl.scripts.executeEndpoint(scriptKey, request, { path, scriptKey, description })` for every matched HTTP request. The script sees three parameters.

### `request` — plain data, host-built

| Field | Type | Notes |
|---|---|---|
| `method` | `'GET' \| 'POST'` | Only these two are routed |
| `path` | `string` | The request path relative to `endpoints/`, decoded, no leading slash, no query string — e.g. `orders/42` |
| `params` | `Record<string,string>` | Values of the matched endpoint's `:name` segments, URL-decoded — `{ id: '42' }` for `orders/:id` |
| `query` | `Record<string, string \| string[]>` | Query string, repeated keys as arrays, values always strings. The host **removes its own keys**: `api-key`, `Api-Key`, `apiKey`, `v` |
| `body` | `unknown` | Parsed JSON body for POST; `undefined` for GET. Never a string: a POST must send `content-type: application/json` (or `+json`) or the runner answers **415** before the script runs; malformed JSON is a 400 |
| `headers` | `Record<string,string>` | Lower-cased names; multi-valued joined with `, `. **Credentials are stripped**: `api-key`, `apikey`, `x-api-key`, `authorization`, `cookie`, `v` — a script can neither read nor forward the instance key |

`options` is the template entry (`{ path, scriptKey, description }`) on the runner, `{}` when a host passes nothing.

### `dcupl` — the read-only facade (`ReadOnlyDcupl`)

Not the instance: a frozen object of read paths, one per instance. Every result is a **deep copy**, so editing it changes nothing.

| Available | Absent (a call is a `TypeError`) |
|---|---|
| `query.one({ modelKey, itemKey })`, `query.many({ modelKey, itemKeys })`, `query.execute({ modelKey, queries, sort, projection, start, count })`, `query.generate(modelKey, query)` | `data.*` (no staging/updating), `init`, `update`, `lists`, `scripts.set`/`remove`/`execute*`, `query.registerCustomOperator` |
| `fn.pivot`, `fn.aggregate`, `fn.suggest`, `fn.groupBy`, `fn.facets`, `fn.metadata` — same option shapes as the SDK (`{ modelKey, options, query? }`; `aggregate.options = { attribute, types: ['sum'\|'avg'\|'count'\|'min'\|'max'\|'distinct'\|'group'] }`) | |
| `models.get(key)`, `models.keys()`, `views.get(key)`, `views.keys({ modelKey }?)`, `scripts.keys()` | |

Queries made from the facade can use the instance's other scripts (`operator`, `sort.script`) and custom operators like any query.

### Return value → response

- Return a plain value **or a Promise**; the runner awaits it and sends `JSON.stringify(value)` with status **200** (also for POST) and `content-type: application/json`.
- `undefined` → `null`; a function or Symbol → `null`; `Date` → ISO string; `Map`/`Set` → `{}`. There is no way to set status or headers in v1 — return the data, let the client read it.
- A circular value is a 500 `{ name: 'TypeError', … }`.

### Errors, timeout, sandbox

| Situation | HTTP | Body |
|---|---|---|
| Script throws (or rejects) | **500** | `{ name, message }` — never a stack; a thrown non-Error becomes `{ name: 'Error', message: String(value) }` |
| Script does not settle within `ENDPOINT_TIMEOUT_MS` (default **5000** ms, runner env, read once per worker thread) | **504** | `{ name: 'EndpointTimeout', message: 'endpoint script did not settle within <n>ms' }` |
| Endpoint configured but its script failed to load | 500 | `{ name: 'ScriptNotFound', … }` — the instance `/status` report says why |
| Path/method not in `endpoints[]` | 404 | `{ statusCode: 404, message: 'endpoint not found', error: 'Not Found' }` — also when the script *is* registered: `endpoints[]` is the allow-list |
| POST without a JSON content type | 415 | `endpoint bodies must be application/json` |

The timeout races the promise; it **cannot interrupt synchronous code**. A CPU-bound loop stalls the whole instance (every route) until it ends — treat 5 s as the budget for async waits, and keep synchronous work small. After a timeout the promise is abandoned, the instance keeps serving.

The script runs in a **SES compartment** inside the instance's worker thread (same place as operators and transformers):

- Available: the JavaScript intrinsics (`Array`, `JSON`, `Map`, `Promise`, `RegExp`, `Intl`, …), the host's `Date`, `Math`, `URL`, `URLSearchParams`, `TextEncoder`/`TextDecoder`, `atob`/`btoa`, `structuredClone`, and `console` (a redacting console — api keys are masked in log lines).
- **Not available: `process`, `require`, `module`, `Buffer`, `fetch`, `setTimeout`/timers, any Node built-in.** An unknown global reads as `undefined`, so `require('fs')` / `fetch(url)` fail with a `TypeError`/`ReferenceError`. An endpoint script cannot call out; it answers from the loaded data only.
- All scripts of one instance share one global object (`globalThis` state survives between calls); instances share nothing.
- Strict mode is on (`"use strict"` is prepended).

### Typings

Exported from `@dcupl/common` (no `@dcupl/core` needed): `ScriptType`, `EndpointScriptMethod`, `EndpointScriptRequest`, `EndpointScriptContext`, `ReadOnlyDcupl`, `ScriptNotFoundError` (check `error.name === 'ScriptNotFound'`, not `instanceof` — core bundles its own copy of common), and **`endpointScriptContextTypes`** — the same contract as one global `.d.ts` string (declares `script_type`, `dcupl`, `request`, `options`, `context`, `query`, `item`, `items`, `resolve`, `reject`) for loading into an editor such as Monaco as an extra lib. The console's file editor already does this for `.js` files under script resources.

## Declaring endpoints on a REST API template

A REST API template is a project file **`api/<key>.api.json`** (the console's *REST APIs* page creates and edits it; it is synced like any file with `dcupl files push`/`pull`). Shape (`RestApi.Template`, `@dcupl/common-internal`):

```json
{
  "key": "orders-api",
  "name": "Orders API",
  "description": "Read endpoints over the sales app",
  "dcuplConfig": {
    "projectId": "<project id>",
    "apiKey": "<api key the runner loads the project with>",
    "processOptions": { "applicationKey": "sales" },
    "loaderFetchOptions": { "baseUrl": "https://cdn.dcupl.com/files/projects/<project id>/draft" }
  },
  "vGuardEnabled": false,
  "auth": [{ "type": "api-key", "value": "<key callers must send>" }],
  "endpoints": [
    { "path": "orders",            "method": "GET",  "scriptKey": "orders", "description": "Orders, optionally filtered by ?customer=" },
    { "path": "orders/:id",        "method": "GET",  "scriptKey": "order-detail" },
    { "path": "orders/summary",    "method": "POST", "scriptKey": "orders-summary", "description": "Body: { customers: string[] }" }
  ]
}
```

`endpoints[]` entries:

| Field | Rules |
|---|---|
| `path` | Relative to the instance's `endpoints/` prefix. Segments of `[A-Za-z0-9_.~-]` joined by `/`; **no leading or trailing slash**; a segment starting with `:` is a path param (`orders/:id/summary`). Regex: `^(:?[A-Za-z0-9_.~-]+)(/:?[A-Za-z0-9_.~-]+)*$` |
| `method` | `GET` or `POST` |
| `scriptKey` | A `type: "script"` resource's `scriptKey` in the app the template loads (`processOptions.applicationKey`). Only listed scripts are callable |
| `description` | Optional; becomes the operation summary in the instance's OpenAPI document |

Rules the schema does not enforce but the runner and the console form check:

- **`method + path` must be unique** per template; a duplicate is an `EndpointDuplicate` error at instance init (the first entry answers).
- **The script must load**: a `scriptKey` the loader did not register is `EndpointScriptMissing` at init. Both appear in the instance's `/status` → `report.quality.errors` (`type: 'loader'`, `errorGroup: 'ResourceError'`), in front of the loader's own errors; the instance still comes up `ready` for its other routes.
- If `dcuplConfig.apiKey` is a **scoped** key, its `files.read` globs must admit the script paths (`scripts/**`), or the loader cannot fetch the scripts and every endpoint reports `EndpointScriptMissing`. The console shows a hint under the *Api Key* select when that is the case.
- Scripts are fetched when the instance initialises. After changing a script file (`dcupl files push`), **update/redeploy the instance** for the new code to be served.

**Scaffold with the CLI** (≥ 1.4.0-beta.11): `dcupl generate api --name <key> [--endpoint "<GET|POST> <path>=<scriptKey>"]...` writes `dcupl/api/<key>.api.json` (validated against `RestApiTemplateSchema`) with `processOptions.applicationKey` = the first entry of `applications[]` in `dcupl.lc.json` (else `default`), `projectId` from `dcupl.config.json` (else a `<project id>` placeholder), a fresh random api-key under `auth` (what callers send), `dcuplConfig.apiKey` left as a placeholder, and no `loaderFetchOptions`. `--endpoint` is repeatable, the method is case-insensitive, path and key are checked with the rules above; a bare call ships one example endpoint `GET <key>` served by script `<key>`. **Every endpoint `scriptKey` that `dcupl.lc.json` does not register gets an `endpoint`-mode starter written to `dcupl/scripts/<scriptKey>.js` and registered** (an existing file is kept, only registered). It is `--name`, not a positional key; omit it and the command prompts. Then set `dcuplConfig.apiKey` (copy it from a template already deployed in the project — `dcupl files read --path api/<other>.api.json` — the CLI never writes a real key), `dcupl files push`, deploy from the console.

```bash
dcupl generate api --name orders-api \
  --endpoint "GET orders=orders" \
  --endpoint "GET orders/:id=order-detail" \
  --endpoint "POST orders/summary=orders-summary"
# → dcupl/api/orders-api.api.json + dcupl/scripts/{orders,order-detail,orders-summary}.js (endpoint starters), all registered
```

Deploying is a console action (*REST APIs* → templates → Deploy, pick a runner); there is no `dcupl` CLI command for REST API instances. The console also validates the `endpoints` section inline (path rules, uniqueness, script picker from the loader config) and writes the file on every change — rows reach the file only while the whole section is valid.

## The served route

```
GET  https://<runner>/instance/<instanceKey>/endpoints/<path>[?query]
POST https://<runner>/instance/<instanceKey>/endpoints/<path>     (content-type: application/json)
```

- `<runner>` is the runner's URL from the console's runner tab (production runners: `app-runner-01.dcupl.com`, `app-runner-02.dcupl.com`; through the proxy `https://run.dcupl.com/runner/<runnerKey>/…`, develop `run.dev.dcupl.com`). `<instanceKey>` is the deployed instance's key as the console's instance table shows it (the instance's `…/status` URL there has it).
- **Auth** as for the data routes: when the template has `auth`, send the key as the `api-key` header or `?api-key=` query (`Api-Key` / `apiKey` spellings also accepted). With `vGuardEnabled: true`, also send the instance's `v` (header or query) or the call is a 400.
- **Matching**: same method, same number of segments, literal segments equal, `:name` binds a non-empty segment. A fully literal path beats a parameterised one regardless of order (`orders/summary` wins over `orders/:id`); among parameterised candidates the first declared wins. No prefix matches, no trailing-slash tolerance (`orders/` ≠ `orders`). An encoded slash stays inside its segment (`orders/a%2Fb` → `params.id === 'a/b'`).
- **OpenAPI**: `GET …/instance/<instanceKey>/swagger-json` is the per-instance document (built-in routes plus one operation per configured endpoint, `:name` as `{name}`); `…/swagger` is the UI. The console tester reads it to list the endpoints.
- Invocations are counted in the runner's invocation log per instance as action `endpoint` and per configured path as `endpoint:<path>` (`orders/:id` is one row however many ids are asked for); a 404 touches no counter.

```bash
# GET with query → request.query.customer === 'acme'
curl -s "https://app-runner-01.dcupl.com/instance/orders-api/endpoints/orders?customer=acme" \
  -H "api-key: $API_KEY"

# path param → request.params.id === '42'
curl -s "https://app-runner-01.dcupl.com/instance/orders-api/endpoints/orders/42" -H "api-key: $API_KEY"

# POST with JSON body → request.body
curl -s -X POST "https://app-runner-01.dcupl.com/instance/orders-api/endpoints/orders/summary" \
  -H "api-key: $API_KEY" -H "content-type: application/json" \
  -d '{"customers":["acme","globex"]}'

# why is it a 500 ScriptNotFound / which endpoint errors exist?
curl -s "https://app-runner-01.dcupl.com/instance/orders-api/status" -H "api-key: $API_KEY" | jq '.report.quality.errors'
```

## Trying a script

- **Console Run panel** (fastest loop, no deploy): open the `.js` file in the console's file editor — when a `type: "script"` resource references it, the toolbar has *Run this script against the loaded project*. Pick the mode (`endpoint`, `script`, `operator`, `sort`), fill the mock input (`request` / `options` / `query` + `item` / `items` as JSON; *Insert starter* gives a per-mode body), run, and read the return value, console lines and a thrown error with its editor line. It runs against the project's in-browser `Dcupl` (the Explorer's loaded application, v2 SDK only), so `endpoint` mode exercises the real read-only facade. A file no resource references runs under a proposed key and can be added to `dcupl.lc.json` from the panel.
- **Console REST API tester** (deployed instance): the instance row shows an `N endpoints` chip; it and *Test* open the tester with the scripted endpoints next to the built-in ones (path params, query, body form), with history and cURL export.
- **`curl`** against the instance as above; `…/status` for init-time errors.
- **Locally via the daemon** for `operator` mode: `dcupl app create --load --auto-serve --json` loads the workspace's `script` resources too (the `processed` line reports `"script": 1`), so a query whose operator is the script key runs its `operator` branch: `dcupl app query execute --model Order --query '{"attribute":"customer","operator":"orders","value":"ac"}' --json` (see `references/querying.md`). An unknown operator name just matches nothing (`[]`) — it is not an error, so check the script key when a filter comes back empty. The CLI's `--sort attr:DIR` does not reach `sort.script`, and there is no `dcupl app` verb for `script`/`endpoint` modes — use the console Run panel for those.
- **In code** (a Node/browser app on `@dcupl/core` ≥ 2.0.0-beta.25): `await dcupl.scripts.executeEndpoint('orders', { method: 'GET', path: 'orders', params: {}, query: { customer: 'acme' }, body: undefined, headers: {} })` after `loader.process()` + `dcupl.init()`; `scripts.get(key)` returns the source, `scripts.keys()` the registered keys.

## Gotchas

- **Positional parameters**: the names in the mode table are the parameter names; a script written as `function (dcupl, options) {…}` or using `module.exports` does not work. Write a bare body.
- **Mode mismatch is silent until runtime**: nothing checks that a `scriptKey` referenced from `endpoints[]` actually has an `endpoint` branch — a script without one falls through to whatever it returns (or its `throw` → 500). Always end the file with `throw new Error('unsupported script type: ' + script_type)`.
- **One registry**: a script registered under a built-in operator name (`eq`, `in`, …) is never reached; a `script` resource with the same key as an `operator` resource shadows it in queries (the script wins).
- **`executeAsync` never catches**: a thrown error inside an async branch rejects only if thrown synchronously; otherwise call `reject`. Prefer `endpoint`/`script` with a returned Promise where a host awaits it.
- **Compiled functions are cached per key and parameter list** and invalidated by `scripts.set`/`remove` (since beta.25; earlier SDKs kept stale code and mixed up modes — bump before relying on hot re-registration).
- **`scripts.get` returned nothing before beta.25** (typed `void`); on older SDKs introspect with `scripts.keys()`.
- **A changed `ENDPOINT_TIMEOUT_MS`** needs a worker restart (instance update), not just a new request.
- **Template editor schema**: the console's file editor validates `api/*.api.json` against `dcupl-schema`'s `dcupl.api.vscode.schema.json` (`additionalProperties: false`); `endpoints` is in it since dcupl-schema#2 — an older schema flags the field even though the runner accepts it.
