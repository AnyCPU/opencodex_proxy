# opencodex Structure

This folder records the implementation map for maintainers. It is intentionally shorter than
`devlog/`: devlog records decisions over time; `structure/` records the current shape of the system.

## Main runtime

| Path | Responsibility |
|---|---|
| `src/cli.ts` | CLI entrypoint for `ocx` / `opencodex`; setup, service, sync, login, restore. |
| `src/server.ts` | Bun proxy server, management API, `/v1/responses`, `/v1/models`. |
| `src/router.ts` | Provider/model resolution before adapter dispatch. |
| `src/types.ts` | Shared config, provider, request, and adapter event types. |
| `src/config.ts` | `~/.opencodex/config.json` read/write and atomic writes. |

## Codex integration

| Path | Responsibility |
|---|---|
| `src/codex-paths.ts` | Resolve `CODEX_HOME`, config path, profile path, catalog path, and cache path. |
| `src/codex-inject.ts` | Inject/strip `model_provider`, provider table, profile file, fast-mode feature. |
| `src/codex-catalog.ts` | Merge routed models into Codex-shaped catalog entries and restore native catalog. |
| `src/service.ts` | launchd, systemd user unit, and Windows Task Scheduler service integration. |
| `src/open-url.ts` | Cross-platform browser opener for OAuth, GUI, and prompts. |

## Providers and adapters

| Path | Responsibility |
|---|---|
| `src/adapters/` | Provider wire adapters and stream bridges. |
| `src/oauth/` | OAuth flows, token storage, refresh, and auth-token resolution. |
| `src/oauth/key-providers.ts` | API-key provider catalog and provider defaults. |
| `src/model-cache.ts` | Provider `/models` cache with fresh/stale fallback. |

## GUI and docs

| Path | Responsibility |
|---|---|
| `gui/` | React dashboard for provider setup, OAuth login, model visibility, and logs. |
| `docs-site/` | Astro/Starlight public documentation site. |
| `docs/` | Technical investigation notes and implementation references. |
| `devlog/` | Time-ordered implementation plans, decisions, and verification records. |

## Generated/local state

| Path | Responsibility |
|---|---|
| `dist/` | Local build/bin output; ignored by git. |
| `node_modules/` | Local dependencies; ignored by git. |
| `~/.opencodex/` | User opencodex config, auth tokens, pid files, logs, catalog backup. |
| `$CODEX_HOME/` | Codex config, profile, catalog, and model cache touched by opencodex. |
