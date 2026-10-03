import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { getMigrations } from 'better-auth/db/migration'
import { getAuth, authPool } from '../../src/lib/platform/auth'

// Run only against an isolated target using a protected snapshot as the source.
// The caller supplies connections through environment variables, never arguments.
async function main() {
  if (!process.env.SOURCE_DATABASE_URL || !process.env.AUTH_DATABASE_URL || process.env.MIGRATION_TARGET_CONFIRMED !== 'empty-target') throw new Error('Missing explicit migration target')
  const source = new Pool({ connectionString: process.env.SOURCE_DATABASE_URL, max: 1 })
  const target = authPool()
  try {
    const unsupported = await source.query("select (select count(*) from auth.identities where provider <> 'email')::int as providers, (select count(*) from auth.mfa_factors)::int as mfa")
    if (unsupported.rows[0].providers || unsupported.rows[0].mfa) throw new Error('Unsupported identity types require a reviewed migration')
    const exists = await target.query("select to_regclass('amountly_auth.\"user\"') as table_name")
    if (exists.rows[0].table_name) {
      const current = await target.query('select count(*)::int as n from amountly_auth."user"')
      if (current.rows[0].n) throw new Error('Target already contains auth users')
    }
    const plan = await getMigrations(getAuth().options)
    await plan.runMigrations()
    const current = await target.query('select count(*)::int as n from amountly_auth."user"')
    if (current.rows[0].n) throw new Error('Target already contains auth users')
    const users = await source.query(`select id,email,encrypted_password,email_confirmed_at,raw_user_meta_data,
      created_at,updated_at,deleted_at,banned_until from auth.users order by id`)
    const connection = await target.connect()
    try {
      await connection.query('begin')
      for (const user of users.rows) {
        if (!user.email || !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(user.encrypted_password ?? '')) throw new Error('Unsupported account requires review')
        const name = typeof user.raw_user_meta_data?.name === 'string' ? user.raw_user_meta_data.name.slice(0,120) : 'Amountly user'
        await connection.query(`insert into amountly_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt",disabled,"bannedUntil") values($1,$2,$3,$4,$5,$6,$7,$8)`,
          [user.id,name,user.email.toLowerCase(),Boolean(user.email_confirmed_at),user.created_at,user.updated_at ?? user.created_at,Boolean(user.deleted_at),user.banned_until])
        await connection.query(`insert into amountly_auth.account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") values($1,$2::text,'credential',$2::uuid,$3,$4,$5)`,
          [randomUUID(),user.id,user.encrypted_password,user.created_at,user.updated_at ?? user.created_at])
      }
      await connection.query(await readFile('ops/render/platform.sql','utf8'))
      await connection.query('commit')
    } catch (error) { await connection.query('rollback'); throw error } finally { connection.release() }
    // Password hashes remain private in both databases; compare without printing.
    const imported = await target.query('select "userId", password from amountly_auth.account where "providerId"=\'credential\'')
    const hashes = new Map(imported.rows.map(row => [row.userId, row.password]))
    if (users.rows.some(user => hashes.get(user.id) !== user.encrypted_password)) throw new Error('Credential verification failed')
    console.log(`Imported and verified ${users.rowCount} account IDs and password hashes; no sessions copied`)
  } finally { await source.end(); await target.end() }
}
main().catch(() => { console.error('Auth import failed; target is not ready for cutover'); process.exitCode=1 })
