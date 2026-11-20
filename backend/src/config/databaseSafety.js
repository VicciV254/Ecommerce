const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** The development deployment's hosted database, the TLS modes it requires and the only settings its URLs may carry. */
const DEVELOPMENT_DATABASE = '/apex_development';
const TLS_MODES = new Set(['require', 'verify-ca', 'verify-full']);
const DIRECT_SETTINGS = new Set(['sslmode', 'channel_binding', 'connect_timeout']);
const POOLED_SETTINGS = new Set([...DIRECT_SETTINGS, 'pgbouncer', 'pool_timeout', 'connection_limit']);

function parseDatabaseUrl(value, label) {
  if (!value) throw new Error(`${label} is required`);

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL`);
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(`${label} must use PostgreSQL`);
  }
  return url;
}

function assertSchemaSetting(url, label) {
  const schemas = url.searchParams.getAll('schema');
  if (schemas.length > 1 || (schemas.length === 1 && !/^[a-z_][a-z0-9_]*$/.test(schemas[0]))) {
    throw new Error(`${label} contains an invalid schema`);
  }
}

export function assertLocalDatabaseUrl(value, label = 'DATABASE_URL') {
  const url = parseDatabaseUrl(value, label);
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`${label} must target a loopback host for local database operations`);
  }
  if (!/^\/apex_(test|development)(_[a-z0-9]+)*$/.test(url.pathname)) {
    throw new Error(`${label} must name an apex_test or apex_development database`);
  }
  if (url.hash || [...url.searchParams.keys()].some((key) => key !== 'schema')) {
    throw new Error(`${label} may only contain a schema query parameter`);
  }
  assertSchemaSetting(url, label);
  return url;
}

/** Hosts of the development deployment's own database (`APPROVED_DATABASE_HOSTS`, comma-separated). */
export function approvedDatabaseHosts(env = process.env) {
  return (env.APPROVED_DATABASE_HOSTS ?? '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
}

function onApprovedHost(value, env) {
  try {
    return approvedDatabaseHosts(env).includes(new URL(value).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function userOf(url) {
  try {
    return decodeURIComponent(url.username);
  } catch {
    return null;
  }
}

/**
 * The development deployment's hosted database: an approved host, the `apex_development` database and its `public`
 * schema, the approved restricted role (`APPROVED_DATABASE_ROLE`), TLS, and no setting that could redirect the
 * connection or change its role or schema. `pooled` also admits the connection pooler's own settings.
 */
export function assertApprovedDevelopmentDatabaseUrl(value, env = process.env, label = 'DATABASE_URL', { pooled = false } = {}) {
  const url = parseDatabaseUrl(value, label);
  if (!onApprovedHost(value, env)) {
    throw new Error(`${label} must target an approved development database host`);
  }
  const role = env.APPROVED_DATABASE_ROLE?.trim();
  if (!role || userOf(url) !== role) {
    throw new Error(`${label} must connect as the approved runtime role`);
  }
  if (url.pathname !== DEVELOPMENT_DATABASE) {
    throw new Error(`${label} must name the apex_development database`);
  }
  const settings = [...url.searchParams.keys()];
  const allowed = pooled ? POOLED_SETTINGS : DIRECT_SETTINGS;
  if (url.hash || new Set(settings).size !== settings.length || settings.some((key) => !allowed.has(key))) {
    throw new Error(`${label} contains a connection setting that is not allowed`);
  }
  if (!TLS_MODES.has(url.searchParams.get('sslmode'))) {
    throw new Error(`${label} must require TLS (sslmode=require or stricter)`);
  }
  return url;
}

export function assertTestDatabaseUrl(value) {
  const url = assertLocalDatabaseUrl(value, 'TEST_DATABASE_URL');
  if (!/^\/apex_test(_[a-z0-9]+)*$/.test(url.pathname)) {
    throw new Error('TEST_DATABASE_URL must name an apex_test database');
  }
  return url;
}

export function assertLocalDatabaseReset(env = process.env) {
  if (!['development', 'test'].includes(env.NODE_ENV)) {
    throw new Error('Database reset/seed requires NODE_ENV=development or test');
  }
  if (env.ALLOW_LOCAL_DATABASE_RESET !== 'true') {
    throw new Error('Database reset/seed requires explicit ALLOW_LOCAL_DATABASE_RESET=true');
  }
  assertMatchingLocalDatabases(env);
}

function assertSameTarget(app, direct, message) {
  const target = (url) => [
    url.hostname,
    url.port || '5432',
    url.pathname,
    url.searchParams.get('schema') || 'public',
  ].join('|');
  if (target(app) !== target(direct)) throw new Error(message);
  return { app, direct };
}

export function assertMatchingLocalDatabases(env = process.env) {
  return assertSameTarget(
    assertLocalDatabaseUrl(env.DATABASE_URL),
    assertLocalDatabaseUrl(env.DIRECT_URL, 'DIRECT_URL'),
    'DATABASE_URL and DIRECT_URL must target the same local database and schema',
  );
}

export function assertDemoInitialization(env = process.env, dryRun = false) {
  if (!['development', 'test'].includes(env.NODE_ENV)) {
    throw new Error('Demo initialization requires NODE_ENV=development or test');
  }
  if (!dryRun && env.ALLOW_DEMO_INITIALIZATION !== 'true') {
    throw new Error('Demo initialization requires explicit ALLOW_DEMO_INITIALIZATION=true');
  }
  // The development deployment's own database is the one hosted target, and only for a development run.
  if (onApprovedHost(env.DATABASE_URL, env) || onApprovedHost(env.DIRECT_URL, env)) {
    if (env.NODE_ENV !== 'development') {
      throw new Error('The approved development database is initialized only with NODE_ENV=development');
    }
    return assertSameTarget(
      assertApprovedDevelopmentDatabaseUrl(env.DATABASE_URL, env, 'DATABASE_URL'),
      assertApprovedDevelopmentDatabaseUrl(env.DIRECT_URL, env, 'DIRECT_URL'),
      'DATABASE_URL and DIRECT_URL must target the same approved development database',
    );
  }
  return assertMatchingLocalDatabases(env);
}
