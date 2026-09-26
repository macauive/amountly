const test = require('node:test')
const assert = require('node:assert/strict')
const appLoader = require('./load-app.cjs')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const query = { year:'2026',month:'4',currency:'USD',basis:'cash' }
const invoice = { invoice_number:'QA',currency:'USD',status:'SENT' }
const receipt = { id:id(1),paid_on:'2026-04-01',amount:25,invoice,reversal:null }

async function request(options={}) {
  const calls=[]
  let clients=0
  const client={
    auth:{getUser:async()=>options.auth ?? {data:{user:{id:id(99)}},error:null}},
    from:table=>{
      const call={table,filters:[]}; calls.push(call)
      const builder={
        select:fields=>{call.fields=fields; return builder},
        maybeSingle:async()=>options.profile ?? {data:{account_type:'business',role:'OWNER',is_active:true}},
        range:async(from,to)=>options.failure === table ? {error:{message:'private database error'}}
          : {data:options.pages ? options.pages(table,from,to) : (options[table] ?? (table==='invoice_payments' ? [receipt] : []))},
      }
      for(const op of ['eq','in','gte','lt','order','is','neq']) builder[op]=(...args)=>{call.filters.push([op,...args]);return builder}
      return builder
    },
  }
  const load=appLoader({'@supabase/ssr':{createServerClient:()=>{clients++;return client}}})
  const res={headers:{},setHeader(k,v){this.headers[k]=v},status(code){this.code=code;return this},json(body){this.body=body;return this},send(body){this.body=body;return this}}
  await load('src/pages/api/reports/workspace.ts').default({method:options.method ?? 'GET',query:options.query ?? query,cookies:{}},res)
  assert.equal(res.headers['Cache-Control'],'private, no-store')
  assert.equal(res.headers['X-Content-Type-Options'],'nosniff')
  assert.ok(!JSON.stringify(res.body).includes('private database error'))
  return {res,calls,clients}
}

test('workspace export rejects methods, duplicate/unknown filters and malformed periods before accessing data',async()=>{
  assert.equal((await request({method:'POST'})).res.code,405)
  for(const patch of [{year:'1999'},{year:'2101'},{month:'0'},{month:'13'},{month:['4','5']},{currency:'USD\r\nInjected'},{basis:'other'},{user_id:id(2)},{organization_id:id(3)}]) {
    const result=await request({query:{...query,...patch}})
    assert.equal(result.res.code,400);assert.equal(result.clients,0)
  }
})
test('workspace export denies anonymous, expired, inactive and unauthorized roles before financial reads',async()=>{
  const anonymous=await request({auth:{data:{user:null},error:{message:'expired'}}})
  assert.equal(anonymous.res.code,401);assert.equal(anonymous.calls.length,0)
  for(const profile of [null,{account_type:'business',role:'OWNER',is_active:false},{account_type:'business',role:'MEMBER',is_active:true},{account_type:'business',role:'CONTRACTOR',is_active:true},{account_type:'business',role:'unknown',is_active:true}]) {
    const result=await request({profile:{data:profile}})
    assert.equal(result.res.code,403);assert.deepEqual(result.calls.map(c=>c.table),['users'])
  }
  for(const [account_type,role] of [['business','ADMIN'],['freelancer','MEMBER'],['personal','MEMBER']]) {
    assert.equal((await request({profile:{data:{account_type,role,is_active:true}}})).res.code,200)
  }
})
test('workspace CSV is an attachment with bounded name, exact fiscal metadata, escaped text and no reversed receipts',async()=>{
  const result=await request({invoice_payments:[{...receipt,invoice:{...invoice,invoice_number:'=1+1,"quoted"'}},{...receipt,id:id(2),amount:90,reversal:[{id:id(3)}]},{...receipt,id:id(4),reversal:{id:id(5)}}]})
  assert.equal(result.res.code,200)
  assert.equal(result.res.headers['Content-Disposition'],'attachment; filename="amountly-workspace-2026-04-01-2027-03-31-USD.csv"')
  assert.match(result.res.body,/"2026-04-01","2027-03-31","USD","cash","captured_record"/)
  assert.match(result.res.body,/"'=1\+1,""quoted"""/)
  assert.equal(result.res.body.split('\r\n').length,2)
  const reads=result.calls.filter(c=>c.table!=='users')
  assert.ok(reads.every(c=>!c.fields.includes('*') && !c.fields.includes('receipt_path')))
  assert.ok(reads.every(c=>c.filters.some(f=>f[0]==='gte' && f[2]==='2026-04-01') && c.filters.some(f=>f[0]==='lt' && f[2]==='2027-04-01')))
})
test('workspace accrual export reads issued invoice totals and captured expenses with separate bases',async()=>{
  const result=await request({query:{...query,basis:'accrual'},invoices:[{...invoice,id:id(1),issue_date:'2026-04-01T00:00:00+00:00',total:100}],expenses:[{id:id(2),expense_date:'2026-05-01',amount:12.5,currency:'USD',description:'Synthetic expense',merchant:null,status:'DRAFT'}]})
  assert.equal(result.res.code,200); assert.ok(!result.calls.some(c=>c.table==='invoice_payments'))
  assert.match(result.res.body,/"accrual","captured_record"/);assert.match(result.res.body,/"100"/);assert.match(result.res.body,/"12.5"/)
})
test('workspace export paginates beyond 1000 without silently truncating oversized reports',async()=>{
  const result=await request({pages:(table,from,to)=>table==='invoice_payments' ? Array.from({length:Math.max(0,Math.min(to+1,1005)-from)},(_,i)=>({...receipt,id:id(from+i+1)})) : []})
  assert.equal(result.res.code,200); assert.equal(result.res.body.split('\r\n').length,1006)
  const large=await request({pages:(table,from)=>table==='invoice_payments' ? Array.from({length:200},(_,i)=>({...receipt,id:id(from+i+1)})) : []})
  assert.equal(large.res.code,413);assert.equal(large.res.headers['Content-Disposition'],undefined)
})
test('workspace export fails closed on malformed stored records and provider failures',async()=>{
  for(const bad of [{amount:'NaN'},{paid_on:'2026-02-30'},{invoice:{...invoice,invoice_number:'x'.repeat(101)}}]) {
    assert.equal((await request({invoice_payments:[{...receipt,...bad}]})).res.code,422)
  }
  for(const failure of ['invoice_payments','expenses']) assert.equal((await request({failure})).res.code,503)
  assert.equal((await request({profile:{error:{message:'private database error'}}})).res.code,503)
})
test('workspace expense export retains reimbursements as captured records and bounds output size',async()=>{
  const reimbursed={id:id(2),expense_date:'2026-05-01',amount:'12.50',currency:'USD',description:'Synthetic reimbursed expense',merchant:null,status:'REIMBURSED'}
  const result=await request({expenses:[reimbursed]})
  assert.equal(result.res.code,200);assert.match(result.res.body,/"12.5","REIMBURSED"/)
  const oversized=await request({expenses:Array.from({length:101},(_,i)=>({...reimbursed,id:id(i+1),description:'x'.repeat(10000)}))})
  assert.equal(oversized.res.code,413)
  const manyReversed=await request({pages:(table,from)=>table==='invoice_payments' ? Array.from({length:200},(_,i)=>({...receipt,id:id(from+i+1),reversal:{id:id(20000+from+i)}})) : []})
  assert.equal(manyReversed.res.code,413)
})
