# RolePlay Platform

**English** | [简体中文](README.zh-CN.md)

An AI-driven role-play platform in the spirit of SillyTavern, built around one idea: **the model runs the world, the UI only shows it.**

You type what your character does. An AI game master narrates the result and, through tools, creates and updates everything else: characters, places, items, quests, stats, lore, time and weather. It can also paint the scene. There is no editor for any of that in the UI. The interface is a message log, a set of read-only world panels, and one input box.

English and Chinese are both first-class: the interface, the game master's instructions, and the stories themselves.

![A game in progress: narration and a painted scene in the middle, the world the game master built on the right](docs/screenshot.jpg)

## Quick start

Requires Node.js 20.12 or newer.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. With no API key configured the app starts in **demo mode**: a scripted game master plays a short fixed story, placeholder pictures included, so you can see everything work.

To play with a real model, open **Settings** and use **Quick setup**: one click selects the official Claude or OpenAI API with sensible defaults, and the only thing left is to paste a key. Or put a key in `.env` (copy `.env.example`):

| In `.env` | Result |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude runs the game |
| `OPENAI_API_KEY` | OpenAI runs the game |
| both | Claude runs the game; switch illustrations on in Settings and OpenAI paints it |

| Command | What it does |
| --- | --- |
| `npm run dev` | Server on :8787 and web app on :5173, both reloading on change |
| `npm run build` then `npm start` | Builds the web app and serves everything from the server on :8787 |
| `npm test` | Engine and provider tests (no network, no key) |
| `npm run typecheck` | Type-checks every package |

## How it works

```
 player action
      │
      ▼
┌──────────────┐  instructions + story so far + world state (JSON)  ┌───────────────┐
│  Game engine │ ─────────────────────────────────────────────────▶ │  Game master  │
│   (server)   │ ◀───────────────────────────────────────────────── │   (the LLM)   │
└──────┬───────┘      tool calls: roll_dice, narrate, record        └───────────────┘
       │ validates and applies them, records what changed, has pictures painted
       ▼
   world state ──▶ streamed to the UI: narration, world events, pictures, new state
```

### The game master's tools

Everything the game master does goes through three tools.

| Tool | Purpose |
| --- | --- |
| `roll_dice` | Decides an uncertain outcome. The result goes back to the model and is shown to the player. |
| `narrate` | Tells the player what happens. This is the only prose the player reads, and it streams to the screen while the model is still writing it. |
| `record` | Everything the turn changed, in one call: the world's title, premise and art style; places; characters and their free-form stats; items; quests; lore (hidden entries are the game master's private notes); removals; the scene (location, time, weather); pictures to paint; suggested next actions. It ends the turn. |

A turn is `narrate` + `record`, preceded by `roll_dice` when something is uncertain. Stats are not predefined: the game master invents the system that fits the genre (HP and gold, sanity, a cultivation realm).

Why three tools and not one per kind of change: some models send several tool calls in one response and others only ever send one. With a tool per change, the second kind needs a round trip for every character and item; with `record`, a whole turn is one response for the first kind and two for the second. And why narration is a tool rather than the model's plain reply: text written next to tool calls is not delivered verbatim by the newest Claude models, and as a tool input it can be streamed first, so the player is reading within a few seconds while the record is still being written.

Three more consequences of the design:

- **The world state is the memory.** Every turn is rebuilt from the world state and a transcript, not from the previous API exchange. Old turns can scroll out of the context window without the model losing track of who exists or what the player carries.
- **Events are data, not prose.** The server never writes player-facing sentences about world changes; it emits typed events ("Mara joined", "HP 20 → 14") and the UI words them in the interface language.
- **Each entry stands alone.** `record` validates and applies its entries one by one. A malformed character does not throw away the rest; the model is told exactly which entry was rejected and resends only that.

### Illustrations

Painting is a separate service from the game master, so any model can tell the story while an image model draws it: Claude writes, OpenAI paints. When illustrations are on, `record` gains a `pictures` section. The game master writes each picture's prompt, the world's art style is appended so pictures share a look, and the engine paints in the background while the turn carries on. A picture of a character, place or item also becomes its portrait in the world panels. At most two pictures per turn.

## Project layout

```
packages/shared      The contract: world model, messages, API and settings types (no runtime deps)
apps/server          Game engine + HTTP API (Hono)
  src/engine           world.ts      world operations, the only code that changes state
                       tools.ts      the three tools: schemas (zod) and handlers
                       gameMaster.ts the turn loop
                       context.ts    what the model sees each turn
                       prompts/      game master instructions, one file per language
  src/llm              provider interface + Anthropic, OpenAI (Responses), OpenAI-compatible (Chat Completions), mock
  src/images           painter interface + OpenAI Images and a free placeholder painter
  src/store            JSON-file persistence for sessions, settings and pictures
apps/web             React UI: message log, world panels, composer, i18n (en / zh)
```

## Model providers

| Provider | Notes |
| --- | --- |
| **Anthropic** | Official SDK, streaming, prompt caching. Defaults to `claude-opus-5-5` at `medium` effort. On Anthropic's own endpoint, a request the model declines is retried on its default fallback model. |
| **OpenAI** | OpenAI's own endpoint is driven through the Responses API, which is where current OpenAI models combine reasoning with tools. Defaults to `gpt-6.1-sol`. Nothing is stored on OpenAI's side. |
| **OpenAI-compatible** | Any other base URL gets Chat Completions with tool calling: DeepSeek, OpenRouter, Ollama, vLLM. Set base URL and model in Settings. |
| **Images** | OpenAI Images API (or a server that mirrors it). Defaults to `gpt-image-2.5-flare` at low quality; each picture is billed by the image provider. |
| **Mock** | Scripted, offline, free. Used for demo mode, development and tests. |

Configure them in the Settings dialog (saved to `data/settings.json`) or with environment variables (see `.env.example`). Settings saved in the app take precedence over the environment. **Fetch models** in Settings lists what your key can actually use.

API keys stay on the server and are never sent back to the browser. `OPENAI_API_KEY` is only ever sent to `OPENAI_BASE_URL`, never to a different endpoint typed into the app. The server listens on `127.0.0.1` by default.

Adding a provider means implementing two small interfaces in `apps/server/src/llm/types.ts`; the turn loop and game rules are provider-independent.

## Languages

- **Interface language** (EN / 中文) is a toggle in the app and only affects the chrome.
- **Story language** is chosen per game. It selects the game master's instruction set (`apps/server/src/engine/prompts/en.ts` or `zh.ts`), so the model is instructed in the language it writes in.

To add a language: add it to `LOCALES` in `packages/shared/src/world.ts`, add a prompt pack on the server and a locale file in `apps/web/src/i18n/locales/`. The compiler points at whatever is missing.

## HTTP API

```
GET    /api/settings                 current settings (no keys)
PUT    /api/settings                 update provider, model, keys, illustrations
GET    /api/settings/models?target=  models the saved key can use (anthropic | openai-compatible | image)
GET    /api/sessions                 saved games
POST   /api/sessions                 new game { language, premise?, playerName?, playerConcept? }
GET    /api/sessions/:id             full session: world + messages
DELETE /api/sessions/:id
POST   /api/sessions/:id/turns       { kind: "start" } or { kind: "action", text } → Server-Sent Events
GET    /api/images/:sessionId/:file  a painted picture
```

The event stream and every payload type are documented in `packages/shared/src/api.ts`.

## Roadmap

- Regenerate / undo a turn (per-turn world snapshots)
- Summarise old turns into lore automatically
- Import SillyTavern character cards and world info as a starting world
- Let the player hand the game master a picture (vision input)
- Multiple player characters in one world
