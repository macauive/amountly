import assert from 'node:assert/strict'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { hash } from 'bcryptjs'
import sharp from 'sharp'

// Explicitly refuse deployed targets. All fixtures belong to this local rehearsal.
const url = new URL(process.env.RENDER_TEST_ADMIN_URL ?? '')
assert.equal(url.protocol,'postgresql:');assert.equal(url.hostname,'127.0.0.1')
assert.equal(url.port,'54399');assert.equal(url.pathname,'/render_rehearsal');assert.equal(url.search,'')
const base='http://127.0.0.1:4192',origin='https://amountly.local.invalid',database=new Pool({connectionString:url.href,max:1})
const users=[randomUUID(),randomUUID()],password=randomBytes(24).toString('hex')
const emails=users.map(id=>`capture-${id}@example.invalid`)
const draftId=randomUUID(), expenseId=randomUUID(), boundaryExpenseId=randomUUID()
let cookie=''
const fields={amount:'12.50',currency:'USD',category:'OFFICE_SUPPLIES',description:'Synthetic paper',merchant:'Rehearsal Shop',expense_date:'2026-10-12',project_id:'',notes:''}
const payload={method:'file',fields,text:'',extraction:null,extracted:false}
async function api(path:string,method='GET',body?:BodyInit,extra:Record<string,string>={}) {
 return fetch(base+path,{method,headers:{Origin:origin,Cookie:cookie,...extra},body,redirect:'manual'})
}
async function login(index:number) {
 const response=await api('/api/auth/sign-in/email','POST',JSON.stringify({email:emails[index],password}),{'Content-Type':'application/json'})
 assert.equal(response.status,200);assert.match(response.headers.get('set-cookie')??'',/HttpOnly/);assert.match(response.headers.get('set-cookie')??'',/Secure/)
 cookie=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
 assert.ok(cookie);assert.equal((await response.json()).token,undefined)
}
async function moneySnapshot() {
 const tables=(await database.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows
 const snapshot:Record<string,string>={}
 for(const {tablename} of tables) {
  assert.match(tablename,/^[a-z_]+$/)
  snapshot[tablename]=(await database.query(`select md5(coalesce(jsonb_agg(row order by row::text)::text,'[]')) as digest from (select to_jsonb(t) as row from public."${tablename}" t) rows`)).rows[0].digest
 }
 return snapshot
}
async function main(){
 await database.query("set request.jwt.claims = '{\"role\":\"service_role\"}'")
 for(const [index,id] of users.entries()) {
  await database.query('insert into amountly_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt",disabled) values($1,\'Synthetic capture test\',$2,true,now(),now(),false)',[id,emails[index]])
  await database.query('insert into amountly_auth.account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") values($1,$2::text,\'credential\',$2::uuid,$3,now(),now())',[randomUUID(),id,await hash(password,10)])
  await database.query("insert into public.users(id,email,name,role,account_type,is_active) values($1,$2,'Synthetic capture test','MEMBER','freelancer',true)",[id,emails[index]])
 }
 await database.query("insert into public.expenses(id,user_id,amount,currency,category,description,merchant,expense_date,status) values($1,$2,12.5,'USD','OFFICE_SUPPLIES','Synthetic paper','Rehearsal Shop','2026-10-12','DRAFT')",[expenseId,users[0]])
 await database.query("insert into public.expenses(id,user_id,amount,currency,category,description,merchant,expense_date,status) values($1,$2,12.5,'USD','OFFICE_SUPPLIES','UTC boundary fixture','Rehearsal boundary','2026-01-01T00:00:00Z','DRAFT')",[boundaryExpenseId,users[0]])
 const before=await moneySnapshot(),migration=await readFile('ops/render/capture-drafts.sql','utf8')
 await database.query(migration);await database.query(migration)
 await database.query(await readFile('ops/render/receipt-storage-quota.sql','utf8'))
 assert.deepEqual(await moneySnapshot(),before,'migration preserves all existing public table rows')
 assert.equal((await api('/api/capture-drafts')).status,401)
 assert.equal((await api('/api/health')).status,200)
 await login(0)
 const png=await sharp({create:{width:40,height:40,channels:3,background:'white'}}).png().toBuffer()
 const form=new FormData();form.set('metadata',JSON.stringify({id:draftId,revision:0,payload}));form.set('file',new File([new Uint8Array(png)],'synthetic.png',{type:'image/png'}))
 const created=await api('/api/capture-drafts','PUT',form);assert.equal(created.status,200)
 const saved=await created.json();assert.equal(saved.revision,1)
 assert.equal(created.headers.get('cache-control'),'private, no-store')
 const retry=await api('/api/capture-drafts','PUT',form);assert.equal(retry.status,200);assert.equal((await retry.json()).revision,1)
 const originalPath=`/api/capture-drafts?id=${draftId}&file=1&revision=1`
 const original=await api(originalPath);assert.equal(original.status,200)
 assert.deepEqual(Buffer.from(await original.arrayBuffer()),png)
 const preserved=(await database.query('select revision,payload,file_sha256,contents from amountly_files.capture_drafts where id=$1',[draftId])).rows[0]
 await database.query(migration)
 const replay=(await database.query('select revision,payload,file_sha256,contents from amountly_files.capture_drafts where id=$1',[draftId])).rows[0]
 assert.deepEqual(replay,preserved);assert.equal(replay.file_sha256,createHash('sha256').update(png).digest('hex'))
 assert.deepEqual(await moneySnapshot(),before,'private captures do not alter financial or public records')
 assert.equal((await api('/api/data/capture_drafts')).status,404,'private table is not exposed through the Data API')
 assert.equal((await api('/api/capture-drafts','PUT',form,{Origin:'https://foreign.invalid'})).status,403)
 const exported=await api('/api/reports/workspace?year=2026&month=1&currency=USD&basis=cash');assert.equal(exported.status,200);const csv=await exported.text();assert.ok(csv.includes('UTC boundary fixture'));assert.ok(csv.includes('2026-01-01'));
 const record=await api('/api/financial-review/record','POST',JSON.stringify({kind:'expenses',id:boundaryExpenseId}),{'Content-Type':'application/json'});assert.equal(record.status,200);assert.equal((await record.json()).date,'2026-01-01');
 const ownerCookie=cookie
 await login(1)
 assert.deepEqual(await(await api('/api/capture-drafts')).json(),[])
 assert.equal((await api(originalPath)).status,404)
 assert.equal((await api('/api/capture-drafts','DELETE',JSON.stringify({id:draftId,revision:1}),{'Content-Type':'application/json'})).status,409)
 assert.equal((await api('/api/capture-drafts','PUT',form)).status,503,'foreign draft ID cannot replace another owner')
 cookie=ownerCookie
 await database.query('update public.users set is_active=false where id=$1',[users[0]])
 assert.equal((await api(originalPath)).status,403)
 await database.query('update public.users set is_active=true where id=$1',[users[0]])
 await database.query('update amountly_auth."user" set disabled=true where id=$1',[users[0]])
 assert.equal((await api(originalPath)).status,401)
 await database.query('update amountly_auth."user" set disabled=false where id=$1',[users[0]])
 assert.equal((await api('/api/auth/sign-out','POST','{}',{'Content-Type':'application/json'})).status,200)
 assert.equal((await api('/api/capture-drafts')).status,401)
 assert.equal((await api(originalPath)).status,401)
 await login(0)
 // Retain only synthetic fixtures for the separately authorized in-app browser run.
 const fixturePath=process.env.RENDER_TEST_BROWSER_FIXTURE
 if(fixturePath) await writeFile(fixturePath,JSON.stringify({email:emails[0],password,userId:users[0],otherEmail:emails[1],draftId,expenseId,boundaryExpenseId,cookie}),{mode:0o600})
 const page=await api('/expenses');assert.equal(page.status,200)
 const policy=page.headers.get('content-security-policy')??''
 assert.match(policy,/worker-src 'self' blob:/);assert.equal(policy.includes('unsafe-eval'),false)
 const worker=await api('/api/receipt-viewer-worker');assert.equal(worker.status,200)
 assert.match(worker.headers.get('content-type')??'',/javascript/)
 assert.ok((await worker.arrayBuffer()).byteLength>100000)
 console.log('PASS: production HTTP cookie authentication, revocation/disablement, owner isolation, private bytes, full-schema migration replay with data, unchanged financial records, UTC boundary exports/review, CSP and bundled viewer worker; fixtures are synthetic, no provider or email calls')
}
main().catch(error=>{console.error('Assertion status',typeof error?.actual==='number'?error.actual:'non-numeric',typeof error?.expected==='number'?error.expected:'non-numeric');console.error('Render improvement rehearsal failed:',error?.code==='ERR_ASSERTION'?'assertion at '+String(error.stack).split('\n').find((line:string)=>line.includes('render-improvements-local.ts')):'unavailable');process.exitCode=1}).finally(()=>database.end())
