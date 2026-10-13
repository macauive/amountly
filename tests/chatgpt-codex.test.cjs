const test=require('node:test')
const assert=require('node:assert/strict')
const {randomBytes,createHash}=require('node:crypto')
const {betterAuth,getAuthTables}=require('better-auth')
const {memoryAdapter}=require('better-auth/adapters/memory')
const {oauthProvider,getOAuthProviderApi}=require('@better-auth/oauth-provider')
const {cimd}=require('@better-auth/cimd')
const loadApp=require('./load-app.cjs')
const origin='https://amountly.example', resource=origin+'/mcp'
const stable='https://chatgpt.com/oauth/codex/client.json'
const scoped='https://chatgpt.com/oauth/codex/synthetic-id/client.json'
const chatgpt='https://chatgpt.com/oauth/client.json'

test('actual OAuth provider resolves Codex metadata, exchanges PKCE codes, records grants and rotates tokens',async()=>{
  const store={}, grants=[], fetched=[], quotas=[], agedGrants=new Set(), counts=new Map()
  let auth
  class BoundaryError extends Error {constructor(status,message){super(message);this.status=status}}
  const overrides={
    '@/lib/platform/auth':{getAuth:()=>auth,authPool:()=>({query:async(sql,values)=>{
      if(sql.startsWith('select is_active')) return {rows:[{is_active:true}]}
      if(sql.includes('select v.value')) {
        const verification=store.verification.find(row=>row.identifier===values[0])
        const grant=grants.find(row=>row[0]===values[0])
        return {rows:verification&&grant?[{value:verification.value,user_id:grant[1]}]:[]}
      }
      if(sql.includes('select t."userId"')) {
        const table=sql.includes('"oauthRefreshToken"')?'oauthRefreshToken':'oauthAccessToken'
        return {rows:store[table].filter(row=>row.token===values[0]&&row.clientId===values[1]&&!row.revoked
          && !(sql.includes('g.granted_at>')&&agedGrants.has(row.authorizationCodeId))).map(row=>({userId:row.userId,sessionId:row.sessionId}))}
      }
      if(sql.includes('select u.id')) return {rows:store.user.filter(row=>row.id===values[0]&&row.emailVerified).map(row=>({id:row.id}))}
      assert.match(sql,/insert into amountly_auth.mcp_grants/);grants.push(values);return {rows:[]}
    }})},
    '@/lib/platform/server':{validateOrigin:()=>{},requireIdentity:async headers=>({id:(await auth.api.getSession({headers})).user.id})},
    '@/lib/chatgpt/auth':{privateHeaders:{'Cache-Control':'private, no-store'},rateLimit:async (key,max)=>{
      quotas.push(key);counts.set(key,(counts.get(key)??0)+1);if(counts.get(key)>max)throw new BoundaryError(429,'Busy')
    }},
    '@/lib/ai/server':{AiHttpError:BoundaryError},
  }
  const load=loadApp(overrides,{AMOUNTLY_APP_ORIGIN:origin,NEXT_PUBLIC_BACKEND:'render',AMOUNTLY_CHATGPT:'enabled',NODE_ENV:'production'})
  const config=load('src/lib/chatgpt/config.ts'), redirect=load('src/lib/chatgpt/redirect.ts')
  const provider=oauthProvider(load('src/lib/chatgpt/oauth.ts').oauthOptions())
  for(const model of Object.keys(getAuthTables({plugins:[provider]}))) store[model]=[]
  auth=betterAuth({baseURL:origin,secret:randomBytes(32).toString('hex'),database:memoryAdapter(store),
    trustedOrigins:[origin],emailAndPassword:{enabled:true},logger:{disabled:true},advanced:{database:{generateId:'uuid'}},
    rateLimit:{enabled:true,storage:'memory',customRules:load('src/lib/chatgpt/admission.ts').oauthRateRules},
    plugins:[provider,cimd({metadataProfile:'mcp-2026-07-28',isMetadataDocumentUrlAllowed:config.allowedClientDocument,
      fetchClientMetadataResource:async input=>{
        const clientId=new Request(input).url;assert.ok([stable,scoped,chatgpt].includes(clientId));fetched.push(clientId)
        // Public Codex metadata shape; discovery and URI matching remain real.
        return Response.json({client_id:clientId,client_uri:'https://chatgpt.com/codex',application_type:'native',
          redirect_uris:clientId===stable?['http://127.0.0.1/callback','http://localhost/callback']:
            clientId===scoped?['http://127.0.0.1/callback/synthetic-id']:['https://chatgpt.com/connector_platform_oauth_redirect'],
          token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],client_name:'Codex'})
      }})]})
  const password=randomBytes(24).toString('hex'), email='synthetic-codex@example.invalid'
  const signup=await auth.api.signUpEmail({body:{name:'Synthetic Codex QA',email,password}})
  await (await auth.$context).internalAdapter.updateUser(signup.user.id,{emailVerified:true})
  const login=await auth.api.signInEmail({body:{email,password},asResponse:true})
  assert.equal(login.status,200)
  const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
  const route=load('src/app/api/auth/oauth2/[action]/route.ts')
  async function call(action,values,method='POST') {
    const query=method==='GET'?'?'+new URLSearchParams(values):''
    const headers=method==='GET'?{Cookie:cookie,Accept:'text/html','Sec-Fetch-Mode':'navigate'}:
      action==='consent'?{Cookie:cookie,Origin:origin,'Content-Type':'application/json'}:{'Content-Type':'application/x-www-form-urlencoded'}
    const body=method==='GET'?undefined:action==='consent'?JSON.stringify(values):new URLSearchParams(values).toString()
    return route[method](new Request(origin+'/api/auth/oauth2/'+action+query,{method,headers,body}),{params:Promise.resolve({action})})
  }
  async function authorize(clientId,callback) {
    const verifier=randomBytes(32).toString('base64url')
    const fields={client_id:clientId,redirect_uri:callback,response_type:'code',resource,scope:'amountly:read offline_access email',
      state:'synthetic-state',code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),prompt:'consent'}
    const response=await call('authorize',fields,'GET');assert.equal(response.status,302)
    const location=new URL(response.headers.get('location'),origin);assert.equal(location.pathname,'/chatgpt/consent')
    const signed=location.searchParams.toString()
    assert.equal(await load('src/lib/chatgpt/query.ts').validateSignedQuery(signed),signed)
    const accepted=await call('consent',{accept:true,oauth_query:signed});assert.equal(accepted.status,200)
    const result=await accepted.json(), target=new URL(result.url??result.redirect_uri)
    assert.equal(redirect.allowedConnectionRedirect(target.href,signed,origin),true)
    assert.equal(target.origin+target.pathname,callback)
    return {code:target.searchParams.get('code'),verifier,clientId,callback}
  }
  const tokenValues=grant=>({client_id:grant.clientId,grant_type:'authorization_code',code:grant.code,code_verifier:grant.verifier,redirect_uri:grant.callback,resource})
  // Exercise the real provider's enabled limiter with no trusted peer IP. A
  // stream of unknown refresh capabilities must not block a later valid one.
  for(let i=0;i<125;i++) {
    const denied=await call('token',{client_id:stable,grant_type:'refresh_token',refresh_token:'amt_rt_'+randomBytes(32).toString('base64url'),resource})
    assert.ok([400,401].includes(denied.status),'unknown refresh returns an auth error, never a shared quota')
  }
  for(const [clientId,callback] of [[stable,'http://127.0.0.1:64903/callback'],[stable,'http://localhost:5421/callback'],[scoped,'http://127.0.0.1:4321/callback/synthetic-id'],[chatgpt,'https://chatgpt.com/connector_platform_oauth_redirect']]) {
    const grant=await authorize(clientId,callback)
    assert.ok(grants.some(values=>values[0]===createHash('sha256').update(grant.code).digest('hex')),'native code has an MCP grant')
    assert.ok([400,401].includes((await call('token',{...tokenValues(grant),code_verifier:randomBytes(32).toString('base64url')})).status))
    const mismatch=await authorize(clientId,callback)
    const changed=new URL(callback);changed.port='5432'
    assert.ok([400,401].includes((await call('token',{...tokenValues(mismatch),redirect_uri:changed.href})).status),'exchange callback remains bound including port')
    const fresh=await authorize(clientId,callback)
    const issued=await call('token',tokenValues(fresh));assert.equal(issued.status,200)
    const tokens=await issued.json();assert.ok(tokens.access_token);assert.ok(tokens.refresh_token)
    const providerApi=getOAuthProviderApi({context:await auth.$context},provider.options)
    const claims=await providerApi.requireActiveAccessToken(tokens.access_token,clientId)
    assert.equal(claims.sub,signup.user.id)
    const refreshed=await call('token',{client_id:clientId,grant_type:'refresh_token',refresh_token:tokens.refresh_token,resource})
    assert.equal(refreshed.status,200);assert.notEqual((await refreshed.json()).refresh_token,tokens.refresh_token)
    assert.ok([400,401].includes((await call('token',tokenValues(fresh))).status),'code replay rejected')
  }
  assert.ok(fetched.includes(stable));assert.ok(fetched.includes(scoped));assert.ok(fetched.includes(chatgpt))
  assert.ok(quotas.includes('oauth:token:user:'+signup.user.id),'real bound code/refresh credentials debit their owner')
  assert.ok(quotas.every(key=>key.endsWith(signup.user.id)),'no anonymous/global durable quota')

  const grant=await authorize(stable,'http://127.0.0.1:64903/callback')
  let tokens=await (await call('token',tokenValues(grant))).json()
  agedGrants.add(createHash('sha256').update(grant.code).digest('hex'))
  counts.set('oauth:token:user:'+signup.user.id,0)
  for(let i=0;i<120;i++) {
    const response=await call('token',{client_id:stable,grant_type:'refresh_token',refresh_token:tokens.refresh_token,resource})
    assert.equal(response.status,200,'still-valid provider refresh stays usable after MCP grant ages out')
    tokens=await response.json()
  }
  assert.equal((await call('token',{client_id:stable,grant_type:'refresh_token',refresh_token:tokens.refresh_token,resource})).status,429,'rotating old grant still debits its owner')
  counts.set('oauth:revoke:user:'+signup.user.id,120)
  for(const token of [tokens.refresh_token,'  '+tokens.refresh_token+'  ','bEaReR '+tokens.refresh_token,'DPoP '+tokens.refresh_token]) {
    assert.equal((await call('revoke',{client_id:stable,token})).status,429,'provider-equivalent token syntax cannot bypass quota')
  }
  counts.set('oauth:revoke:user:'+signup.user.id,0)
  assert.equal((await call('revoke',{client_id:stable,token:'bEaReR '+tokens.refresh_token})).status,200,'legitimate revoke still works')
})
