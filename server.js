import 'dotenv/config'; 
import express from 'express'; 
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { createReadStream, existsSync } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';
import PDFDocument from 'pdfkit';
import { sendMaintenanceReminderEmail, sendPasswordResetEmail, sendWelcomeEmail } from './src/email/send.js';
import { createPasswordResetStore } from './src/auth/passwordResetStore.js';
import {
  InMemoryPasswordResetStore,
  buildPasswordResetUrl,
  createResetTokenRecord,
  requestPasswordReset,
  resetPasswordWithToken,
} from './src/auth/passwordResetService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isValidAbsoluteHttpUrl = (value) => {
  if (!value || typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const PORT = process.env.PORT || 3000;
const API_BASE_URL = process.env.ADMIRALTY_API_BASE_URL || 'https://admiraltyapi.azure-api.net/uktidalapi/api/V1';
const API_KEY = process.env.ADMIRALTY_API_KEY || 'baec423358314e4e8f527980f959295d';
const subscriberBaseUrlFromEnv = process.env.ADMIRALTY_SUBSCRIBER_TIDAL_API_BASE_URL;
if (subscriberBaseUrlFromEnv && !isValidAbsoluteHttpUrl(subscriberBaseUrlFromEnv)) {
  throw new Error(
    `Invalid ADMIRALTY_SUBSCRIBER_TIDAL_API_BASE_URL: "${subscriberBaseUrlFromEnv}". `
    + 'Expected an absolute http/https URL (e.g. https://example.com/path).',
  );
}
const SUBSCRIBER_TIDAL_API_BASE_URL = subscriberBaseUrlFromEnv || API_BASE_URL;
const SUBSCRIBER_TIDAL_API_KEY = process.env.ADMIRALTY_SUBSCRIBER_TIDAL_API_KEY || API_KEY;
const SESSION_COOKIE = 'tc_session';
const SESSION_TTL_HOURS = 24;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

if (subscriberBaseUrlFromEnv && !isValidAbsoluteHttpUrl(subscriberBaseUrlFromEnv)) {
  console.warn(
    'WARNING: ADMIRALTY_SUBSCRIBER_TIDAL_API_BASE_URL is invalid. Expected an absolute URL (http/https). Falling back to API_BASE_URL.',
    { providedValue: subscriberBaseUrlFromEnv },
  );
}

// Warn if DATABASE_URL missing but don't exit - let connection retry handle it
if (!process.env.DATABASE_URL) {
  console.warn('WARNING: DATABASE_URL environment variable is not set');
  console.warn('Server will start but database operations will fail until DATABASE_URL is configured');
  console.warn('Ensure Railway Postgres plugin is linked to this service');
}

// Configure SSL for production databases
const isProduction = process.env.NODE_ENV === 'production' ||
                     process.env.DATABASE_URL?.includes('railway') ||
                     process.env.DATABASE_URL?.includes('postgres://');
const sslConfig = isProduction ? { rejectUnauthorized: false } : undefined;

console.log('Database configuration:', {
  hasUrl: !!process.env.DATABASE_URL,
  isProduction,
  sslEnabled: !!sslConfig,
  environment: process.env.NODE_ENV || 'development'
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost/temp',
  ssl: sslConfig,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 20,
});

const passwordResetStore =
  process.env.USE_IN_MEMORY_RESET_STORE === 'true'
    ? new InMemoryPasswordResetStore() // TODO: replace with persistent storage outside local dev.
    : createPasswordResetStore(pool);

// Handle pool errors to prevent crashes
pool.on('error', (err, client) => {
  console.error('Unexpected database pool error:', err);
});

const app = express();
const stripeWebhookPath = '/api/payments/stripe/webhook';
const jsonParser = express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
});
const stripeWebhookRawParser = express.raw({ type: 'application/json' });
app.use((req, res, next) => {
  if (req.path === stripeWebhookPath) {
    return stripeWebhookRawParser(req, res, next);
  }
  return jsonParser(req, res, next);
});
app.use(cookieParser());

const isValidEmail = (value) => typeof value === 'string' && /\S+@\S+\.\S+/.test(value);
const OVERPASS_API_URLS = (process.env.OVERPASS_API_URL
  ? process.env.OVERPASS_API_URL.split(',').map((item) => item.trim()).filter(Boolean)
  : [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ]);
const NOMINATIM_SEARCH_URL = process.env.NOMINATIM_SEARCH_URL || 'https://nominatim.openstreetmap.org/search';
const FACILITY_LOOKUP_USER_AGENT = process.env.FACILITY_LOOKUP_USER_AGENT || 'BoatScrubCalendar/1.0 (+https://boatscrubcalendar.com)';

const toRadians = (deg) => (deg * Math.PI) / 180;
const haversineKm = (aLat, aLon, bLat, bLon) => {
  const earthKm = 6371;
  const dLat = toRadians(bLat - aLat);
  const dLon = toRadians(bLon - aLon);
  const p = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLon / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(p), Math.sqrt(1 - p));
};

const parseMetricValue = (value) => {
  if (!value) return null;
  const match = String(value).match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
};

const stripHtml = (value = '') => String(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const sanitizeBlogHtml = (value = '') => String(value)
  .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
  .replace(/\son\w+="[^"]*"/gi, '')
  .replace(/\son\w+='[^']*'/gi, '')
  .trim();
const toSlugBase = (value = '') => String(value)
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[^\w\s-]/g, '')
  .replace(/[_\s]+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 90) || 'article';

const buildUniqueBlogSlug = async (title, excludeId = null) => {
  const base = toSlugBase(title);
  let candidate = base;
  let suffix = 2;
  while (true) {
    const values = [candidate];
    const where = ['slug = $1'];
    if (excludeId) {
      values.push(excludeId);
      where.push(`id <> $${values.length}`);
    }
    const { rows } = await pool.query(`SELECT 1 FROM blog_posts WHERE ${where.join(' AND ')} LIMIT 1`, values);
    if (rows.length === 0) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
};

const initialBlogPosts = [
  {
    title: 'Spring Sail Boat Maintenance in the UK',
    excerpt: 'A practical March-to-May refresh plan to keep your yacht safe, efficient, and ready for longer coastal passages.',
    coverImageUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1400&q=80',
    contentHtml: `
      <p>Start with a full topside and hull inspection while the weather is still cool. Look for gelcoat cracks, tired antifoul patches, anode wear, and any signs of water ingress around deck fittings.</p>
      <p>Move on to rigging and sail systems. Winter moisture can accelerate corrosion on terminals and turnbuckles, so clean and inspect standing rigging carefully. Re-lubricate winches, replace worn control lines, and test reefing setups before your first longer trip.</p>
      <p>Finally, review safety and engine essentials: service filters, belts, and impellers, confirm navigation lights and VHF operation, and renew flares near expiry. Pair this with spring tide planning in your home port so haul-out and relaunch tasks line up with practical tidal windows.</p>
    `.trim(),
  },
  {
    title: 'Know Your Waters: Hull Fouling Around the UK and When to Scrub',
    excerpt: 'Understand growth pressure by region and season so you can schedule cleaning around the right tidal windows.',
    coverImageUrl: '',
    contentHtml: `
      <p>Hull fouling is not uniform around the UK. In warmer, nutrient-rich marinas, slime and weed can build quickly. In higher-energy or colder waters, buildup may be slower, but barnacle spikes still appear if inspections are delayed.</p>
      <p>Track your own performance indicators: reduced speed at normal RPM, higher fuel burn, and sluggish acceleration are often the earliest signs. A light clean early in the season can prevent heavy fouling later.</p>
      <p>Use local low-water opportunities and club scrubbing slots to stay ahead of growth. Planning by tide and weather windows avoids rushed maintenance and keeps your hull efficient over longer passages.</p>
    `.trim(),
  },
];

const parseJsonResponse = async (response, context) => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (_err) {
    const preview = text.slice(0, 140).replace(/\s+/g, ' ');
    throw new Error(`${context} returned non-JSON response (${response.status}): ${preview || 'empty body'}`);
  }
};

