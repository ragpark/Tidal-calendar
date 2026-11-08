# HeyCatch docs scratch — index

Fetched 2026-11-08 with `curl -sSL` (raw bodies, saved byte for byte) and `npm view`.

| File | Source | Status / content type |
| --- | --- | --- |
| heycatch-agents.md | https://heycatch.ai/agents.md | 200, text/markdown |
| heycatch-agents-native.md | https://heycatch.ai/agents-native.md (linked from agents.md as `/agents-native.md`) | 200, text/markdown |
| heycatch-home.html | https://heycatch.ai (linked from agents.md and agents-native.md) | 200, text/html |
| heycatch-sdk-npm.json | `npm view @heycatch/sdk version dist-tags --json` and `npm view @heycatch/sdk --json`, combined into one JSON object | npm registry |
| heycatch-sdk-README.md | `npm view @heycatch/sdk readme` | npm registry |

## Link audit

agents.md links to, on heycatch.ai hosts: `https://heycatch.ai` (home) and `/agents-native.md`.
It does not link to any websites, channels/redirects, privacy/processor, llms.txt or other .md page on
heycatch.ai, app.heycatch.ai or docs.heycatch.ai. Non-doc hosts mentioned (not fetched): `https://in.heycatch.ai`
(SDK ingest endpoint), `https://esm.sh`, `https://registry.npmjs.org`.

agents-native.md links back to `/agents.md` and `https://heycatch.ai`; also `https://in.heycatch.ai/batch/`,
`https://in.heycatch.ai/capture/` (ingest endpoints) and `https://github.com/PostHog/posthog-ios.git`. Nothing further fetched.

The home page's internal links (/pricing, /features/*, app.heycatch.ai/sign-in) were not crawled; only pages linked
directly from agents.md were in scope.
