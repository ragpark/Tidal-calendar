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
import PDFDocument from 'pdfkit';
import tls from 'tls';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const API_BASE_URL = 'https://admiraltyapi.azure-api.net/uktidalapi/api/V1';
const API_KEY = process.env.ADMIRALTY_API_KEY || 'baec423358314e4e8f527980f959295d';
const SESSION_COOKIE = 'tc_session';
const SESSION_TTL_HOURS = 24;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const SMTP_HOST = process.env.SMTP_HOST || 'mail.boatscrubcalendar.com';
const SMTP_PORT = Number(process.env.SMTP_PORT) || 465;
const SMTP_USER = process.env.SMTP_USER || 'alert@boatscrubcalendar.com';
const SMTP_KEY = process.env.SMTP_KEY || '';

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

// Handle pool errors to prevent crashes
pool.on('error', (err, client) => {
  console.error('Unexpected database pool error:', err);
});

const app = express();
app.use(express.json());
app.use(cookieParser());

const publicPath = path.join(__dirname, 'public');

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
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS maintenance_reminders_enabled BOOLEAN NOT NULL DEFAULT false;`);
  await pool.query(`ALTER TABLE maintenance_logs ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;`);

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
    `SELECT u.id, u.email, u.role, u.subscription_status, u.subscription_period_end, u.stripe_customer_id, u.stripe_last_session_id, u.maintenance_reminders_enabled, u.home_port_id, u.home_port_name, u.home_club_id, u.home_club_name
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

app.use('/api', requireDatabase);

// Auth routes
app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2)
       RETURNING id, email, role, subscription_status, subscription_period_end, stripe_customer_id, stripe_last_session_id, maintenance_reminders_enabled, home_port_id, home_port_name, home_club_id, home_club_name`,
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
    `SELECT id, email, role, subscription_status, subscription_period_end, stripe_customer_id, stripe_last_session_id, maintenance_reminders_enabled, password_hash, home_port_id, home_port_name, home_club_id, home_club_name
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
    stripe_customer_id: user.stripe_customer_id,
    stripe_last_session_id: user.stripe_last_session_id,
    maintenance_reminders_enabled: user.maintenance_reminders_enabled,
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
  const { homePortId, homePortName, homeClubId, homeClubName, maintenanceRemindersEnabled } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE users
     SET home_port_id = COALESCE($1, home_port_id),
         home_port_name = COALESCE($2, home_port_name),
         home_club_id = COALESCE($3, home_club_id),
         home_club_name = COALESCE($4, home_club_name),
         maintenance_reminders_enabled = COALESCE($5, maintenance_reminders_enabled)
     WHERE id = $6
     RETURNING id, email, role, subscription_status, subscription_period_end, stripe_customer_id, stripe_last_session_id, maintenance_reminders_enabled, home_port_id, home_port_name, home_club_id, home_club_name`,
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
     RETURNING id, email, role, subscription_status, subscription_period_end, stripe_customer_id, stripe_last_session_id, maintenance_reminders_enabled, home_port_id, home_port_name, home_club_id, home_club_name`,
    [role, req.user.id],
  );
  res.json(rows[0]);
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
  let note = '';
  try {
    sent = await sendMaintenanceReminderEmail({ to: req.user.email, ...payload });
    if (!sent) {
      note = 'SMTP is not configured, so no email was sent. The preview below shows the message.';
    }
  } catch (err) {
    return res.status(500).json({ error: err.message, subject: payload.subject, body: payload.body });
  }
  return res.json({ sent, email: req.user.email, subject: payload.subject, body: payload.body, note });
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
  return { subject, body: bodyLines.join('\n') };
};

const sendSmtpCommand = (socket, command) => new Promise((resolve, reject) => {
  const onData = (data) => {
    const message = data.toString('utf8');
    const lines = message.split(/\r?\n/).filter(Boolean);
    const lastLine = lines[lines.length - 1] || '';
    const code = Number.parseInt(lastLine.slice(0, 3), 10);
    if (Number.isNaN(code)) {
      socket.off('data', onData);
      reject(new Error(`Unexpected SMTP response: ${message}`));
      return;
    }
    if (lastLine[3] === '-') return;
    socket.off('data', onData);
    resolve({ code, message });
  };
  socket.on('data', onData);
  if (command) {
    socket.write(`${command}\r\n`);
  }
});

