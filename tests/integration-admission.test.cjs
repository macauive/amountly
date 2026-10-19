const test = require('node:test'), assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const loadApp = require('./load-app.cjs')
const origin = 'https://app.example.invalid', client = 'amt_dcr_' + 'a'.repeat(43)
const owner = '00000000-0000-4000-8000-000000000001', other = '00000000-0000-4000-8000-000000000002'
const sid = '00000000-0000-4000-8000-000000000003'
class BoundaryError extends Error { constructor(status, message) { super(message); this.status = status } }
const env = { AMOUNTLY_APP_ORIGIN: origin, NEXT_PUBLIC_BACKEND: 'render', AMOUNTLY_CHATGPT: 'enabled', AMOUNTLY_CHATGPT_DCR: 'enabled', NODE_ENV: 'production' }

test('anonymous hash quotas and cache churn cannot spend an unrelated credential budget', async () => {
  const { createAdmissionLimiter } = loadApp()('src/lib/chatgpt/admission.ts')
  const admit = createAdmissionLimiter(4, 2)
  for (let i=0;i<120;i++) await admit('invalid', async()=>null)
  await assert.rejects(admit('invalid', async()=>null), error=>error.status===429)
  for(let i=0;i<1030;i++) await admit('random-invalid-'+i, async()=>null)
  assert.equal(await admit('valid-secret-capability', async()=> 'accepted'), 'accepted')
  await assert.rejects(admit('failing',async()=>{throw Error('test failure')}))
  assert.equal(await admit('after-failure',async()=> true), true)
  let finish
  const pending = admit('slow',()=>new Promise(resolve=>{finish=resolve}))
  const second = admit('other-slow',()=>new Promise(resolve=>{setImmediate(resolve)}))
  await assert.rejects(admit('third',async()=>null),error=>error.status===429)
  finish(); await pending; await second
  assert.equal(await admit('third',async()=> true),true,'processing slots recover')
})

function mcpHarness(registeredClient = client) {
  const counts = new Map(), valid = 'amt_at_'+'v'.repeat(32), unknown = 'amt_at_'+'x'.repeat(32)
  const claims = {active:true,iss:origin+'/api/auth',aud:origin+'/mcp',sub:owner,client_id:registeredClient,
    exp:Date.now()/1000+600,scope:'amountly:read',token_type:'Bearer',sid}
  const pool = {query:async(sql,args)=>{
    if(sql.startsWith('insert into amountly_auth.mcp_rate')) {
      counts.set(args[0],(counts.get(args[0])??0)+1);return {rows:[{count:counts.get(args[0])}]}
    }
    if(sql.includes('select a."clientId"')) return {rows:args[0]===createHash('sha256').update(valid.slice(7)).digest('hex')?[{clientId:registeredClient}]:[]}
    if(sql.includes('select u.id, u.email'))return {rows:[{id:owner,email:'synthetic@example.invalid',emailVerified:true,disabled:false,is_active:true}]}
    throw Error('Unexpected query')
  }}
  const load = loadApp({'@/lib/platform/auth':{authPool:()=>pool,getAuth:()=>({api:{validateAmountlyToken:async()=>claims}})},
    '@/lib/platform/server':{clientForIdentity:async identity=>identity},'@/lib/ai/server':{AiHttpError:BoundaryError}},env)
  return {api:load('src/lib/chatgpt/auth.ts'),counts,valid,unknown}
}
test('fabricated MCP bearer floods never debit durable user quota and valid identities remain isolated',async()=>{
  const h=mcpHarness()
  for(let i=0;i<245;i++) await assert.rejects(h.api.requireMcpIdentity(new Request(origin+'/mcp',{
    headers:{authorization:'Bearer '+h.unknown,'x-forwarded-for':'203.0.113.1'},
  })),error=>[401,429].includes(error.status))
  assert.equal(h.counts.size,0)
  const request=()=>new Request(origin+'/mcp',{headers:{authorization:'Bearer '+h.valid,'x-forwarded-for':'203.0.113.1'}})
  assert.equal((await h.api.requireMcpIdentity(request())).id,owner)
  assert.deepEqual([...h.counts.keys()],['mcp:user:'+owner])
  for(let i=1;i<30;i++) await h.api.requireMcpIdentity(request())
  await assert.rejects(h.api.requireMcpIdentity(request()),error=>error.status===429)
})

