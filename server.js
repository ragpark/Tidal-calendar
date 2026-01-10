import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { createReadStream, existsSync } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const API_BASE_URL = 'https://admiraltyapi.azure-api.net/uktidalapi/api/V1';
const API_KEY = process.env.ADMIRALTY_API_KEY || 'baec423358314e4e8f527980f959295d';
const SESSION_COOKIE = 'tc_session';
const SESSION_TTL_HOURS = 24;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';

// Validate DATABASE_URL
if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL environment variable is not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  max: 20,
});

// Handle pool errors to prevent crashes
pool.on('error', (err, client) => {
  console.error('Unexpected database pool error:', err);
});

const app = express();
app.use(express.json());
app.use(cookieParser());

const distPath = path.join(__dirname, 'dist');

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

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
      console.error(`Database connection attempt ${attempt} failed:`, err.message);
      if (attempt < maxRetries) {
        console.log(`Retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
        throw new Error(`Failed to connect to database after ${maxRetries} attempts: ${err.message}`);
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
        stripe_customer_id TEXT,
        stripe_last_session_id TEXT,
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
      CREATE TABLE IF NOT EXISTS clubs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        capacity INT NOT NULL DEFAULT 8,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS scrub_windows (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        club_id UUID REFERENCES clubs(id) ON DELETE CASCADE,
        date_label TEXT NOT NULL,
        low_water TEXT NOT NULL,
        duration TEXT NOT NULL,
        capacity INT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS bookings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        window_id UUID REFERENCES scrub_windows(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(window_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS alerts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        due_at TIMESTAMPTZ,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS maintenance_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        activity_type TEXT NOT NULL DEFAULT 'planned',
        title TEXT NOT NULL,
        notes TEXT,
        completed BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT now()
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
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_last_session_id TEXT;`);

  const { rows } = await pool.query(`SELECT id FROM clubs LIMIT 1`);
  if (rows.length === 0) {
    const { rows: clubRows } = await pool.query(
      `INSERT INTO clubs (name, capacity) VALUES ($1, $2) RETURNING id, name, capacity`,
      ['Solent Cruising Club', 8],
    );
    const clubId = clubRows[0].id;
    const windows = [
      { date: 'Thu 18 Sep', lowWater: '11:42', duration: '2h 20m', capacity: 8 },
      { date: 'Fri 19 Sep', lowWater: '12:28', duration: '2h 10m', capacity: 8 },
      { date: 'Sat 20 Sep', lowWater: '13:10', duration: '2h 05m', capacity: 8 },
    ];
    for (const w of windows) {
      await pool.query(
        `INSERT INTO scrub_windows (club_id, date_label, low_water, duration, capacity) VALUES ($1, $2, $3, $4, $5)`,
        [clubId, w.date, w.lowWater, w.duration, w.capacity],
      );
    }
  }
};

const getUserFromSession = async (req) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.role, u.subscription_status, u.subscription_period_end, u.stripe_customer_id, u.stripe_last_session_id, u.home_port_id, u.home_port_name, u.home_club_id, u.home_club_name
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  );
  return rows[0] || null;
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

// Health check endpoint for container monitoring
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.use(async (req, res, next) => {
  // Refresh session on activity
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    await pool.query(`UPDATE sessions SET expires_at = now() + interval '${SESSION_TTL_HOURS} hours' WHERE token = $1`, [token]);
  }
  next();
});

// Proxy to Admiralty API
app.use('/api/Stations', async (req, res) => {
  const targetPath = req.originalUrl.replace('/api/', '');
  const url = new URL(`${API_BASE_URL}/${targetPath}`);
  try {
    const upstream = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Ocp-Apim-Subscription-Key': API_KEY,
      },
    });

    res.status(upstream.status);
    res.set('Content-Type', upstream.headers.get('content-type') || 'application/json');

    if (!upstream.body) {
      res.end();
      return;
    }

    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    console.error('Proxy error', err);
    res.status(502).json({ error: 'Proxy request failed' });
  }
});

// Auth routes
app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, role, subscription_status, subscription_period_end, stripe_customer_id, stripe_last_session_id, home_port_id, home_port_name, home_club_id, home_club_name`,
      [email.toLowerCase(), hash],
    );
    const user = rows[0];
    const token = randomUUID();
    await pool.query(`INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, now() + interval '${SESSION_TTL_HOURS} hours')`, [user.id, token]);
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: SESSION_TTL_HOURS * 3600 * 1000 });
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
    `SELECT id, email, role, subscription_status, subscription_period_end, stripe_customer_id, stripe_last_session_id, password_hash, home_port_id, home_port_name, home_club_id, home_club_name FROM users WHERE email = $1`,
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
    stripe_customer_id: user.stripe_customer_id,
    stripe_last_session_id: user.stripe_last_session_id,
    home_port_id: user.home_port_id,
    home_port_name: user.home_port_name,
    home_club_id: user.home_club_id,
    home_club_name: user.home_club_name,
  });
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
  const { homePortId, homePortName, homeClubId, homeClubName } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE users SET home_port_id = $1, home_port_name = $2, home_club_id = $3, home_club_name = $4 WHERE id = $5 RETURNING id, email, role, subscription_status, subscription_period_end, stripe_customer_id, stripe_last_session_id, home_port_id, home_port_name, home_club_id, home_club_name`,
    [homePortId || null, homePortName || null, homeClubId || null, homeClubName || null, req.user.id],
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
     RETURNING id, email, role, subscription_status, subscription_period_end, stripe_customer_id, stripe_last_session_id, home_port_id, home_port_name, home_club_id, home_club_name`,
    [role, req.user.id],
  );
  res.json(rows[0]);
});

// Alerts
app.get('/api/alerts', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, title, due_at as "dueDate", notes FROM alerts WHERE user_id = $1 ORDER BY due_at NULLS LAST, created_at DESC`,
    [req.user.id],
  );
  res.json(rows);
});

