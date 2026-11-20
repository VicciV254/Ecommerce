import { Prisma } from '@prisma/client';
import prisma from './database.js';
import { approvedDatabaseHosts, assertApprovedDevelopmentDatabaseUrl } from './databaseSafety.js';

const DEVELOPMENT_DATABASE = 'apex_development';

/**
 * Outside production on the hosting platform (`VERCEL_ENV` preview or development), and wherever a development
 * database is approved, the API serves only from that database through its restricted runtime role. Returns what
 * the session must be, or null where the rule does not apply: production, local runs and tests.
 */
export function deploymentDatabaseRule(env = process.env) {
  if (env.VERCEL_ENV === 'production') return null;
  if (!env.VERCEL_ENV && !env.APPROVED_DATABASE_HOSTS && !env.APPROVED_DATABASE_ROLE) return null;
  if (!approvedDatabaseHosts(env).length || !env.APPROVED_DATABASE_ROLE?.trim()) {
    throw new Error('APPROVED_DATABASE_HOSTS and APPROVED_DATABASE_ROLE must be set outside production');
  }
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    assertApprovedDevelopmentDatabaseUrl(env[key], env, key, { pooled: true });
  }
  return { role: env.APPROVED_DATABASE_ROLE.trim(), database: DEVELOPMENT_DATABASE };
}

/** What the connected session may do. A runtime role reads and writes rows, belongs to no other role, and nothing more. */
const SESSION_CHECK = Prisma.sql`
  SELECT current_user::text AS "user",
         current_database()::text AS "database",
         (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls) AS "elevated",
         (has_database_privilege(current_database(), 'CREATE') OR has_schema_privilege('public', 'CREATE')) AS "creates",
         EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid) AS "belongsToRoles",
         EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relowner = r.oid) AS "ownsTables"
  FROM pg_roles r
  WHERE r.rolname = current_user`;

/** Rejects unless the session runs as `role` on `database` with row access only. */
export async function verifySessionRole(query, { role, database }) {
  const [session] = await query(SESSION_CHECK);
  const problems = !session ? ['its role could not be read'] : [
    session.user !== role && `it connects as ${session.user}, not ${role}`,
    session.database !== database && `it uses the ${session.database} database, not ${database}`,
    session.elevated && 'its role has administrative attributes',
    session.creates && 'its role can create objects',
    // A member gains its roles' powers with SET ROLE even without inheriting them (neon_superuser included).
    session.belongsToRoles && 'its role belongs to other roles',
    session.ownsTables && 'its role owns tables',
  ].filter(Boolean);
  if (problems.length) throw new Error(`Database refused: ${problems.join('; ')}`);
}

const REFUSAL = { error: 'This deployment is not connected to its approved database.', code: 'DEPLOYMENT_DATABASE_REFUSED' };

/**
 * Express middleware placed before every route: where the rule applies, the session is verified once per instance
 * and every request is refused with 503 until it passes. A failed check is retried on the next request.
 */
export function deploymentDatabaseGuard({ env = process.env, query = (sql) => prisma.$queryRaw(sql), log = console } = {}) {
  let verified = null;
  return async (req, res, next) => {
    try {
      const rule = deploymentDatabaseRule(env);
      if (rule) {
        verified ??= verifySessionRole(query, rule)
          .then(() => log.info(`Development database verified: ${rule.role} on ${rule.database}`));
        await verified;
      }
    } catch (error) {
      verified = null;
      log.error(`Deployment database refused: ${error.message}`);
      res.status(503).json(REFUSAL);
      return;
    }
    next();
  };
}
