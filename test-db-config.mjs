#!/usr/bin/env node
// Test server startup without actually starting the server
import { Pool } from 'pg';

console.log('Testing database configuration...\n');

// Simulate Railway environment
const testConfig = {
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test',
  NODE_ENV: process.env.NODE_ENV || 'production'
};

console.log('Configuration:', {
  hasUrl: !!testConfig.DATABASE_URL,
  environment: testConfig.NODE_ENV,
  urlPattern: testConfig.DATABASE_URL.substring(0, 20) + '...'
});

// Test SSL configuration logic
const isProduction = testConfig.NODE_ENV === 'production' ||
                     testConfig.DATABASE_URL?.includes('railway') ||
                     testConfig.DATABASE_URL?.includes('postgres://');

const sslConfig = isProduction ? { rejectUnauthorized: false } : undefined;

console.log('\nSSL Configuration:', {
  isProduction,
  sslEnabled: !!sslConfig
});

// Test pool creation
try {
  const pool = new Pool({
    connectionString: testConfig.DATABASE_URL,
    ssl: sslConfig,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 20,
  });

  console.log('\n✓ Pool created successfully');
  console.log('✓ Configuration is valid');

  // Don't actually connect in this test
  pool.end();
  process.exit(0);
} catch (err) {
  console.error('\n✗ Error creating pool:', err.message);
  process.exit(1);
}