const resolveUkLocation = async (locationQuery) => {
  const trimmed = String(locationQuery || '').trim();
  if (!trimmed) throw new Error('Location is required');

  const normalized = trimmed.toUpperCase().replace(/\s+/g, '');
  const postcodePattern = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/;
  if (postcodePattern.test(normalized)) {
    const postcode = `${normalized.slice(0, -3)} ${normalized.slice(-3)}`;
    const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`);
    const data = await parseJsonResponse(response, 'Postcodes.io');
    if (response.ok && data?.status === 200 && data?.result) {
      return { lat: data.result.latitude, lon: data.result.longitude, label: data.result.postcode };
    }
  }

  const searchUrl = new URL(NOMINATIM_SEARCH_URL);
  searchUrl.searchParams.set('q', trimmed);
  searchUrl.searchParams.set('format', 'jsonv2');
  searchUrl.searchParams.set('limit', '1');
  searchUrl.searchParams.set('countrycodes', 'gb');

  const response = await fetch(searchUrl, {
    headers: { 'User-Agent': FACILITY_LOOKUP_USER_AGENT },
  });
  const data = await parseJsonResponse(response, 'Nominatim');
  if (!response.ok || !Array.isArray(data) || data.length === 0) {
    throw new Error('Could not geocode that UK location');
  }
  return { lat: Number(data[0].lat), lon: Number(data[0].lon), label: data[0].display_name };
};

const inferFacilityType = (tags = {}) => {
  if (tags.waterway === 'boatyard') return 'boatyard';
  if (tags.leisure === 'marina') return 'marina';
  if (tags.sport === 'sailing' || tags.club === 'sailing' || tags.seamark_type === 'yacht_club') return 'club';
  return 'marine_facility';
};

const searchMarineFacilities = async ({ location, draft, loa, scrubNeed }) => {
  const origin = await resolveUkLocation(location);
  const radiusMeters = 160000;
  const overpassQuery = `
[out:json][timeout:30];
(
  nwr(around:${radiusMeters},${origin.lat},${origin.lon})[leisure=marina];
  nwr(around:${radiusMeters},${origin.lat},${origin.lon})[waterway=boatyard];
  nwr(around:${radiusMeters},${origin.lat},${origin.lon})[sport=sailing];
  nwr(around:${radiusMeters},${origin.lat},${origin.lon})["seamark:type"="yacht_club"];
);
out center tags;
  `.trim();

  let payload = null;
  let overpassError = null;
  for (const overpassUrl of OVERPASS_API_URLS) {
    try {
      const response = await fetch(overpassUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Accept: 'application/json',
          'User-Agent': FACILITY_LOOKUP_USER_AGENT,
        },
        body: new URLSearchParams({ data: overpassQuery }),
      });
      const data = await parseJsonResponse(response, `Overpass (${overpassUrl})`);
      if (!response.ok) {
        throw new Error(data?.remark || `HTTP ${response.status}`);
      }
      if (!Array.isArray(data?.elements)) {
        throw new Error('Missing elements in Overpass response');
      }
      payload = data;
      break;
    } catch (err) {
      overpassError = err;
    }
  }
  if (!payload) {
    throw new Error(`Unable to load facilities from Overpass: ${overpassError?.message || 'all endpoints failed'}`);
  }

  const results = payload.elements
    .map((item) => {
      const lat = item.lat ?? item.center?.lat;
      const lon = item.lon ?? item.center?.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const tags = item.tags || {};
      const name = tags.name || tags.operator || 'Unnamed marine facility';
      const maxDraft = parseMetricValue(tags.maxdraught || tags.maxdraft || tags.depth) || 99;
      const maxLoa = parseMetricValue(tags.maxlength || tags['maxlength:physical'] || tags.length) || 99;
      const distanceKm = haversineKm(origin.lat, origin.lon, lat, lon);
      const supportsBoat = maxDraft >= draft && maxLoa >= loa;
      const urgentBoost = scrubNeed === 'urgent' ? (distanceKm <= 40 ? 20 : 0) : 0;
      const capabilityScore = (supportsBoat ? 120 : -400) + Math.max(0, Math.min(40, (maxDraft - draft) * 10)) + Math.max(0, Math.min(30, (maxLoa - loa) * 2));
      return {
        id: `${item.type}-${item.id}`,
        name,
        type: inferFacilityType(tags),
        lat,
        lon,
        distanceKm,
        maxDraft: Number(maxDraft.toFixed(1)),
        maxLoa: Number(maxLoa.toFixed(1)),
        supportsBoat,
        score: capabilityScore + urgentBoost - distanceKm,
        source: 'OpenStreetMap/Overpass',
      };
    })
    .filter(Boolean)
    .filter((item) => item.supportsBoat)
    .sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm)
    .slice(0, 8);

  return { origin, facilities: results };
};

const createRateLimiter = ({ windowMs, max, message }) => {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const entry = hits.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }

    entry.count += 1;
    hits.set(key, entry);

    if (entry.count > max) {
      res.status(429).json(message);
      return;
    }

    next();
  };
};

const publicPath = path.join(__dirname, 'public');
const frontendBundlePath = path.join(publicPath, 'assets', 'bundle.js');

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

let dbReady = false;
let dbInitInProgress = false;

// Test database connection with retry logic
const testDatabaseConnection = async (maxRetries = 5, delayMs = 2000) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempting to connect to database (attempt ${attempt}/${maxRetries})...`);
      const client = await pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      console.log('Database connection successful');
      return true;
    } catch (err) {
      const message = err?.message || 'Unknown database connection error';
      const isFinalAttempt = attempt >= maxRetries;
      const log = isFinalAttempt ? console.error : console.warn;
      log(`Database connection attempt ${attempt} failed: ${message}`);
      if (attempt < maxRetries) {
        console.log(`Retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
        throw new Error(`Failed to connect to database after ${maxRetries} attempts: ${message}`);
      }
    }
  }
};

const ensureSchema = async () => {
  console.log('Creating database schema...');
  try {
    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        subscription_status TEXT NOT NULL DEFAULT 'inactive',
        subscription_period_end TIMESTAMPTZ,
        has_pdf_calendar_access BOOLEAN NOT NULL DEFAULT false,
        pdf_calendar_purchased_at TIMESTAMPTZ,
        stripe_customer_id TEXT,
        stripe_last_session_id TEXT,
        maintenance_reminders_enabled BOOLEAN NOT NULL DEFAULT false,
        home_port_id TEXT,
        home_port_name TEXT,
        home_club_id UUID,
        home_club_name TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        token_hash TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS clubs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        capacity INT NOT NULL DEFAULT 8,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS club_facilities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        club_id UUID REFERENCES clubs(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(club_id, name)
      );
      CREATE TABLE IF NOT EXISTS club_memberships (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        club_id UUID REFERENCES clubs(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        added_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(club_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS scrub_windows (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        club_id UUID REFERENCES clubs(id) ON DELETE CASCADE,
        date_label TEXT NOT NULL,
        low_water TEXT NOT NULL,
        duration TEXT NOT NULL,
        starts_at TIMESTAMPTZ,
        ends_at TIMESTAMPTZ,
        notes TEXT,
        facility_id UUID REFERENCES club_facilities(id) ON DELETE SET NULL,
        capacity INT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS bookings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        window_id UUID REFERENCES scrub_windows(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        boat_name TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(window_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS maintenance_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        activity_type TEXT NOT NULL DEFAULT 'planned',
        title TEXT NOT NULL,
        notes TEXT,
        completed BOOLEAN DEFAULT false,
        reminder_sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS blog_posts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title TEXT NOT NULL,
        excerpt TEXT,
        cover_image_url TEXT,
        content_html TEXT NOT NULL,
        author_id UUID REFERENCES users(id) ON DELETE SET NULL,
        published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS club_calendar_integrations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        club_id UUID REFERENCES clubs(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        external_calendar_id TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        token_expires_at TIMESTAMPTZ,
        remote_sync_cursor TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        last_synced_at TIMESTAMPTZ,
        UNIQUE(club_id, provider, external_calendar_id)
      );
      CREATE TABLE IF NOT EXISTS club_calendar_event_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        integration_id UUID REFERENCES club_calendar_integrations(id) ON DELETE CASCADE,
        scrub_window_id UUID REFERENCES scrub_windows(id) ON DELETE CASCADE,
        external_event_id TEXT NOT NULL,
        external_etag TEXT,
        last_pushed_at TIMESTAMPTZ DEFAULT now(),
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(integration_id, scrub_window_id),
        UNIQUE(integration_id, external_event_id)
      );
    `);
    console.log('Database schema created successfully');
  } catch (err) {
    console.error('Failed to create database schema:', err);
    throw err;
  }

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'inactive';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_period_end TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS has_pdf_calendar_access BOOLEAN NOT NULL DEFAULT false;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pdf_calendar_purchased_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_last_session_id TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS maintenance_reminders_enabled BOOLEAN NOT NULL DEFAULT false;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS home_port_id TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS home_port_name TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS home_club_id UUID;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS home_club_name TEXT;`);
  await pool.query(`CREATE TABLE IF NOT EXISTS club_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id UUID REFERENCES clubs(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    added_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(club_id, user_id)
  );`);
  await pool.query(`ALTER TABLE maintenance_logs ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE scrub_windows ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE scrub_windows ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE scrub_windows ADD COLUMN IF NOT EXISTS notes TEXT;`);
  await pool.query(`CREATE TABLE IF NOT EXISTS club_facilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id UUID REFERENCES clubs(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(club_id, name)
  );`);
  await pool.query(`ALTER TABLE scrub_windows ADD COLUMN IF NOT EXISTS facility_id UUID REFERENCES club_facilities(id) ON DELETE SET NULL;`);
  await pool.query(`ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS excerpt TEXT;`);
  await pool.query(`ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS cover_image_url TEXT;`);
  await pool.query(`ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();`);
  await pool.query(`ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS slug TEXT;`);
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS boat_name TEXT;`);

  const { rows: rowsNeedingSlug } = await pool.query(
    `SELECT id, title FROM blog_posts WHERE slug IS NULL OR btrim(slug) = '' ORDER BY created_at ASC`,
  );
  for (const post of rowsNeedingSlug) {
    const slug = await buildUniqueBlogSlug(post.title, post.id);
    await pool.query(`UPDATE blog_posts SET slug = $1 WHERE id = $2`, [slug, post.id]);
  }
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS blog_posts_slug_unique_idx ON blog_posts(slug);`);

  const { rows: blogRows } = await pool.query(`SELECT id FROM blog_posts LIMIT 1`);
  if (blogRows.length === 0) {
    for (const post of initialBlogPosts) {
      const slug = await buildUniqueBlogSlug(post.title);
      await pool.query(
        `INSERT INTO blog_posts (title, excerpt, cover_image_url, content_html, slug, published_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, now(), now(), now())`,
        [post.title, post.excerpt, post.coverImageUrl || null, sanitizeBlogHtml(post.contentHtml), slug],
      );
    }
  }

  const { rows } = await pool.query(`SELECT id FROM clubs LIMIT 1`);
  if (rows.length === 0) {
    const { rows: clubRows } = await pool.query(
      `INSERT INTO clubs (name, capacity) VALUES ($1, $2) RETURNING id, name, capacity`,
      ['Solent Cruising Club', 8],
    );
    const clubId = clubRows[0].id;
    const { rows: facilityRows } = await pool.query(
      `INSERT INTO club_facilities (club_id, name) VALUES ($1, $2) RETURNING id`,
      [clubId, 'Main scrubbing post'],
    );
    const facilityId = facilityRows[0].id;
    const windows = [
      { date: 'Thu 18 Sep', lowWater: '11:42', duration: '2h 20m', capacity: 8 },
      { date: 'Fri 19 Sep', lowWater: '12:28', duration: '2h 10m', capacity: 8 },
      { date: 'Sat 20 Sep', lowWater: '13:10', duration: '2h 05m', capacity: 8 },
    ];
    for (const w of windows) {
      await pool.query(
        `INSERT INTO scrub_windows (club_id, date_label, low_water, duration, facility_id, capacity) VALUES ($1, $2, $3, $4, $5, $6)`,
        [clubId, w.date, w.lowWater, w.duration, facilityId, w.capacity],
      );
    }
  }
};

const initializeDatabase = async () => {
  if (dbInitInProgress) return;
  dbInitInProgress = true;
  try {
    await testDatabaseConnection();
    await ensureSchema();
    dbReady = true;
    console.log('Database initialization complete');
    scheduleMaintenanceReminderChecks();
  } catch (err) {
    dbReady = false;
    console.error('Database initialization failed:', err.message);
    const retryDelayMs = Number(process.env.DB_INIT_RETRY_MS) || 10000;
    console.log(`Retrying database initialization in ${retryDelayMs}ms...`);
    setTimeout(() => {
      dbInitInProgress = false;
      initializeDatabase();
    }, retryDelayMs);
    return;
  }
  dbInitInProgress = false;
};

const getUserFromSession = async (req) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.role, u.subscription_status, u.subscription_period_end, u.has_pdf_calendar_access, u.pdf_calendar_purchased_at, u.stripe_customer_id, u.stripe_last_session_id, u.maintenance_reminders_enabled, u.home_port_id, u.home_port_name, u.home_club_id, u.home_club_name
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  );
  return rows[0] || null;
};

const requireDatabase = (_req, res, next) => {
  if (!dbReady) {
    res.status(503).json({ error: 'Database is initializing' });
    return;
  }
  next();
};

const requireAuth = async (req, res, next) => {
  const user = await getUserFromSession(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  req.user = user;
  next();
};

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin permission required' });
    return;
  }
  next();
};

const requireClubAdmin = (req, res, next) => {
  if (req.user?.role !== 'club_admin' && req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Club admin permission required' });
    return;
  }
  next();
};

const OAUTH_STATE_SECRET = process.env.CALENDAR_OAUTH_STATE_SECRET || process.env.SESSION_SECRET || 'tidal-calendar-oauth-state';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_CALENDAR_REDIRECT_URI || '';
const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CALENDAR_CLIENT_ID || '';
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CALENDAR_CLIENT_SECRET || '';
const MICROSOFT_REDIRECT_URI = process.env.MICROSOFT_CALENDAR_REDIRECT_URI || '';

const getOAuthProviderConfig = (provider) => {
  if (provider === 'gmail') {
    return {
      provider: 'gmail',
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      redirectUri: GOOGLE_REDIRECT_URI,
      scope: 'https://www.googleapis.com/auth/calendar',
    };
  }
  if (provider === 'outlook') {
    return {
      provider: 'outlook',
      authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      clientId: MICROSOFT_CLIENT_ID,
      clientSecret: MICROSOFT_CLIENT_SECRET,
      redirectUri: MICROSOFT_REDIRECT_URI,
      scope: 'offline_access Calendars.ReadWrite',
    };
  }
  return null;
};

const createOAuthState = ({ userId, clubId, provider }) => {
  const payload = `${userId}.${clubId}.${provider}.${Date.now()}`;
  const signature = createHmac('sha256', OAUTH_STATE_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}.${signature}`).toString('base64url');
};

const verifyOAuthState = (state) => {
  try {
    const raw = Buffer.from(String(state || ''), 'base64url').toString('utf8');
    const parts = raw.split('.');
    if (parts.length < 5) return null;
    const signature = parts.pop();
    const payload = parts.join('.');
    const expected = createHmac('sha256', OAUTH_STATE_SECRET).update(payload).digest('hex');
    if (signature !== expected) return null;
    const [userId, clubId, provider, issuedAtRaw] = parts;
    const issuedAt = Number(issuedAtRaw);
    if (!Number.isFinite(issuedAt) || (Date.now() - issuedAt) > (1000 * 60 * 20)) return null;
    return { userId, clubId, provider };
  } catch {
    return null;
  }
};

const parseDurationToMinutes = (value) => {
  const text = String(value || '').trim();
  const hmMatch = text.match(/(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?/i);
  if (hmMatch && (hmMatch[1] || hmMatch[2])) {
    const hours = Number(hmMatch[1] || 0);
    const minutes = Number(hmMatch[2] || 0);
    return (hours * 60) + minutes;
  }
  const numeric = Number(text);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 120;
};

const toWindowTimestamps = ({ startsAt, endsAt, date, lowWater, duration }) => {
  if (startsAt) {
    const parsedStart = new Date(startsAt);
    if (!Number.isNaN(parsedStart.getTime())) {
      let parsedEnd = endsAt ? new Date(endsAt) : null;
      if (!parsedEnd || Number.isNaN(parsedEnd.getTime()) || parsedEnd <= parsedStart) {
        parsedEnd = new Date(parsedStart.getTime() + parseDurationToMinutes(duration) * 60 * 1000);
      }
      return { startsAt: parsedStart.toISOString(), endsAt: parsedEnd.toISOString() };
    }
  }
  if (date && lowWater) {
    const parsedStart = new Date(`${date}T${lowWater}:00`);
    if (!Number.isNaN(parsedStart.getTime())) {
      const parsedEnd = new Date(parsedStart.getTime() + parseDurationToMinutes(duration) * 60 * 1000);
      return { startsAt: parsedStart.toISOString(), endsAt: parsedEnd.toISOString() };
    }
  }
  return { startsAt: null, endsAt: null };
};

const formatClubWindow = (row) => ({
  id: row.id,
  date: row.date,
  lowWater: row.lowWater,
  duration: row.duration,
  capacity: Number(row.capacity),
  booked: Number(row.booked || 0),
  startsAt: row.startsAt || null,
  endsAt: row.endsAt || null,
  notes: row.notes || '',
  facilityId: row.facilityId || null,
  facilityName: row.facilityName || 'Unassigned facility',
  myBooking: row.myBooking || null,
  bookingDetails: Array.isArray(row.bookingDetails) ? row.bookingDetails : [],
});

const hasPaidCalendarAccess = (user) => {
  if (!user) return false;
  return Boolean(user.has_pdf_calendar_access);
};

const hasExtendedTidalAccess = (user) => {
  if (!user) return false;
  return user.subscription_status === 'active'
    && Boolean(user.has_pdf_calendar_access);
};

const isTidalEventsPath = (targetPath = '') => /^Stations\/[^/]+\/TidalEvents(?:ForDateRange)?(?:\?|$)/.test(String(targetPath));

const formatIsoDate = (date) => date.toISOString().slice(0, 10);

const normalizeDurationDays = (duration, maxDurationDays) => {
  const parsedDuration = Number.parseInt(duration, 10);
  const normalizedDuration = Math.max(1, Number.isFinite(parsedDuration) ? parsedDuration : 7);
  if (!Number.isFinite(maxDurationDays)) {
    return normalizedDuration;
  }
  return Math.min(normalizedDuration, Math.max(1, maxDurationDays));
};

const buildDateRangeFromDuration = (duration, maxDurationDays = Number.POSITIVE_INFINITY) => {
  const normalizedDuration = normalizeDurationDays(duration, maxDurationDays);
  const startDate = new Date();
  startDate.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + normalizedDuration - 1);
  return {
    startDate: formatIsoDate(startDate),
    endDate: formatIsoDate(endDate),
  };
};

const toPremiumDateRangePath = (targetPath, maxDurationDays = Number.POSITIVE_INFINITY) => {
  if (!isTidalEventsPath(targetPath)) {
    return targetPath;
  }

  const [pathOnly, query = ''] = targetPath.split('?');
  const stationId = pathOnly.split('/')[1];
  if (!stationId) {
    return targetPath;
  }

  const params = new URLSearchParams(query);
  const startDate = params.get('StartDate') || params.get('startDate');
  const endDate = params.get('EndDate') || params.get('endDate');
  const duration = params.get('duration');

  if (startDate && endDate) {
    const startDateValue = new Date(startDate);
    const endDateValue = new Date(endDate);
    if (Number.isFinite(maxDurationDays) && !Number.isNaN(startDateValue.getTime()) && !Number.isNaN(endDateValue.getTime())) {
      const clampedEndDate = new Date(startDateValue);
      clampedEndDate.setUTCDate(clampedEndDate.getUTCDate() + Math.max(1, maxDurationDays) - 1);
      const effectiveEndDate = endDateValue > clampedEndDate ? clampedEndDate : endDateValue;
      return `Stations/${stationId}/TidalEventsForDateRange?StartDate=${encodeURIComponent(formatIsoDate(startDateValue))}&EndDate=${encodeURIComponent(formatIsoDate(effectiveEndDate))}`;
    }
    return `Stations/${stationId}/TidalEventsForDateRange?StartDate=${encodeURIComponent(startDate)}&EndDate=${encodeURIComponent(endDate)}`;
  }

  const { startDate: computedStart, endDate: computedEnd } = buildDateRangeFromDuration(duration, maxDurationDays);
  return `Stations/${stationId}/TidalEventsForDateRange?StartDate=${computedStart}&EndDate=${computedEnd}`;
};

