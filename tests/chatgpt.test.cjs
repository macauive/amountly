const test=require('node:test')
const assert=require('node:assert/strict')
const loadApp=require('./load-app.cjs')
const origin='https://amountly.app'
const load=loadApp({
  '@/lib/platform/auth':{getAuth:()=>({$context:Promise.resolve({secret:'synthetic-only'})}),authPool:()=>({query:async()=>({rows:[]})})},
  '@/lib/platform/server':{clientForIdentity:()=>{throw new Error('Unexpected data client')}},
  '@/lib/ai/server':{AiHttpError:class AiHttpError extends Error{constructor(status,message){super(message);this.status=status}}},
},{AMOUNTLY_APP_ORIGIN:origin,NEXT_PUBLIC_BACKEND:'render',AMOUNTLY_CHATGPT:'enabled',NODE_ENV:'production'})
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
test('only exact HTTPS ChatGPT client documents and registered callback shapes are allowed',()=>{
  for(const uri of ['https://chatgpt.com/oauth/client.json','https://chatgpt.com/oauth/qa-123/client.json']) assert.equal(config.allowedClientDocument(uri),true)
  for(const uri of ['http://chatgpt.com/oauth/client.json','https://chatgpt.com.evil.example/oauth/client.json','https://chatgpt.com@127.0.0.1/oauth/client.json','https://chatgpt.com/oauth/client.json?url=http://127.0.0.1','https://chatgpt.com/oauth/client.json#fragment','https://chatgpt.com/oauth/../client.json','https://127.0.0.1/oauth/client.json','file:///etc/passwd']) assert.equal(config.allowedClientDocument(uri),false,uri)
  assert.equal(config.allowedCallback('https://chatgpt.com/connector_platform_oauth_redirect'),true)
  assert.equal(config.allowedCallback('https://chatgpt.com/connector_platform_oauth_redirect/qa123'),true)
  for(const uri of ['https://evil.example/callback','https://chatgpt.com/connector_platform_oauth_redirect?next=https://evil.example','https://chatgpt.com:8443/connector_platform_oauth_redirect']) assert.equal(config.allowedCallback(uri),false)
})
const client='https://chatgpt.com/oauth/client.json', user='00000000-0000-4000-8000-000000000001'
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
