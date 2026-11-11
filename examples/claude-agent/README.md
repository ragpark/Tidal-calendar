# Claude agent example for Boat Scrub Calendar

This example shows a small, runnable tool-calling agent that uses the **Boat Scrub Calendar HTTP API** to answer boat-maintenance questions such as:

> “When is the next good scrub window for my boat?”

It is intentionally minimal, uses Node.js + TypeScript, and avoids re-implementing local tide logic.

## What this demonstrates

- A Claude-powered agent built on the Anthropic SDK's tool runner (`client.beta.messages.toolRunner`), which drives the request → tool call → result loop for you.
- Tools defined once with Zod schemas (`betaZodTool`, `strict: true`) so Claude's arguments always validate.
- Claude Opus 5.5 (`claude-opus-5-5`) with adaptive thinking and an explicit `medium` effort, plus a server-side refusal fallback.
- Tool functions that call the Boat Scrub Calendar API:
  - `getScrubWindows`
  - `getNextScrubWindow`
  - `getTideSummary`
  - `explainScrubWindow`
- Clear source signalling in results (`live_api` vs `demo_fallback`).
- Helpful error handling for API misconfiguration.

## Setup

From the repository root:

```bash
cd examples/claude-agent
npm install
cp .env.example .env
```

Then set at least:

- `ANTHROPIC_API_KEY` (or run `ant auth login` and leave it unset; the SDK picks up the profile)

And optionally:

- `BOATSCRUB_API_BASE_URL` (defaults to `https://boatscrubcalendar.com`)
- `BOATSCRUB_API_KEY` (if your API deployment requires auth)
- `BOATSCRUB_ALLOW_DEMO_FALLBACK=true` (optional fallback sample mode)

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes, unless an `ant auth login` profile exists | - | Anthropic API key for the agent. |
| `BOATSCRUB_API_BASE_URL` | No | `https://boatscrubcalendar.com` | Base URL for Boat Scrub Calendar API. |
| `BOATSCRUB_API_KEY` | No | empty | Optional API token/key for protected endpoints. |
| `BOATSCRUB_ALLOW_DEMO_FALLBACK` | No | `false` | If true, uses clearly labelled demo window data if `/api/clubs` fails. |

## Example prompts

- “When is the next good scrub window for my boat near Sheerness?”
- “Please summarise low-water opportunities for station 0240 between 2026-05-01 and 2026-05-31.”
- “Explain why this scrub slot is suitable for light fouling removal.”

## CLI demo commands

```bash
npm run demo -- --location "Sheerness" --from "2026-05-01" --to "2026-05-31"
```

Other examples:

```bash
npm run demo -- --location "Ramsgate" --boatType "fin keel yacht"
npm run demo -- --stationId "0240" --from "2026-05-01" --to "2026-05-10" --question "Summarise tides and suggest a scrub window"
```

## Notes on API route assumptions (adapter points)

This example inspects existing project routes and uses:

- `/api/clubs` for scrub windows
- `/api/Stations` and `/api/Stations/:id/TidalEventsForDateRange` for tide summaries

If your deployed API uses different paths, update:

- `src/boatscrubClient.ts` (`getScrubWindows`, `getStations`, `getTideSummary`)

Search for `TODO` comments in that file for adapter guidance.

## How the Claude call is set up

`src/index.ts` creates one `toolRunner` call:

- `model: 'claude-opus-5-5'` with `output_config: { effort: 'medium' }`. Opus 5.5 always thinks; effort is the lever for depth, cost and latency. Raise it to `high` for harder questions.
- `betas: ['server-side-fallback-2026-07-01']` and `fallbacks: 'default'`: if a safety classifier declines the request, the API re-runs it on a fallback model inside the same call. Remove both lines to turn that off.
- `max_iterations: 12` caps the tool loop. A `stop_reason` of `refusal` or `max_tokens` is reported rather than silently printed.
- Tool failures are returned to Claude as JSON (`ok: false` with a configuration hint), never thrown, so the model can explain the problem instead of crashing the demo.

## Type-checking

```bash
npm run typecheck
```

## Expected agent behaviour

The system prompt enforces:

- Plain British English.
- Include recommendation + suitability explanation + assumptions.
- State whether data came from live API or demo fallback.
- Never invent tide data.
- If an API call fails, return a helpful configuration hint.

## Running tests

A minimal API-client unit test (mocked `fetch`) is included. It does not call Claude:

```bash
npm test
```

## Future MCP-compatible workflow direction

To expose this as an MCP-compatible workflow later, you can:

1. Keep the handlers from `createToolHandlers()` in `src/tools.ts` as your canonical integration layer; `createClaudeTools()` wraps them for the SDK tool runner.
2. Add an MCP server wrapper that maps MCP `tools/call` requests to those same handlers.
3. Reuse the same `BoatScrubClient` so HTTP integration remains in one place.

That approach gives parity between:

- CLI agent usage
- MCP-connected agent usage
- Any future UI or backend orchestration layer