const getAdmiraltyApiConfig = (targetPath) => {
  if (isTidalEventsPath(targetPath)) {
    return { baseUrl: 'https://admiraltyapi.azure-api.net/uktidalapi-premium/api/V2', apiKey: '605d09171c3944faa3649d9dc9b4293b', source: 'premium_tidal' };
  }
  return { baseUrl: API_BASE_URL, apiKey: API_KEY, source: 'default_tidal' };
};

const getAdmiraltyTargetPath = (targetPath, user) => {
  if (!isTidalEventsPath(targetPath)) {
    return targetPath;
  }
  const isExtendedUser = hasExtendedTidalAccess(user);
  if (isExtendedUser && targetPath.includes('duration=')) {
    const [pathOnly, query = ''] = targetPath.split('?');
    const params = new URLSearchParams(query);
    params.set('duration', '365');
    return toPremiumDateRangePath(`${pathOnly}?${params.toString()}`, 365);
  }
  const maxDurationDays = isExtendedUser ? 365 : 7;
  return toPremiumDateRangePath(targetPath, maxDurationDays);
};

const getAdmiraltyHeaders = (apiKey) => ({
  Accept: 'application/json',
  'Subscription-Key': apiKey,
  'Ocp-Apim-Subscription-Key': apiKey,
});

const fetchAdmiraltyEvents = async ({ stationId, duration, user = null }) => {
  const targetPath = `Stations/${stationId}/TidalEvents?duration=${duration}`;
  const { baseUrl, apiKey } = getAdmiraltyApiConfig(targetPath);
  const apiTargetPath = getAdmiraltyTargetPath(targetPath, user);
  const response = await fetch(`${baseUrl}/${apiTargetPath}`, {
    headers: getAdmiraltyHeaders(apiKey),
  });
  if (!response.ok) {
    throw new Error(`TidalEvents fetch failed (${response.status})`);
  }
  return response.json();
};

const passwordResetLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many password reset requests, please try again later.' },
});

// Health check endpoint for container monitoring.
// Keep this endpoint independent of database availability so Railway can
// consistently validate container liveness during deploys and restarts.
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    databaseReady: dbReady,
    timestamp: new Date().toISOString(),
  });
});

app.use(async (req, res, next) => {
  // Refresh session on activity
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    if (!dbReady) return next();
    try {
      await pool.query(`UPDATE sessions SET expires_at = now() + interval '${SESSION_TTL_HOURS} hours' WHERE token = $1`, [token]);
    } catch (err) {
      console.error('Failed to refresh session expiry:', err);
    }
  }
  next();
});

// Proxy to Admiralty API
app.use('/api/Stations', async (req, res) => {
  const targetPath = req.originalUrl.replace('/api/', '');
  let user = null;
  if (dbReady && req.cookies?.[SESSION_COOKIE]) {
    try {
      user = await getUserFromSession(req);
    } catch (err) {
      console.warn('Failed to load session for Stations proxy:', err.message);
    }
  }
  const apiConfig = getAdmiraltyApiConfig(targetPath);
  const apiTargetPath = getAdmiraltyTargetPath(targetPath, user);
  const url = new URL(`${apiConfig.baseUrl}/${apiTargetPath}`);
  try {
    const upstream = await fetch(url, {
      headers: getAdmiraltyHeaders(apiConfig.apiKey),
    });

    res.status(upstream.status);
    res.set('Content-Type', upstream.headers.get('content-type') || 'application/json');

    if (!upstream.body) {
      res.end();
      return;
    }

    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    console.error('Proxy error', { err, targetPath, apiTargetPath, source: apiConfig.source });
    res.status(502).json({ error: 'Proxy request failed' });
  }
});

app.use('/api', requireDatabase);

// Auth routes
app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2)
       RETURNING id, email, role, subscription_status, subscription_period_end, has_pdf_calendar_access, pdf_calendar_purchased_at, stripe_customer_id, stripe_last_session_id, maintenance_reminders_enabled, home_port_id, home_port_name, home_club_id, home_club_name`,
      [email.toLowerCase(), hash],
    );
    const user = rows[0];
    const token = randomUUID();
    await pool.query(`INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, now() + interval '${SESSION_TTL_HOURS} hours')`, [user.id, token]);
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: SESSION_TTL_HOURS * 3600 * 1000 });
    let welcomeResetUrl;
    if (process.env.PUBLIC_APP_URL) {
      try {
        const { token: resetToken } = await createResetTokenRecord({
          store: passwordResetStore,
          userId: user.id,
          email: user.email,
        });
        welcomeResetUrl = buildPasswordResetUrl(process.env.PUBLIC_APP_URL, resetToken);
      } catch (err) {
        console.error('Failed to create welcome reset link:', err.message);
      }
    }
    try {
      await sendWelcomeEmail({ to: user.email, resetUrl: welcomeResetUrl });
    } catch (err) {
      console.error('Failed to send welcome email:', err.message);
    }
    res.json(user);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'User already exists' });
    console.error(err);
    res.status(500).json({ error: 'Signup failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const { rows } = await pool.query(
    `SELECT id, email, role, subscription_status, subscription_period_end, has_pdf_calendar_access, pdf_calendar_purchased_at, stripe_customer_id, stripe_last_session_id, maintenance_reminders_enabled, password_hash, home_port_id, home_port_name, home_club_id, home_club_name
     FROM users WHERE email = $1`,
    [email.toLowerCase()],
  );
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  const token = randomUUID();
  await pool.query(`INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, now() + interval '${SESSION_TTL_HOURS} hours')`, [user.id, token]);
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: SESSION_TTL_HOURS * 3600 * 1000 });
  res.json({
    id: user.id,
    email: user.email,
    role: user.role,
    subscription_status: user.subscription_status,
    subscription_period_end: user.subscription_period_end,
    has_pdf_calendar_access: user.has_pdf_calendar_access,
    pdf_calendar_purchased_at: user.pdf_calendar_purchased_at,
    stripe_customer_id: user.stripe_customer_id,
    stripe_last_session_id: user.stripe_last_session_id,
    maintenance_reminders_enabled: user.maintenance_reminders_enabled,
    home_port_id: user.home_port_id,
    home_port_name: user.home_port_name,
    home_club_id: user.home_club_id,
    home_club_name: user.home_club_name,
  });
});

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const { rows } = await pool.query(
    `SELECT password_hash FROM users WHERE id = $1`,
    [req.user.id],
  );
  const record = rows[0];
  if (!record) return res.status(404).json({ error: 'User not found' });

  const valid = await bcrypt.compare(currentPassword, record.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const nextPasswordHash = await bcrypt.hash(newPassword, 10);
  await pool.query(
    `UPDATE users SET password_hash = $1 WHERE id = $2`,
    [nextPasswordHash, req.user.id],
  );

  res.json({ ok: true });
});

app.post('/api/auth/request-password-reset', passwordResetLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!isValidEmail(email)) {
    res.status(200).json({ ok: true });
    return;
  }

  try {
    await requestPasswordReset({
      email,
      store: passwordResetStore,
      userLookup: async (normalizedEmail) => {
        const { rows } = await pool.query(
          `SELECT id, email FROM users WHERE email = $1`,
          [normalizedEmail],
        );
        return rows[0] || null;
      },
      sendPasswordResetEmail,
      publicAppUrl: process.env.PUBLIC_APP_URL,
    });
  } catch (err) {
    console.error('Password reset request failed:', err.message);
  }

  res.status(200).json({ ok: true });
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Token required' });
  }
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  const result = await resetPasswordWithToken({
    token,
    newPasswordHash: newHash,
    store: passwordResetStore,
    updatePasswordHash: async (userId, passwordHash) => {
      await pool.query(
        `UPDATE users SET password_hash = $1 WHERE id = $2`,
        [passwordHash, userId],
      );
    },
  });

  if (!result.ok) {
    return res.status(400).json({ error: 'Invalid or expired token' });
  }

  res.json({ ok: true });
});

app.post('/api/dev/send-test-email', requireAuth, requireAdmin, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  const { to, type } = req.body || {};
  if (!isValidEmail(to)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const emailType = type || 'welcome';
  try {
    if (emailType === 'welcome') {
      const result = await sendWelcomeEmail({ to });
      return res.json({ ok: true, id: result.id });
    }
    if (emailType === 'reset') {
      const fallbackUrl = process.env.PUBLIC_APP_URL || 'http://localhost:3000';
      const resetUrl = buildPasswordResetUrl(fallbackUrl, 'test-token');
      const result = await sendPasswordResetEmail({ to, resetUrl });
      return res.json({ ok: true, id: result.id });
    }
    return res.status(400).json({ error: 'Unknown email type' });
  } catch (err) {
    console.error('Test email failed:', err.message);
    return res.status(500).json({ error: 'Failed to send test email' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    await pool.query(`DELETE FROM sessions WHERE token = $1`, [token]);
  }
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res) => {
  const user = await getUserFromSession(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  res.json(user);
});

// Profile
app.get('/api/profile', requireAuth, async (req, res) => {
  res.json(req.user);
});

app.put('/api/profile', requireAuth, async (req, res) => {
  const { homePortId, homePortName, homeClubId, homeClubName, maintenanceRemindersEnabled } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE users
     SET home_port_id = COALESCE($1, home_port_id),
         home_port_name = COALESCE($2, home_port_name),
         home_club_id = COALESCE($3, home_club_id),
         home_club_name = COALESCE($4, home_club_name),
         maintenance_reminders_enabled = COALESCE($5, maintenance_reminders_enabled)
     WHERE id = $6
     RETURNING id, email, role, subscription_status, subscription_period_end, has_pdf_calendar_access, pdf_calendar_purchased_at, stripe_customer_id, stripe_last_session_id, maintenance_reminders_enabled, home_port_id, home_port_name, home_club_id, home_club_name`,
    [homePortId ?? null, homePortName ?? null, homeClubId ?? null, homeClubName ?? null, maintenanceRemindersEnabled, req.user.id],
  );
  res.json(rows[0]);
});

app.post('/api/profile/role', requireAuth, async (req, res) => {
  const { role } = req.body || {};
  if (!['user', 'subscriber', 'club_admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const { rows } = await pool.query(
    `UPDATE users
     SET role = $1,
         subscription_status = CASE WHEN $1 = 'subscriber' THEN 'active' ELSE subscription_status END,
         subscription_period_end = CASE WHEN $1 = 'subscriber' AND subscription_period_end IS NULL THEN now() + interval '1 year' ELSE subscription_period_end END
     WHERE id = $2
     RETURNING id, email, role, subscription_status, subscription_period_end, has_pdf_calendar_access, pdf_calendar_purchased_at, stripe_customer_id, stripe_last_session_id, maintenance_reminders_enabled, home_port_id, home_port_name, home_club_id, home_club_name`,
    [role, req.user.id],
  );
  res.json(rows[0]);
});

// Admin users
app.get('/api/admin/stats', requireAuth, requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT
        COUNT(*)::int AS total,
        COUNT(*)::int AS signed_up,
        COUNT(*) FILTER (WHERE role = 'subscriber' OR subscription_status = 'active')::int AS subscribers,
        COUNT(*) FILTER (WHERE has_pdf_calendar_access = true)::int AS pdf_calendar_buyers,
        COUNT(*) FILTER (WHERE stripe_customer_id IS NOT NULL OR stripe_last_session_id IS NOT NULL)::int AS stripe_customers
     FROM users`,
  );
  res.json(rows[0]);
});

app.get('/api/admin/users', requireAuth, requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, email, role, subscription_status, subscription_period_end, has_pdf_calendar_access, pdf_calendar_purchased_at, stripe_customer_id, stripe_last_session_id, created_at
     FROM users
     ORDER BY created_at DESC`,
  );
  res.json(rows);
});

app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const { email, password, role, subscriptionStatus, subscriptionPeriodEnd } = req.body || {};
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Valid email required' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (role && !['user', 'subscriber', 'club_admin', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (subscriptionStatus && !['active', 'inactive'].includes(subscriptionStatus)) {
    return res.status(400).json({ error: 'Invalid subscription status' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, role, subscription_status, subscription_period_end)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, role, subscription_status, subscription_period_end, has_pdf_calendar_access, pdf_calendar_purchased_at, stripe_customer_id, stripe_last_session_id, created_at`,
    [
      email.toLowerCase(),
      passwordHash,
      role || 'user',
      subscriptionStatus || 'inactive',
      subscriptionPeriodEnd ? new Date(subscriptionPeriodEnd) : null,
    ],
  );
  res.status(201).json(rows[0]);
});

app.put('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { email, password, role, subscriptionStatus, subscriptionPeriodEnd } = req.body || {};
  const updates = [];
  const values = [];
  let idx = 1;

  if (email !== undefined) {
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Valid email required' });
    updates.push(`email = $${idx++}`);
    values.push(email.toLowerCase());
  }
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const passwordHash = await bcrypt.hash(password, 10);
    updates.push(`password_hash = $${idx++}`);
    values.push(passwordHash);
  }
  if (role !== undefined) {
    if (!['user', 'subscriber', 'club_admin', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    updates.push(`role = $${idx++}`);
    values.push(role);
  }
  if (subscriptionStatus !== undefined) {
    if (!['active', 'inactive'].includes(subscriptionStatus)) {
      return res.status(400).json({ error: 'Invalid subscription status' });
    }
    updates.push(`subscription_status = $${idx++}`);
    values.push(subscriptionStatus);
  }
  if (subscriptionPeriodEnd !== undefined) {
    updates.push(`subscription_period_end = $${idx++}`);
    values.push(subscriptionPeriodEnd ? new Date(subscriptionPeriodEnd) : null);
  }

  if (updates.length === 0) return res.status(400).json({ error: 'No updates provided' });

  values.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE users
     SET ${updates.join(', ')}
     WHERE id = $${idx}
     RETURNING id, email, role, subscription_status, subscription_period_end, has_pdf_calendar_access, pdf_calendar_purchased_at, stripe_customer_id, stripe_last_session_id, created_at`,
    values,
  );
  if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
  res.json(rows[0]);
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own admin account' });
  }
  const { rowCount } = await pool.query(`DELETE FROM users WHERE id = $1`, [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});

