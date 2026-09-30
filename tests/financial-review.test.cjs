const test = require('node:test')
const assert = require('node:assert/strict')
const loadApp = require('./load-app.cjs')
const load = loadApp()
const { calculateReview } = load('src/lib/financial-review/calculate.ts')
const { syntheticSnapshot, demoPeriod, demoDay, syntheticId: id } = load('src/lib/financial-review/fixtures.ts')
const { periodSchema } = load('src/lib/financial-review/contracts.ts')
const { prepareFollowThrough } = load('src/lib/financial-review/events.ts')
const clean = value => JSON.parse(JSON.stringify(value))

test('current balances, obligations, receipts and unusual expenses share deterministic calculation', () => {
 const review = calculateReview(syntheticSnapshot(), demoPeriod, demoDay)
 assert.deepEqual(clean(review.totals), { unpaid: 1800, obligations: 965, expenses: 420 })
 assert.equal(review.findings.length, 5)
 assert.equal(review.findings.filter(f=>f.title==='Overdue invoice').length, 1)
 assert.match(review.findings.find(f=>f.id.startsWith('unusual')).detail, /40.00; 3 records/)
})
test('reversed payments are excluded and paid, cancelled and draft invoices are not outstanding', () => {
 const rows = syntheticSnapshot()
 rows.payments[0].reversal = [{ id: id(99) }]
 assert.equal(calculateReview(rows,demoPeriod,demoDay).totals.unpaid,2050)
 for(const status of ['PAID','CANCELLED','DRAFT']) {
  rows.invoices[0].status=status
  assert.equal(calculateReview(rows,demoPeriod,demoDay).totals.unpaid,800)
 }
})
test('calendar boundaries, currency isolation, minimum baseline and missing receipt references', () => {
 const rows = syntheticSnapshot()
 rows.invoices[0].due_date=demoDay
 rows.bills[0].due_date='2026-10-07'
 rows.expenses[3].receipt_path='synthetic-reference'
 rows.expenses[0].currency='EUR'
 const review=calculateReview(rows,demoPeriod,demoDay)
 assert.equal(review.unpaid[0].overdue,false)
 assert.equal(review.totals.obligations,65)
 assert.equal(review.findings.some(f=>/receipt|unusual/.test(f.id)),false)
 assert.equal(calculateReview(rows,{...demoPeriod,currency:'CAD'},demoDay).totals.unpaid,0)
})
test('strict periods, valid calendar dates, money and record boundaries', () => {
 for(const p of [{...demoPeriod,userId:id(1)}, {...demoPeriod,start:'2026-02-30'}, {...demoPeriod,end:'2027-01-01'}, {...demoPeriod,start:'2026-10-05'}]) assert.equal(periodSchema.safeParse(p).success,false)
 for(const amount of [NaN,Infinity,-1,1.123,'5e9']) { const rows=syntheticSnapshot();rows.invoices[0].total=amount;assert.throws(()=>calculateReview(rows,demoPeriod,demoDay)) }
})
function fakeClient({ actor, data = {}, fail, identity = actor?.id, unfiltered = false }) {
 const calls=[]
 return { calls, auth:{getUser:async()=>({data:{user:identity?{id:identity}:null},error:null})}, from(table) {
  const filters=[]; const q={ select(columns){if(table==='expenses')assert.ok(!columns.includes('organization_id'),'expenses have no organization column');return q},eq(k,v){filters.push([k,'eq',v]);return q},is(k,v){filters.push([k,'eq',v]);return q},neq(k,v){filters.push([k,'neq',v]);return q},in(k,v){filters.push([k,'in',v]);return q},gte(k,v){filters.push([k,'gte',v]);return q},lt(k,v){filters.push([k,'lt',v]);return q},lte(){return q},order(){return q},
   single:async()=>({data:(data[table]||(table==='users'?[actor]:[])).find(r=>unfiltered||filters.every(([k,op,v])=>op==='eq'?r[k]===v:true)),error:fail===table?{}:null}),range:async(start,end)=>{calls.push({table,filters:[...filters]});let rows=data[table]||(table==='users'?[actor]:[]); if(!unfiltered)for(const [k,op,v] of filters)rows=rows.filter(r=>op==='eq'?r[k]===v:op==='neq'?r[k]!==v:op==='gte'?r[k]>=v:op==='lt'?r[k]<v:v.includes(r[k]));return {data:rows.slice(start,end+1),error:fail===table?{message:'secret database detail'}:null}} };return q
 }}
}
const actor={id:id(1),organization_id:null,account_type:'freelancer',role:'MEMBER',is_active:true}
function dataRows(){const s=syntheticSnapshot();return {invoices:s.invoices,invoice_payments:s.payments,expenses:s.expenses.map(({organization_id,...row})=>row),bills:s.bills}}
const { readActor, loadReviewSnapshot, safeReviewFailure }=load('src/lib/financial-review/service.ts')
test('authentication and disabled profiles fail closed',async()=>{
 await assert.rejects(readActor(fakeClient({actor,identity:null})),e=>e.status===401)
 await assert.rejects(readActor(fakeClient({actor:{...actor,is_active:false}})),e=>e.status===403)
 await assert.rejects(readActor(fakeClient({actor,fail:'users'})),e=>e.status===503)
})
test('freelancer reads are explicitly owned and payments scoped to authorized invoice IDs',async()=>{
 const data=dataRows();data.invoices.push({...data.invoices[0],id:id(800),user_id:id(999)})
 const client=fakeClient({actor,data})
 const result=await loadReviewSnapshot(client,actor,demoPeriod)
 assert.equal(result.invoices.length,2)
 assert.ok(client.calls.filter(c=>c.table==='invoices').every(c=>c.filters.some(f=>f[0]==='user_id'&&f[2]===id(1))))
 assert.ok(client.calls.find(c=>c.table==='invoice_payments').filters.some(f=>f[0]==='invoice_id'&&f[1]==='in'))
 assert.equal(result.bills.length,0)
})
test('business member cannot read invoices, vendor obligations or other member expenses',async()=>{
 const member={...actor,account_type:'business',organization_id:id(700)}
 const data=dataRows();data.expenses.push({...data.expenses[0],id:id(810),user_id:id(999)})
 const client=fakeClient({actor:member,data})
 const result=await loadReviewSnapshot(client,member,demoPeriod)
 assert.equal(result.invoices.length,0);assert.equal(result.bills.length,0);assert.equal(result.expenses.length,4)
 assert.ok(client.calls.every(c=>c.table==='expenses'))
})
test('team review resolves expense ownership from verified profiles and rejects foreign profile/expense rows',async()=>{
 const owner={...actor,account_type:'business',role:'OWNER',organization_id:id(700)}
 const member={...owner,id:id(2),role:'MEMBER'},foreign={...member,id:id(999),organization_id:id(701)}
 const data={users:[owner,member,foreign],expenses:[{...dataRows().expenses[3],user_id:member.id}]}
 const client=fakeClient({actor:owner,data})
 const rows=await loadReviewSnapshot(client,owner,demoPeriod)
 assert.equal(rows.expenses.length,1);assert.equal(rows.expenses[0].organization_id,owner.organization_id)
 assert.ok(client.calls.filter(c=>c.table==='expenses').every(c=>c.filters.some(f=>f[0]==='user_id'&&f[1]==='in'&&!f[2].includes(foreign.id))))
 assert.ok(client.calls.filter(c=>c.table==='expenses').every(c=>!c.filters.some(f=>f[0]==='organization_id')))
 await assert.rejects(loadReviewSnapshot(fakeClient({actor:owner,data,unfiltered:true}),owner,demoPeriod),e=>e.status===403)
 await assert.rejects(loadReviewSnapshot(fakeClient({actor:owner,data:{users:[owner],expenses:[{...data.expenses[0],user_id:foreign.id}]},unfiltered:true}),owner,demoPeriod),e=>e.status===403)
 const {readSourceRecord}=load('src/lib/financial-review/service.ts')
 assert.equal((await readSourceRecord(client,{kind:'expenses',id:data.expenses[0].id})).amount,420)
 const foreignData={...data,expenses:[{...data.expenses[0],user_id:foreign.id}]}
 await assert.rejects(readSourceRecord(fakeClient({actor:owner,data:foreignData}),{kind:'expenses',id:data.expenses[0].id}),e=>e.status===403)
})
test('defense in depth rejects foreign tenant rows and foreign payment parents',async()=>{
 const data=dataRows();data.invoices[0].user_id=id(999)
 await assert.rejects(loadReviewSnapshot(fakeClient({actor,data,unfiltered:true}),actor,demoPeriod),e=>e.status===403)
 const other=dataRows();other.invoice_payments[0].invoice_id=id(999)
 await assert.rejects(loadReviewSnapshot(fakeClient({actor,data:other,unfiltered:true}),actor,demoPeriod),e=>e.status===403)
})
test('read failures are generic and never produce partial totals; pages are bounded',async()=>{
 await assert.rejects(loadReviewSnapshot(fakeClient({actor,data:dataRows(),fail:'expenses'}),actor,demoPeriod),e=>e.status===503&&!e.message.includes('secret'))
 const data=dataRows();data.invoices=Array.from({length:2001},(_,n)=>({...data.invoices[0],id:id(n+1000)}))
 await assert.rejects(loadReviewSnapshot(fakeClient({actor,data}),actor,demoPeriod),e=>e.status===413)
 assert.equal(safeReviewFailure(new Error('secret')).message.includes('secret'),false)
})
test('follow-through requires opt-in, isolates tenants, deduplicates replay and rejects stale versions',()=>{
 const review=calculateReview(syntheticSnapshot(),demoPeriod,demoDay),event={id:id(90),accountId:id(1),kind:'invoices',recordId:id(10),version:1}
 const state={accountId:id(1),enabled:false,seen:[],versions:{},drafts:[]}
 assert.equal(prepareFollowThrough(state,event,review),state)
 const next=prepareFollowThrough({...state,enabled:true},event,review)
 assert.equal(next.drafts.length,1);assert.equal(next.drafts[0].status,'needs_review')
 assert.equal(prepareFollowThrough(next,event,review),next)
 assert.equal(prepareFollowThrough(next,{...event,id:id(91)},review),next)
 assert.throws(()=>prepareFollowThrough(next,{...event,accountId:id(999)},review))
 const resolved=prepareFollowThrough(next,{...event,id:id(92),version:2},{...review,findings:[]})
 assert.equal(resolved.drafts.length,0)
})
test('agent output cannot inject links, invent findings or repeat findings',()=>{
 const {validateAgentSelection}=load('src/lib/financial-review/agent.ts'),review=calculateReview(syntheticSnapshot(),demoPeriod,demoDay)
 assert.equal(validateAgentSelection(JSON.stringify({findingIds:[review.findings[0].id]}),review)[0],review.findings[0])
 for(const data of [{findingIds:['invented']},{findingIds:[review.findings[0].id,review.findings[0].id]},{findingIds:[],href:'https://evil.invalid'}])assert.throws(()=>validateAgentSelection(JSON.stringify(data),review))
})

