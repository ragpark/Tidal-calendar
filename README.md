# Tidal Calendar - Boat Scrubbing Planner

A UK tidal prediction app with monthly calendar view and boat scrubbing day planner.

## Features

- **Monthly Calendar View** - Navigate through months with tide times for each day
- **Scrubbing Day Planner** - Identifies optimal days for boat scrubbing based on morning high water times
- **Harmonic Predictions** - Uses M2/S2 tidal constituents to predict beyond the 7-day API limit
- **Configurable Time Window** - Set your preferred high water window (default 06:30-09:00)

## Deploy to Railway

### Option 1: One-Click Deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template)

### Option 2: Manual Deploy

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/tidal-calendar.git
   git push -u origin main
   ```

2. **Connect to Railway**
   - Go to [railway.app](https://railway.app)
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository
   - Railway will auto-detect the Vite project and deploy

3. **Get your URL**
   - Go to Settings → Domains
   - Generate a Railway domain or add your custom domain
   - Your app will be at `https://your-app.up.railway.app`

### Option 3: Railway CLI

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

## Embed in Wix

Once deployed, embed in your Wix site:

1. In Wix Editor: **Add (+)** → **Embed Code** → **Embed HTML**
2. Paste this code:
   ```html
   <iframe 
     src="https://your-app.up.railway.app/?embed=1&station=0240&view=scrubbing" 
     width="100%" 
     height="900" 
     frameborder="0"
     style="border-radius: 12px; border: none;">
   </iframe>
   ```
3. The widget automatically posts its height via `postMessage` with `{ type: 'tidal-calendar:resize', height }`. You can listen for it in Wix to adjust the iframe height dynamically, or start with 900px as a safe default.

### Embeddable widget options

Add query parameters to customise the widget:

| Parameter | Example | Purpose |
|-----------|---------|---------|
| `embed` or `widget` | `1` | Enables the compact embed UI |
| `station` | `0240` | Station ID (or name) to load automatically |
| `view` | `scrubbing` | `monthly` (tide times) or `scrubbing` (suitability list) |
| `theme` | `dark` | `light` (default) or `dark` |
| `accent` | `%230ea5e9` | Hex colour for highlights (URL-encoded `#`) |
| `compact` | `1` | Trims padding for tighter embeds |

Example:

```html
<iframe
  src="https://your-app.up.railway.app/?embed=1&station=0452&view=monthly&accent=%2322c55e&compact=1"
  width="100%"
  height="760"
  frameborder="0"
  style="border: none; border-radius: 12px;">
</iframe>
```

## Configuration

### Transactional Email (Resend)

Set these environment variables (Railway-friendly, no SMTP):

| Variable | Required | Description |
| --- | --- | --- |
| `RESEND_API_KEY` | ✅ | Resend API key for sending transactional emails. |
| `EMAIL_FROM` | ➖ | From address (default: `Your App <no-reply@yourdomain.com>`). |
| `PUBLIC_APP_URL` | ✅ | Base URL for building reset links (e.g. `https://myapp.com`). |
| `RESEND_USE_TEMPLATES` | ➖ | Set to `true` to use Resend templates. |
| `RESEND_WELCOME_TEMPLATE_ID` | ➖ | Template id for welcome email (required if templates enabled). |
| `RESEND_RESET_TEMPLATE_ID` | ➖ | Template id for password reset email (required if templates enabled). |

Template switching:

- Inline HTML emails are sent by default.
- Set `RESEND_USE_TEMPLATES=true` to send using template ids + variables.

### Local development

```bash
npm install
npm run dev
```

For local testing without a database, you can temporarily set `USE_IN_MEMORY_RESET_STORE=true` (reset tokens will not persist).

### Railway configuration

1. Add the environment variables above in Railway → Service → Variables.
2. Ensure the Railway Postgres plugin is attached and `DATABASE_URL` is injected.

### Adding Stations

Edit `src/App.jsx` and modify the `DEMO_STATIONS` array:

```javascript
const DEMO_STATIONS = [
  { 
    id: '0001', 
    name: 'Aberdeen', 
    country: 'Scotland',
    mhws: 4.3,  // Mean High Water Springs
    mhwn: 3.4,  // Mean High Water Neaps
    mlwn: 1.3,  // Mean Low Water Neaps
    mlws: 0.5   // Mean Low Water Springs
  },
  // Add more stations...
];
```

### Connecting to Live API

To use real Admiralty API data for the first 7 days:

1. Get an API key from [Admiralty Developer Portal](https://admiraltyapi.portal.azure-api.net)
2. Subscribe to "UK Tidal API - Discovery" (free tier)
3. Add your key in the app interface

## Model Context Protocol (MCP)

This repo includes a standalone MCP server that proxies the existing HTTP API so other agents can use Tidal Calendar tools without modifying the main app.

### Run the MCP server

1. Start the web server (so the MCP server can reach it):
   ```bash
   npm run dev
   ```
2. In a separate terminal, run:
   ```bash
   npm run mcp
   ```

### MCP environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `TIDAL_API_BASE_URL` | ➖ | Base URL for the Tidal Calendar API (default: `http://localhost:3000`). |
| `TIDAL_SESSION_COOKIE` | ➖ | Pre-authenticated `tc_session` cookie value (e.g. `tc_session=...`). |
| `TIDAL_EMAIL` | ➖ | Email used to log in when no session cookie is provided. |
| `TIDAL_PASSWORD` | ➖ | Password used to log in when no session cookie is provided. |

Authenticated MCP tools (profile updates, bookings, PDF generation) require either `TIDAL_SESSION_COOKIE` or `TIDAL_EMAIL`/`TIDAL_PASSWORD`.

## Tech Stack

- React 18
- Vite 5
- Harmonic tidal prediction algorithms
- UK Admiralty Tidal API (optional)

## Tidal Prediction Algorithm

Beyond the 7-day API limit, the app uses simplified harmonic analysis:

- **M2 Constituent**: 12.42-hour lunar semi-diurnal cycle
- **Lunar Phase**: 29.53-day synodic month
- **Spring/Neap Factor**: Varies tidal range based on moon phase
- **2-Day Lag**: Accounts for delay between moon phase and maximum effect

## Licence

Data model based on UK Hydrographic Office tidal predictions.
Crown Copyright applies to tidal data.
