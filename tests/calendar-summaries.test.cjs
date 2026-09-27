const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./load-app.cjs')
const app = load()
const { effectiveBillStatus, billDaysUntilDue } = app('src/lib/bill-status.ts')
const { weeklyTime } = app('src/lib/weekly-time.ts')

test('bill display derives overdue, due today, and upcoming by calendar day', () => {
  const now = new Date(2026, 8, 26, 23, 59)
  for (const stored of ['upcoming', 'due', 'overdue']) {
    assert.equal(effectiveBillStatus({status:stored,due_date:'2026-09-25'},now),'overdue')
    assert.equal(effectiveBillStatus({status:stored,due_date:'2026-09-26'},now),'due')
    assert.equal(effectiveBillStatus({status:stored,due_date:'2026-09-27'},now),'upcoming')
  }
  assert.equal(billDaysUntilDue('2026-09-27',now),1)
  assert.equal(billDaysUntilDue('2026-09-25',new Date(2026,8,26,0,1)),-1)
})

test('closed bill states survive past due dates and source records remain unchanged', () => {
  for (const status of ['paid','cancelled']) {
    const bill = Object.freeze({status,due_date:'2026-01-01'})
    assert.equal(effectiveBillStatus(bill,new Date(2026,8,26)),status)
  }
  assert.equal(effectiveBillStatus({status:'upcoming',due_date:'invalid'}),'upcoming')
})

test('AI receives effective bill statuses without modifying financial records', async () => {
  let payload
  const ai = load({'@/lib/ai/client':{runAiTask: async (_task,input) => {payload=input;return {}}}})('src/lib/dashboard-ai.ts')
  const overdue = Object.freeze({id:'qa',name:'Sample',bill_number:'Sample',amount:10,total:10,due_date:'2000-01-01',status:'upcoming'})
  const cancelled = {...overdue,status:'cancelled'}
  await ai.getDashboardAiInsights({accountType:'business',searchQuery:'',candidateHrefs:[],bills:[overdue,cancelled],expenses:[],workData:{invoices:[],expenses:[],timeEntries:[],vendorBills:[overdue,cancelled]}})
  assert.equal(payload.bills[0].status,'overdue')
  assert.equal(payload.workData.vendorBills[0].status,'overdue')
  assert.equal(payload.bills[1].status,'cancelled')
  assert.equal(payload.workData.vendorBills[1].status,'cancelled')
  assert.equal(overdue.status,'upcoming')
})

test('weekly time uses Monday boundaries in the saved timezone, not UTC or browser day', () => {
  const entries = [
    {start_at:'2026-09-21T04:59:59Z',duration_minutes:999}, // Sunday Chicago
    {start_at:'2026-09-21T05:00:00Z',duration_minutes:90},
    {start_at:'2026-09-28T04:59:59Z',duration_minutes:30}, // Sunday Chicago
    {start_at:'2026-09-28T05:00:00Z',duration_minutes:999},
  ]
  const result = weeklyTime(entries,new Date('2026-09-26T12:00:00Z'),'America/Chicago')
  assert.equal(result.minutes,120)
  assert.equal(result.start,'2026-09-21')
  assert.equal(result.end,'2026-09-27')
  assert.equal(result.timeZone,'America/Chicago')
  assert.equal(weeklyTime(entries,new Date('2026-09-28T05:00:00Z'),'America/Chicago').minutes,999)
})

test('weekly time handles daylight saving and year boundaries', () => {
  const rows=[{start_at:'2026-03-02T06:00:00Z',duration_minutes:60},{start_at:'2026-03-09T04:59:59Z',duration_minutes:60},{start_at:'2026-03-09T05:00:00Z',duration_minutes:999}]
  assert.equal(weeklyTime(rows,new Date('2026-03-08T12:00:00Z'),'America/Chicago').minutes,120)
  const year=weeklyTime([{start_at:'2025-12-29T00:00:00Z',duration_minutes:60}],new Date('2026-01-01T12:00:00Z'),'UTC')
  assert.equal(year.start,'2025-12-29')
  assert.equal(year.end,'2026-01-04')
  assert.equal(year.minutes,60)
})

test('empty or invalid durations cannot produce a misleading weekly total', () => {
  const now=new Date('2026-09-26T12:00:00Z')
  assert.equal(weeklyTime([],now,'UTC').minutes,0)
  const rows=[{start_at:'bad',duration_minutes:60},...[null,-1,NaN,Infinity].map(duration_minutes=>({start_at:now.toISOString(),duration_minutes}))]
  assert.equal(weeklyTime(rows,now,'UTC').minutes,0)
  const fallback=weeklyTime([],now,'not-a-timezone')
  assert.equal(fallback.timeZone,'UTC')
})