test('agent lifecycle handles a real-shaped required action, validates turn completion and deletes session',async()=>{
 const {runSyntheticReviewAgent}=load('src/lib/financial-review/agent.ts'),review=calculateReview(syntheticSnapshot(),demoPeriod,demoDay)
 const calls=[],event={session:{id:'synthetic-session',required_actions:[{type:'function_call',turn_id:'synthetic-turn',call_id:'synthetic-call',name:'read_financial_review',arguments:{}}]}}
 const client={beta:{agents:{sessions:{create:async function*(params){assert.equal(params.environment.type,'none');yield {type:'agent.session.created',session:{id:'synthetic-session'}};yield {type:'agent.session.turn.created',session_id:'synthetic-session',turn_id:'synthetic-turn'};yield {type:'agent.session.requires_action',...event};yield {type:'agent.session.requires_action',...event};yield {type:'agent.session.turn.output_text.done',session_id:'synthetic-session',turn_id:'synthetic-turn',text:JSON.stringify({findingIds:[review.findings[0].id]})};yield {type:'agent.session.turn.completed',session_id:'synthetic-session',turn_id:'synthetic-turn',turn:{status:'completed'}}},events:{create:async(id,input)=>calls.push(input)},delete:async id=>calls.push({deleted:id})}}}}
 const result=await runSyntheticReviewAgent(review,client,'synthetic-model')
 assert.equal(result.toolCalls,1);assert.equal(result.cleanup,'deleted');assert.equal(calls.length,2)
 assert.equal(calls[0].events[0].call_id,'synthetic-call')
})
test('idle or disconnected streams are failures, and pending work is cancelled before cleanup',async()=>{
 const {runSyntheticReviewAgent}=load('src/lib/financial-review/agent.ts'),review=calculateReview(syntheticSnapshot(),demoPeriod,demoDay)
 const calls=[]
 const client={beta:{agents:{sessions:{create:async function*(){yield {type:'agent.session.created',session:{id:'synthetic-session'}};yield {type:'agent.session.turn.created',session_id:'synthetic-session',turn_id:'synthetic-turn'};yield {type:'agent.session.idle',session:{id:'synthetic-session'}}},events:{create:async(id,input)=>calls.push(input)},delete:async()=>calls.push('deleted')}}}}
 await assert.rejects(runSyntheticReviewAgent(review,client,'synthetic-model'))
 assert.equal(calls[0].events[0].type,'agent.session.input.cancel');assert.equal(calls[1],'deleted')
})
test('database timestamp dates normalize to calendar days and uncategorized expenses do not create a false comparison',()=>{
 const rows=syntheticSnapshot();rows.invoices[0].issue_date+='T00:00:00+00:00';rows.invoices[0].due_date+='T00:00:00+00:00';rows.bills[0].due_date+='T00:00:00.000Z'
 rows.expenses=rows.expenses.map(e=>({...e,expense_date:e.expense_date+'T00:00:00+00:00',category:null}))
 const review=calculateReview(rows,demoPeriod,demoDay)
 assert.equal(review.totals.expenses,420);assert.equal(review.unpaid[0].due,'2026-09-25');assert.equal(review.findings.some(f=>f.id.startsWith('unusual')),false)
})
test('local journal persists explicit opt-in and replay protection across reloads',async()=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path')
 const {updateLocalReviewJournal}=load('src/lib/financial-review/event-journal.ts')
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'amountly-review-journal-'))
 try {
  const review=calculateReview(syntheticSnapshot(),demoPeriod,demoDay),event={id:id(91),accountId:id(1),kind:'invoices',recordId:id(10),version:1}
  assert.equal((await updateLocalReviewJournal(directory,id(1),{event,review})).drafts.length,0)
  await updateLocalReviewJournal(directory,id(1),{enabled:true})
  assert.equal((await updateLocalReviewJournal(directory,id(1),{event,review})).drafts.length,1)
  assert.equal((await updateLocalReviewJournal(directory,id(1),{event,review})).drafts.length,1)
  await updateLocalReviewJournal(directory,id(1),{enabled:false})
  assert.equal((await updateLocalReviewJournal(directory,id(1),{event:{...event,id:id(92),version:2},review})).seen.length,1)
  await assert.rejects(updateLocalReviewJournal(directory,'../escape',{enabled:true}))
 } finally { await fs.rm(directory,{recursive:true,force:true}) }
})
test('last day includes expenses after midnight and excludes the next day',async()=>{
 const data=dataRows();data.expenses=[{...data.expenses[3],expense_date:'2026-10-04T23:59:59+00:00'},{...data.expenses[3],id:id(45),expense_date:'2026-10-05T00:00:00+00:00'}]
 const rows=await loadReviewSnapshot(fakeClient({actor,data}),actor,demoPeriod)
 assert.equal(rows.expenses.length,1);assert.equal(rows.expenses[0].expense_date,'2026-10-04')
})
test('supporting records enforce ownership and capabilities and redact receipt storage references',async()=>{
 const {readSourceRecord}=load('src/lib/financial-review/service.ts'),data=dataRows()
 const record=await readSourceRecord(fakeClient({actor,data}),{kind:'expenses',id:id(40)})
 assert.equal(record.receiptAttached,true);assert.equal(record.receipt_path,undefined);assert.equal(record.user_id,undefined)
 await assert.rejects(readSourceRecord(fakeClient({actor,data}),{kind:'expenses',id:id(999)}),e=>e.status===404)
 data.expenses[0].user_id=id(999)
 await assert.rejects(readSourceRecord(fakeClient({actor,data,unfiltered:true}),{kind:'expenses',id:id(40)}),e=>e.status===403)
 await assert.rejects(readSourceRecord(fakeClient({actor:{...actor,account_type:'personal'},data}),{kind:'invoices',id:id(10)}),e=>e.status===403)
})
