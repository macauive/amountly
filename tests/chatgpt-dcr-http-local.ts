// Disposable PostgreSQL + actual Next.js HTTP rehearsal. No production env is
// loaded, no email transport is configured, and OAuth callbacks are never followed.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { Pool } from 'pg'
import { getMigrations } from 'better-auth/db/migration'
import { emailOTP } from 'better-auth/plugins'
import { hashPassword } from 'better-auth/crypto'
import { oauthProvider } from '@better-auth/oauth-provider'
import { cimd } from '@better-auth/cimd'
import { oauthOptions } from '../src/lib/chatgpt/oauth'
import { allowedClientDocument } from '../src/lib/chatgpt/config'

async function main() {
const exec = promisify(execFile), base = 'http://127.0.0.1:4191'
const callback = 'https://chatgpt.com/connector_platform_oauth_redirect'
const resource = base + '/mcp'
const scratch = await mkdtemp(join(tmpdir(), 'amountly-dcr-local-'))
const secret = () => randomBytes(32).toString('hex')
const dbPassword = secret(), password = secret(), userId = randomUUID()
const email = 'local-dcr-' + randomUUID() + '@example.invalid'
const data = join(scratch, 'postgres'), passwordFile = join(scratch, 'postgres-password')
const dbUrl = new URL('postgresql://127.0.0.1:54399/postgres')
dbUrl.username = userInfo().username; dbUrl.password = dbPassword
const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'development', NEXT_PUBLIC_BACKEND: 'render',
  AMOUNTLY_CHATGPT: 'enabled', AMOUNTLY_CHATGPT_DCR: 'enabled', AMOUNTLY_APP_ORIGIN: base,
  AUTH_DATABASE_URL: dbUrl.href, BETTER_AUTH_SECRET: secret(), POSTGREST_JWT_SECRET: secret(),
  NEXT_TELEMETRY_DISABLED: '1' }