app.get('/api/blog-posts', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT p.id, p.slug, p.title, p.excerpt, p.cover_image_url, p.content_html, p.published_at, p.created_at, p.updated_at,
            u.email AS author_email
     FROM blog_posts p
     LEFT JOIN users u ON u.id = p.author_id
     ORDER BY p.published_at DESC, p.created_at DESC`,
  );
  const posts = rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt || stripHtml(row.content_html).slice(0, 220),
    coverImageUrl: row.cover_image_url || '',
    contentHtml: row.content_html,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    authorEmail: row.author_email || 'Admin',
  }));
  res.json(posts);
});

app.get('/api/blog-posts/by-slug/:slug', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.id, p.slug, p.title, p.excerpt, p.cover_image_url, p.content_html, p.published_at, p.created_at, p.updated_at,
            u.email AS author_email
     FROM blog_posts p
     LEFT JOIN users u ON u.id = p.author_id
     WHERE p.slug = $1
     LIMIT 1`,
    [String(req.params.slug || '').trim().toLowerCase()],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Blog post not found' });
  const row = rows[0];
  return res.json({
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt || stripHtml(row.content_html).slice(0, 220),
    coverImageUrl: row.cover_image_url || '',
    contentHtml: row.content_html,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    authorEmail: row.author_email || 'Admin',
  });
});

app.post('/api/admin/blog-posts', requireAuth, requireAdmin, async (req, res) => {
  const { title, excerpt, coverImageUrl, contentHtml, slug } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title is required' });
  if (!contentHtml || !String(contentHtml).trim()) return res.status(400).json({ error: 'Post content is required' });
  const cleanContent = sanitizeBlogHtml(contentHtml);
  const cleanExcerpt = excerpt ? stripHtml(excerpt).slice(0, 400) : stripHtml(cleanContent).slice(0, 220);
  const slugToSave = await buildUniqueBlogSlug(slug || title);
  const { rows } = await pool.query(
    `INSERT INTO blog_posts (title, excerpt, cover_image_url, content_html, slug, author_id, published_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now(), now(), now())
     RETURNING id, slug, title, excerpt, cover_image_url, content_html, published_at, created_at, updated_at`,
    [String(title).trim(), cleanExcerpt, coverImageUrl ? String(coverImageUrl).trim() : null, cleanContent, slugToSave, req.user.id],
  );
  res.status(201).json(rows[0]);
});

app.put('/api/admin/blog-posts/:id', requireAuth, requireAdmin, async (req, res) => {
  const { title, excerpt, coverImageUrl, contentHtml, slug } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title is required' });
  if (!contentHtml || !String(contentHtml).trim()) return res.status(400).json({ error: 'Post content is required' });
  const cleanContent = sanitizeBlogHtml(contentHtml);
  const cleanExcerpt = excerpt ? stripHtml(excerpt).slice(0, 400) : stripHtml(cleanContent).slice(0, 220);
  const { rows: existingRows } = await pool.query(`SELECT id, slug FROM blog_posts WHERE id = $1 LIMIT 1`, [req.params.id]);
  if (existingRows.length === 0) return res.status(404).json({ error: 'Blog post not found' });
  const slugToSave = slug
    ? await buildUniqueBlogSlug(slug, req.params.id)
    : (existingRows[0].slug || await buildUniqueBlogSlug(title, req.params.id));
  const { rows } = await pool.query(
    `UPDATE blog_posts
     SET title = $1,
         excerpt = $2,
         cover_image_url = $3,
         content_html = $4,
         slug = $5,
         author_id = $6,
         updated_at = now()
     WHERE id = $7
     RETURNING id, slug, title, excerpt, cover_image_url, content_html, published_at, created_at, updated_at`,
    [String(title).trim(), cleanExcerpt, coverImageUrl ? String(coverImageUrl).trim() : null, cleanContent, slugToSave, req.user.id, req.params.id],
  );
  res.json(rows[0]);
});

