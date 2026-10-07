import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { Pool, type QueryResult } from 'pg'
import { hash } from 'bcryptjs'
import sharp from 'sharp'
import nodemailer from 'nodemailer'

// Run with node --import tsx tests/receipt-render-local.ts. The parent rehearsal
// supplies private runtime-role URLs and a local PostgREST process on port3001.
// This suite never connects to production or sends documents to a real provider.
const origin = 'http://127.0.0.1:4191'
const providerUrl = 'https://api.openai.com/v1/responses'
const userId = randomUUID()
const foreignId = randomUUID()
const email = `receipt-rehearsal-${userId}@example.invalid`
const password = randomBytes(24).toString('hex')
const originalFetch = globalThis.fetch
const originalTransport = nodemailer.createTransport
let database: Pool | undefined
let closeAuthPool: (() => Promise<void>) | undefined
let fixtureCreated = false
let cookie = ''
let providerCalls = 0
let stage = 'configuration'

function sqlState(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error
    && typeof error.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code)) return error.code
  return 'UNAVAILABLE'
}

function localDatabase(name: string) {
  const value = process.env[name]
  assert.ok(value, `Missing local rehearsal configuration: ${name}`)
  const url = new URL(value)
  assert.ok(['postgresql:', 'postgres:'].includes(url.protocol), 'Only the disposable PostgreSQL rehearsal is allowed')
  assert.equal(url.hostname, '127.0.0.1', 'Deployed databases are forbidden')
  assert.equal(url.port, '54399', 'Only the disposable rehearsal port is allowed')
  assert.equal(url.pathname, '/render_rehearsal', 'Only the disposable rehearsal database is allowed')
  assert.equal(url.search, '', 'Additional connection options are not allowed')
  return url.href
}

function syntheticPdf() {
  const stream = 'BT /F1 12 Tf 72 720 Td (Synthetic receipt Total USD 12.50) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let source = '%PDF-1.7\n'
  const offsets: number[] = []
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source))
    source += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(source)
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  source += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(source)
}

