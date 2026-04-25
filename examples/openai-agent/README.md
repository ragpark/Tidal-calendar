# OpenAI agent example for Boat Scrub Calendar

This example shows a small, runnable tool-calling agent that uses the **Boat Scrub Calendar HTTP API** to answer boat-maintenance questions such as:

> “When is the next good scrub window for my boat?”

It is intentionally minimal, uses Node.js + TypeScript, and avoids re-implementing local tide logic.

## What this demonstrates

- An OpenAI-powered agent loop (Responses API + function tools).
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
cd examples/openai-agent
npm install
cp .env.example .env
```

Then set at least:

- `OPENAI_API_KEY`

And optionally:

- `BOATSCRUB_API_BASE_URL` (defaults to `https://boatscrubcalendar.com`)
- `BOATSCRUB_API_KEY` (if your API deployment requires auth)
- `BOATSCRUB_ALLOW_DEMO_FALLBACK=true` (optional fallback sample mode)

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `OPENAI_API_KEY` | Yes | - | OpenAI API key for the agent. |
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

## Expected agent behaviour

The system prompt enforces:

- Plain British English.
- Include recommendation + suitability explanation + assumptions.
- State whether data came from live API or demo fallback.
- Never invent tide data.
- If an API call fails, return a helpful configuration hint.

## Running tests

A minimal API-client unit test (mocked `fetch`) is included:

```bash
npm test
```

## Future MCP-compatible workflow direction

To expose this as an MCP-compatible workflow later, you can:

1. Keep tool functions in `src/tools.ts` as your canonical integration layer.
2. Add an MCP server wrapper that maps MCP `tools/call` requests to those same handlers.
3. Reuse the same `BoatScrubClient` so HTTP integration remains in one place.

That approach gives parity between:

- CLI agent usage
- MCP-connected agent usage
- Any future UI or backend orchestration layer