app.delete('/api/admin/blog-posts/:id', requireAuth, requireAdmin, async (req, res) => {
  const { rowCount } = await pool.query(`DELETE FROM blog_posts WHERE id = $1`, [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Blog post not found' });
  res.json({ ok: true });
});

// Maintenance logs
app.get('/api/maintenance-logs', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, date, activity_type as "activityType", title, notes, completed
     FROM maintenance_logs
     WHERE user_id = $1
     ORDER BY date DESC, created_at DESC`,
    [req.user.id],
  );
  res.json(rows);
});

app.post('/api/maintenance-logs', requireAuth, async (req, res) => {
  const { date, activityType, title, notes, completed } = req.body || {};
  if (!date || !title) return res.status(400).json({ error: 'Date and title required' });
  const { rows } = await pool.query(
    `INSERT INTO maintenance_logs (user_id, date, activity_type, title, notes, completed)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, date, activity_type as "activityType", title, notes, completed`,
    [req.user.id, new Date(date), activityType || 'planned', title, notes || null, completed || false],
  );
  res.status(201).json(rows[0]);
});

app.put('/api/maintenance-logs/:id', requireAuth, async (req, res) => {
  const { date, activityType, title, notes, completed } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE maintenance_logs
     SET date = COALESCE($1, date),
         activity_type = COALESCE($2, activity_type),
         title = COALESCE($3, title),
         notes = $4,
         completed = COALESCE($5, completed),
         reminder_sent_at = CASE WHEN $1 IS NOT NULL THEN NULL ELSE reminder_sent_at END
     WHERE id = $6 AND user_id = $7
     RETURNING id, date, activity_type as "activityType", title, notes, completed`,
    [date ? new Date(date) : null, activityType, title, notes, completed, req.params.id, req.user.id],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Maintenance log not found' });
  res.json(rows[0]);
});

app.delete('/api/maintenance-logs/:id', requireAuth, async (req, res) => {
  await pool.query(`DELETE FROM maintenance_logs WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
  res.json({ ok: true });
});

app.post('/api/maintenance-reminders/test', requireAuth, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  const { rows } = await pool.query(
    `SELECT id, date, activity_type as "activityType", title, notes, completed
     FROM maintenance_logs
     WHERE user_id = $1
     ORDER BY date DESC NULLS LAST
     LIMIT 1`,
    [req.user.id],
  );
  let log = rows[0];
  if (!log) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    log = {
      id: 'sample',
      date: tomorrow,
      activityType: 'planned',
      title: 'Sample maintenance task',
      notes: 'This is a test reminder email.',
      completed: false,
    };
  }
  const payload = buildMaintenanceReminderEmail({ log, user: { email: req.user.email } });
  let sent = false;
  try {
    await sendMaintenanceReminderEmail({ to: req.user.email, ...payload });
    sent = true;
  } catch (err) {
    return res.status(500).json({ error: err.message, subject: payload.subject, body: payload.text });
  }
  return res.json({ sent, email: req.user.email, subject: payload.subject, body: payload.text });
});

const formatMaintenanceDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};

const buildMaintenanceReminderEmail = ({ log, user }) => {
  const dueLabel = formatMaintenanceDate(log.date);
  const subject = `Maintenance reminder: ${log.title} due ${dueLabel}`;
  const bodyLines = [
    `Hi ${user.email},`,
    '',
    'This is a reminder that your maintenance task is due tomorrow:',
    `• Task: ${log.title}`,
    `• Due date: ${dueLabel}`,
    `• Activity type: ${log.activityType || 'planned'}`,
    `• Completed: ${log.completed ? 'Yes' : 'No'}`,
  ];
  if (log.notes) {
    bodyLines.push(`• Notes: ${log.notes}`);
  }
  bodyLines.push('', 'You can edit or delete this task in Tidal Calendar before it is due.');
  return { subject, text: bodyLines.join('\n') };
};

const sendMaintenanceRemindersForTomorrow = async () => {
  if (!dbReady) return;
  const { rows } = await pool.query(
    `SELECT m.id, m.date, m.activity_type as "activityType", m.title, m.notes, m.completed, u.email
     FROM maintenance_logs m
     JOIN users u ON u.id = m.user_id
     WHERE m.date = current_date + interval '1 day'
       AND m.completed = false
       AND m.reminder_sent_at IS NULL
       AND u.maintenance_reminders_enabled = true`,
  );

  for (const log of rows) {
    const payload = buildMaintenanceReminderEmail({ log, user: { email: log.email } });
    try {
      const sent = await sendMaintenanceReminderEmail({ to: log.email, ...payload });
      if (sent) {
        await pool.query(`UPDATE maintenance_logs SET reminder_sent_at = now() WHERE id = $1`, [log.id]);
      }
    } catch (err) {
      console.error(`Failed to send maintenance reminder for log ${log.id}:`, err);
    }
  }
};

let maintenanceReminderTimer = null;
const scheduleMaintenanceReminderChecks = () => {
  if (maintenanceReminderTimer) return;
  const run = async () => {
    if (!dbReady) return;
    try {
      await sendMaintenanceRemindersForTomorrow();
    } catch (err) {
      console.error('Failed to run maintenance reminder checks:', err);
    }
  };
  run();
  maintenanceReminderTimer = setInterval(run, 60 * 60 * 1000);
};

const retrieveStripeSession = async (sessionId) => {
  console.info('Stripe session retrieval started', { sessionId });
  const params = new URLSearchParams();
  params.append('expand[]', 'subscription');
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}?${params.toString()}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('Stripe session retrieval failed', { sessionId, status: res.status, body: text });
    throw new Error(`Stripe responded with ${res.status}: ${text}`);
  }
  const payload = await res.json();
  console.info('Stripe session retrieval succeeded', {
    sessionId: payload?.id || sessionId,
    status: payload?.status || null,
    paymentStatus: payload?.payment_status || null,
    clientReferenceId: payload?.client_reference_id || null,
    customerId: payload?.customer || null,
    customerEmail: payload?.customer_details?.email || payload?.customer_email || null,
  });
  return payload;
};

const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const parseStripeIdList = (value) => new Set(
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);
const STRIPE_SUBSCRIPTION_PRICE_IDS = parseStripeIdList(process.env.STRIPE_SUBSCRIPTION_PRICE_IDS);
const STRIPE_PDF_CALENDAR_PRICE_IDS = parseStripeIdList(process.env.STRIPE_PDF_CALENDAR_PRICE_IDS);
const STRIPE_SUBSCRIPTION_PRODUCT_IDS = parseStripeIdList(process.env.STRIPE_SUBSCRIPTION_PRODUCT_IDS);
const STRIPE_PDF_CALENDAR_PRODUCT_IDS = parseStripeIdList(process.env.STRIPE_PDF_CALENDAR_PRODUCT_IDS);
const STRIPE_SUBSCRIPTION_LOOKUP_KEYS = parseStripeIdList(process.env.STRIPE_SUBSCRIPTION_LOOKUP_KEYS);
const STRIPE_PDF_CALENDAR_LOOKUP_KEYS = parseStripeIdList(process.env.STRIPE_PDF_CALENDAR_LOOKUP_KEYS);

const parseStripeTruthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

const retrieveStripeSessionLineItems = async (sessionId) => {
  const params = new URLSearchParams();
  params.append('expand[]', 'data.price');
  params.append('expand[]', 'data.price.product');
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}/line_items?${params.toString()}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Stripe line items responded with ${res.status}: ${text}`);
  }
  const payload = await res.json();
  return Array.isArray(payload?.data) ? payload.data : [];
};

const inferStripeCheckoutEntitlements = ({ session, lineItems }) => {
  const priceIds = lineItems.map((item) => item?.price?.id).filter(Boolean);
  const priceLookupKeys = lineItems.map((item) => item?.price?.lookup_key).filter(Boolean);
  const productIds = lineItems
    .map((item) => (typeof item?.price?.product === 'string' ? item.price.product : item?.price?.product?.id))
    .filter(Boolean);
  const sessionMetadata = session?.metadata || {};

  const matchesSubscriptionPriceId = priceIds.some((priceId) => STRIPE_SUBSCRIPTION_PRICE_IDS.has(priceId));
  const matchesPdfPriceId = priceIds.some((priceId) => STRIPE_PDF_CALENDAR_PRICE_IDS.has(priceId));
  const matchesSubscriptionLookupKey = priceLookupKeys.some((key) => STRIPE_SUBSCRIPTION_LOOKUP_KEYS.has(key));
  const matchesPdfLookupKey = priceLookupKeys.some((key) => STRIPE_PDF_CALENDAR_LOOKUP_KEYS.has(key));
  const matchesSubscriptionProductId = productIds.some((productId) => STRIPE_SUBSCRIPTION_PRODUCT_IDS.has(productId));
  const matchesPdfProductId = productIds.some((productId) => STRIPE_PDF_CALENDAR_PRODUCT_IDS.has(productId));

  const metadataGrantsSubscription = parseStripeTruthy(
    sessionMetadata.grants_subscription
    || sessionMetadata.subscription_entitlement
    || sessionMetadata.includes_subscription,
  );
  const metadataGrantsPdf = parseStripeTruthy(
    sessionMetadata.grants_pdf_calendar
    || sessionMetadata.pdf_calendar_entitlement
    || sessionMetadata.includes_pdf_calendar,
  );

  return {
    grantsSubscription: metadataGrantsSubscription
      || matchesSubscriptionPriceId
      || matchesSubscriptionLookupKey
      || matchesSubscriptionProductId,
    grantsPdfCalendar: metadataGrantsPdf
      || matchesPdfPriceId
      || matchesPdfLookupKey
      || matchesPdfProductId,
  };
};

const resolveStripeUserId = async ({ userId = null, customerId = null, email = null, sessionId = null }) => {
  if (userId) {
    const { rows } = await pool.query(`SELECT id FROM users WHERE id = $1 LIMIT 1`, [userId]);
    if (rows[0]?.id) return rows[0].id;
  }

  const lookups = [
    customerId
      ? {
        sql: `SELECT id FROM users WHERE stripe_customer_id = $1 LIMIT 1`,
        value: customerId,
      }
      : null,
    email
      ? {
        sql: `SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1`,
        value: normalizeEmail(email),
      }
      : null,
    sessionId
      ? {
        sql: `SELECT id FROM users WHERE stripe_last_session_id = $1 LIMIT 1`,
        value: sessionId,
      }
      : null,
  ].filter(Boolean);

  for (const lookup of lookups) {
    const { rows } = await pool.query(lookup.sql, [lookup.value]);
    if (rows[0]?.id) return rows[0].id;
  }

  return null;
};

const applyStripePurchasesForUser = async ({
  userId = null,
  customerId = null,
  email = null,
  periodEndIso = null,
  sessionId = null,
  grantsSubscription = false,
  grantsPdfCalendar = false,
}) => {
  if (!grantsSubscription && !grantsPdfCalendar) return null;
  if (grantsSubscription && !periodEndIso) return null;
  const resolvedUserId = await resolveStripeUserId({ userId, customerId, email, sessionId });
  if (!resolvedUserId) {
    console.warn('Stripe purchase application did not match any users', {
      userId: userId || null,
      customerId: customerId || null,
      email: email || null,
      sessionId: sessionId || null,
      grantsSubscription,
      grantsPdfCalendar,
    });
    return null;
  }
  const { rows } = await pool.query(
    `UPDATE users
     SET role = CASE WHEN $1::boolean THEN 'subscriber' ELSE role END,
         subscription_status = CASE WHEN $1::boolean THEN 'active' ELSE subscription_status END,
         subscription_period_end = CASE
           WHEN $1::boolean THEN GREATEST(COALESCE(subscription_period_end, to_timestamp(0)), $2::timestamptz)
           ELSE subscription_period_end
         END,
         has_pdf_calendar_access = CASE WHEN $3::boolean THEN true ELSE has_pdf_calendar_access END,
         pdf_calendar_purchased_at = CASE
           WHEN $3::boolean THEN COALESCE(pdf_calendar_purchased_at, now())
           ELSE pdf_calendar_purchased_at
         END,
         stripe_customer_id = COALESCE(stripe_customer_id, $6),
         stripe_last_session_id = COALESCE($4, stripe_last_session_id)
     WHERE id = $5
     RETURNING id`,
    [grantsSubscription, periodEndIso, grantsPdfCalendar, sessionId, resolvedUserId, customerId],
  );
  if (!rows.length) {
    console.warn('Stripe purchase update matched user id but did not update a row', {
      resolvedUserId,
      customerId: customerId || null,
      email: email || null,
      sessionId: sessionId || null,
    });
  }
  if (rows.length) {
    console.info('Stripe purchase update succeeded', {
      resolvedUserId,
      customerId: customerId || null,
      sessionId: sessionId || null,
      grantsSubscription,
      grantsPdfCalendar,
    });
  }
  return rows[0] || null;
};

const deactivateSubscriptionByCustomerId = async (customerId) => {
  if (!customerId) return;
  await pool.query(
    `UPDATE users
     SET subscription_status = 'inactive'
     WHERE stripe_customer_id = $1`,
    [customerId],
  );
};

const parseStripeTimestampMs = (value, fallbackMs = null) => {
  if (!value) return fallbackMs;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallbackMs;
  return seconds * 1000;
};

const verifyStripeWebhookSignature = (req) => {
  if (!STRIPE_WEBHOOK_SECRET) return true;
  const signatureHeader = req.get('stripe-signature') || '';
  const rawBodyBuffer = Buffer.isBuffer(req.body) ? req.body : req.rawBody;
  const body = rawBodyBuffer?.toString('utf8') || '';
  if (!signatureHeader || !body) return false;
  const parts = signatureHeader.split(',').reduce((acc, part) => {
    const [key, value] = part.split('=');
    if (!key || !value) return acc;
    const normalizedKey = key.trim();
    const normalizedValue = value.trim();
    if (normalizedKey === 'v1') {
      if (!acc.v1) acc.v1 = [];
      acc.v1.push(normalizedValue);
    } else {
      acc[normalizedKey] = normalizedValue;
    }
    return acc;
  }, {});
  if (!parts.t || !Array.isArray(parts.v1) || parts.v1.length === 0) return false;
  const signedPayload = `${parts.t}.${body}`;
  const expected = createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(signedPayload, 'utf8').digest('hex');
  return parts.v1.some((signature) => {
    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch (_err) {
      return false;
    }
  });
};

app.post('/api/payments/stripe/confirm', requireAuth, async (req, res) => {
  if (!STRIPE_SECRET_KEY) return res.status(501).json({ error: 'Stripe not configured' });
  const { sessionId } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  console.info('Stripe confirm started', { sessionId, userId: req.user.id, email: req.user.email });
  try {
    const session = await retrieveStripeSession(sessionId);
    const lineItems = await retrieveStripeSessionLineItems(sessionId);
    const entitlements = inferStripeCheckoutEntitlements({ session, lineItems });
    const isPaid = session.payment_status === 'paid' || session.status === 'complete';
    if (!isPaid) {
      console.warn('Stripe confirm rejected: payment not completed', {
        sessionId,
        userId: req.user.id,
        status: session.status || null,
        paymentStatus: session.payment_status || null,
      });
      return res.status(402).json({ error: 'Payment not completed' });
    }
    if (session.client_reference_id && String(session.client_reference_id) !== String(req.user.id)) {
      console.warn('Stripe confirm rejected: client reference mismatch', {
        sessionId,
        userId: req.user.id,
        clientReferenceId: session.client_reference_id,
      });
      return res.status(409).json({ error: 'Session does not match user' });
    }
    if (session.customer_details?.email && session.customer_details.email.toLowerCase() !== req.user.email.toLowerCase()) {
      console.warn('Stripe confirm rejected: email mismatch', {
        sessionId,
        userId: req.user.id,
        sessionEmail: session.customer_details.email,
        userEmail: req.user.email,
      });
      return res.status(409).json({ error: 'Session email does not match user' });
    }

    if (!entitlements.grantsSubscription && !entitlements.grantsPdfCalendar) {
      return res.status(409).json({ error: 'Stripe session did not include a supported product' });
    }
    const periodEndMs = entitlements.grantsSubscription
      ? (session.subscription?.current_period_end
        ? session.subscription.current_period_end * 1000
        : Date.now() + 365 * 24 * 60 * 60 * 1000)
      : null;
    const periodEndIso = periodEndMs ? new Date(periodEndMs).toISOString() : null;
    if (session.customer) {
      const { rows: existingRows } = await pool.query(
        `SELECT stripe_customer_id FROM users WHERE id = $1 LIMIT 1`,
        [req.user.id],
      );
      const existingCustomerId = existingRows[0]?.stripe_customer_id || null;
      if (existingCustomerId && existingCustomerId !== session.customer) {
        console.warn('Stripe confirm rejected: customer id mismatch', {
          sessionId,
          userId: req.user.id,
          existingCustomerId,
          incomingCustomerId: session.customer,
        });
        return res.status(409).json({ error: 'Stripe customer mismatch for this account' });
      }
    }
    const { rows } = await pool.query(
      `UPDATE users
       SET role = CASE WHEN $1::boolean THEN 'subscriber' ELSE role END,
           subscription_status = CASE WHEN $1::boolean THEN 'active' ELSE subscription_status END,
           subscription_period_end = CASE
             WHEN $1::boolean THEN GREATEST(COALESCE(subscription_period_end, to_timestamp(0)), $2::timestamptz)
             ELSE subscription_period_end
           END,
           has_pdf_calendar_access = CASE WHEN $3::boolean THEN true ELSE has_pdf_calendar_access END,
           pdf_calendar_purchased_at = CASE
             WHEN $3::boolean THEN COALESCE(pdf_calendar_purchased_at, now())
             ELSE pdf_calendar_purchased_at
           END,
           stripe_customer_id = COALESCE(stripe_customer_id, $6),
           stripe_last_session_id = $4
           WHERE id = $5
       RETURNING id, email, role, subscription_status, subscription_period_end, has_pdf_calendar_access, pdf_calendar_purchased_at, stripe_customer_id, stripe_last_session_id, maintenance_reminders_enabled, home_port_id, home_port_name, home_club_id, home_club_name`,
      [
        entitlements.grantsSubscription,
        periodEndIso,
        entitlements.grantsPdfCalendar,
        session.id,
        req.user.id,
        session.customer || null,
      ],
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Could not update subscription for this account' });
    }
    console.info('Stripe confirm user update succeeded', {
      sessionId,
      userId: rows[0].id,
      email: rows[0].email,
      subscriptionStatus: rows[0].subscription_status,
      subscriptionPeriodEnd: rows[0].subscription_period_end,
      stripeCustomerId: rows[0].stripe_customer_id || null,
      stripeLastSessionId: rows[0].stripe_last_session_id || null,
    });
    res.status(200).json({ ok: true, user: rows[0] });
  } catch (err) {
    console.error('Stripe confirmation failed', err);
    res.status(502).json({ error: 'Stripe confirmation failed' });
  }
});

app.post('/api/payments/stripe/webhook', async (req, res) => {
  const rawPayload = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  let event = req.body || {};
  if (Buffer.isBuffer(req.body)) {
    try {
      event = rawPayload ? JSON.parse(rawPayload) : {};
    } catch (_err) {
      return res.status(400).json({ error: 'Invalid Stripe event payload' });
    }
  }
  console.info('Stripe webhook received', {
    eventId: event.id || null,
    eventType: event.type || null,
  });
  if (!verifyStripeWebhookSignature(req)) {
    console.info('Stripe webhook signature verification failed', {
      eventId: event.id || null,
      eventType: event.type || null,
      hasSignatureHeader: Boolean(req.get('stripe-signature')),
    });
    return res.status(400).json({ error: 'Invalid Stripe signature' });
  }
  if (!event?.type) {
    console.info('Stripe webhook rejected: invalid payload (missing event type)', {
      eventId: event.id || null,
    });
    return res.status(400).json({ error: 'Invalid Stripe event payload' });
  }
  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const webhookSession = event.data?.object || {};
        const session = webhookSession.id ? await retrieveStripeSession(webhookSession.id) : webhookSession;
        const lineItems = session.id ? await retrieveStripeSessionLineItems(session.id) : [];
        const entitlements = inferStripeCheckoutEntitlements({ session, lineItems });
        const isPaid = session.payment_status === 'paid' || session.status === 'complete';
        if (!isPaid) break;
        const periodEndMs = entitlements.grantsSubscription
          ? parseStripeTimestampMs(
            session.subscription?.current_period_end || session.subscription_details?.current_period_end,
            Date.now() + 365 * 24 * 60 * 60 * 1000,
          )
          : null;
        const activated = await applyStripePurchasesForUser({
          userId: session.client_reference_id || session.metadata?.user_id || null,
          customerId: session.customer || null,
          email: session.customer_details?.email || session.customer_email || null,
          periodEndIso: periodEndMs ? new Date(periodEndMs).toISOString() : null,
          sessionId: session.id || null,
          grantsSubscription: entitlements.grantsSubscription,
          grantsPdfCalendar: entitlements.grantsPdfCalendar,
        });
        if (!activated) {
          console.warn('Stripe checkout webhook did not update a user', {
            eventType: event.type,
            sessionId: session.id || null,
            userId: session.client_reference_id || session.metadata?.user_id || null,
            customerId: session.customer || null,
            email: session.customer_details?.email || session.customer_email || null,
          });
        }
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data?.object || {};
        const periodEndMs = parseStripeTimestampMs(
          invoice.lines?.data?.[0]?.period?.end,
          Date.now() + 365 * 24 * 60 * 60 * 1000,
        );
        const activated = await applyStripePurchasesForUser({
          customerId: invoice.customer || null,
          email: invoice.customer_email || invoice.customer_details?.email || null,
          periodEndIso: new Date(periodEndMs).toISOString(),
          sessionId: null,
          grantsSubscription: true,
          grantsPdfCalendar: false,
        });
        if (!activated) {
          console.warn('Stripe invoice webhook did not activate a user', {
            eventType: event.type,
            customerId: invoice.customer || null,
            email: invoice.customer_email || invoice.customer_details?.email || null,
          });
        }
        break;
      }
      case 'customer.subscription.updated': {
        const subscription = event.data?.object || {};
        const periodEndMs = parseStripeTimestampMs(subscription.current_period_end);
        if (!periodEndMs) break;
        const activated = await applyStripePurchasesForUser({
          customerId: subscription.customer || null,
          periodEndIso: new Date(periodEndMs).toISOString(),
          sessionId: null,
          grantsSubscription: true,
          grantsPdfCalendar: false,
        });
        if (!activated) {
          console.warn('Stripe subscription update webhook did not activate a user', {
            eventType: event.type,
            customerId: subscription.customer || null,
          });
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data?.object || {};
        await deactivateSubscriptionByCustomerId(subscription.customer || null);
        break;
      }
      default:
        break;
    }
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Stripe webhook handling failed', err);
    res.status(500).json({ error: 'Stripe webhook handling failed' });
  }
});

