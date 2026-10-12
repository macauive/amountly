const {test}=require('node:test'),assert=require('node:assert/strict')
const load=require('./load-app.cjs')()
const {parseRecordFilters,filterRecords,emptyRecordFilters,sourceRecordHref,safeReturnHref}=load('src/lib/record-search.ts')
const {expenseNavigation,expenseFilterHref}=load('src/lib/expense-navigation.ts')
const id='00000000-0000-4000-8000-000000000021'
const records=[
{id,kind:'expenses',label:'Paper Studio',detail:'Notebooks',amount:12.5,currency:'USD',date:'2026-10-01',status:'DRAFT',receipt:false},
{id:'00000000-0000-4000-8000-000000000022',kind:'expenses',label:'Supplier',detail:'Paper Studio conference',amount:100,currency:'EUR',date:'2026-10-12',status:'APPROVED',receipt:true},
{id:'00000000-0000-4000-8000-000000000023',kind:'invoices',label:'INV-021',detail:'Paper Studio',amount:250,currency:'USD',date:'2026-10-01',status:'SENT',receipt:false},
]
test('exact titles rank above incidental newer matches; record filters combine without changing currency',()=>{
 assert.equal(filterRecords(records,{...emptyRecordFilters,q:'Paper Studio'})[0].id,id)
 const filtered=filterRecords(records,{...emptyRecordFilters,q:'Paper',start:'2026-10-01',end:'2026-10-01',receipt:'missing'})
 assert.deepEqual(filtered.map(r=>r.id),[id]);assert.equal(filtered[0].currency,'USD')
 assert.equal(filterRecords(records,{...emptyRecordFilters,q:'12.50'})[0].id,id)
 assert.equal(filterRecords(records,{...emptyRecordFilters,q:'absent'}).length,0)
})
test('malformed dates, duplicate selectors and unsupported enums fail closed',()=>{
 for(const input of ['q=a&q=b','status=OWNER','kind=users','receipt=maybe','start=2026-02-30','start=2026-10-02&end=2026-10-01'])assert.equal(parseRecordFilters(new URLSearchParams(input)),null)
 assert.equal(filterRecords(records,null).length,0)
})
test('record destinations and return links cannot escape fixed local routes',()=>{
 const parent='/records?q=Paper&receipt=missing&start=2026-10-01'
 const link=sourceRecordHref({id,kind:'expenses'},parent)
 assert.equal(new URL('https://example.invalid'+link).searchParams.get('returnTo'),parent)
 for(const input of ['https://foreign.invalid','//foreign.invalid','javascript:alert(1)','/records?returnTo=//foreign.invalid','/records?kind=users','/records#secret','/invoices\\evil'])assert.equal(safeReturnHref(input),'/records')
 const expense=expenseFilterHref({query:'Paper',start:'2026-10-01',end:'2026-10-12',category:'OFFICE_SUPPLIES',status:'DRAFT',review:'needs-review'})
 const nav=expenseNavigation(new URLSearchParams(expense.split('?')[1]))
 assert.equal(nav.filters.query,'Paper');assert.equal(nav.filters.end,'2026-10-12');assert.equal(nav.filters.review,'needs-review')
 assert.equal(expenseNavigation(new URLSearchParams('capture='+id)).captureId,id)
 assert.equal(expenseNavigation(new URLSearchParams('capture='+id+'&expense='+id)).invalid,true)
})
