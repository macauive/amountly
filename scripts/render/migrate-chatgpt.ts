import { getMigrations } from 'better-auth/db/migration'
import { oauthProvider } from '@better-auth/oauth-provider'
import { cimd } from '@better-auth/cimd'
import { fetchClientMetadataResource } from '@better-auth/cimd/node'
import { allowedClientDocument } from '../../src/lib/chatgpt/config'
import { oauthOptions } from '../../src/lib/chatgpt/oauth'
import { Pool } from 'pg'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

// The migration owner is supplied separately from runtime credentials. The
// reviewed SQL creates private auth tables only; it never alters financial data.
async function main() {
  const connectionString = process.env.AMOUNTLY_MIGRATION_DATABASE_URL
  if (!connectionString || process.env.AMOUNTLY_CHATGPT !== 'enabled') throw new Error('Migration configuration required')
  const owner = new Pool({ connectionString, max: 1, options: '-c search_path=amountly_auth,pg_catalog -c statement_timeout=30000' })
  try {
    if (process.argv.includes('--plan')) {
      // Schema planning must not initialize the running provider: its resource
      // seed runs only after these tables exist.
      const plan = await getMigrations({ database: owner, advanced: { database: { generateId: 'uuid' } }, plugins: [
        oauthProvider(oauthOptions()),
        cimd({ fetchClientMetadataResource, isMetadataDocumentUrlAllowed: allowedClientDocument }),
      ] })
      if (plan.unsafeChanges.length || plan.schemaProblems.length || plan.toBeAdded.length) {
        console.log(JSON.stringify({ unsafe: plan.unsafeChanges, problems: plan.schemaProblems,
          added: plan.toBeAdded.map(row => ({ table: row.table, fields: Object.keys(row.fields) })) }))
        throw new Error('Unexpected migration changes; review required')
      }
      // Assertion replay keys are supplied by the provider as namespace:jti,
      // rather than generated UUIDs. All user/session foreign keys remain UUID.
      const sql = (await plan.compileMigrations()).replace('create table "oauthClientAssertion" ("id" uuid', 'create table "oauthClientAssertion" ("id" text')
      await writeFile('ops/render/chatgpt-auth.sql', '-- Generated from pinned Better Auth 1.7.7 OAuth provider. Apply as the migration owner with search_path=amountly_auth,pg_catalog.\n'+sql+'\n')
      console.log('Private OAuth migration plan saved for review')
    } else if (process.argv.includes('--apply')) {
      const connection = await owner.connect()
      try {
        await connection.query('begin')
        await connection.query("select pg_advisory_xact_lock(hashtext('amountly-chatgpt-migration'))")
        await connection.query('create table if not exists amountly_auth.schema_migrations (name text primary key, digest text not null, applied_at timestamptz not null default now())')
        await connection.query('revoke all on amountly_auth.schema_migrations from public, anon, authenticated, amountly_data_runtime, amountly_auth_runtime')
        const authSql=await readFile('ops/render/chatgpt-auth.sql','utf8')
        const controlsSql=await readFile('ops/render/chatgpt-controls.sql','utf8')
        const digest=createHash('sha256').update(authSql).update(controlsSql).digest('hex')
        const applied=await connection.query("select digest from amountly_auth.schema_migrations where name='chatgpt-1.0.0'")
        if (applied.rowCount && applied.rows[0].digest!==digest) throw new Error('Applied migration differs from reviewed SQL')
        if (!applied.rowCount) {
          await connection.query(authSql)
          await connection.query(controlsSql)
          await connection.query("insert into amountly_auth.schema_migrations(name,digest) values('chatgpt-1.0.0',$1)",[digest])
        }
        await connection.query('revoke all on amountly_auth.schema_migrations from amountly_auth_runtime')
        await connection.query('commit')
        console.log('Reviewed private OAuth migration applied')
      } catch (error) { await connection.query('rollback'); throw error }
      finally { connection.release() }
    } else throw new Error('Choose --plan or --apply')
  } finally { await owner.end() }
}
main().catch(error => { console.error('OAuth migration failed:', error instanceof Error ? error.message : 'Unknown migration error'); process.exitCode=1 })
