const test=require('node:test')
const assert=require('node:assert/strict')
const loadApp=require('./load-app.cjs')
const origin='https://amountly.app'
const load=loadApp({
  '@/lib/platform/auth':{getAuth:()=>({$context:Promise.resolve({secret:'synthetic-only'})}),authPool:()=>({query:async()=>({rows:[]})})},
  '@/lib/platform/server':{clientForIdentity:()=>{throw new Error('Unexpected data client')}},
  '@/lib/ai/server':{AiHttpError:class AiHttpError extends Error{constructor(status,message){super(message);this.status=status}}},
},{AMOUNTLY_APP_ORIGIN:origin,NEXT_PUBLIC_BACKEND:'render',AMOUNTLY_CHATGPT:'enabled',AMOUNTLY_CHATGPT_DCR:'enabled',NODE_ENV:'production'})
const config=load('src/lib/chatgpt/config.ts'), auth=load('src/lib/chatgpt/auth.ts')
test('only explicit document navigation can bypass the cross-site read guard',()=>{
  const server=loadApp({
    '@/lib/platform/auth':{getAuth:()=>({}),authPool:()=>({})},
    '@/lib/ai/server':{AiHttpError:class extends Error{constructor(status,message){super(message);this.status=status}}},
  },{AMOUNTLY_APP_ORIGIN:origin,NEXT_PUBLIC_BACKEND:'render',NODE_ENV:'production'})('src/lib/platform/server.ts')
  const navigation=new Headers({'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'})
  assert.doesNotThrow(()=>server.validateOrigin(navigation,false,true))
  assert.throws(()=>server.validateOrigin(navigation))
  assert.throws(()=>server.validateOrigin(navigation,true,true))
  for(const change of [{'Sec-Fetch-Mode':'cors'},{'Sec-Fetch-Dest':'empty'},{Origin:'https://evil.example'}]) {
    const headers=new Headers(navigation);for(const [name,value] of Object.entries(change))headers.set(name,value)
    assert.throws(()=>server.validateOrigin(headers,false,true))
  }
})
const client='amt_dcr_'+'a'.repeat(43), user='00000000-0000-4000-8000-000000000001'
test('only opaque DCR client ID shapes are admitted; client document URLs are rejected',()=>{
  assert.equal(config.allowedOAuthClientId(client),true)
  for(const id of ['https://chatgpt.com/oauth/client.json','https://chatgpt.com/oauth/codex/client.json',
    'https://chatgpt.com/oauth/qa-123/client.json','http://127.0.0.1/client.json','file:///etc/passwd','amt_dcr_short'])
    assert.equal(config.allowedOAuthClientId(id),false,id)
  for(const uri of ['https://chatgpt.com/connector_platform_oauth_redirect','https://chatgpt.com/connector_platform_oauth_redirect/qa123'])
    assert.equal(config.allowedClientCallback(client,uri),true)
  for(const uri of ['https://evil.example/callback','https://chatgpt.com/connector_platform_oauth_redirect?next=https://evil.example','https://chatgpt.com:8443/connector_platform_oauth_redirect'])
    assert.equal(config.allowedCallback(uri),false)
})
test('native DCR callbacks retain canonical loopback host and bounded path checks',()=>{
  for(const uri of ['http://127.0.0.1/callback','http://127.0.0.1:64903/callback','http://localhost:4321/callback','http://127.0.0.1:4321/callback/synthetic-id'])
    assert.equal(config.allowedClientCallback(client,uri),true,uri)
  for(const uri of ['http://127.0.0.1:0/callback','http://127.0.0.1:65536/callback','http://127.1:4321/callback','http://2130706433:4321/callback','http://localhost.evil.example:4321/callback','http://127.0.0.1.evil.example/callback','http://localhost./callback','http://[::1]:4321/callback','https://127.0.0.1/callback','http://127.0.0.1:4321/admin','http://127.0.0.1:4321/path/../callback','http://user@127.0.0.1:4321/callback','http://127.0.0.1:4321/callback?','http://127.0.0.1:4321/callback#'])
    assert.equal(config.allowedCallback(uri),false,uri)
  assert.equal(config.allowedClientCallback('https://chatgpt.com/oauth/codex/client.json','http://127.0.0.1:4321/callback'),false)
})
test('native redirects still require the provider registered-metadata match',async()=>{
  const options=load('src/lib/chatgpt/oauth.ts').oauthOptions()
  assert.equal(await options.validateRedirectUri('http://127.0.0.1:4321/callback',['http://127.0.0.1/callback'],true),true)
  assert.equal(await options.validateRedirectUri('http://127.0.0.1:4321/callback',['http://127.0.0.1/other'],false),false)
  assert.equal(await options.validateRedirectUri('http://evil.example/callback',['http://evil.example/callback'],true),false)
})
test('browser return navigation is bound to the original callback, state and issuer',()=>{
  const redirect=load('src/lib/chatgpt/redirect.ts')
  for(const [clientId,callback] of [[client,'http://127.0.0.1:4321/callback'],[client,'https://chatgpt.com/connector_platform_oauth_redirect']]) {
    const query=new URLSearchParams({client_id:clientId,redirect_uri:callback,state:'synthetic-state'}).toString()
    const target=new URL(callback);target.search=new URLSearchParams({code:'synthetic-code',state:'synthetic-state',iss:origin+'/api/auth'}).toString()
    assert.equal(redirect.allowedConnectionRedirect(target.href,query,origin),true)
    const cancelled=new URL(target);cancelled.searchParams.delete('code');cancelled.searchParams.set('error','access_denied')
    assert.equal(redirect.allowedConnectionRedirect(cancelled.href,query,origin),true)
    for(const change of [url=>url.port='4322',url=>url.pathname='/callback/other',url=>url.hostname='evil.example',url=>url.username='user',url=>url.hash='fragment',url=>url.searchParams.set('state','wrong'),url=>url.searchParams.append('state','synthetic-state'),url=>url.searchParams.set('iss','https://evil.example')]) {
      const changed=new URL(target);change(changed)
      assert.equal(redirect.allowedConnectionRedirect(changed.href,query,origin),false,changed.href)
    }
    assert.equal(redirect.allowedConnectionRedirect('/chatgpt/consent?synthetic=true',query,origin),true)
  }
})
const good={active:true,iss:origin+'/api/auth',aud:origin+'/mcp',sub:user,client_id:client,exp:2000,scope:'amountly:read',token_type:'Bearer',sid:'synthetic-session'}
test('bearer claims enforce issuer, audience, expiry, user identity, scope and bearer type',()=>{
  assert.equal(auth.validateClaims(good,client,1000).sub,user)
  for(const change of [{active:false},{iss:'https://evil.example'},{aud:'https://amountly.app/admin'},{sub:'not-a-user'},{client_id:'https://evil.example'},{exp:1000},{token_type:'DPoP'},{sid:''},{cnf:{jkt:'synthetic'}}]) assert.throws(()=>auth.validateClaims({...good,...change},client,1000),error=>error.status===401)
  assert.throws(()=>auth.validateClaims({...good,scope:'email'},client,1000),error=>error.status===403)
})
test('missing or malformed bearer tokens fail before querying financial data',async()=>{
  for(const value of ['', 'Basic synthetic', 'Bearer random', 'Bearer amt_at_123@']) {
    const request=new Request(origin+'/mcp',{headers:{Authorization:value}})
    await assert.rejects(auth.requireMcpIdentity(request),error=>error.status===401)
  }
})
test('authentication errors are private, minimal and include a metadata challenge',async()=>{
  const error=new Error('private database password and stack')
  const response=auth.mcpAuthError(error)
  assert.equal(response.status,503); assert.equal(response.headers.get('Cache-Control'),'private, no-store')
  assert.deepEqual(await response.json(),{error:'Amountly is temporarily unavailable.'})
  // Use the configured error type through the public missing-bearer path.
  try { await auth.requireMcpIdentity(new Request(origin+'/mcp')) } catch(error) {
    assert.match(auth.mcpAuthError(error).headers.get('WWW-Authenticate'),/scope="amountly:read offline_access"/)
  }
})
test('authorization rejects unexpected identity, scopes, resources, PKCE modes and duplicate values',()=>{
  const query=load('src/lib/chatgpt/query.ts')
  const fields={client_id:client,redirect_uri:'https://chatgpt.com/connector_platform_oauth_redirect',response_type:'code',scope:'amountly:read offline_access',state:'synthetic-state',resource:origin+'/mcp',code_challenge_method:'S256',code_challenge:'a'.repeat(43)}
  assert.doesNotThrow(()=>query.validateAuthorization(new URLSearchParams(fields)))
  assert.doesNotThrow(()=>query.validateAuthorization(new URLSearchParams({...fields,redirect_uri:'http://127.0.0.1:64903/callback'})))
  assert.throws(()=>query.validateAuthorization(new URLSearchParams({...fields,client_id:'https://chatgpt.com/oauth/client.json'})))
  // OpenAI's dashboard relay state includes its return route and exceeds the
  // short state values generated by ordinary OAuth clients.
  assert.doesNotThrow(()=>query.validateAuthorization(new URLSearchParams({...fields,state:'openai_platform_oauth_relay__'+'a'.repeat(1000)})))
  assert.throws(()=>query.validateAuthorization(new URLSearchParams({...fields,state:'a'.repeat(2049)})))
  for(const change of [{resource:origin+'/admin'},{code_challenge_method:'plain'},{code_challenge:'small'},{scope:'amountly:write'},{state:''},{client_id:'https://127.0.0.1/client.json'}]) assert.throws(()=>query.validateAuthorization(new URLSearchParams({...fields,...change})))
  const duplicate=new URLSearchParams(fields);duplicate.append('client_id',client)
  assert.throws(()=>query.validateAuthorization(duplicate))
  assert.throws(()=>query.signedSearchParams({client_id:[client,client]}))
  assert.equal(new URLSearchParams(query.signedSearchParams({ba_param:['scope','state']})).getAll('ba_param').length,2)
})
