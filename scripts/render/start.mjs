import { spawn } from 'node:child_process'

for (const name of ['AUTH_DATABASE_URL', 'DATA_DATABASE_URL', 'POSTGREST_JWT_SECRET', 'BETTER_AUTH_SECRET', 'AMOUNTLY_APP_ORIGIN']) {
  if (!process.env[name]) { console.error(`Required configuration is missing: ${name}`); process.exit(1) }
}
const env = { ...process.env }
const data = spawn('postgrest', [], { stdio: ['ignore', 'ignore', 'ignore'], env: {
  PATH: env.PATH, PGRST_DB_URI: env.DATA_DATABASE_URL, PGRST_DB_SCHEMAS: 'public',
  PGRST_JWT_SECRET: env.POSTGREST_JWT_SECRET, PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: '3001',
  PGRST_ADMIN_SERVER_HOST: '127.0.0.1', PGRST_ADMIN_SERVER_PORT: '3002',
  PGRST_DB_POOL: '4', PGRST_DB_MAX_ROWS: '500', PGRST_DB_EXTRA_SEARCH_PATH: 'extensions',
  PGRST_OPENAPI_MODE: 'disabled', PGRST_LOG_LEVEL: 'crit', PGRST_DB_CONFIG: 'false',
} })
const web = spawn(process.execPath, ['server.js'], { stdio: 'inherit', env: { ...env, HOSTNAME: '0.0.0.0', PORT: env.PORT || '10000' } })
let stopping = false
function stop(code) {
  if (stopping) return
  stopping = true; data.kill('SIGTERM'); web.kill('SIGTERM')
  setTimeout(() => process.exit(code), 5000).unref()
}
data.on('error', () => { console.error('Database API could not start'); stop(1) })
web.on('error', () => { console.error('Web server could not start'); stop(1) })
data.on('exit', () => { if (!stopping) console.error('Database API stopped'); stop(1) })
web.on('exit', code => stop(code || 1))
process.on('SIGTERM', () => stop(0))
process.on('SIGINT', () => stop(0))
