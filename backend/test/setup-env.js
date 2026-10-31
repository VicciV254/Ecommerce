import { assertTestDatabaseUrl } from '../src/config/databaseSafety.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = assertTestDatabaseUrl(
  process.env.TEST_DATABASE_URL || 'postgresql://apex_test:local_test_only@127.0.0.1:1/apex_test',
).href;
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.JWT_SECRET = 'test-only-access-signing-key-not-for-production';
process.env.JWT_REFRESH_SECRET = 'test-only-refresh-signing-key-not-for-production';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
process.env.ALLOW_LOCAL_DATABASE_RESET = 'false';
process.env.ENABLE_EMAIL_VERIFICATION = 'false';
process.env.ENABLE_MPESA = 'false';
process.env.ALLOW_DEMO_CATALOG = 'false';
process.env.ALLOW_DEMO_INITIALIZATION = 'false';
process.env.CORS_ORIGIN = 'http://127.0.0.1:4173';
process.env.IMAGE_HOST_API_URL = '';
process.env.IMAGE_HOST_LOGIN_URL = '';
process.env.IMAGE_HOST_USERNAME = '';
process.env.IMAGE_HOST_PASSWORD = '';
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
process.env.GOOGLE_CLIENT_ID = '';
process.env.GOOGLE_CLIENT_SECRET = '';
process.env.GOOGLE_REFRESH_TOKEN = '';
