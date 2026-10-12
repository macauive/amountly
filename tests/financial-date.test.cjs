const test=require('node:test'),assert=require('node:assert/strict'),loadApp=require('./load-app.cjs')
test('UTC financial dates survive PostgreSQL offset serialization in editing, display, search and duplicate checks',()=>{
 const load=loadApp(),{dateInputValue,formatDateOnly}=load('src/lib/date-format.ts')
 const serialized='2026-10-11T19:00:00-05:00'
 assert.equal(dateInputValue(serialized),'2026-10-12');assert.equal(formatDateOnly(serialized,'yyyy-MM-dd'),'2026-10-12')
 assert.equal(dateInputValue('2026-10-12'),'2026-10-12')
 const {expenseSearchRecord}=load('src/lib/search-records.ts'),{filterRecords,parseRecordFilters}=load('src/lib/record-search.ts')
 const row={id:'00000000-0000-4000-8000-000000000001',merchant:'Synthetic shop',description:'Paper',amount:12.5,currency:'USD',expense_date:serialized,status:'DRAFT',receipt_path:'synthetic',category:'OTHER'}
 const record=expenseSearchRecord(row);assert.equal(record.date,'2026-10-12')
 const filters=parseRecordFilters(new URLSearchParams('start=2026-10-12&end=2026-10-12'));assert.equal(filterRecords([record],filters).length,1)
 const {findPossibleReceiptDuplicate}=load('src/lib/receipt-review.ts')
 assert.equal(findPossibleReceiptDuplicate({merchant:row.merchant,amount:'12.50',currency:'USD',expense_date:'2026-10-12'},[row]).id,row.id)
})
test('financial review and expense reporting use the same UTC day at period boundaries',()=>{
 const load=loadApp(),{storedDay}=load('src/lib/financial-review/contracts.ts'),{expenseRecords}=load('src/lib/reporting.ts')
 const offset='2025-12-31T19:00:00-05:00'
 assert.equal(storedDay.parse(offset),'2026-01-01')
 assert.equal(expenseRecords([{expense_date:offset,currency:'USD',status:'DRAFT',amount:12}],2026,'USD').length,1)
 assert.equal(expenseRecords([{expense_date:offset,currency:'USD',status:'DRAFT',amount:12}],2025,'USD').length,0)
})
