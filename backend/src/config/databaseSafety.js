const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function assertLocalDatabaseUrl(value, label = 'DATABASE_URL') {
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
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`${label} must target a loopback host for local database operations`);
  }
  if (!/^\/apex_(test|development)(_[a-z0-9]+)*$/.test(url.pathname)) {
    throw new Error(`${label} must name an apex_test or apex_development database`);
  }
  if (url.hash || [...url.searchParams.keys()].some((key) => key !== 'schema')) {
    throw new Error(`${label} may only contain a schema query parameter`);
  }
  const schemas = url.searchParams.getAll('schema');
  if (schemas.length > 1 || (schemas.length === 1 && !/^[a-z_][a-z0-9_]*$/.test(schemas[0]))) {
    throw new Error(`${label} contains an invalid schema`);
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
  const app = assertLocalDatabaseUrl(env.DATABASE_URL);
  const direct = assertLocalDatabaseUrl(env.DIRECT_URL, 'DIRECT_URL');
  const target = (url) => [
    url.hostname,
    url.port || '5432',
    url.pathname,
    url.searchParams.get('schema') || 'public',
  ].join('|');
  if (target(app) !== target(direct)) {
    throw new Error('DATABASE_URL and DIRECT_URL must target the same local database and schema');
  }
}
