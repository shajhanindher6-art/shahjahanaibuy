/**
 * Section 18, item 69 (audit §1 #43) — RLS policies executed
 * against a REAL Postgres, not just grepped as SQL text.
 *
 * WHY: every RLS assertion in the suite greps migration SQL
 * (e.g. `expect(sql).toContain('FOR SELECT TO anon')`). A policy
 * that is syntactically present but semantically wrong passes all
 * of those — exactly what happened with 017's `is_admin()`,
 * which read a `profiles.role` column that does not exist. Only
 * executing the policy against a real database catches that.
 *
 * WHAT RUNS WHERE:
 * - ALWAYS (this sandbox, CI without a DB): the harness checks
 *   below — the migration files exist, the real policy
 *   statements + the real `is_admin()` function can be extracted
 *   from them, and the extraction finds the policies this file
 *   probes. If extraction ever finds nothing, the suite FAILS
 *   loudly instead of silently skipping (a drifted harness must
 *   never look green).
 * - GATED (CI with a database): the `describe.skipIf` suite below
 *   applies the EXTRACTED statements — the verbatim SQL from the
 *   repo's migration files, not re-typed copies — to an ephemeral
 *   database and probes the two policy surfaces that matter most:
 *   admin-only catalog writes (`products` INSERT/UPDATE/DELETE
 *   from 017) and public product reads (`read_products` from 010),
 *   plus the own-row profile read from 001.
 *
 * CI SETUP (add to the workflow that runs vitest — workflows are
 * web-UI only, so this file documents it instead of adding one):
 *   1. Add a Postgres service container, e.g.:
 *        services:
 *          postgres:
 *            image: postgres:16
 *            env:
 *              POSTGRES_USER: postgres
 *              POSTGRES_PASSWORD: test-only-fake-password
 *              POSTGRES_DB: postgres
 *            ports: ['5432:5432']
 *   2. Install the driver (it is NOT a repo dependency — the
 *      harness dynamic-imports it so the suite never fails for
 *      lack of a driver when the suite is skipped):
 *        npm i -D pg
 *   3. Run with the connection string set (points at the service
 *      container above; the harness creates + drops its own
 *      ephemeral database `s18_rls_<random>` on it):
 *        S18_RLS_DATABASE_URL=postgres://postgres:test-only-fake-password@localhost:5432/postgres \
 *          npx vitest run tests/section18-rls-execution.test.ts
 *   Without `S18_RLS_DATABASE_URL` the gated suite SKIPS and the
 *   harness checks still run. The suite NEVER touches a shared or
 *   live database: it only ever creates/drops its own ephemeral
 *   database on the URL it is given, and applies NO migration to
 *   any existing database. The `auth.uid()` stub below exists
 *   because vanilla Postgres has no Supabase `auth` schema — the
 *   stub reads `app.current_uid` (set per probe) so `is_admin()`
 *   resolves exactly as it does against Supabase Auth.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'supabase',
  'migrations'
);
const MIGRATION_001 = '20260710063738_001_core_foundation_tables.sql';
const MIGRATION_010 = '20260712070058_010_security_fix_rls_policies.sql.sql';
const MIGRATION_017 = '20261105190000_017_admin_only_catalog_writes.sql';

function readMigration(name: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
}

/**
 * All `CREATE POLICY ... ;` statements for one table, verbatim
 * from the migration file. Policy statements contain no inner
 * semicolons, so splitting on the first `;` is exact.
 */
function extractPoliciesForTable(sql: string, table: string): string[] {
  const found: string[] = [];
  const re = new RegExp(
    `CREATE POLICY\\s+(?:"[^"]+"|\\S+)\\s+ON\\s+${table}\\s+FOR\\s+(?:SELECT|INSERT|UPDATE|DELETE)[\\s\\S]*?;`,
    'g'
  );
  for (const m of sql.matchAll(re)) found.push(m[0]);
  return found;
}

/** The verbatim `public.is_admin()` definition from 017. */
function extractIsAdmin(sql: string): string | null {
  const m = sql.match(
    /CREATE OR REPLACE FUNCTION public\.is_admin\(\)[\s\S]*?\$\$;/
  );
  return m ? m[0] : null;
}

const RLS_ENABLED = Boolean(process.env.S18_RLS_DATABASE_URL);