test('legacy URL registrations cannot retain MCP access after DCR-only cutover', async()=>{
  for (const legacy of ['https://chatgpt.com/oauth/client.json', 'https://chatgpt.com/oauth/codex/client.json']) {
    const h=mcpHarness(legacy)
    await assert.rejects(h.api.requireMcpIdentity(new Request(origin+'/mcp', {
      headers:{authorization:'Bearer '+h.valid},
    })), error=>error.status===401)
    assert.equal(h.counts.size,0)
  }
})

test('OAuth admission owner requires matching PKCE or a real client-bound token, including after session expiry',async()=>{
  const verifier='a'.repeat(43), code='c'.repeat(32), callback='https://chatgpt.com/connector_platform_oauth_redirect'
  const value={type:'authorization_code',userId:owner,sessionId:sid,resource:[origin+'/mcp'],
    query:{client_id:client,redirect_uri:callback,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}}
  let active=true, stored=value, tokenOwner=owner, credentialKnown=true
  const calls=[]
  const load=loadApp({'@/lib/platform/auth':{authPool:()=>({query:async(sql,args)=>{
    calls.push({sql,args})
    if(sql.includes('select v.value'))return {rows:credentialKnown?[{value:JSON.stringify(stored),user_id:owner}]:[]}
    if(sql.includes('select t."userId"'))return {rows:credentialKnown?[{userId:tokenOwner,sessionId:sid}]:[]}
    if(sql.includes('select u.id'))return {rows:active?[{id:args[0]}]:[]}
    throw Error('Unexpected query')
  }})}},env)
  const {oauthRateOwner}=load('src/lib/chatgpt/rate-owner.ts')
  const fields={grant_type:'authorization_code',client_id:client,code,code_verifier:verifier,redirect_uri:callback,resource:origin+'/mcp'}
  assert.equal(await oauthRateOwner('token',new URLSearchParams(fields)),owner)
  for(const patch of [{code_verifier:'b'.repeat(43)},{client_id:client+'/wrong'},{redirect_uri:callback+'/wrong'},{resource:origin+'/wrong'}])
    assert.equal(await oauthRateOwner('token',new URLSearchParams({...fields,...patch})),null)
  stored={...value,userId:other};assert.equal(await oauthRateOwner('token',new URLSearchParams(fields)),null);stored=value
  active=false;assert.equal(await oauthRateOwner('token',new URLSearchParams(fields)),null);active=true
  for(const [action,fields] of [['token',{grant_type:'refresh_token',refresh_token:'amt_rt_'+'r'.repeat(32)}],
    ...['amt_at_'+'t'.repeat(32),'amt_rt_'+'r'.repeat(32),'  amt_rt_'+'r'.repeat(32)+'  ',
      'bEaReR amt_rt_'+'r'.repeat(32),'DPoP amt_at_'+'t'.repeat(32)].map(token=>['revoke',{token}])]) {
    assert.equal(await oauthRateOwner(action,new URLSearchParams({client_id:client,...fields})),owner)
    credentialKnown=false;assert.equal(await oauthRateOwner(action,new URLSearchParams({client_id:client,...fields})),null);credentialKnown=true
  }
  assert.ok(calls.filter(x=>x.sql.includes('select t.')).every(x=>x.sql.includes('t.revoked is null')&&!x.sql.includes('g.granted_at>')&&x.sql.includes('t."clientId"=$2')))
  assert.ok(calls.filter(x=>x.sql.includes('select t.')).every(x=>x.args[0]===createHash('sha256').update(x.sql.includes('"oauthRefreshToken"')?'r'.repeat(32):'t'.repeat(32)).digest('hex')))
  active=false
  assert.equal(await oauthRateOwner('token',new URLSearchParams({client_id:client,grant_type:'refresh_token',refresh_token:'amt_rt_'+'r'.repeat(32)})),owner,'known provider credential still spends owner quota after login ends')
})

