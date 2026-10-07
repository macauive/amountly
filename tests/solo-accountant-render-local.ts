import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { hash } from 'bcryptjs'
import { unzipSync, strFromU8 } from 'fflate'

// This mutating rehearsal refuses every deployed database and app destination.
const url = new URL(process.env.RENDER_TEST_ADMIN_URL ?? '')
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'54399');assert.equal(url.pathname,'/render_rehearsal')
const base = 'http://127.0.0.1:4193'
const database = new Pool({connectionString:url.href,max:1})
const users = [randomUUID(),randomUUID()]
const emails = users.map(id=>`packet-${id}@example.invalid`)
const password = randomBytes(24).toString('hex')
const expenses = Array.from({length:7},()=>randomUUID())
const invoiceId = randomUUID(),paymentId = randomUUID(),clientId = randomUUID()
const ownPath = `${users[0]}/${randomUUID()}.png`,foreignPath = `${users[1]}/${randomUUID()}.pdf`
const missingPath = `${users[0]}/${randomUUID()}.pdf`
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64')
let cookie = ''
const packetQuery = new URLSearchParams({year:'2026',month:'1',start:'2026-01-01',end:'2026-03-31',currency:'USD',basis:'cash'})
async function api(path:string,method='GET',body?:unknown,extra:Record<string,string>={}) {
  return fetch(base+path,{method,headers:{Origin:base,Cookie:cookie,...(body?{'Content-Type':'application/json'}:{}),...extra},body:body?JSON.stringify(body):undefined,redirect:'manual'})
}
async function saved(id:string) {
  const response = await api(`/api/data/expenses?id=eq.${id}&select=id,status,reviewed_at,updated_at,amount`)
  assert.equal(response.status,200)
  const rows = await response.json();assert.equal(rows.length,1);return rows[0]
}
async function marker(id:string,reviewed:boolean,version:string) {
  return api('/api/data/rpc/set_expense_review','POST',{p_id:id,p_reviewed:reviewed,p_expected_updated_at:version})
}
async function packet(extra='') {return api(`/api/reports/accountant?${packetQuery}${extra}`)}
async function main() {
  await database.query("set request.jwt.claims = '{\"role\":\"service_role\"}'")
  for(const [index,id] of users.entries()) {
    await database.query('insert into amountly_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt",disabled) values($1,\'Synthetic packet test\',$2,true,now(),now(),false)',[id,emails[index]])
    await database.query('insert into amountly_auth.account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") values($1,$2::text,\'credential\',$2::uuid,$3,now(),now())',[randomUUID(),id,await hash(password,10)])
    await database.query("insert into public.users(id,email,name,role,account_type,is_active) values($1,$2,'Synthetic packet test','MEMBER','freelancer',true)",[id,emails[index]])
  }
  await database.query('insert into amountly_files.receipts(path,owner_id,content_type,contents) values($1,$2,\'image/png\',$3),($4,$5,\'application/pdf\',$6)',[ownPath,users[0],png,foreignPath,users[1],Buffer.from('%PDF-1.7\nSynthetic foreign receipt\n%%EOF')])
  const seeds = [
    ['2026-01-01','USD','DRAFT',ownPath,null,users[0]],
    ['2026-03-31','USD','DRAFT',missingPath,null,users[0]],
    ['2026-02-01','USD','DRAFT',null,null,users[0]],
    ['2026-04-01','USD','DRAFT',null,null,users[0]],
    ['2026-02-01','EUR','DRAFT',null,null,users[0]],
    ['2026-02-01','USD','REJECTED',null,null,users[0]],
    ['2026-02-01','USD','DRAFT',foreignPath,null,users[1]],
  ]
  for(const [index,[date,currency,status,path,archived,owner]] of seeds.entries()) {
    await database.query("insert into public.expenses(id,user_id,amount,currency,category,description,merchant,expense_date,status,receipt_path,archived_at) values($1,$2,12.5,$3,'SOFTWARE','=Synthetic CSV-safe expense','Synthetic merchant',$4,$5,$6,$7)",[expenses[index],owner,currency,date,status,path,archived])
  }
  await database.query("insert into public.clients(id,user_id,name) values($1,$2,'Synthetic packet client')",[clientId,users[0]])
  await database.query("insert into public.invoices(id,user_id,client_id,invoice_number,issue_date,due_date,currency,subtotal,total,status) values($1,$2,$3,'PACKET-'||$4,'2026-01-01','2026-02-01','USD',100,100,'SENT')",[invoiceId,users[0],clientId,invoiceId.slice(-8)])
  await database.query("insert into public.invoice_payments(id,invoice_id,amount,paid_on,method,recorded_by) values($1,$2,25,'2026-02-15','other',$3)",[paymentId,invoiceId,users[0]])
  const anonymous = await packet();assert.equal(anonymous.status,401);assert.equal(anonymous.headers.get('Content-Disposition'),null)
  const login = await api('/api/auth/sign-in/email','POST',{email:emails[0],password})
  assert.equal(login.status,200)
  cookie = login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
  const before = await saved(expenses[0])
  assert.equal((await marker(expenses[0],true,before.updated_at)).status,204)
  const reviewed = await saved(expenses[0]);assert.ok(reviewed.reviewed_at);assert.equal(reviewed.status,'DRAFT')
  assert.equal((await marker(expenses[0],false,before.updated_at)).status,409)
  const forged = await api(`/api/data/expenses?id=eq.${expenses[0]}`,'PATCH',{reviewed_at:'2026-01-01T00:00:00Z'})
  assert.equal(forged.status,403)
  const foreign = (await database.query('select updated_at from public.expenses where id=$1',[expenses[6]])).rows[0]
  assert.equal((await marker(expenses[6],true,foreign.updated_at.toISOString())).status,403)
  const edited = await api(`/api/data/expenses?id=eq.${expenses[0]}`,'PATCH',{amount:14})
  assert.equal(edited.status,204)
  const changed = await saved(expenses[0]);assert.equal(changed.reviewed_at,null);assert.equal(changed.status,'DRAFT')
  assert.equal((await marker(expenses[0],true,changed.updated_at)).status,204)
  const history = await api(`/api/data/record_events?record_type=eq.expenses&record_id=eq.${expenses[0]}&select=action`)
  assert.equal(history.status,200);const events=await history.json()
  assert.ok(events.some((event:{action:string})=>event.action==='reviewed'));assert.ok(events.some((event:{action:string})=>event.action==='review_cleared'))
  const download = await packet();assert.equal(download.status,200)
  assert.equal(download.headers.get('Cache-Control'),'private, no-store')
  assert.equal(download.headers.get('Content-Type'),'application/zip')
  const files = unzipSync(new Uint8Array(await download.arrayBuffer()))
  assert.deepEqual(Buffer.from(files[`receipts/${expenses[0]}.png`]),png)
  const records = strFromU8(files['records.csv']),index = strFromU8(files['receipt-index.csv'])
  assert.equal(records.split('\r\n').length,5)
  for(const id of [paymentId,...expenses.slice(0,3)])assert.ok(records.includes(id))
  for(const id of [invoiceId,...expenses.slice(3)])assert.equal(records.includes(id),false)
  assert.match(records,/"25","RECEIVED"/);assert.match(records,/"'=Synthetic CSV-safe expense"/)
  assert.equal(index.split('\r\n').length,4);assert.match(index,/"Reviewed"/);assert.match(index,/"missing"/);assert.match(index,/"none"/)
  assert.equal(index.includes(ownPath),false);assert.equal(index.includes(foreignPath),false)
  packetQuery.set('basis','accrual')
  const issued = await packet();assert.equal(issued.status,200)
  const issuedRecords = strFromU8(unzipSync(new Uint8Array(await issued.arrayBuffer()))['records.csv'])
  assert.ok(issuedRecords.includes(invoiceId));assert.equal(issuedRecords.includes(paymentId),false);assert.match(issuedRecords,/"100","SENT"/)
  assert.equal((await packet(`&user_id=${users[1]}`)).status,400)
  assert.equal((await api(`/api/reports/accountant?${packetQuery}`,'GET',undefined,{Origin:'https://foreign.invalid'})).status,403)
  await database.query('update public.expenses set receipt_path=$1 where id=$2',[foreignPath,expenses[0]])
  const unsafe = await packet();assert.equal(unsafe.status,422);assert.equal(unsafe.headers.get('Content-Disposition'),null)
  await database.query('update public.expenses set receipt_path=$1 where id=$2',[ownPath,expenses[0]])
  await database.query('update public.users set is_active=false where id=$1',[users[0]])
  assert.equal((await packet()).status,403)
  await database.query('update public.users set is_active=true where id=$1',[users[0]])
  assert.equal((await api('/api/auth/sign-out','POST',{})).status,200)
  const revoked = await packet();assert.equal(revoked.status,401);assert.equal(revoked.headers.get('Content-Disposition'),null)
  console.log('PASS: real cookie sessions, optimistic solo review, forged/foreign marker denial, automatic clearing/history, scoped cash/accrual packets, exact private originals, missing index, CSV safety, disablement and revocation; no provider calls')
}
main().catch(error=>{console.error(error.message);process.exitCode=1}).finally(async()=>{
  await database.query('delete from public.invoice_payments where invoice_id=$1',[invoiceId]).catch(()=>{})
  await database.query('delete from public.invoices where id=$1',[invoiceId]).catch(()=>{})
  await database.query('delete from public.clients where id=$1',[clientId]).catch(()=>{})
  for(const id of users) {
    await database.query('delete from public.expenses where user_id=$1',[id]).catch(()=>{})
    await database.query('delete from amountly_files.receipts where owner_id=$1',[id]).catch(()=>{})
    await database.query('delete from amountly_auth."user" where id=$1',[id]).catch(()=>{})
    await database.query('delete from public.users where id=$1',[id]).catch(()=>{})
    await database.query('delete from auth.users where id=$1',[id]).catch(()=>{})
  }
  await database.end()
})