describe('Section 18 item 69 — RLS execution harness (always runs)', () => {
  it('the migration files the harness reads exist', () => {
    for (const name of [MIGRATION_001, MIGRATION_010, MIGRATION_017]) {
      expect(fs.existsSync(path.join(MIGRATIONS_DIR, name))).toBe(true);
    }
  });

  it('017 contains the admin-only products write policies, each gated on is_admin()', () => {
    const policies = extractPoliciesForTable(readMigration(MIGRATION_017), 'products');
    const kinds = policies.map((p) =>
      /FOR\s+(SELECT|INSERT|UPDATE|DELETE)/.exec(p)?.[1]
    );
    expect(kinds).toEqual(expect.arrayContaining(['INSERT', 'UPDATE', 'DELETE']));
    for (const p of policies) expect(p).toContain('public.is_admin()');
  });

  it('017 is_admin() resolves via the roles join, not a profiles.role column', () => {
    const fn = extractIsAdmin(readMigration(MIGRATION_017));
    expect(fn).not.toBeNull();
    expect(fn as string).toContain('JOIN public.roles');
    expect(fn as string).toContain("r.name = 'admin'");
    expect(fn as string).not.toContain('profiles.role');
  });

  it('010 contains the public products read policy for anon', () => {
    const policies = extractPoliciesForTable(readMigration(MIGRATION_010), 'products');
    const read = policies.find((p) => /FOR\s+SELECT/.test(p));
    expect(read).toBeDefined();
    expect(read as string).toContain('TO anon');
  });

  it('001 contains the own-row profile read policy', () => {
    const policies = extractPoliciesForTable(readMigration(MIGRATION_001), 'profiles');
    const read = policies.find((p) => /FOR\s+SELECT/.test(p));
    expect(read).toBeDefined();
    expect(read as string).toContain('auth.uid() = id');
  });

  it('documents the skip: without S18_RLS_DATABASE_URL the execution suite skips (never fails for lack of a DB)', () => {
    if (process.env.S18_RLS_DATABASE_URL) {
      expect(RLS_ENABLED).toBe(true);
    } else {
      expect(RLS_ENABLED).toBe(false);
    }
  });
});

type PgClientLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