app.post('/api/alerts', requireAuth, async (req, res) => {
  const { title, dueDate, notes } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Title required' });
  const { rows } = await pool.query(
    `INSERT INTO alerts (user_id, title, due_at, notes) VALUES ($1, $2, $3, $4) RETURNING id, title, due_at as "dueDate", notes`,
    [req.user.id, title, dueDate ? new Date(dueDate) : null, notes || null],
  );
  res.status(201).json(rows[0]);
});

app.delete('/api/alerts/:id', requireAuth, async (req, res) => {
  await pool.query(`DELETE FROM alerts WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
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
         completed = COALESCE($5, completed)
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

const retrieveStripeSession = async (sessionId) => {
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
    throw new Error(`Stripe responded with ${res.status}: ${text}`);
  }
  return res.json();
};

app.post('/api/payments/stripe/confirm', requireAuth, async (req, res) => {
  if (!STRIPE_SECRET_KEY) return res.status(501).json({ error: 'Stripe not configured' });
  const { sessionId } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  try {
    const session = await retrieveStripeSession(sessionId);
    const isPaid = session.payment_status === 'paid' || session.status === 'complete';
    if (!isPaid) return res.status(402).json({ error: 'Payment not completed' });
    if (session.client_reference_id && session.client_reference_id !== req.user.id) {
      return res.status(409).json({ error: 'Session does not match user' });
    }
    if (session.customer_details?.email && session.customer_details.email.toLowerCase() !== req.user.email.toLowerCase()) {
      return res.status(409).json({ error: 'Session email does not match user' });
    }

    const periodEndMs = session.subscription?.current_period_end
      ? session.subscription.current_period_end * 1000
      : Date.now() + 365 * 24 * 60 * 60 * 1000;
    const periodEndIso = new Date(periodEndMs).toISOString();
    const { rows } = await pool.query(
      `UPDATE users
       SET role = 'subscriber',
           subscription_status = 'active',
           subscription_period_end = $1,
           stripe_customer_id = COALESCE($2, stripe_customer_id),
           stripe_last_session_id = $3
       WHERE id = $4
       RETURNING id, email, role, subscription_status, subscription_period_end, stripe_customer_id, stripe_last_session_id, home_port_id, home_port_name, home_club_id, home_club_name`,
      [periodEndIso, session.customer || null, session.id, req.user.id],
    );
    res.status(200).json({ ok: true, user: rows[0] });
  } catch (err) {
    console.error('Stripe confirmation failed', err);
    res.status(502).json({ error: 'Stripe confirmation failed' });
  }
});

// Clubs and scrub windows
const hydrateClubs = async () => {
  const { rows: clubRows } = await pool.query(`SELECT id, name, capacity FROM clubs ORDER BY created_at`);
  const clubs = [];
  for (const club of clubRows) {
    const { rows: windows } = await pool.query(
      `SELECT w.id, w.date_label as date, w.low_water as "lowWater", w.duration, w.capacity,
              (SELECT COUNT(*) FROM bookings b WHERE b.window_id = w.id) AS booked
       FROM scrub_windows w WHERE w.club_id = $1 ORDER BY w.created_at`,
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
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Booking failed' });
  }
});

// Static assets (Vite build output)
const serveStatic = (filePath, res) => {
  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  createReadStream(filePath).pipe(res);
};

app.use(express.static(distPath));

app.get('*', async (req, res) => {
  // skip API routes
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  let filePath = path.join(distPath, req.path);
  if (req.path === '/' || !path.extname(filePath)) {
    filePath = path.join(distPath, 'index.html');
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

  const indexPath = path.join(distPath, 'index.html');
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

    // Test database connection with retries
    await testDatabaseConnection();

    // Create database schema
    await ensureSchema();

    // Start Express server
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`✓ Server running successfully on port ${PORT}`);
      console.log(`✓ Database connected`);
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

  } catch (err) {
    console.error('FATAL: Failed to start server');
    console.error('Error details:', err);
    console.error('Stack trace:', err.stack);
    process.exit(1);
  }
};

startServer();