const resolveManagedClub = async (userId) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.capacity
     FROM users u
     LEFT JOIN clubs c ON c.id = u.home_club_id
     WHERE u.id = $1`,
    [userId],
  );
  return rows[0] || null;
};

const fetchClubIntegrations = async (clubId) => {
  const { rows } = await pool.query(
    `SELECT id, provider, external_calendar_id, metadata, last_synced_at, created_at, updated_at
     FROM club_calendar_integrations
     WHERE club_id = $1
     ORDER BY created_at ASC`,
    [clubId],
  );
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    externalCalendarId: row.external_calendar_id,
    metadata: row.metadata || {},
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
};

const getIntegrationAuthToken = async (integrationId) => {
  const { rows } = await pool.query(
    `SELECT id, provider, access_token, refresh_token, token_expires_at
     FROM club_calendar_integrations
     WHERE id = $1
     LIMIT 1`,
    [integrationId],
  );
  return rows[0] || null;
};

const refreshIntegrationAccessTokenIfNeeded = async (integration) => {
  if (!integration) return null;
  const providerCfg = getOAuthProviderConfig(integration.provider);
  if (!providerCfg) return integration.access_token;
  const expiresSoon = integration.token_expires_at
    ? (new Date(integration.token_expires_at).getTime() - Date.now()) < (60 * 1000)
    : false;
  if (!expiresSoon) return integration.access_token;
  if (!integration.refresh_token) return integration.access_token;

  const form = new URLSearchParams();
  form.set('client_id', providerCfg.clientId);
  form.set('client_secret', providerCfg.clientSecret);
  form.set('refresh_token', integration.refresh_token);
  form.set('grant_type', 'refresh_token');
  const response = await fetch(providerCfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const data = await parseJsonResponse(response, `${integration.provider} refresh token`);
  if (!response.ok || !data?.access_token) {
    throw new Error(`Unable to refresh ${integration.provider} calendar token`);
  }
  const expiresAt = data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString() : null;
  await pool.query(
    `UPDATE club_calendar_integrations
     SET access_token = $1,
         refresh_token = COALESCE($2, refresh_token),
         token_expires_at = COALESCE($3::timestamptz, token_expires_at),
         updated_at = now()
     WHERE id = $4`,
    [data.access_token, data.refresh_token || null, expiresAt, integration.id],
  );
  return data.access_token;
};

const getScrubWindowsForClub = async (clubId, options = {}) => {
  const { viewerUserId = null, includeBookingDetails = false } = options;
  const { rows } = await pool.query(
    `SELECT w.id, w.date_label as date, w.low_water as "lowWater", w.duration, w.capacity,
            w.starts_at as "startsAt", w.ends_at as "endsAt", w.notes,
            w.facility_id as "facilityId", cf.name as "facilityName",
            (SELECT COUNT(*) FROM bookings b WHERE b.window_id = w.id)::int AS booked,
            (
              SELECT json_build_object(
                'bookingId', b.id,
                'boatName', b.boat_name,
                'bookedAt', b.created_at
              )
              FROM bookings b
              WHERE b.window_id = w.id AND b.user_id = $2
              ORDER BY b.created_at DESC
              LIMIT 1
            ) AS "myBooking",
            CASE
              WHEN $3::boolean THEN (
                SELECT COALESCE(
                  json_agg(
                    json_build_object(
                      'bookingId', b.id,
                      'userId', u.id,
                      'email', u.email,
                      'boatName', b.boat_name,
                      'bookedAt', b.created_at
                    )
                    ORDER BY b.created_at ASC
                  ),
                  '[]'::json
                )
                FROM bookings b
                JOIN users u ON u.id = b.user_id
                WHERE b.window_id = w.id
              )
              ELSE '[]'::json
            END AS "bookingDetails"
     FROM scrub_windows w
     LEFT JOIN club_facilities cf ON cf.id = w.facility_id
     WHERE w.club_id = $1
     ORDER BY COALESCE(w.starts_at, w.created_at) ASC`,
    [clubId, viewerUserId, includeBookingDetails],
  );
  return rows.map(formatClubWindow);
};

const buildWindowExternalEventPayload = (window, clubName) => {
  if (!window.startsAt || !window.endsAt) return null;
  return {
    summary: `${clubName} - ${window.facilityName || 'Scrub facility'} scrub window`,
    body: {
      summary: `${clubName} - ${window.facilityName || 'Scrub facility'} scrub window`,
      description: `Scrubbing slot\nBooked: ${window.booked}/${window.capacity}\nLow water: ${window.lowWater}\nDuration: ${window.duration}${window.notes ? `\nNotes: ${window.notes}` : ''}`,
      start: { dateTime: window.startsAt },
      end: { dateTime: window.endsAt },
    },
    outlook: {
      subject: `${clubName} - ${window.facilityName || 'Scrub facility'} scrub window`,
      body: {
        contentType: 'text',
        content: `Facility: ${window.facilityName || 'Unassigned'}\nScrubbing slot\nBooked: ${window.booked}/${window.capacity}\nLow water: ${window.lowWater}\nDuration: ${window.duration}${window.notes ? `\nNotes: ${window.notes}` : ''}`,
      },
      start: { dateTime: new Date(window.startsAt).toISOString(), timeZone: 'UTC' },
      end: { dateTime: new Date(window.endsAt).toISOString(), timeZone: 'UTC' },
    },
  };
};

const upsertExternalEventLink = async ({ integrationId, windowId, externalEventId, externalEtag = null }) => {
  await pool.query(
    `INSERT INTO club_calendar_event_links (integration_id, scrub_window_id, external_event_id, external_etag, last_pushed_at, updated_at)
     VALUES ($1, $2, $3, $4, now(), now())
     ON CONFLICT (integration_id, scrub_window_id)
     DO UPDATE SET external_event_id = EXCLUDED.external_event_id,
                   external_etag = EXCLUDED.external_etag,
                   last_pushed_at = now(),
                   updated_at = now()`,
    [integrationId, windowId, externalEventId, externalEtag],
  );
};

const syncIntegrationPush = async ({ integration, club, windows }) => {
  const authRow = await getIntegrationAuthToken(integration.id);
  const accessToken = await refreshIntegrationAccessTokenIfNeeded(authRow);
  const createdOrUpdated = [];
  for (const window of windows) {
    const payload = buildWindowExternalEventPayload(window, club.name);
    if (!payload) continue;
    const { rows: linkRows } = await pool.query(
      `SELECT external_event_id FROM club_calendar_event_links WHERE integration_id = $1 AND scrub_window_id = $2 LIMIT 1`,
      [integration.id, window.id],
    );
    if (integration.provider === 'gmail') {
      const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(integration.externalCalendarId)}/events`;
      const existingEventId = linkRows[0]?.external_event_id || null;
      const method = existingEventId ? 'PUT' : 'POST';
      const target = existingEventId ? `${base}/${encodeURIComponent(existingEventId)}` : base;
      const response = await fetch(target, {
        method,
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload.body),
      });
      const data = await parseJsonResponse(response, 'Google Calendar events');
      if (!response.ok || !data?.id) throw new Error(data?.error?.message || 'Google event sync failed');
      await upsertExternalEventLink({ integrationId: integration.id, windowId: window.id, externalEventId: data.id, externalEtag: data.etag || null });
      createdOrUpdated.push(data.id);
    } else if (integration.provider === 'outlook') {
      const existingEventId = linkRows[0]?.external_event_id || null;
      const base = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(integration.externalCalendarId)}/events`;
      const method = existingEventId ? 'PATCH' : 'POST';
      const target = existingEventId ? `${base}/${encodeURIComponent(existingEventId)}` : base;
      const response = await fetch(target, {
        method,
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload.outlook),
      });
      const data = response.status === 204 ? { id: existingEventId } : await parseJsonResponse(response, 'Microsoft Calendar events');
      if (!response.ok) throw new Error(data?.error?.message || 'Outlook event sync failed');
      const externalId = data?.id || existingEventId;
      if (externalId) {
        await upsertExternalEventLink({ integrationId: integration.id, windowId: window.id, externalEventId: externalId, externalEtag: data?.['@odata.etag'] || null });
        createdOrUpdated.push(externalId);
      }
    }
  }
  return createdOrUpdated;
};

const syncIntegrationPull = async ({ integration, clubId }) => {
  const authRow = await getIntegrationAuthToken(integration.id);
  const accessToken = await refreshIntegrationAccessTokenIfNeeded(authRow);
  const imported = [];
  if (integration.provider === 'gmail') {
    const from = new Date();
    const to = new Date(Date.now() + 1000 * 60 * 60 * 24 * 180);
    const listUrl = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(integration.externalCalendarId)}/events`);
    listUrl.searchParams.set('singleEvents', 'true');
    listUrl.searchParams.set('timeMin', from.toISOString());
    listUrl.searchParams.set('timeMax', to.toISOString());
    listUrl.searchParams.set('maxResults', '200');
    const response = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await parseJsonResponse(response, 'Google calendar list events');
    if (!response.ok) throw new Error(data?.error?.message || 'Google calendar pull failed');
    for (const event of data.items || []) {
      const startsAt = event?.start?.dateTime;
      const endsAt = event?.end?.dateTime;
      if (!startsAt || !endsAt) continue;
      const { rows: found } = await pool.query(
        `SELECT scrub_window_id FROM club_calendar_event_links WHERE integration_id = $1 AND external_event_id = $2 LIMIT 1`,
        [integration.id, event.id],
      );
      if (found[0]?.scrub_window_id) continue;
      const dateObj = new Date(startsAt);
      const dateLabel = dateObj.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
      const lowWater = dateObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
      const durationMin = Math.max(15, Math.round((new Date(endsAt).getTime() - dateObj.getTime()) / (60 * 1000)));
      const duration = `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`;
      const { rows: inserted } = await pool.query(
        `INSERT INTO scrub_windows (club_id, date_label, low_water, duration, starts_at, ends_at, notes, capacity)
         VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8)
         RETURNING id`,
        [clubId, dateLabel, lowWater, duration, startsAt, endsAt, event.summary || '', 1],
      );
      await upsertExternalEventLink({ integrationId: integration.id, windowId: inserted[0].id, externalEventId: event.id, externalEtag: event.etag || null });
      imported.push(event.id);
    }
  } else if (integration.provider === 'outlook') {
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 1000 * 60 * 60 * 24 * 180).toISOString();
    const listUrl = new URL(`https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(integration.externalCalendarId)}/calendarView`);
    listUrl.searchParams.set('startDateTime', from);
    listUrl.searchParams.set('endDateTime', to);
    listUrl.searchParams.set('$top', '200');
    const response = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await parseJsonResponse(response, 'Microsoft calendar list events');
    if (!response.ok) throw new Error(data?.error?.message || 'Outlook calendar pull failed');
    for (const event of data.value || []) {
      const startsAt = event?.start?.dateTime;
      const endsAt = event?.end?.dateTime;
      if (!startsAt || !endsAt) continue;
      const { rows: found } = await pool.query(
        `SELECT scrub_window_id FROM club_calendar_event_links WHERE integration_id = $1 AND external_event_id = $2 LIMIT 1`,
        [integration.id, event.id],
      );
      if (found[0]?.scrub_window_id) continue;
      const dateObj = new Date(startsAt);
      const dateLabel = dateObj.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
      const lowWater = dateObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
      const durationMin = Math.max(15, Math.round((new Date(endsAt).getTime() - dateObj.getTime()) / (60 * 1000)));
      const duration = `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`;
      const { rows: inserted } = await pool.query(
        `INSERT INTO scrub_windows (club_id, date_label, low_water, duration, starts_at, ends_at, notes, capacity)
         VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8)
         RETURNING id`,
        [clubId, dateLabel, lowWater, duration, startsAt, endsAt, event.subject || '', 1],
      );
      await upsertExternalEventLink({ integrationId: integration.id, windowId: inserted[0].id, externalEventId: event.id, externalEtag: event?.['@odata.etag'] || null });
      imported.push(event.id);
    }
  }
  await pool.query(
    `UPDATE club_calendar_integrations
     SET last_synced_at = now(),
         updated_at = now()
     WHERE id = $1`,
    [integration.id],
  );
  return imported;
};

const syncWindowToExternalCalendars = async ({ club, windowId }) => {
  if (!club?.id || !windowId) return;
  try {
    const [integrations, windows] = await Promise.all([
      fetchClubIntegrations(club.id),
      getScrubWindowsForClub(club.id),
    ]);
    const targetWindow = windows.find((window) => window.id === windowId);
    if (!targetWindow || integrations.length === 0) return;
    for (const integration of integrations) {
      try {
        await syncIntegrationPush({ integration, club, windows: [targetWindow] });
      } catch (err) {
        console.warn(
          `Calendar sync push failed (non-fatal) for club ${club.id}, window ${windowId}, integration ${integration.id}: ${err?.message || err}`,
        );
      }
    }
  } catch (err) {
    console.warn(
      `Calendar sync preparation failed (non-fatal) for club ${club?.id || 'unknown'}, window ${windowId}: ${err?.message || err}`,
    );
  }
};


const getClubFacilities = async (clubId) => {
  const { rows } = await pool.query(
    `SELECT id, name, created_at as "createdAt"
     FROM club_facilities
     WHERE club_id = $1
     ORDER BY name ASC`,
    [clubId],
  );
  return rows;
};

app.post('/api/club-admin/facilities', requireAuth, requireClubAdmin, async (req, res) => {
  const club = await resolveManagedClub(req.user.id);
  if (!club?.id) return res.status(400).json({ error: 'Set up your club first' });
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Facility name is required' });

  const { rows } = await pool.query(
    `INSERT INTO club_facilities (club_id, name, created_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (club_id, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, name, created_at as "createdAt"`,
    [club.id, name, req.user.id],
  );
  return res.status(201).json(rows[0]);
});

app.get('/api/club-admin/overview', requireAuth, requireClubAdmin, async (req, res) => {
  const club = await resolveManagedClub(req.user.id);
  if (!club?.id) {
    return res.json({ club: null, members: [], windows: [], availableUsers: [], integrations: [], facilities: [] });
  }

  const [membersResult, windows, availableResult, integrations, facilities] = await Promise.all([
    pool.query(
      `SELECT u.id, u.email, u.role, u.home_port_name, u.home_club_name
       FROM users u
       WHERE u.home_club_id = $1
       ORDER BY u.email ASC`,
      [club.id],
    ),
    getScrubWindowsForClub(club.id),
    pool.query(
      `SELECT id, email FROM users
       WHERE (home_club_id IS NULL OR home_club_id <> $1)
       ORDER BY email ASC
       LIMIT 200`,
      [club.id],
    ),
    fetchClubIntegrations(club.id),
    getClubFacilities(club.id),
  ]);

  return res.json({
    club,
    members: membersResult.rows,
    windows,
    availableUsers: availableResult.rows,
    integrations,
    facilities,
  });
});

app.get('/api/club-admin/calendar/oauth/start', requireAuth, requireClubAdmin, async (req, res) => {
  const provider = String(req.query.provider || '').trim();
  const cfg = getOAuthProviderConfig(provider);
  if (!cfg) return res.status(400).json({ error: 'Unsupported provider' });
  if (!cfg.clientId || !cfg.clientSecret || !cfg.redirectUri) {
    return res.status(400).json({ error: `${provider} calendar integration is not configured on the server` });
  }
  const club = await resolveManagedClub(req.user.id);
  if (!club?.id) return res.status(400).json({ error: 'Set up your club first' });
  const state = createOAuthState({ userId: req.user.id, clubId: club.id, provider });
  const url = new URL(cfg.authUrl);
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', cfg.scope);
  url.searchParams.set('state', state);
  if (provider === 'gmail') {
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
  }
  return res.json({ authorizationUrl: url.toString() });
});

