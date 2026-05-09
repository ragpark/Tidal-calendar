# Smart Speaker MVP Backend

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and fill values.
3. Run `npm run voice:dev`.

## Webhook API
### POST /voice/intent
```bash
curl -X POST http://localhost:4010/voice/intent \
 -H 'content-type: application/json' \
 -d '{"sessionId":"abc","intentName":"GetTideSummaryIntent","slots":{"station_name":"Seattle","date":"today"}}'
```

### POST /voice/confirm
```bash
curl -X POST http://localhost:4010/voice/confirm \
 -H 'content-type: application/json' \
 -d '{"sessionId":"abc","confirmation":"yes"}'
```

## Booking flow sequence diagram
```mermaid
sequenceDiagram
participant U as User
participant V as Voice Platform
participant B as Backend
participant M as Tidal MCP/API
U->>V: "Book option 2"
V->>B: POST /voice/intent BookScrubSlotIntent
B-->>V: "Confirm booking ... yes/no"
U->>V: "Yes"
V->>B: POST /voice/confirm yes
B->>M: login/session resolve
B->>M: book_scrub_window(club_id, window_id)
M-->>B: success/failure
B-->>V: spoken result
```

## TODO: Adapter glue
- Alexa request signature verification and response envelope mapping.
- Google Assistant App Actions intent schema mapping.
- Platform-specific session persistence bridge.
- SSML tuning per assistant voice.
