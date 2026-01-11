# Railway Deployment Troubleshooting Guide

## Issues Fixed

### 1. SSL Configuration
**Problem:** Railway requires SSL connections but the app might not enable SSL properly.

**Fix Applied:**
```javascript
const isProduction = process.env.NODE_ENV === 'production' ||
                     process.env.DATABASE_URL?.includes('railway') ||
                     process.env.DATABASE_URL?.includes('postgres://');
const sslConfig = isProduction ? { rejectUnauthorized: false } : undefined;
```

**What changed:**
- Now checks for `NODE_ENV=production` OR Railway URL patterns
- Increased connection timeout from 5s to 10s for slow network conditions

### 2. Frontend Error Handling
**Problem:** Malformed maintenance log data could crash the React app.

**Fix Applied:**
- Added null/undefined checks in `maintenanceByDate` useMemo
- Ensured `maintenanceLogs` is always an array
- Added try-catch around date parsing
- Set empty array fallback on API errors

### 3. Database Configuration Logging
**Problem:** Hard to diagnose connection issues without logs.

**Fix Applied:**
```javascript
console.log('Database configuration:', {
  hasUrl: !!process.env.DATABASE_URL,
  isProduction,
  sslEnabled: !!sslConfig,
  environment: process.env.NODE_ENV || 'development'
});
```

## Railway Environment Variables Required

Ensure these are set in Railway:

### Required
- `DATABASE_URL` - Auto-provided by Railway Postgres plugin
- `PORT` - Auto-provided by Railway (usually 3000)

### Optional
- `NODE_ENV=production` - Recommended for production
- `ADMIRALTY_API_KEY` - For tide data API
- `STRIPE_SECRET_KEY` - For payment processing

## Deployment Checklist

### 1. Check Railway Logs
```bash
railway logs
```

Look for:
- ✓ "Starting Tidal Calendar Server..."
- ✓ "Attempting to connect to database..."
- ✓ "Database connection successful"
- ✓ "Database schema created successfully"
- ✓ "Server running successfully on port 3000"

### 2. Check Database Plugin
- Ensure Railway Postgres plugin is installed
- Verify DATABASE_URL is linked to your service
- Check database is in same region as app

### 3. Check Build Logs
```bash
railway logs --build
```

Look for:
- ✓ "npm run build" completes successfully
- ✓ No TypeScript/ESLint errors
- ✓ Vite build creates dist/ folder

### 4. Test Health Endpoint
Once deployed:
```bash
curl https://your-app.railway.app/health
```

Expected response:
```json
{
  "status": "healthy",
  "database": "connected",
  "timestamp": "2026-01-11T..."
}
```

## Common Errors & Solutions

### Error: "FATAL: DATABASE_URL environment variable is not set"
**Solution:**
1. Add Railway Postgres plugin
2. Link it to your service
3. Redeploy

### Error: "Failed to connect to database after 5 attempts"
**Possible causes:**
1. Database not ready yet - check Postgres plugin status
2. Wrong region - ensure DB and app in same region
3. Network issues - Railway temporary outage

**Solution:**
- Check Railway status page
- Verify Postgres plugin is "Active"
- Try manual redeploy

### Error: "Port 3000 is already in use"
**Solution:**
- This shouldn't happen on Railway (uses dynamic ports)
- If it does, set `PORT` env var to different value

### Error: App builds but shows blank page
**Possible causes:**
1. Frontend error during hydration
2. API requests failing
3. CORS issues

**Solution:**
1. Check browser console for errors
2. Verify `/health` endpoint works
3. Check Railway logs for API errors

### Error: "Cannot GET /" shows instead of app
**Possible causes:**
1. Vite build failed
2. Static files not served
3. Wrong build output directory

**Solution:**
1. Verify `dist/` folder exists after build
2. Check build script in package.json
3. Ensure server.js serves static files from `dist/`

## Debugging Steps

### 1. Local Test with Railway Database
```bash
# Get DATABASE_URL from Railway dashboard
export DATABASE_URL="postgresql://..."
npm run build
npm start
```

### 2. Check Database Connection
```bash
node test-db-config.mjs
```

### 3. Manual Build Test
```bash
npm run build
ls -la dist/
```

Should show:
- index.html
- assets/ folder with JS/CSS files

### 4. Test Server Locally
```bash
DATABASE_URL="postgresql://..." npm start
```

Visit http://localhost:3000 and check:
- App renders correctly
- No console errors
- /health returns 200

## Railway-Specific Settings

### Build Command
```
npm run build
```

### Start Command
```
npm start
```

### Watch Paths (optional)
```
server.js
src/**
```

### Health Check Path
```
/health
```

### Health Check Timeout
```
30 seconds
```

## Still Not Working?

### 1. Check Railway Service Logs
Look for the exact error message and search this file

### 2. Check Browser Console
- Open DevTools (F12)
- Check Console tab for errors
- Check Network tab for failed requests

### 3. Verify Build Output
```bash
railway run npm run build
ls -la dist/
```

### 4. Test Minimal Server
Comment out maintenance logs temporarily to isolate the issue

### 5. Contact Support
If issue persists:
1. Copy full error logs
2. Note your Railway service ID
3. Check Railway Discord/Support