describe.skipIf(!RLS_ENABLED)(
  'Section 18 item 69 — RLS policies executed against ephemeral Postgres',
  () => {
    let adminClient: PgClientLike | null = null;
    let probeClient: PgClientLike | null = null;
    let dbName = '';
    const adminId = '11111111-1111-4111-8111-111111111111';
    const userId = '22222222-2222-4222-8222-222222222222';

    async function makeClient(
      ClientCtor: new (config: { connectionString: string }) => PgClientLike,
      connectionString: string
    ): Promise<PgClientLike> {
      const c = new ClientCtor({ connectionString });
      await (c as unknown as { connect: () => Promise<void> }).connect();
      return c;
    }

    beforeAll(async () => {
      // The driver is a CI-only dev dependency (see the header):
      // missing here is a loud failure, not a silent skip — a
      // workflow that sets S18_RLS_DATABASE_URL must install it.
      const pg = (await import('pg')) as unknown as {
        Client: new (config: { connectionString: string }) => PgClientLike & {
          connect: () => Promise<void>;
        };
      };
      const baseUrl = process.env.S18_RLS_DATABASE_URL as string;
      dbName = `s18_rls_${Date.now().toString(36)}`;
      const maintenance = await makeClient(pg.Client, baseUrl);
      await maintenance.query(`CREATE DATABASE "${dbName}"`);
      await maintenance.end();

      const dbUrl = baseUrl.replace(/\/[^/?]*(\?|$)/, `/${dbName}$1`);
      adminClient = await makeClient(pg.Client, dbUrl);
      probeClient = await makeClient(pg.Client, dbUrl);

      // Minimal Supabase stand-ins: the `auth` schema + uid stub.
      await adminClient.query(`CREATE SCHEMA IF NOT EXISTS auth`);
      await adminClient.query(
        `CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.current_uid', true), '')::uuid $$`
      );
      await adminClient.query(
        `CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;`
      );
      await adminClient.query(
        `CREATE TABLE roles (id uuid PRIMARY KEY, name text UNIQUE NOT NULL)`
      );
      await adminClient.query(
        `CREATE TABLE profiles (id uuid PRIMARY KEY, email text NOT NULL, role_id uuid REFERENCES roles(id))`
      );
      // 010's read_products policy filters on deleted_at — the
      // minimal table must carry the column or the policy cannot
      // even be created.
      await adminClient.query(
        `CREATE TABLE products (id uuid PRIMARY KEY, name text NOT NULL, slug text UNIQUE NOT NULL, deleted_at timestamptz)`
      );
      for (const t of ['roles', 'profiles', 'products']) {
        await adminClient.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
      }
      await adminClient.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON products TO anon, authenticated`
      );
      await adminClient.query(`GRANT SELECT ON profiles TO authenticated`);
      await adminClient.query(`GRANT SELECT ON roles TO anon, authenticated`);

      // The REAL policy statements + function, extracted verbatim
      // from the repo's migration files (never re-typed).
      const sql017 = readMigration(MIGRATION_017);
      const sql010 = readMigration(MIGRATION_010);
      const sql001 = readMigration(MIGRATION_001);
      const isAdmin = extractIsAdmin(sql017);
      expect(isAdmin).not.toBeNull();
      await adminClient.query(isAdmin as string);
      await adminClient.query(
        `GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated`
      );
      for (const stmt of [
        ...extractPoliciesForTable(sql010, 'products').filter((p) =>
          /FOR\s+SELECT/.test(p)
        ),
        ...extractPoliciesForTable(sql017, 'products'),
        ...extractPoliciesForTable(sql001, 'profiles').filter((p) =>
          /FOR\s+SELECT/.test(p)
        ),
      ]) {
        await adminClient.query(stmt);
      }

      // Seed (as superuser: bypasses RLS, so the seed itself is
      // never blocked by the policies under test).
      const roleUser = '33333333-3333-4333-8333-333333333333';
      const roleAdmin = '44444444-4444-4444-8444-444444444444';
      await adminClient.query(
        `INSERT INTO roles (id, name) VALUES ('${roleUser}', 'user'), ('${roleAdmin}', 'admin')`
      );
      await adminClient.query(
        `INSERT INTO profiles (id, email, role_id) VALUES ('${userId}', 'user@example.test', '${roleUser}'), ('${adminId}', 'admin@example.test', '${roleAdmin}')`
      );
      await adminClient.query(
        `INSERT INTO products (id, name, slug, deleted_at) VALUES ('55555555-5555-4555-8555-555555555555', 'Seed Product', 'seed-product', NULL)`
      );
    }, 60000);

    afterAll(async () => {
      try {
        await probeClient?.end();
        await adminClient?.end();
      } catch {
        // Best-effort cleanup only.
      }
      if (!dbName || !process.env.S18_RLS_DATABASE_URL) return;
      try {
        const pg = (await import('pg')) as unknown as {
          Client: new (config: { connectionString: string }) => PgClientLike & {
            connect: () => Promise<void>;
          };
        };
        const maintenance = await makeClient(
          pg.Client,
          process.env.S18_RLS_DATABASE_URL as string
        );
        await maintenance.query(`DROP DATABASE IF EXISTS "${dbName}"`);
        await maintenance.end();
      } catch {
        // The ephemeral DB is dropped best-effort; a leftover
        // s18_rls_* database is inert test data, never live data.
      }
    });

    /**
     * Run one statement as a Postgres role with a simulated
     * Supabase identity (auth.uid() = `uid`, or unset for anon).
     * SET LOCAL keeps each probe isolated inside its transaction.
     */
    async function asRole(
      role: 'anon' | 'authenticated',
      uid: string | null,
      sql: string
    ): Promise<{ rows: Record<string, unknown>[] }> {
      const client = probeClient as PgClientLike;
      await client.query('BEGIN');
      try {
        await client.query(`SET LOCAL ROLE ${role}`);
        if (uid) await client.query(`SET LOCAL app.current_uid = '${uid}'`);
        const result = await client.query(sql);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      }
    }

    async function expectDenied(
      role: 'anon' | 'authenticated',
      uid: string | null,
      sql: string
    ): Promise<void> {
      let thrown: unknown = null;
      try {
        await asRole(role, uid, sql);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).not.toBeNull();
      expect((thrown as { code?: string }).code).toBe('42501');
    }

    it('anon can read products but cannot insert (admin-only write, 017)', async () => {
      const read = await asRole('anon', null, `SELECT id FROM products`);
      expect(read.rows.length).toBeGreaterThanOrEqual(1);
      await expectDenied(
        'anon',
        null,
        `INSERT INTO products (id, name, slug) VALUES ('66666666-6666-4666-8666-666666666666', 'Anon Product', 'anon-product')`
      );
    });

    it('an authenticated non-admin cannot insert products (is_admin() must be false)', async () => {
      await expectDenied(
        'authenticated',
        userId,
        `INSERT INTO products (id, name, slug) VALUES ('77777777-7777-4777-8777-777777777777', 'User Product', 'user-product')`
      );
    });

    it('an authenticated admin CAN insert products (is_admin() must be true)', async () => {
      const result = await asRole(
        'authenticated',
        adminId,
        `INSERT INTO products (id, name, slug) VALUES ('88888888-8888-4888-8888-888888888888', 'Admin Product', 'admin-product') RETURNING id`
      );
      expect(result.rows).toHaveLength(1);
    });

    it('profiles are own-row only: anon sees none, a user sees only their own row', async () => {
      const anonRead = await asRole('anon', null, `SELECT id FROM profiles`);
      expect(anonRead.rows).toHaveLength(0);
      const ownRead = await asRole(
        'authenticated',
        userId,
        `SELECT id FROM profiles`
      );
      expect(ownRead.rows.map((r) => r.id)).toEqual([userId]);
    });
  }
);
