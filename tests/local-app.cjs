// Build/start a production-mode app against the isolated local Supabase stack.
// Public variables are embedded at build time; override them for BOTH commands.
const { execFileSync, spawn } = require('node:child_process')
const mode = process.argv[2]
if (!['build','start','dev'].includes(mode)) throw Error('Use build, start or dev')
const s = JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}))
if (s.API_URL !== 'http://127.0.0.1:54321') throw Error('Refusing non-local Supabase')
const child = spawn('npm',['run',mode,...(mode==='build'?[]:['--','--hostname','127.0.0.1','--port','4174'])],{
  stdio:'inherit',env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:s.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:s.ANON_KEY,OPENAI_API_KEY:''},
})
child.on('exit',code=>{process.exitCode=code ?? 1})
