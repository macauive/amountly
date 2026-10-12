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
  const store={}, grants=[], fetched=[]
  let auth
  const overrides={
    '@/lib/platform/auth':{getAuth:()=>auth,authPool:()=>({query:async(sql,values)=>{
      if(sql.startsWith('select is_active')) return {rows:[{is_active:true}]}
      assert.match(sql,/insert into amountly_auth.mcp_grants/);grants.push(values);return {rows:[]}
    }})},
    '@/lib/platform/server':{validateOrigin:()=>{},requireIdentity:async()=>{}},
    '@/lib/chatgpt/auth':{privateHeaders:{'Cache-Control':'private, no-store'},rateLimit:async()=>{}},
    '@/lib/ai/server':{AiHttpError:class extends Error{constructor(status,message){super(message);this.status=status}}},
  }
  const load=loadApp(overrides,{AMOUNTLY_APP_ORIGIN:origin,NEXT_PUBLIC_BACKEND:'render',AMOUNTLY_CHATGPT:'enabled',NODE_ENV:'production'})
  const config=load('src/lib/chatgpt/config.ts'), redirect=load('src/lib/chatgpt/redirect.ts')
  const provider=oauthProvider(load('src/lib/chatgpt/oauth.ts').oauthOptions())
  for(const model of Object.keys(getAuthTables({plugins:[provider]}))) store[model]=[]
  auth=betterAuth({baseURL:origin,secret:randomBytes(32).toString('hex'),database:memoryAdapter(store),
    trustedOrigins:[origin],emailAndPassword:{enabled:true},logger:{disabled:true},
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
})