async function main() {
  // Validate every destination before creating any fixture or importing the app.
  const adminUrl = localDatabase('RENDER_TEST_ADMIN_URL')
  localDatabase('AUTH_DATABASE_URL')
  localDatabase('DATA_DATABASE_URL')
  assert.equal(process.env.NEXT_PUBLIC_BACKEND, 'render')
  assert.equal(process.env.NODE_ENV, 'development')
  assert.equal(process.env.AMOUNTLY_APP_ORIGIN, origin)
  assert.ok((process.env.BETTER_AUTH_SECRET?.length ?? 0) >= 32)
  assert.ok((process.env.POSTGREST_JWT_SECRET?.length ?? 0) >= 32)
  // Explicitly replace any inherited provider configuration; no real key is used.
  process.env.OPENAI_API_KEY = 'synthetic-receipt-provider-key'
  process.env.OPENAI_MODEL = 'synthetic-receipt-model'
  process.env.AMOUNTLY_CHATGPT = 'disabled'
  nodemailer.createTransport = (() => { throw new Error('Email transport is forbidden in receipt rehearsal') }) as unknown as typeof nodemailer.createTransport
  database = new Pool({ connectionString: adminUrl, max: 1, connectionTimeoutMillis: 5000 })
  await database.query("set request.jwt.claims = '{\"role\":\"service_role\"}'")

  stage = 'fixture_seed'
  await database.query('insert into amountly_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt",disabled) values($1,$2,$3,true,now(),now(),false)',
    [userId, 'Synthetic receipt rehearsal', email])
  fixtureCreated = true
  await database.query('insert into amountly_auth.account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") values($1,$2::text,\'credential\',$2::uuid,$3,now(),now())',
    [randomUUID(), userId, await hash(password, 10)])
  await database.query("insert into public.users(id,email,name,role,account_type,is_active) values($1,$2,'Synthetic receipt rehearsal','MEMBER','freelancer',true)", [userId, email])

  const { POST: auth } = await import('../src/app/api/auth/[...all]/route')
  const { authPool } = await import('../src/lib/platform/auth')
  closeAuthPool = () => authPool().end()
  const { POST: receipt } = await import('../src/app/api/ai/receipt/route')
  const { ExpenseCategory } = await import('../src/types/enums')
  const result = {
    document_type: 'receipt', amount: '12.50', currency: 'USD', merchant: 'Synthetic Shop',
    description: 'Synthetic paper purchase', expense_date: '2026-10-07', category: ExpenseCategory.other,
    confidence: 'high', reason: 'Synthetic extraction fixture.', summary: 'Review this synthetic draft.',
  }
  const providerInputs: Array<{ type: string; filename?: string; file_data?: string; image_url?: string }> = []
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (url.href === providerUrl) {
      providerCalls++
      assert.equal(init?.method, 'POST')
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-receipt-provider-key')
      const payload = JSON.parse(String(init?.body))
      assert.equal(payload.model, 'synthetic-receipt-model')
      assert.equal(payload.store, false)
      assert.equal(payload.max_output_tokens, 2000)
      assert.equal(payload.tools, undefined)
      const fileParts = payload.input.flatMap((item: { content: Array<{ type: string }> }) => item.content)
        .filter((part: { type: string }) => part.type === 'input_image' || part.type === 'input_file')
      assert.equal(fileParts.length, 1)
      providerInputs.push(fileParts[0])
      return Response.json({ status: 'completed', output: [
        { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] },
      ] })
    }
    // Delegate actual signed PostgREST traffic, while forbidding all other hosts.
    assert.equal(url.origin, 'http://127.0.0.1:3001', 'Unexpected outbound request is forbidden')
    return originalFetch(input, init)
  }

  async function authCall(path: string, body: object) {
    return auth(new Request(`${origin}/api/auth/${path}`, {
      method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ all: path.split('/') }) })
  }
  async function quota() {
    const rows = await database!.query('select day_count from public.ai_usage where user_id=$1', [userId])
    return rows.rows[0]?.day_count ?? 0
  }
  async function noFinancialWrites() {
    for (const table of ['expenses', 'invoices', 'bills', 'vendor_bills']) {
      // Table names are a fixed test allowlist, never request-derived input.
      const rows = await database!.query(`select count(*)::int as count from public.${table} where user_id=$1`, [userId])
      assert.equal(rows.rows[0].count, 0, 'Extraction must not create financial records')
    }
    const stored = await database!.query('select count(*)::int as count from amountly_files.receipts where owner_id=$1', [userId])
    assert.equal(stored.rows[0].count, 0, 'Extraction must not store receipt bytes')
  }
  const image = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#ffffff' } }).png().toBuffer()
  const pdf = syntheticPdf()
  function input(body: Buffer = image, type = 'image/png', headers: Record<string, string | null> = {}, query = '') {
    const requestHeaders = new Headers({ Origin: origin, Cookie: cookie, 'Content-Type': type })
    for (const [name, value] of Object.entries(headers)) {
      if (value === null) requestHeaders.delete(name)
      else requestHeaders.set(name, value)
    }
    return new Request(`${origin}/api/ai/receipt${query}`, { method: 'POST', headers: requestHeaders, body: new Uint8Array(body) })
  }
  async function denied(request: Request, status: number) {
    const used = await quota(), calls = providerCalls
    const response = await receipt(request)
    assert.equal(response.status, status)
    assert.match(response.headers.get('cache-control') ?? '', /no-store/)
    assert.equal(await quota(), used, 'Denied requests must not consume quota')
    assert.equal(providerCalls, calls, 'Denied requests must not invoke the provider')
    await noFinancialWrites()
  }

  stage = 'anonymous_denial'
  await noFinancialWrites()
  await denied(input(), 401)
  stage = 'cookie_sign_in'
  const login = await authCall('sign-in/email', { email, password })
  assert.equal(login.status, 200, 'The synthetic verified account must sign in through Better Auth')
  const setCookies = login.headers.getSetCookie()
  assert.ok(setCookies.some(value => value.includes('HttpOnly')))
  assert.ok(setCookies.some(value => value.includes('SameSite=Lax')))
  cookie = setCookies.map(value => value.split(';')[0]).join('; ')
  assert.ok(cookie)
  assert.equal((await login.json()).token, undefined)
  stage = 'origin_denials'
  await denied(input(undefined, undefined, { Origin: null }), 403)
  await denied(input(undefined, undefined, { Origin: 'https://evil.example.invalid' }), 403)
  await denied(input(undefined, undefined, { 'Sec-Fetch-Site': 'cross-site' }), 403)
  stage = 'ownership_input_denials'
  await denied(input(undefined, undefined, {}, `?user_id=${foreignId}`), 400)
  await denied(input(undefined, undefined, {}, '?path=private-receipt.pdf'), 400)

  for (const [body, type] of [[image, 'image/png'], [pdf, 'application/pdf']] as const) {
    stage = type === 'image/png' ? 'image_extraction' : 'pdf_extraction'
    const used = await quota(), calls = providerCalls
    const response = await receipt(input(body, type, { 'x-user-id': foreignId }))
    assert.equal(response.status, 200, 'Real Render sessions and quota must allow a validated synthetic receipt')
    assert.deepEqual(await response.json(), { result })
    assert.equal(await quota(), used + 1, 'Each extraction consumes exactly one durable quota request')
    assert.equal(providerCalls, calls + 1)
    const foreignQuota: QueryResult<{ count: number }> = await database.query('select count(*)::int as count from public.ai_usage where user_id=$1', [foreignId])
    assert.equal(foreignQuota.rows[0].count, 0, 'Caller headers cannot choose quota ownership')
    await noFinancialWrites()
  }
  stage = 'provider_payload_assertions'
  assert.equal(providerInputs[0].type, 'input_image')
  assert.match(providerInputs[0].image_url ?? '', /^data:image\/jpeg;base64,/)
  assert.equal(providerInputs[1].type, 'input_file')
  assert.equal(providerInputs[1].filename, 'receipt.pdf')
  assert.equal(providerInputs[1].file_data, `data:application/pdf;base64,${pdf.toString('base64')}`)

  stage = 'quota_exhaustion'
  await database.query("update public.ai_usage set minute_start=date_trunc('minute',clock_timestamp(),'UTC'),minute_count=10,day_start=date_trunc('day',clock_timestamp(),'UTC'),day_count=100 where user_id=$1", [userId])
  await denied(input(), 429)
  await database.query("update public.ai_usage set minute_start=date_trunc('minute',clock_timestamp(),'UTC'),minute_count=2,day_start=date_trunc('day',clock_timestamp(),'UTC'),day_count=2 where user_id=$1", [userId])
  stage = 'profile_disablement'
  await database.query('update public.users set is_active=false where id=$1', [userId])
  await denied(input(), 403)
  await database.query('update public.users set is_active=true where id=$1', [userId])
  stage = 'auth_disablement'
  await database.query('update amountly_auth."user" set disabled=true where id=$1', [userId])
  await denied(input(), 401)
  await database.query('update amountly_auth."user" set disabled=false where id=$1', [userId])
  stage = 'session_revocation'
  assert.equal((await authCall('sign-out', {})).status, 200)
  await denied(input(), 401)
  assert.equal(providerCalls, 2)
  console.log('PASS: real Render cookie sessions, signed PostgREST quota, validated image/PDF, quota exhaustion, CSRF, ownership-input denial, disablement, revocation and zero financial/storage writes; no real provider or email calls')
}

main().catch(error => {
  // Never print request bodies, passwords, cookies, connection strings or errors.
  console.error(`Receipt Render rehearsal failed (${stage}; SQLSTATE ${sqlState(error)}).`)
  process.exitCode = 1
}).finally(async () => {
  globalThis.fetch = originalFetch
  nodemailer.createTransport = originalTransport
  if (database && fixtureCreated) {
    for (const [label, sql, values] of [
      ['quota', 'delete from public.ai_usage where user_id=$1', [userId]],
      ['auth_user', 'delete from amountly_auth."user" where id=$1', [userId]],
      ['membership', 'delete from public.workspace_memberships where user_id=$1', [userId]],
      ['profile', 'delete from public.users where id=$1', [userId]],
      ['workspace', "delete from public.workspaces where id=$1 and owner_id=$1 and kind='individual' and organization_id is null", [userId]],
      ['auth_anchor', 'delete from auth.users where id=$1', [userId]],
    ] as const) {
      try { await database.query(sql, [...values]) } catch (error) {
        console.error(`Synthetic receipt rehearsal cleanup failed (${label}; SQLSTATE ${sqlState(error)}).`)
        process.exitCode = 1
      }
    }
  }
  await closeAuthPool?.()
  await database?.end()
})
