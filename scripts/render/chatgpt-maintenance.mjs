import pg from 'pg'
export function startChatgptMaintenance() {
  if (process.env.AMOUNTLY_CHATGPT !== 'enabled') return () => {}
  const pool = new pg.Pool({ connectionString: process.env.AUTH_DATABASE_URL, max: 1,
    connectionTimeoutMillis: 10000, options: '-c statement_timeout=10000' })
  let running = false
  async function clean() {
    if (running) return
    running = true
    try {
      await pool.query("delete from amountly_auth.mcp_audit where created_at < now()-interval '30 days'")
      await pool.query("delete from amountly_auth.mcp_rate where window_start < now()-interval '1 day'")
      // Replay tombstones outlive the associated token expiration.
      await pool.query('delete from amountly_auth."oauthAccessToken" where "expiresAt" < now()-interval \'7 days\'')
      await pool.query('delete from amountly_auth."oauthRefreshToken" where "expiresAt" < now()-interval \'7 days\'')
      await pool.query('delete from amountly_auth."oauthClientAssertion" where "expiresAt" < now()-interval \'1 day\'')
      await pool.query("delete from amountly_auth.mcp_grants g where granted_at < now()-interval '14 days' and not exists(select 1 from amountly_auth.\"oauthRefreshToken\" r where r.\"authorizationCodeId\"=g.authorization_code_id) and not exists(select 1 from amountly_auth.\"oauthAccessToken\" a where a.\"authorizationCodeId\"=g.authorization_code_id)")
    } catch { console.error('Integration retention maintenance failed') }
    finally { running = false }
  }
  void clean()
  const timer = setInterval(clean, 60*60*1000); timer.unref()
  return () => { clearInterval(timer); void pool.end() }
}