app.post('/api/club-admin/calendar/oauth/callback', requireAuth, requireClubAdmin, async (req, res) => {
  const { code, state } = req.body || {};
  if (!code || !state) return res.status(400).json({ error: 'code and state are required' });
  const decodedState = verifyOAuthState(state);
  if (!decodedState || decodedState.userId !== req.user.id) return res.status(400).json({ error: 'Invalid OAuth state' });
  const cfg = getOAuthProviderConfig(decodedState.provider);
  if (!cfg) return res.status(400).json({ error: 'Unsupported provider' });
  const club = await resolveManagedClub(req.user.id);
  if (!club?.id || club.id !== decodedState.clubId) return res.status(400).json({ error: 'Club context mismatch' });

  const form = new URLSearchParams();
  form.set('client_id', cfg.clientId);
  form.set('client_secret', cfg.clientSecret);
  form.set('redirect_uri', cfg.redirectUri);
  form.set('code', code);
  form.set('grant_type', 'authorization_code');
  const tokenResponse = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const tokenData = await parseJsonResponse(tokenResponse, `${cfg.provider} token exchange`);
  if (!tokenResponse.ok || !tokenData?.access_token) {
    return res.status(400).json({ error: tokenData?.error_description || tokenData?.error || 'OAuth token exchange failed' });
  }

  let calendarId = 'primary';
  let metadata = {};
  if (cfg.provider === 'gmail') {
    const me = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList/primary', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const meData = await parseJsonResponse(me, 'Google calendar primary');
    if (!me.ok) return res.status(400).json({ error: meData?.error?.message || 'Unable to resolve Google calendar' });
    calendarId = meData.id || 'primary';
    metadata = { summary: meData.summary || 'Primary calendar', timeZone: meData.timeZone || 'UTC' };
  } else if (cfg.provider === 'outlook') {
    const me = await fetch('https://graph.microsoft.com/v1.0/me/calendar', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const meData = await parseJsonResponse(me, 'Outlook calendar primary');
    if (!me.ok) return res.status(400).json({ error: meData?.error?.message || 'Unable to resolve Outlook calendar' });
    calendarId = meData.id;
    metadata = { summary: meData.name || 'Calendar', owner: meData.owner?.address || '' };
  }

  const expiresAt = tokenData.expires_in ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString() : null;
  await pool.query(
    `INSERT INTO club_calendar_integrations (club_id, provider, external_calendar_id, access_token, refresh_token, token_expires_at, metadata, created_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::jsonb, $8, now())
     ON CONFLICT (club_id, provider, external_calendar_id)
     DO UPDATE SET access_token = EXCLUDED.access_token,
                   refresh_token = COALESCE(EXCLUDED.refresh_token, club_calendar_integrations.refresh_token),
                   token_expires_at = EXCLUDED.token_expires_at,
                   metadata = EXCLUDED.metadata,
                   updated_at = now()`,
    [club.id, cfg.provider, calendarId, tokenData.access_token, tokenData.refresh_token || null, expiresAt, JSON.stringify(metadata), req.user.id],
  );
  return res.json({ ok: true, provider: cfg.provider, calendarId, metadata });
});

app.post('/api/club-admin/calendar/sync', requireAuth, requireClubAdmin, async (req, res) => {
  const club = await resolveManagedClub(req.user.id);
  if (!club?.id) return res.status(400).json({ error: 'Set up your club first' });
  const { integrationId } = req.body || {};
  const params = [club.id];
  let filterSql = '';
  if (integrationId) {
    params.push(integrationId);
    filterSql = ` AND id = $${params.length}`;
  }
  const { rows: integrations } = await pool.query(
    `SELECT id, provider, external_calendar_id as "externalCalendarId"
     FROM club_calendar_integrations
     WHERE club_id = $1 ${filterSql}`,
    params,
  );
  const windows = await getScrubWindowsForClub(club.id);
  const summary = [];
  for (const integration of integrations) {
    const pushedIds = await syncIntegrationPush({ integration, club, windows });
    const pulledIds = await syncIntegrationPull({ integration, clubId: club.id });
    summary.push({ integrationId: integration.id, provider: integration.provider, pushed: pushedIds.length, pulled: pulledIds.length });
  }
  return res.json({ synced: summary });
});

app.delete('/api/club-admin/calendar/integrations/:id', requireAuth, requireClubAdmin, async (req, res) => {
  const club = await resolveManagedClub(req.user.id);
  if (!club?.id) return res.status(400).json({ error: 'Set up your club first' });
  await pool.query(`DELETE FROM club_calendar_integrations WHERE id = $1 AND club_id = $2`, [req.params.id, club.id]);
  return res.status(204).send();
});

app.put('/api/club-admin/club', requireAuth, requireClubAdmin, async (req, res) => {
  const { clubName, scrubPostCount, homePortId, homePortName } = req.body || {};
  const cleanedName = String(clubName || '').trim();
  if (!cleanedName) return res.status(400).json({ error: 'Club name is required' });

  let clubId = req.user.home_club_id;
  const postCount = Math.max(Number(scrubPostCount) || 1, 1);
  if (clubId) {
    const { rows: updated } = await pool.query(
      `UPDATE clubs
       SET name = $1, capacity = $2
       WHERE id = $3
       RETURNING id, name, capacity`,
      [cleanedName, postCount, clubId],
    );
    if (updated.length === 0) {
      clubId = null;
    }
  }

  if (!clubId) {
    const { rows: created } = await pool.query(
      `INSERT INTO clubs (name, capacity, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, name, capacity`,
      [cleanedName, postCount, req.user.id],
    );
    clubId = created[0].id;
  }

  const { rows: profileRows } = await pool.query(
    `UPDATE users
     SET home_port_id = COALESCE($1, home_port_id),
         home_port_name = COALESCE($2, home_port_name),
         home_club_id = $3,
         home_club_name = $4
     WHERE id = $5
     RETURNING id, email, role, subscription_status, subscription_period_end, has_pdf_calendar_access, pdf_calendar_purchased_at, stripe_customer_id, stripe_last_session_id, maintenance_reminders_enabled, home_port_id, home_port_name, home_club_id, home_club_name`,
    [homePortId ?? null, homePortName ?? null, clubId, cleanedName, req.user.id],
  );

  await pool.query(
    `INSERT INTO club_memberships (club_id, user_id, added_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (club_id, user_id) DO NOTHING`,
    [clubId, req.user.id, req.user.id],
  );

  return res.json({ user: profileRows[0], club: { id: clubId, name: cleanedName, capacity: postCount } });
});

app.post('/api/club-admin/members', requireAuth, requireClubAdmin, async (req, res) => {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  const club = await resolveManagedClub(req.user.id);
  if (!club?.id) return res.status(400).json({ error: 'Set up your club first' });

  const { rows: targetRows } = await pool.query(
    `UPDATE users
     SET home_club_id = $1,
         home_club_name = $2
     WHERE id = $3
     RETURNING id, email, role, home_port_name, home_club_id, home_club_name`,
    [club.id, club.name, userId],
  );
  if (targetRows.length === 0) return res.status(404).json({ error: 'User not found' });

  await pool.query(
    `INSERT INTO club_memberships (club_id, user_id, added_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (club_id, user_id) DO NOTHING`,
    [club.id, userId, req.user.id],
  );

  return res.status(201).json(targetRows[0]);
});

app.post('/api/club-admin/windows', requireAuth, requireClubAdmin, async (req, res) => {
  const club = await resolveManagedClub(req.user.id);
  if (!club?.id) return res.status(400).json({ error: 'Set up your club first' });

  const { date, lowWater, duration, capacity, startsAt, endsAt, notes, facilityId } = req.body || {};
  if (!date || !lowWater || !duration || !facilityId) return res.status(400).json({ error: 'Date, low water, duration, and facility are required' });
  const parsed = toWindowTimestamps({ startsAt, endsAt, date, lowWater, duration });

  const { rows: facilityRows } = await pool.query(
    `SELECT id FROM club_facilities WHERE id = $1 AND club_id = $2 LIMIT 1`,
    [facilityId, club.id],
  );
  if (facilityRows.length === 0) return res.status(400).json({ error: 'Facility not found for this club' });

  const { rows } = await pool.query(
    `INSERT INTO scrub_windows (club_id, date_label, low_water, duration, starts_at, ends_at, notes, facility_id, capacity)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8, $9)
     RETURNING id, date_label as date, low_water as "lowWater", duration, starts_at as "startsAt", ends_at as "endsAt", notes, facility_id as "facilityId", capacity`,
    [club.id, date, lowWater, duration, parsed.startsAt, parsed.endsAt, notes || null, facilityId, Math.max(Number(capacity) || 1, 1)],
  );
  const created = formatClubWindow(rows[0]);
  await syncWindowToExternalCalendars({ club, windowId: created.id });
  return res.status(201).json(created);
});

app.post('/api/club-admin/windows/:windowId/book-on-behalf', requireAuth, requireClubAdmin, async (req, res) => {
  const { userId, boatName } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  const normalizedBoatName = String(boatName || '').trim();
  if (!normalizedBoatName) return res.status(400).json({ error: 'Boat name is required' });
  const club = await resolveManagedClub(req.user.id);
  if (!club?.id) return res.status(400).json({ error: 'Set up your club first' });

  const { rows: memberRows } = await pool.query(
    `SELECT id FROM users WHERE id = $1 AND home_club_id = $2 LIMIT 1`,
    [userId, club.id],
  );
  if (memberRows.length === 0) return res.status(400).json({ error: 'User is not in this club group' });

  const { rows: windowRows } = await pool.query(
    `SELECT id FROM scrub_windows WHERE id = $1 AND club_id = $2 LIMIT 1`,
    [req.params.windowId, club.id],
  );
  if (windowRows.length === 0) return res.status(404).json({ error: 'Scrub window not found' });

  await pool.query(
    `INSERT INTO bookings (window_id, user_id, boat_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (window_id, user_id)
     DO UPDATE SET boat_name = EXCLUDED.boat_name`,
    [req.params.windowId, userId, normalizedBoatName],
  );
  await syncWindowToExternalCalendars({ club, windowId: req.params.windowId });
  return res.json({ ok: true });
});

// Clubs and scrub windows
const hydrateClubs = async () => {
  const { rows: clubRows } = await pool.query(`SELECT id, name, capacity FROM clubs ORDER BY created_at`);
  const clubs = [];
  for (const club of clubRows) {
    const { rows: windows } = await pool.query(
      `SELECT w.id, w.date_label as date, w.low_water as "lowWater", w.duration, w.capacity,
              w.facility_id as "facilityId", COALESCE(cf.name, 'Unassigned facility') as "facilityName",
              (SELECT COUNT(*) FROM bookings b WHERE b.window_id = w.id) AS booked
       FROM scrub_windows w
       LEFT JOIN club_facilities cf ON cf.id = w.facility_id
       WHERE w.club_id = $1 ORDER BY w.created_at`,
      [club.id],
    );
    clubs.push({ ...club, windows: windows.map(w => ({ ...w, booked: Number(w.booked) })) });
  }
  return clubs;
};

app.get('/api/clubs', async (_req, res) => {
  const clubs = await hydrateClubs();
  res.json(clubs);
});

app.get('/api/my-club/calendar', requireAuth, async (req, res) => {
  const managedClub = (req.user.role === 'club_admin' || req.user.role === 'admin')
    ? await resolveManagedClub(req.user.id)
    : null;
  const clubId = managedClub?.id || req.user.home_club_id;
  if (!clubId) return res.status(403).json({ error: 'Club membership required' });

  const { rows } = await pool.query(`SELECT id, name, capacity FROM clubs WHERE id = $1 LIMIT 1`, [clubId]);
  if (rows.length === 0) return res.status(404).json({ error: 'Club not found' });

  const includeBookingDetails = req.user.role === 'club_admin' || req.user.role === 'admin';
  const windows = await getScrubWindowsForClub(clubId, {
    viewerUserId: req.user.id,
    includeBookingDetails,
  });
  return res.json({ club: rows[0], windows });
});

app.post('/api/my-club/windows/:windowId/book', requireAuth, async (req, res) => {
  const { boatName } = req.body || {};
  const normalizedBoatName = String(boatName || '').trim();
  if (!normalizedBoatName) return res.status(400).json({ error: 'Boat name is required' });
  const managedClub = (req.user.role === 'club_admin' || req.user.role === 'admin')
    ? await resolveManagedClub(req.user.id)
    : null;
  const clubId = managedClub?.id || req.user.home_club_id;
  if (!clubId) return res.status(403).json({ error: 'Club membership required' });

  const { rows: windowRows } = await pool.query(
    `SELECT id, capacity,
            (SELECT COUNT(*) FROM bookings b WHERE b.window_id = w.id)::int AS booked
     FROM scrub_windows w
     WHERE id = $1 AND club_id = $2
     LIMIT 1`,
    [req.params.windowId, clubId],
  );
  if (windowRows.length === 0) return res.status(404).json({ error: 'Scrub window not found for your club' });

  const { rows: existingRows } = await pool.query(
    `SELECT id FROM bookings WHERE window_id = $1 AND user_id = $2 LIMIT 1`,
    [req.params.windowId, req.user.id],
  );
  if (existingRows.length > 0) {
    await pool.query(
      `UPDATE bookings SET boat_name = $3 WHERE window_id = $1 AND user_id = $2`,
      [req.params.windowId, req.user.id, normalizedBoatName],
    );
    return res.json({ ok: true, alreadyBooked: true });
  }

  const window = windowRows[0];
  if (Number(window.booked) >= Number(window.capacity)) {
    return res.status(400).json({ error: 'This facility slot is fully booked' });
  }

  await pool.query(`INSERT INTO bookings (window_id, user_id, boat_name) VALUES ($1, $2, $3)`, [req.params.windowId, req.user.id, normalizedBoatName]);
  const { rows: clubRows } = await pool.query(`SELECT id, name, capacity FROM clubs WHERE id = $1 LIMIT 1`, [clubId]);
  await syncWindowToExternalCalendars({ club: clubRows[0] || null, windowId: req.params.windowId });
  return res.json({ ok: true, alreadyBooked: false });
});

app.get('/api/facilities/search', async (req, res) => {
  try {
    const draft = Number(req.query.draft);
    const loa = Number(req.query.loa);
    const scrubNeed = req.query.scrubNeed === 'urgent' ? 'urgent' : 'planned';
    const location = String(req.query.location || '').trim();
    if (!location) return res.status(400).json({ error: 'Location is required' });
    if (!Number.isFinite(draft) || draft <= 0) return res.status(400).json({ error: 'Draft must be a positive number' });
    if (!Number.isFinite(loa) || loa <= 0) return res.status(400).json({ error: 'LOA must be a positive number' });

    const data = await searchMarineFacilities({ location, draft, loa, scrubNeed });
    res.json(data);
  } catch (err) {
    console.error('Facility search failed:', err);
    res.status(502).json({ error: err.message || 'Facility search failed' });
  }
});

app.post('/api/clubs', requireAuth, async (req, res) => {
  if (req.user.role !== 'club_admin') return res.status(403).json({ error: 'Club admin role required' });
  const { name, capacity } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  const { rows } = await pool.query(
    `INSERT INTO clubs (name, capacity, created_by) VALUES ($1, $2, $3) RETURNING id, name, capacity`,
    [name, Math.max(Number(capacity) || 1, 1), req.user.id],
  );
  res.status(201).json(rows[0]);
});

app.post('/api/clubs/:id/windows', requireAuth, async (req, res) => {
  const { date, lowWater, duration, capacity } = req.body || {};
  if (!date || !lowWater || !duration) return res.status(400).json({ error: 'All fields required' });
  const { rows } = await pool.query(
    `INSERT INTO scrub_windows (club_id, date_label, low_water, duration, capacity) VALUES ($1, $2, $3, $4, $5) RETURNING id, date_label as date, low_water as "lowWater", duration, capacity`,
    [req.params.id, date, lowWater, duration, Math.max(Number(capacity) || 1, 1)],
  );
  res.status(201).json(rows[0]);
});

app.post('/api/clubs/:id/windows/:windowId/book', requireAuth, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO bookings (window_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.params.windowId, req.user.id],
    );
    const { rows: clubRows } = await pool.query(
      `SELECT id, name, capacity FROM clubs WHERE id = $1 LIMIT 1`,
      [req.params.id],
    );
    await syncWindowToExternalCalendars({ club: clubRows[0] || null, windowId: req.params.windowId });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Booking failed' });
  }
});

