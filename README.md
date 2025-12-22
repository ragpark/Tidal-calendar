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
     src="https://your-app.up.railway.app" 
     width="100%" 
     height="900" 
     frameborder="0"
     style="border-radius: 12px; border: none;">
   </iframe>
   ```
3. Adjust the height as needed (900px recommended minimum)

## Configuration

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
