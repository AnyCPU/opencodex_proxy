# Codex App Catalog Path

## Current model

Codex App can show opencodex models because it reads Codex's shared config/catalog state. The
important path is:

```text
$CODEX_HOME/config.toml
  -> model_provider = "opencodex"
  -> model_catalog_json = "$CODEX_HOME/opencodex-catalog.json"
  -> [model_providers.opencodex]

$CODEX_HOME/opencodex-catalog.json
  -> native OpenAI passthrough entries
  -> routed provider/model entries

opencodex server
  -> http://localhost:10100/v1/responses
  -> http://localhost:10100/v1/models
```

## Invariants

- `model_provider = "opencodex"` must be a root TOML key.
- `model_catalog_json` must be a root TOML key.
- `[model_providers.opencodex]` must use `wire_api = "responses"`.
- `[model_providers.opencodex]` must use `requires_openai_auth = true` for Codex App/TUI
  ChatGPT-account-gated UI.
- Catalog entries shown in pickers must have `visibility = "list"`.
- Routed model slugs use `<provider>/<model>`.
- Routed models must not expose OpenAI fast/service-tier metadata.

## Fast tier split

Codex currently uses:

```text
config.toml: service_tier = "fast"
catalog/request tier id: priority
feature gate: [features].fast_mode = true
provider/account gate: requires_openai_auth = true
```

Do not collapse these spellings into one value. Both names are meaningful on different Codex
surfaces.

## Implementation references

| Path | Notes |
|---|---|
| `src/codex-paths.ts` | Resolves the shared Codex home and file paths. |
| `src/codex-inject.ts` | Writes root provider/catalog keys and provider table. |
| `src/codex-catalog.ts` | Builds Codex-shaped entries and strips routed fast-tier metadata. |
| `src/server.ts` | Serves `/v1/models` with the same catalog entry builder for Codex clients. |
