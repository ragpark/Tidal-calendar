# Pull Request: Add Maintenance Log Feature with Deployment Fixes

## Title
Add maintenance log feature with deployment fixes

## Summary

This PR adds a comprehensive maintenance log feature for tracking boat maintenance and scrubbing day activities, along with critical deployment fixes to ensure reliable container operation.

## Features Added

### Maintenance Log System
- **Database schema**: New `maintenance_logs` table with activity tracking
- **API endpoints**: Full CRUD operations for maintenance logs
  - `GET /api/maintenance-logs` - Fetch all logs for authenticated user
  - `POST /api/maintenance-logs` - Create new maintenance log
  - `PUT /api/maintenance-logs/:id` - Update existing log
  - `DELETE /api/maintenance-logs/:id` - Delete a log
- **Activity types**: Planned, scrubbing, antifouling, inspection, repairs, other
- **Completion tracking**: Mark activities as completed with boolean flag

### Frontend Integration
- **Calendar indicators**: 🔧 wrench icon on days with maintenance logs
- **Profile management**: Dedicated section for viewing/editing maintenance logs
- **Modal interface**: Clean UI for adding/editing logs with date, type, title, notes
- **Scrubbing integration**: Quick-add maintenance logs from scrubbing day modal
- **Completion status**: Visual indicators for completed activities

## Critical Deployment Fixes

### Issues Resolved
- Container stopping after deployment due to database connection failures
- No retry logic for database startup delays
- Missing environment variable validation
- Unhandled database pool errors causing crashes
- Poor error logging making diagnosis difficult

### Fixes Applied
1. **DATABASE_URL validation**: Fails fast with clear error if missing
2. **Connection retry logic**: 5 attempts with 2-second delays
3. **Pool error handlers**: Prevents crashes from unexpected DB errors
4. **Enhanced logging**: Detailed startup logs and error messages
5. **Health check endpoint**: `/health` for container monitoring
6. **Graceful shutdown**: Proper cleanup on SIGTERM/SIGINT signals
7. **Network binding**: Listens on 0.0.0.0 for container networking

### Server Startup Sequence
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

## Testing

- ✅ Build succeeds without errors
- ✅ Database schema migrations work correctly
- ✅ API endpoints respond correctly
- ✅ Frontend UI renders properly
- ✅ Health check endpoint returns correct status

## Health Check

New endpoint for container orchestrators:
```bash
GET /health
```

Returns:
```json
{
  "status": "healthy",
  "database": "connected",
  "timestamp": "2026-01-10T..."
}
```

## Documentation

See `DEPLOYMENT_FIXES.md` for detailed documentation on:
- Issues diagnosed and fixed
- Configuration requirements
- Health check usage
- Common troubleshooting steps

## Breaking Changes

None - all changes are additive.

## Migration Notes

No manual migration required. Database schema is created automatically on server startup.

Required environment variables:
- `DATABASE_URL` (required)
- `PORT` (optional, defaults to 3000)
- `NODE_ENV` (optional)

## Commits Included

1. **Add maintenance log feature for tracking scrubbing day activities** (360c694)
   - Backend: Database schema and API endpoints
   - Frontend: UI components and calendar integration

2. **Fix container deployment issues with enhanced error handling** (08b7bcb)
   - Database connection retry logic
   - Environment variable validation
   - Health check endpoint
   - Graceful shutdown handling

## Files Changed

**Backend:**
- `server.js` - Database schema, API endpoints, deployment fixes

**Frontend:**
- `src/App.jsx` - Maintenance log UI and state management

**Documentation:**
- `DEPLOYMENT_FIXES.md` - Deployment troubleshooting guide

## Related Issues

Fixes container deployment failures where the application would stop after starting.
