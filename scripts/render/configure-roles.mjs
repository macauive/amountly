import pg from 'pg'
import { randomBytes } from 'node:crypto'
import { open, stat, realpath } from 'node:fs/promises'
import path from 'node:path'

// One-time migration operator command. Generates isolated runtime credentials;
// the owner connection is never copied into the deployment environment file.
async function main() {
  const destination = process.env.RUNTIME_ENV_FILE
  if (!destination || !path.isAbsolute(destination) || destination.startsWith(process.cwd() + path.sep)) throw new Error('Choose protected storage outside the repository')
  const parentPath = await realpath(path.dirname(destination))
  if (parentPath === process.cwd() || parentPath.startsWith(process.cwd() + path.sep)) throw new Error('Choose protected storage outside the repository')
  const parent = await stat(parentPath)
  if ((parent.mode & 0o077) !== 0) throw new Error('Destination directory must be owner-only')
  const config = {}, credentials = []
  for (const [role, key] of [['amountly_auth_runtime','AUTH_DATABASE_URL'], ['amountly_data_runtime','DATA_DATABASE_URL']]) {
    const password = randomBytes(32).toString('hex')
    const url = new URL(process.env.AUTH_DATABASE_URL)
    url.username = role; url.password = password
    config[key] = url.href
    credentials.push({ role, password })
  }
  for (const name of ['BETTER_AUTH_SECRET','POSTGREST_JWT_SECRET','AMOUNTLY_APP_ORIGIN','NEXT_PUBLIC_BACKEND']) {
    if (!process.env[name] || /[\r\n]/.test(process.env[name])) throw new Error('Missing or invalid application configuration')
    config[name] = process.env[name]
  }
  // Persist recoverable credentials before changing any role. An existing file
  // fails closed, without rotating working passwords or overwriting secrets.
  const output = await open(destination, 'wx', 0o600)
  try {
    await output.writeFile(Object.entries(config).map(([name,value])=>`${name}=${value}`).join('\n')+'\n')
    await output.sync()
  } finally { await output.close() }
  const connection = new pg.Client({ connectionString: process.env.AUTH_DATABASE_URL })
  await connection.connect()
  try {
    await connection.query('begin')
    for (const { role, password } of credentials) {
      const existing = await connection.query('select rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls from pg_roles where rolname=$1', [role])
      if (existing.rows.length !== 1 || Object.values(existing.rows[0]).some(Boolean)) throw new Error('Runtime role has unexpected privileges')
      // Managed Postgres owners cannot modify superuser-only role attributes,
      // even to false. Verify those attributes and change only login settings.
      const query = await connection.query("select format('alter role %I login noinherit password %L', $1::text, $2::text) as sql", [role, password])
      await connection.query(query.rows[0].sql)
    }
    await connection.query('commit')
    console.log('Least-privilege runtime credentials saved to protected configuration')
  } catch (error) {
    await connection.query('rollback')
    throw error
  } finally { await connection.end() }
}
main().catch(() => { console.error('Runtime credential configuration failed'); process.exitCode = 1 })
