# Container Deployment Fixes

## Issues Diagnosed

The container was stopping after deployment due to several critical issues:

1. **Missing DATABASE_URL validation** - No check for required environment variable
2. **No database connection retry logic** - Failed immediately if database wasn't ready
3. **Insufficient error logging** - Hard to diagnose failures in production
4. **No pool error handlers** - Unhandled database errors crashed the application
5. **No health check endpoint** - Container orchestrators couldn't monitor service health

## Fixes Applied

### 1. DATABASE_URL Validation (server.js:23-27)
```javascript
if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL environment variable is not set');
  process.exit(1);
}
```
- Validates DATABASE_URL exists before creating pool
- Provides clear error message for missing configuration

### 2. Enhanced Pool Configuration (server.js:29-40)
```javascript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  max: 20,
});

pool.on('error', (err, client) => {
  console.error('Unexpected database pool error:', err);
});
```
- Added connection timeouts
- Added pool error handler to prevent crashes
- Configured pool size limits

### 3. Database Connection Retry Logic (server.js:58-78)
```javascript
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
```
- Retries connection up to 5 times with 2s delays
- Handles database startup delays (common in containers)
- Provides detailed logging for each attempt

### 4. Enhanced Error Logging (server.js:80-152)
- Added detailed console logging throughout schema creation
- Logs success/failure at each step
- Includes stack traces for debugging

### 5. Health Check Endpoint (server.js:204-221)
```javascript
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
```
- Allows container orchestrators to monitor service health
- Returns 200 if database is connected, 503 if not
- Useful for Kubernetes liveness/readiness probes

### 6. Improved Server Startup (server.js:566-602)
```javascript
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
```
- Sequential startup: test connection → create schema → start server
- Comprehensive error handling and logging
- Binds to 0.0.0.0 for container networking
- Handles EADDRINUSE error specifically

### 7. Graceful Shutdown (server.js:549-563)
```javascript
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
```
- Handles SIGTERM/SIGINT signals from container orchestrators
- Closes database connections cleanly
- Prevents connection leaks during restarts

## Deployment Verification

After deploying with these fixes, you should see logs like:

```
Starting Tidal Calendar Server...
Environment: production
Port: 3000
Attempting to connect to database (attempt 1/5)...
Database connection successful
Creating database schema...
Database schema created successfully
✓ Server running successfully on port 3000
✓ Database connected
✓ Ready to accept requests
```

## Health Check Usage

Test the health endpoint:
```bash
curl http://localhost:3000/health
```

Expected response when healthy:
```json
{
  "status": "healthy",
  "database": "connected",
  "timestamp": "2026-01-10T12:00:00.000Z"
}
```

## Environment Variables Required

Ensure these are set in your container environment:
- `DATABASE_URL` (required) - PostgreSQL connection string
- `PORT` (optional) - defaults to 3000
- `NODE_ENV` (optional) - set to "production" for production deployments
- `ADMIRALTY_API_KEY` (optional) - for tide data API
- `STRIPE_SECRET_KEY` (optional) - for payment processing

## Common Issues & Solutions

### Container still stops immediately
- Check logs: `docker logs <container-id>`
- Verify DATABASE_URL is set correctly
- Ensure database is accessible from container network

### Database connection timeouts
- Increase retry delay or max retries in `testDatabaseConnection()`
- Check database is actually running
- Verify network connectivity between containers

### Port conflicts
- Change PORT environment variable
- Check if another service is using the port

## Testing Locally

Run with proper logging:
```bash
DATABASE_URL="postgresql://user:pass@localhost:5432/dbname" npm start
```

Test health endpoint:
```bash
curl http://localhost:3000/health
```
