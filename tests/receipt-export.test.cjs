const test = require('node:test')
const assert = require('node:assert/strict')
const appLoader = require('./load-app.cjs')
const identity = {id:'00000000-0000-4000-8000-000000000001',email:'synthetic@example.invalid'}
const objectPath = `${identity.id}/00000000-0000-4000-8000-000000000002.pdf`

test('Render packet originals read through the authenticated role and bound claims/path, with a read-only transaction',async()=>{
  const calls=[]
  let released=false,configuration
  const connection={query:async(sql,args)=>{calls.push({sql,args});return {rows:sql.startsWith('select content_type') ? [{content_type:'application/pdf',contents:Buffer.from('%PDF-test')}] : []}},release:()=>{released=true}}
  const load=appLoader({'pg':{Pool:class{constructor(options){configuration=options}async connect(){return connection}}},'@/lib/platform/config':{requiredSecret:()=> 'postgres://local.invalid/disposable'}},{NEXT_PUBLIC_BACKEND:'render'})
  const result=await load('src/lib/receipt-export.ts').withReceiptReader(identity,{},Date.now()+1000,reader=>reader(objectPath))
  assert.equal(result.mime,'application/pdf');assert.equal(result.bytes.toString(),'%PDF-test')
  assert.equal(configuration.max,1);assert.equal(configuration.connectionTimeoutMillis,10000)
  assert.equal(calls[0].sql,'begin read only');assert.equal(calls[1].sql,'set local role authenticated')
  assert.deepEqual(JSON.parse(calls[2].args[0]),{sub:identity.id,email:identity.email,role:'authenticated'})
  assert.equal(calls[3].sql,'select content_type,contents from amountly_files.receipts where path=$1')
  assert.equal(calls[3].args[0],objectPath);assert.equal(calls.at(-1).sql,'commit');assert.equal(released,true)
})
test('Render missing originals return null; database failure rolls back and releases without a result',async()=>{
  for(const failure of [false,true]) {
    const calls=[];let released=false
    const load=appLoader({'pg':{Pool:class{async connect(){return {query:async sql=>{calls.push(sql);if(failure && sql.startsWith('select content_type'))throw Error('private SQL failure');return {rows:[]}},release:()=>{released=true}}}}},'@/lib/platform/config':{requiredSecret:()=> 'postgres://local.invalid/disposable'}},{NEXT_PUBLIC_BACKEND:'render'})
    const work=load('src/lib/receipt-export.ts').withReceiptReader(identity,{},Date.now()+1000,reader=>reader(objectPath))
    if(failure){await assert.rejects(work);assert.equal(calls.at(-1),'rollback')}
    else{assert.equal(await work,null);assert.equal(calls.at(-1),'commit')}
    assert.equal(released,true)
  }
})
test('legacy receipt reads use a fixed authenticated storage bucket; only confirmed 404 is missing',async()=>{
  const load=appLoader()
  const {withReceiptReader,}=load('src/lib/receipt-export.ts')
  for(const statusCode of ['404','403','500',undefined]){
    const calls=[]
    const client={storage:{from:bucket=>{calls.push(bucket);return {download:async path=>{calls.push(path);return {data:null,error:{statusCode}}}}}}}
    const work=withReceiptReader(identity,client,Date.now()+1000,reader=>reader(objectPath))
    if(statusCode==='404')assert.equal(await work,null);else await assert.rejects(work)
    assert.deepEqual(calls,['receipts',objectPath])
  }
})
test('legacy originals are bounded before materialization and expired deadlines fail before storage access',async()=>{
  const load=appLoader()
  const {withReceiptReader}=load('src/lib/receipt-export.ts')
  let reads=0,materialized=0
  const client={storage:{from:()=>({download:async()=>{reads++;return {data:{size:10*1024*1024+1,type:'application/pdf',arrayBuffer:async()=>{materialized++;return new ArrayBuffer(1)}}}}})}}
  await assert.rejects(withReceiptReader(identity,client,Date.now()+1000,reader=>reader(objectPath)))
  assert.equal(reads,1);assert.equal(materialized,0)
  await assert.rejects(withReceiptReader(identity,client,Date.now()-1000,reader=>reader(objectPath)))
  assert.equal(reads,1)
})