// Tide prediction functions (from frontend)
const getLunarPhase = (date) => {
  const LUNAR_CYCLE = 29.53059;
  const KNOWN_NEW_MOON = new Date('2024-01-11T11:57:00Z').getTime();
  const daysSinceNew = (date.getTime() - KNOWN_NEW_MOON) / (1000 * 60 * 60 * 24);
  const phase = (daysSinceNew % LUNAR_CYCLE) / LUNAR_CYCLE;
  return phase < 0 ? phase + 1 : phase;
};

const getSpringNeapFactor = (date) => {
  const phase = getLunarPhase(date);
  const springProximity = Math.min(Math.abs(phase - 0), Math.abs(phase - 0.5), Math.abs(phase - 1));
  return 1 - (springProximity / 0.25);
};

const ensureUtcDateTimeString = (value) => {
  if (!value) return value;
  const stringValue = String(value);
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(stringValue)) return stringValue;
  return `${stringValue}Z`;
};

const predictTidalEvents = (station, startDate, days) => {
  const events = [];
  const { mhws = 4.5, mhwn = 3.5, mlwn = 1.5, mlws = 0.5 } = station;
  const M2_PERIOD = 12.4206;

  const referenceDate = new Date(startDate);
  referenceDate.setHours(0, 0, 0, 0);

  const lunarPhase = getLunarPhase(referenceDate);
  const initialHWOffset = (lunarPhase * 24 * 0.5 + 2) % M2_PERIOD;

  for (let day = 0; day < days; day++) {
    const currentDate = new Date(referenceDate);
    currentDate.setDate(currentDate.getDate() + day);

    const laggedDate = new Date(currentDate);
    laggedDate.setDate(laggedDate.getDate() - 2);
    const springFactor = getSpringNeapFactor(laggedDate);

    const hwHeight = mhwn + (mhws - mhwn) * springFactor;
    const lwHeight = mlwn - (mlwn - mlws) * springFactor;

    const dayOffset = day * 0.8333;
    let hw1Hour = (initialHWOffset + dayOffset) % 24;
    if (hw1Hour < 0) hw1Hour += 24;

    let hw2Hour = (hw1Hour + M2_PERIOD) % 24;
    let lw1Hour = (hw1Hour + M2_PERIOD / 2) % 24;
    let lw2Hour = (hw2Hour + M2_PERIOD / 2) % 24;

    const addEvent = (hour, type, baseHeight) => {
      if (hour >= 0 && hour < 24) {
        const time = new Date(currentDate);
        time.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
        events.push({
          EventType: type,
          DateTime: time.toISOString(),
          Height: Math.max(0, baseHeight + (Math.random() - 0.5) * 0.15),
          date: currentDate.toISOString().split('T')[0],
        });
      }
    };

    addEvent(hw1Hour, 'HighWater', hwHeight);
    if (Math.abs(hw2Hour - hw1Hour) > 6 || hw2Hour < hw1Hour) addEvent(hw2Hour, 'HighWater', hwHeight - 0.1);
    addEvent(lw1Hour, 'LowWater', lwHeight);
    if (Math.abs(lw2Hour - lw1Hour) > 6 || lw2Hour < lw1Hour) addEvent(lw2Hour, 'LowWater', lwHeight);
  }

  return events;
};

// PDF Tide Booklet Generation
app.get('/api/generate-tide-booklet', requireAuth, async (req, res) => {
  try {
    if (!hasPaidCalendarAccess(req.user)) {
      return res.status(403).json({ error: 'PDF calendar purchase is required to download PDF tide booklets.' });
    }

    // Get user's home port
    if (!req.user.home_port_id || !req.user.home_port_name) {
      return res.status(400).json({ error: 'No home port configured. Please set your home port first.' });
    }

    // Fetch station data from Admiralty API
    const stationUrl = `${API_BASE_URL}/Stations/${req.user.home_port_id}`;
    const stationResponse = await fetch(stationUrl, {
      headers: getAdmiraltyHeaders(API_KEY),
    });

    if (!stationResponse.ok) {
      throw new Error('Failed to fetch station data');
    }

    const station = await stationResponse.json();

    // Generate tide data for the entire year
    const currentYear = new Date().getFullYear();
    const startDate = new Date(currentYear, 0, 1); // January 1st of current year
    let allEvents = [];
    try {
      const rawApiEvents = await fetchAdmiraltyEvents({
        stationId: req.user.home_port_id,
        duration: 365,
        user: req.user,
      });
      allEvents = (Array.isArray(rawApiEvents) ? rawApiEvents : []).map(event => ({
        ...event,
        DateTime: ensureUtcDateTimeString(event.DateTime),
        IsPredicted: false,
        Source: 'UKHO',
      }));
    } catch (err) {
      console.warn('Subscriber/PDF tidal API failed for booklet generation, falling back to predictions:', err.message);
      allEvents = predictTidalEvents(station, startDate, 365);
    }

    // Group events by month
    const eventsByMonth = {};
    allEvents.forEach(event => {
      const eventDate = new Date(event.DateTime);
      const monthKey = `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, '0')}`;
      if (!eventsByMonth[monthKey]) {
        eventsByMonth[monthKey] = {};
      }
      const dayKey = eventDate.getDate();
      if (!eventsByMonth[monthKey][dayKey]) {
        eventsByMonth[monthKey][dayKey] = [];
      }
      eventsByMonth[monthKey][dayKey].push(event);
    });

    // Create PDF document
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: 40, bottom: 40, left: 40, right: 40 }
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="tide-booklet-${req.user.home_port_name.replace(/\s+/g, '-')}-${currentYear}.pdf"`);

    // Pipe the PDF to the response
    doc.pipe(res);

    const palette = {
      primary: '#8b5cf6',
      primaryDark: '#6d28d9',
      text: '#1f2937',
      muted: '#6b7280',
      border: '#e5e7eb',
      headerBg: '#f5f3ff',
      weekendBg: '#f8fafc'
    };
    const fontRegular = 'Helvetica';
    const fontBold = 'Helvetica-Bold';

    // Cover page
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(palette.headerBg);
    doc.fillColor(palette.text);
    doc.fontSize(30).font(fontBold).text('Tide Data Booklet', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(20).font(fontRegular).text(req.user.home_port_name, { align: 'center' });
    doc.moveDown();
    doc.fontSize(14).text(`Year ${currentYear}`, { align: 'center' });
    doc.moveDown(3);
    doc.fontSize(11).fillColor(palette.muted).font(fontRegular).text('Generated from Tidal Calendar App', { align: 'center' });
    doc.fontSize(9).text(`Generated on ${new Date().toLocaleDateString()}`, { align: 'center' });
    doc.fillColor(palette.text);

    // Generate a page for each month
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const drawMonthPage = (month) => {
      const monthKey = `${currentYear}-${String(month + 1).padStart(2, '0')}`;
      const monthEvents = eventsByMonth[monthKey] || {};
      const daysInMonth = new Date(currentYear, month + 1, 0).getDate();
      const firstDay = new Date(currentYear, month, 1).getDay();

      const pageMargin = 40;
      const headerHeight = 60;
      const footerHeight = 24;
      const gridTop = pageMargin + headerHeight;
      const gridLeft = pageMargin;
      const gridWidth = doc.page.width - pageMargin * 2;
      const gridHeight = doc.page.height - pageMargin * 2 - headerHeight - footerHeight;
      const headerRowHeight = 20;
      const dayGridHeight = gridHeight - headerRowHeight;
      const colWidth = gridWidth / 7;
      const rowHeight = dayGridHeight / 6;

      doc.rect(0, 0, doc.page.width, doc.page.height).fill('white');
      doc.rect(pageMargin, pageMargin, gridWidth, headerHeight).fill(palette.primary);
      doc.fillColor('white');
      doc.fontSize(24).font(fontBold).text(`${months[month]} ${currentYear}`, pageMargin, pageMargin + 16, {
        width: gridWidth,
        align: 'center'
      });

      doc.fontSize(10).font(fontRegular).text(
        `${req.user.home_port_name} - Tide Calendar`,
        pageMargin,
        pageMargin + 40,
        { width: gridWidth, align: 'center' }
      );

      doc.fillColor(palette.text);
      doc.rect(gridLeft, gridTop, gridWidth, gridHeight).stroke(palette.border);

      // Weekday header
      for (let col = 0; col < 7; col++) {
        const x = gridLeft + col * colWidth;
        doc.rect(x, gridTop, colWidth, headerRowHeight).fill(palette.headerBg);
        doc.fillColor(palette.muted).font(fontBold).fontSize(10).text(weekdayNames[col], x, gridTop + 5, {
          width: colWidth,
          align: 'center'
        });
        doc.fillColor(palette.text);
      }

      // Weekend background
      const maxCells = 42;
      for (let cell = 0; cell < maxCells; cell++) {
        const row = Math.floor(cell / 7);
        const col = cell % 7;
        const cellX = gridLeft + col * colWidth;
        const cellY = gridTop + headerRowHeight + row * rowHeight;

        if (col === 0 || col === 6) {
          doc.rect(cellX, cellY, colWidth, rowHeight).fill(palette.weekendBg);
        }
      }

      // Grid lines
      doc.strokeColor(palette.border);
      for (let col = 0; col <= 7; col++) {
        const x = gridLeft + col * colWidth;
        doc.moveTo(x, gridTop).lineTo(x, gridTop + gridHeight).stroke();
      }
      for (let row = 0; row <= 6; row++) {
        const y = gridTop + headerRowHeight + row * rowHeight;
        doc.moveTo(gridLeft, y).lineTo(gridLeft + gridWidth, y).stroke();
      }

      // Calendar cells
      for (let cell = 0; cell < maxCells; cell++) {
        const row = Math.floor(cell / 7);
        const col = cell % 7;
        const dayNumber = cell - firstDay + 1;
        const cellX = gridLeft + col * colWidth;
        const cellY = gridTop + headerRowHeight + row * rowHeight;

        if (dayNumber < 1 || dayNumber > daysInMonth) {
          continue;
        }

        doc.fillColor(palette.text).font(fontBold).fontSize(11).text(String(dayNumber), cellX + 6, cellY + 4, {
          width: colWidth - 12,
          align: 'left'
        });

        const dayEvents = monthEvents[dayNumber] || [];
        if (dayEvents.length > 0) {
          const eventsToShow = [...dayEvents]
            .sort((a, b) => new Date(a.DateTime) - new Date(b.DateTime))
            .slice(0, 3);
          const eventsText = eventsToShow.map(event => {
            const eventDate = new Date(event.DateTime);
            const timeStr = eventDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            const typeLabel = event.EventType === 'HighWater' ? 'HW' : 'LW';
            return `${timeStr} ${typeLabel} ${event.Height.toFixed(1)}m`;
          });

          doc.font(fontRegular).fontSize(8).fillColor(palette.text).text(
            eventsText.join('\n'),
            cellX + 6,
            cellY + 20,
            { width: colWidth - 12, height: rowHeight - 24 }
          );
        }
      }

      doc.fillColor(palette.muted).font(fontRegular).fontSize(9).text(
        'HW High Water  /  LW Low Water',
        pageMargin,
        doc.page.height - pageMargin - 12,
        { width: gridWidth, align: 'left' }
      );

      doc.fillColor(palette.muted).font(fontRegular).fontSize(9).text(
        `Page ${month + 2} of 13`,
        pageMargin,
        doc.page.height - pageMargin - 12,
        { width: gridWidth, align: 'right' }
      );
    };

    for (let month = 0; month < 12; month++) {
      doc.addPage();
      drawMonthPage(month);
    }

    // Finalize the PDF
    doc.end();
  } catch (err) {
    console.error('PDF generation failed:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate PDF booklet' });
    }
  }
});

// Static assets (build output)
const serveStatic = (filePath, res) => {
  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  createReadStream(filePath).pipe(res);
};

app.use(express.static(publicPath));

app.get('*', async (req, res) => {
  // skip API routes
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  const hasFileExtension = Boolean(path.extname(req.path));
  let filePath = path.resolve(publicPath, `.${req.path}`);
  if (req.path === '/' || !path.extname(filePath)) {
    filePath = path.join(publicPath, 'index.html');
  }

  try {
    const stats = await stat(filePath);
    if (stats.isFile()) {
      serveStatic(filePath, res);
      return;
    }
  } catch {
    // fallthrough to index.html for SPA routes
  }

  if (hasFileExtension) {
    return res.status(404).send('Not Found');
  }

  const indexPath = path.join(publicPath, 'index.html');
  if (existsSync(indexPath)) {
    serveStatic(indexPath, res);
  } else {
    res.status(404).send('Not Found');
  }
});

// Graceful shutdown
const shutdown = async (signal) => {
  console.log(`\n${signal} received, shutting down gracefully...`);
  try {
    if (maintenanceReminderTimer) {
      clearInterval(maintenanceReminderTimer);
      maintenanceReminderTimer = null;
    }
    await pool.end();
    console.log('Database connections closed');
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server with proper error handling and retry logic
const startServer = async () => {
  try {
    console.log('Starting Tidal Calendar Server...');
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Port: ${PORT}`);

    if (!existsSync(frontendBundlePath)) {
      console.warn(`Frontend bundle missing at ${frontendBundlePath}. Building now...`);
      await import('./scripts/build.mjs');
      if (!existsSync(frontendBundlePath)) {
        throw new Error(`Frontend bundle build did not produce ${frontendBundlePath}`);
      }
      console.log('✓ Frontend bundle generated successfully');
    }

    // Start Express server
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`✓ Server running successfully on port ${PORT}`);
      console.log(`✓ Ready to accept requests`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`FATAL: Port ${PORT} is already in use`);
      } else {
        console.error('Server error:', err);
      }
      process.exit(1);
    });

    // Initialize database connection and schema in the background
    initializeDatabase();
  } catch (err) {
    console.error('FATAL: Failed to start server');
    console.error('Error details:', err);
    console.error('Stack trace:', err.stack);
    process.exit(1);
  }
};

startServer();