// Explicitly clear any inherited deployment/email secrets. This test uses only
// freshly generated loopback credentials and cannot send signup or reset mail.
for (const key of ['RESEND_API_KEY', 'RESEND_FROM', 'AMOUNTLY_MIGRATION_DATABASE_URL', 'DATABASE_URL',
  'DATA_DATABASE_URL', 'OPENAI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) delete env[key]
Object.assign(process.env, { NODE_ENV: env.NODE_ENV, NEXT_PUBLIC_BACKEND: env.NEXT_PUBLIC_BACKEND,
  AMOUNTLY_CHATGPT: env.AMOUNTLY_CHATGPT, AMOUNTLY_CHATGPT_DCR: env.AMOUNTLY_CHATGPT_DCR, AMOUNTLY_APP_ORIGIN: base })
let pgStarted = false, web: ReturnType<typeof spawn> | undefined, pool: Pool | undefined
let stage = 'initialize', cookie = ''
async function request(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return fetch(base + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) })
}
function authorizeQuery(clientId: string) {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, query: new URLSearchParams({ client_id: clientId, redirect_uri: callback,
    response_type: 'code', resource, scope: 'amountly:read offline_access', state: 'local-' + randomUUID(),
    code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), prompt: 'consent' }) }
}
async function authorize(clientId: string) {
  const grant = authorizeQuery(clientId)
  const first = await request('/api/auth/oauth2/authorize?' + grant.query, undefined, { Accept: 'application/json' })
  assert.equal(first.status, 200)
  const loginUrl = new URL((await first.json()).url, base)
  assert.equal(loginUrl.origin, base); assert.equal(loginUrl.pathname, '/chatgpt/login')
  const login = await request('/api/auth/sign-in/email', { email, password, oauth_query: loginUrl.searchParams.toString() }, { Origin: base })
  assert.equal(login.status, 200)
  cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  assert.ok(cookie)
  const result = await login.json()
  assert.equal(result.token, undefined)
  const consentUrl = new URL(result.url ?? result.redirect_uri, base)
  assert.equal(consentUrl.origin, base); assert.equal(consentUrl.pathname, '/chatgpt/consent')
  const accepted = await request('/api/auth/oauth2/consent', { accept: true, oauth_query: consentUrl.searchParams.toString() }, { Cookie: cookie, Origin: base })
  assert.equal(accepted.status, 200)
  const consent = await accepted.json(), target = new URL(consent.url ?? consent.redirect_uri)
  assert.equal(target.origin + target.pathname, callback)
  assert.equal(target.searchParams.get('state'), grant.query.get('state'))
  assert.equal(target.searchParams.get('iss'), base + '/api/auth')
  assert.ok(target.searchParams.get('code'))
  // Do not navigate to the external callback. All code exchange stays local.
  return { ...grant, code: target.searchParams.get('code')! }
}
async function tokenRequest(values: Record<string, string>) {
  return fetch(base + '/api/auth/oauth2/token', { method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values) })
}
async function tools(token: string) {
  return request('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, {
    Authorization: 'Bearer ' + token, Accept: 'application/json, text/event-stream' })
}
try {
  assert.ok(!(await readdir(process.cwd())).some(name => /^\.env(?:\.|$)/.test(name) && name !== '.env.example'),
    'Run the rehearsal from an isolated checkout without dotenv files')
  await writeFile(passwordFile, dbPassword, { mode: 0o600 })
  stage = 'initialize PostgreSQL'
  await exec('initdb', ['-D', data, '--auth=scram-sha-256', '--pwfile=' + passwordFile, '--no-instructions'], { timeout: 30000 })
  stage = 'start PostgreSQL'
  await exec('pg_ctl', ['-D', data, '-l', join(scratch, 'postgres-start.log'), '-o', '-h 127.0.0.1 -p 54399 -k ' + scratch
    + ' -c log_statement=none -c log_min_error_statement=panic -c log_parameter_max_length=0 -c log_parameter_max_length_on_error=0', '-w', '-t', '10', 'start'], { timeout: 15000 })
  pgStarted = true
  stage = 'create local schema'
  pool = new Pool({ connectionString: dbUrl.href, max: 1 })
  await pool.query('create schema amountly_auth; create table public.users(id uuid primary key, email text, is_active boolean not null default true)')
  await pool.query('set search_path=amountly_auth,pg_catalog')
  const plan = await getMigrations({ database: pool, advanced: { database: { generateId: 'uuid' } },
    user: { additionalFields: { disabled: { type: 'boolean', required: false, defaultValue: false }, bannedUntil: { type: 'date', required: false } } },
    rateLimit: { enabled: true, storage: 'database' }, plugins: [emailOTP({ sendVerificationOTP: async () => { throw new Error('Email disabled in local DCR rehearsal') } }),
      oauthProvider(oauthOptions()), cimd({ isMetadataDocumentUrlAllowed: allowedClientDocument,
        fetchClientMetadataResource: async () => { throw new Error('DCR rehearsal does not fetch remote client documents') } })] })
  const sql = (await plan.compileMigrations()).replace('create table "oauthClientAssertion" ("id" uuid', 'create table "oauthClientAssertion" ("id" text')
  stage = 'apply generated local auth schema'
  await pool.query(sql)
  // Only the runtime controls are needed here, with no production data schema.
  const controls = (await readFile('ops/render/chatgpt-controls.sql', 'utf8')).split('revoke all on all tables')[0]
  await pool.query(controls)
  stage = 'seed synthetic local user'
  await pool.query('insert into amountly_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt",disabled) values($1,\'Local synthetic DCR account\',$2,true,now(),now(),false)', [userId, email])
  await pool.query('insert into amountly_auth.account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") values($1,$2::text,\'credential\',$2::uuid,$3,now(),now())', [randomUUID(), userId, await hashPassword(password)])
  await pool.query('insert into public.users(id,email) values($1,$2)', [userId, email])
  stage = 'start Next.js'
  web = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '4191'], { env, stdio: 'ignore' })
  const started = Date.now()
  while (true) {
    assert.ok(Date.now() - started < 60000, 'local server startup timeout')
    if (web.exitCode !== null) throw new Error('Local Next.js exited')
    try { if ((await request('/.well-known/oauth-authorization-server/api/auth')).status === 200) break } catch { /* Startup only. */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 500))
  }
  stage = 'HTTP discovery and registration'
  const discovery = await (await request('/.well-known/oauth-authorization-server/api/auth')).json()
  assert.equal(discovery.registration_endpoint, base + '/api/auth/oauth2/register')
  const registration = await request('/api/auth/oauth2/register', { client_name: 'ChatGPT', redirect_uris: [callback],
    token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: 'amountly:read offline_access' })
  assert.equal(registration.status, 201)
  const client = await registration.json()
  assert.match(client.client_id, /^amt_dcr_[A-Za-z0-9_-]{43}$/)
  assert.equal(client.client_secret, undefined)
  stage = 'HTTP consent and token exchange'
  const grant = await authorize(client.client_id)
  const issued = await tokenRequest({ client_id: client.client_id, grant_type: 'authorization_code', code: grant.code,
    code_verifier: grant.verifier, redirect_uri: callback, resource })
  assert.equal(issued.status, 200)
  const tokens = await issued.json()
  assert.equal(tokens.expires_in, 600)
  stage = 'HTTP MCP discovery and token lifecycle'
  const listed = await tools(tokens.access_token)
  assert.equal(listed.status, 200)
  assert.equal((await listed.json()).result.tools.length, 5)
  const refreshed = await tokenRequest({ client_id: client.client_id, grant_type: 'refresh_token', refresh_token: tokens.refresh_token, resource })
  assert.equal(refreshed.status, 200)
  const rotated = await refreshed.json()
  assert.ok(rotated.refresh_token !== tokens.refresh_token)
  const revoked = await fetch(base + '/api/auth/oauth2/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client.client_id, token: rotated.refresh_token }) })
  assert.equal(revoked.status, 200)
  assert.equal((await tools(rotated.access_token)).status, 401)
  console.log('PASS: actual Next.js + disposable PostgreSQL: DCR discovery/registration, verified login, signed consent, PKCE exchange, five-tool discovery, refresh and revocation')
  if (process.argv.includes('--browser')) {
    const browser = authorizeQuery(client.client_id)
    const response = await request('/api/auth/oauth2/authorize?' + browser.query, undefined, { Accept: 'application/json' })
    assert.equal(response.status, 200)
    const loginUrl = new URL((await response.json()).url, base)
    assert.equal(loginUrl.origin, base)
    const statePath = join(scratch, 'browser-state.json')
    await writeFile(statePath, JSON.stringify({ loginUrl: loginUrl.href, email, password }), { mode: 0o600 })
    console.log('READY: local browser state at ' + statePath)
    console.log('Type stop to shut down the disposable rehearsal.')
    await new Promise<void>(resolveStop => { process.stdin.once('data', () => resolveStop()); process.once('SIGTERM', () => resolveStop()); process.once('SIGINT', () => resolveStop()) })
  }
} catch (error) {
  const code = (error as { code?: unknown })?.code
  console.error('FAIL: local DCR rehearsal at ' + stage + '; ' + (error instanceof assert.AssertionError ? 'assertion failed' : 'setup or runtime error')
    + (typeof code === 'string' || typeof code === 'number' ? ' (' + code + ')' : ''))
  process.exitCode = 1
} finally {
  process.stdin.pause()
  web?.kill('SIGTERM')
  await pool?.end()
  let stopped = !pgStarted
  if (pgStarted) await exec('pg_ctl', ['-D', data, '-m', 'fast', '-w', '-t', '10', 'stop'], { timeout: 15000 })
    .then(() => { stopped = true }).catch(() => { console.error('Local PostgreSQL cleanup needs attention'); process.exitCode = 1 })
  if (stopped) await rm(scratch, { recursive: true, force: true })
}
}
main().catch(() => { console.error('Local DCR setup could not start'); process.exitCode = 1 })