const sendMaintenanceReminderEmail = async ({ to, subject, body }) => {
  if (!SMTP_KEY) {
    console.warn('SMTP_KEY is not configured; maintenance reminder emails will not be sent.');
    return false;
  }
  if (SMTP_PORT !== 465) {
    throw new Error(`Unsupported SMTP port ${SMTP_PORT}. Expected port 465.`);
  }
  const socket = tls.connect({
    host: SMTP_HOST,
    port: SMTP_PORT,
    servername: SMTP_HOST,
  });

  await new Promise((resolve, reject) => {
    socket.once('secureConnect', resolve);
    socket.once('error', reject);
  });

  try {
    const greeting = await sendSmtpCommand(socket, null);
    if (greeting.code !== 220) throw new Error(`SMTP greeting failed: ${greeting.message}`);

    const ehlo = await sendSmtpCommand(socket, `EHLO ${SMTP_HOST}`);
    if (ehlo.code !== 250) throw new Error(`SMTP EHLO failed: ${ehlo.message}`);

    const auth = await sendSmtpCommand(socket, 'AUTH LOGIN');
    if (auth.code !== 334) throw new Error(`SMTP AUTH LOGIN failed: ${auth.message}`);

    const userRes = await sendSmtpCommand(socket, Buffer.from(SMTP_USER).toString('base64'));
    if (userRes.code !== 334) throw new Error(`SMTP username rejected: ${userRes.message}`);

    const passRes = await sendSmtpCommand(socket, Buffer.from(SMTP_KEY).toString('base64'));
    if (passRes.code !== 235) throw new Error(`SMTP password rejected: ${passRes.message}`);

    const mailFrom = await sendSmtpCommand(socket, `MAIL FROM:<${SMTP_USER}>`);
    if (mailFrom.code !== 250) throw new Error(`SMTP MAIL FROM failed: ${mailFrom.message}`);

    const rcptTo = await sendSmtpCommand(socket, `RCPT TO:<${to}>`);
    if (rcptTo.code !== 250 && rcptTo.code !== 251) throw new Error(`SMTP RCPT TO failed: ${rcptTo.message}`);

    const dataCmd = await sendSmtpCommand(socket, 'DATA');
    if (dataCmd.code !== 354) throw new Error(`SMTP DATA failed: ${dataCmd.message}`);

    const message = [
      `From: ${SMTP_USER}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset="utf-8"',
      '',
      body,
      '',
      '.',
    ].join('\r\n');
    socket.write(`${message}\r\n`);

    const dataRes = await sendSmtpCommand(socket, null);
    if (dataRes.code !== 250) throw new Error(`SMTP message rejected: ${dataRes.message}`);

    await sendSmtpCommand(socket, 'QUIT');
    socket.end();
    return true;
  } catch (err) {
    socket.end();
    throw err;
  }
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
       RETURNING id, email, role, subscription_status, subscription_period_end, stripe_customer_id, stripe_last_session_id, maintenance_reminders_enabled, home_port_id, home_port_name, home_club_id, home_club_name`,
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
    // Get user's home port
    if (!req.user.home_port_id || !req.user.home_port_name) {
      return res.status(400).json({ error: 'No home port configured. Please set your home port first.' });
    }

    // Fetch station data from Admiralty API
    const stationUrl = `${API_BASE_URL}/Stations/${req.user.home_port_id}`;
    const stationResponse = await fetch(stationUrl, {
      headers: {
        Accept: 'application/json',
        'Ocp-Apim-Subscription-Key': API_KEY,
      },
    });

    if (!stationResponse.ok) {
      throw new Error('Failed to fetch station data');
    }

    const station = await stationResponse.json();

    // Generate tide data for the entire year
    const currentYear = new Date().getFullYear();
    const startDate = new Date(currentYear, 0, 1); // January 1st of current year
    const allEvents = predictTidalEvents(station, startDate, 365);

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
  let filePath = path.join(publicPath, req.path);
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