function oauthHarness() {
  const counts=new Map(), calls=[]
  let proof=owner, signedIn=false
  const load=loadApp({'@/lib/platform/auth':{getAuth:()=>({handler:async request=>{calls.push(request);return Response.json({access_token:'synthetic-response'})}})},
    '@/lib/platform/server':{validateOrigin:()=>{},requireIdentity:async()=>{if(!signedIn)throw new BoundaryError(401,'Sign in');return {id:owner}}},
    '@/lib/chatgpt/rate-owner':{oauthRateOwner:async()=>proof},'@/lib/chatgpt/grant':{recordIssuedGrant:async()=>{}},
    '@/lib/chatgpt/auth':{privateHeaders:{'Cache-Control':'private, no-store'},rateLimit:async(key,max)=>{counts.set(key,(counts.get(key)??0)+1);if(counts.get(key)>max)throw new BoundaryError(429,'Busy')}},
    '@/lib/ai/server':{AiHttpError:BoundaryError}},env)
  const route=load('src/app/api/auth/oauth2/[action]/route.ts')
  const send=(action,body,headers={})=>route.POST(new Request(origin+'/api/auth/oauth2/'+action,{method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded',...headers},body}),{params:Promise.resolve({action})})
  return {route,send,counts,calls,setProof:id=>{proof=id},signIn:()=>{signedIn=true}}
}
test('malformed OAuth floods leave valid token/refresh/revocation quotas and provider state intact',async()=>{
  const h=oauthHarness()
  for(let i=0;i<125;i++) for(const action of ['token','revoke'])assert.equal((await h.send(action,undefined)).status,400)
  assert.equal(h.counts.size,0);assert.equal(h.calls.length,0)
  const body=new URLSearchParams({client_id:client,grant_type:'refresh_token',refresh_token:'amt_rt_'+'r'.repeat(32)}).toString()
  const valid=await h.send('token',body,{'x-forwarded-for':'203.0.113.1'});assert.equal(valid.status,200)
  assert.equal(valid.headers.get('cache-control'),'private, no-store')
  h.counts.set('oauth:token:user:'+owner,120)
  const blocked=await h.send('token',body);assert.equal(blocked.status,429);assert.equal(blocked.headers.get('retry-after'),'60')
  assert.equal(h.calls.length,1,'quota denial occurs before single-use provider state mutation')
  h.setProof(other);assert.equal((await h.send('token',body)).status,200)
  h.setProof(null);assert.equal((await h.send('revoke',new URLSearchParams({client_id:client,token:'unknown'}).toString())).status,200)
  assert.equal(h.counts.has('oauth:token'),false);assert.equal(h.counts.has('oauth:revoke'),false)
})

test('Better Auth bypasses only OAuth IP-fallback buckets and preserves browser sign-in throttling',()=>{
  let options
  const load=loadApp({'better-auth':{betterAuth:value=>{options=value;return {}}},'pg':{Pool:class{}},
    '@/lib/platform/config':{requiredSecret:()=> 'x'.repeat(40),appOrigin:()=>origin},
    '@/lib/chatgpt/config':{chatgptEnabled:()=>false}},env)
  load('src/lib/platform/auth.ts').getAuth()
  assert.equal(options.rateLimit.enabled,true)
  assert.deepEqual(JSON.parse(JSON.stringify(options.rateLimit.customRules['/sign-in/email'])),{window:60,max:5})
  for(const path of ['authorize','token','revoke','consent'])assert.equal(options.rateLimit.customRules['/oauth2/'+path],false)
})
