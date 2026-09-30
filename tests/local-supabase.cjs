// Credentials are read into memory from a local CLI stack, never from .env files.
const { execFileSync } = require('node:child_process')
module.exports = function localSupabase() {
  const args = ['status', '-o', 'json']
  if (process.env.AMOUNTLY_TEST_SUPABASE_WORKDIR) args.push('--workdir', process.env.AMOUNTLY_TEST_SUPABASE_WORKDIR)
  const settings = JSON.parse(execFileSync('supabase', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
  if (!['http://127.0.0.1:54321', 'http://127.0.0.1:55321'].includes(settings.API_URL)) throw Error('Refusing non-local Supabase')
  return settings
}
