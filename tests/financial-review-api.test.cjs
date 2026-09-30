const test=require('node:test'),assert=require('node:assert/strict'),loadApp=require('./load-app.cjs')
const period={start:'2026-09-28',end:'2026-10-04',currency:'USD'}
const env={NODE_ENV:'development',AMOUNTLY_REVIEW_MODE:'synthetic'}
const request=(body=period,headers={})=>new Request('http://localhost:4180/api/financial-review',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)})
test('synthetic HTTP path works without credentials and rejects forged ownership/large body/cross-origin',async()=>{
 const {POST}=loadApp({},env)('src/app/api/financial-review/route.ts')
 const ok=await POST(request());assert.equal(ok.status,200);assert.match(ok.headers.get('cache-control'),/no-store/);assert.equal((await ok.json()).synthetic,true)
 assert.equal((await POST(request({...period,userId:'forged'}))).status,400)
 assert.equal((await POST(request({...period,x:'x'.repeat(5000)}))).status,413)
 assert.equal((await POST(request(period,{origin:'https://evil.invalid'}))).status,403)
})
test('production never enables synthetic bypass; default disabled; account auth cannot be omitted',async()=>{
 const prod=loadApp({},{...env,NODE_ENV:'production'})('src/app/api/financial-review/route.ts')
 assert.equal((await prod.POST(request())).status,404)
 const disabled=loadApp()('src/app/api/financial-review/route.ts');assert.equal((await disabled.POST(request())).status,404)
 const account=loadApp({},{NODE_ENV:'development',AMOUNTLY_REVIEW_MODE:'account'})('src/app/api/financial-review/route.ts')
 assert.equal((await account.POST(request())).status,401)
})
test('disabled agent returns 404 and invalid requests preserve client statuses without starting OpenAI',async()=>{
 const path='src/app/api/financial-review/agent/route.ts'
 const overrides={openai:class {constructor(){throw new Error('Provider must not be started')}}}
 for(const settings of [{NODE_ENV:'production'},{...env,NODE_ENV:'production',AMOUNTLY_SYNTHETIC_AGENT:'enabled'},
  {NODE_ENV:'production',AMOUNTLY_REVIEW_MODE:'account'},env]) {
  const response=await loadApp(overrides,settings)(path).POST(request())
  assert.equal(response.status,404)
  assert.equal((await response.json()).error,'Agent preview is not enabled.')
  assert.match(response.headers.get('cache-control'),/no-store/)
 }
 const enabled={...env,AMOUNTLY_SYNTHETIC_AGENT:'enabled',OPENAI_API_KEY:'synthetic-local-test-key'}
 const {POST}=loadApp(overrides,enabled)(path)
 assert.equal((await POST(request(period,{origin:'https://evil.invalid'}))).status,403)
 assert.equal((await POST(request({...period,extra:'x'.repeat(5000)}))).status,413)
 assert.equal((await POST(new Request('http://localhost:4180/api/financial-review/agent',{method:'POST',body:'{'}))).status,400)
})
test('MCP discovery, read tools, source record and UI resource work over actual SDK transport',async()=>{
 const {POST}=loadApp({},env)('src/app/api/mcp/route.ts')
 const rpc=async(method,params)=>{
  const response=await POST(new Request('http://localhost:4180/api/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}))
  assert.equal(response.status,200);return response.json()
 }
 const init=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'synthetic-test',version:'1'}})
 assert.equal(init.result.serverInfo.name,'amountly-review');assert.equal(init.result.capabilities.events,undefined)
 const listed=await rpc('tools/list',{});assert.equal(listed.result.tools.length,6);assert.ok(listed.result.tools.every(t=>t.annotations.readOnlyHint))
 const result=await rpc('tools/call',{name:'weekly_overview',arguments:period});assert.equal(result.result.structuredContent.totals.unpaid,1800)
 const rejected=await rpc('tools/call',{name:'weekly_overview',arguments:{...period,sql:'select *'}});assert.ok(rejected.result?.isError||rejected.error)
 const record=await rpc('tools/call',{name:'get_financial_record',arguments:{kind:'expenses',id:'00000000-0000-4000-8000-000000000043'}})
 assert.equal(record.result.structuredContent.amount,420);assert.equal(record.result.structuredContent.receipt_path,undefined)
 const ui=await rpc('resources/read',{uri:'ui://amountly/financial-review.html'});assert.equal(ui.result.contents[0].mimeType,'text/html;profile=mcp-app')
 assert.match(ui.result.contents[0].text,/ui\/initialize/)
})
test('source endpoint rejects invalid IDs and unavailable synthetic records',async()=>{
 const {POST}=loadApp({},env)('src/app/api/financial-review/record/route.ts')
 assert.equal((await POST(request({kind:'expenses',id:'forged'}))).status,422)
 assert.equal((await POST(request({kind:'expenses',id:'00000000-0000-4000-8000-999999999999'}))).status,404)
})
test('panel harness is synthetic development only and permits scripts by nonce',async()=>{
 const path='src/app/api/financial-review/panel-preview/route.ts'
 const response=loadApp({},env)(path).GET(new Request('http://localhost:4180/api/financial-review/panel-preview'))
 assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/script-src 'nonce-/)
 const html=await response.text();assert.match(html,/sandbox="allow-scripts"/);assert.doesNotMatch(html,/allow-same-origin/)
 assert.equal(loadApp({},{...env,NODE_ENV:'production'})(path).GET(new Request('http://localhost:4180/api/financial-review/panel-preview')).status,404)
})
