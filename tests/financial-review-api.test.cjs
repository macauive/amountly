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
test('source endpoint rejects invalid IDs and unavailable synthetic records',async()=>{
 const {POST}=loadApp({},env)('src/app/api/financial-review/record/route.ts')
 assert.equal((await POST(request({kind:'expenses',id:'forged'}))).status,422)
 assert.equal((await POST(request({kind:'expenses',id:'00000000-0000-4000-8000-999999999999'}))).status,404)
})
test('direct source endpoint returns a safe supporting record without an external tool transport',async()=>{
 const {POST}=loadApp({},env)('src/app/api/financial-review/record/route.ts')
 const response=await POST(request({kind:'expenses',id:'00000000-0000-4000-8000-000000000043'}))
 assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/)
 const record=await response.json()
 assert.equal(record.amount,420);assert.equal(record.receipt_path,undefined)
})
