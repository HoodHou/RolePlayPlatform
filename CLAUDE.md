# RolePlay Platform

AI-driven role-play platform. The model (the "game master") simulates the world; the UI only renders messages and world state. See `README.md` for the full picture.

## Commands

- `npm run dev` — server (:8787, `tsx watch`) + web (:5173, Vite, proxies `/api`)
- `npm test` — server tests (`node:test` via tsx; no network, no API key)
- `npm run typecheck` — all workspaces
- `npm run build` && `npm start` — production: server serves `apps/web/dist`

The active provider comes from `data/settings.json`, then `.env`, and is `mock` (a scripted, free, offline game master with a placeholder painter) when neither sets one. Use `mock` for UI work and tests: every real turn and every picture is billed. The real providers are covered offline by `apps/server/src/llm/providers.test.ts`, which runs them against a local fake API.

Server env vars are prefixed (`RP_PORT`, `RP_HOST`, `RP_DATA_DIR`): generic `PORT`/`HOST` are set by shells and preview tools and must not be read.

## Rules of the design

- **The UI never edits world state.** A new world feature is something the game master can record, not a form. The path of a change: a section of the `record` tool in `apps/server/src/engine/tools.ts` → an operation in `engine/world.ts` → a `WorldEvent` in `packages/shared/src/events.ts` → wording in both web locale files.
- **Three tools: `roll_dice`, `narrate`, `record`.** Do not add a tool per kind of change: models that send one tool call per response pay a round trip for each. Narration goes through `narrate`, never the model's plain text, because the newest Claude models return text written beside tool calls as hidden progress notes.
- **`engine/world.ts` is the only code that mutates `WorldState`.** Operations mutate in place and return the events to show.
- **The world state is the model's memory.** Each turn is rebuilt from instructions + transcript + world JSON (`engine/context.ts`); raw API messages are never carried across turns. Keep the system prompt byte-stable for a given set of options (no timestamps or per-request values) so it caches.
- **`packages/shared` is the contract.** Change types there first; both apps import them. It has no runtime dependencies.
- **Two languages, always.** Every user-visible string exists in English and Chinese: `apps/web/src/i18n/locales/{en,zh}.ts` for the UI, `apps/server/src/engine/prompts/{en,zh}.ts` for the game master. The server sends codes and structured events, never player-facing prose; the web app words them.
- **Providers only translate wire formats** (`apps/server/src/llm`, `apps/server/src/images`). Loop policy, validation and game rules stay in `engine/`. Input from any model is validated (zod) before it touches the world; a rejected entry goes back to the model as an error result.
- Errors shown to the user are `AppError`s with a code from `ERROR_CODES`; add the code and its two translations together.
- API keys live in `.env` or `data/settings.json`, both gitignored. Never print them, commit them, or send them to the browser.
