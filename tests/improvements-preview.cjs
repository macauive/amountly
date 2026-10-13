// Local-only sample backend around the actual Next UI. No .env files are read;
// no production account, AI provider, database or email transport is available.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {execFileSync}=require('node:child_process')
const {createServer}=require('node:http')
const {Pool}=require('pg')
const sharp=require('sharp')
const appLoader=require('./load-app.cjs')
const next=require('next')
const origin='http://127.0.0.1:4174'
if(process.env.NODE_ENV==='production'||fs.existsSync('.env.local')||fs.existsSync('.env'))throw Error('Run preview in an isolated copy without environment files.')
for(const key of Object.keys(process.env))if(/(?:SECRET|KEY|DATABASE_URL|SMTP|TOKEN)/.test(key))delete process.env[key]
process.env.NODE_ENV='development';process.env.NEXT_PUBLIC_BACKEND='render';process.env.AMOUNTLY_APP_ORIGIN=origin
const bin=execFileSync('pg_config',['--bindir'],{encoding:'utf8'}).trim()
const root=fs.mkdtempSync(path.join(os.tmpdir(),'amt-preview-')),socket=fs.mkdtempSync('/private/tmp/amt-preview-sock-'),data=path.join(root,'data')
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,owner=id(1)
const stamp='2026-10-12T12:00:00Z'
const profile={id:owner,name:'Sample workspace · local preview',email:'preview@example.invalid',account_type:'freelancer',role:'MEMBER',is_active:true,organization_id:null,created_at:stamp,updated_at:stamp,preferences:{currency:'USD',date_format:'MM/DD/YYYY',fiscal_year_start:1}}
const tables={users:[profile],organizations:[],clients:[{id:id(20),user_id:owner,organization_id:null,name:'Paper Studio',email:'client@example.invalid',created_at:stamp}],projects:[],tasks:[],vendors:[{id:id(30),user_id:owner,organization_id:null,name:'Harbor Print',status:'active',created_at:stamp}],purchase_orders:[],time_entries:[],invoice_payments:[],record_events:[],workspace_contacts:[]}
tables.expenses=[
 {id:id(40),merchant:'Paper Studio',description:'Notebooks and postage',amount:58.2,expense_date:'2026-10-01',receipt_path:`${owner}/${id(80)}.png`},
 {id:id(41),merchant:'Paper Studio',description:'September printing',amount:145,expense_date:'2026-09-22',receipt_path:`${owner}/${id(81)}.png`},
 {id:id(42),merchant:'Harbor Print',description:'Two-page supplier receipt',amount:26.75,expense_date:'2026-10-05',receipt_path:`${owner}/${id(82)}.pdf`},
 {id:id(43),merchant:'Paper Studio',description:'October stationery, missing original',amount:29.5,expense_date:'2026-10-10',receipt_path:null},
].map(row=>({...row,user_id:owner,category:'OFFICE_SUPPLIES',currency:'USD',status:'DRAFT',receipt_url:null,archived_at:null,reviewed_at:null,created_at:stamp,updated_at:stamp,project_id:null,project:null,notes:''}))
tables.invoices=[{id:id(50),user_id:owner,organization_id:null,client_id:id(20),client:tables.clients[0],invoice_number:'INV-2026-001',issue_date:'2026-10-01',due_date:'2026-10-10',subtotal:1200,total:1200,tax_amount:0,tax_rate:0,currency:'USD',status:'SENT',payments:[],line_items:[],created_at:stamp,updated_at:stamp,notes:'Website design'}]
tables.vendor_bills=[{id:id(60),user_id:owner,organization_id:null,vendor_id:id(30),vendor:tables.vendors[0],bill_number:'BILL-2026-101',issue_date:'2026-10-01',date:'2026-10-01',due_date:'2026-10-11',subtotal:80,total:80,tax_amount:0,tax_rate:0,currency:'USD',status:'overdue',line_items:[],created_at:stamp,updated_at:stamp,notes:'Sample print supplier'}]
tables.bills=[]
const originals=new Map(),financialRequests=new Map()
let started=false,pool,server,app
function sql(text){return execFileSync(path.join(bin,'psql'),['-X','-qAt','-v','ON_ERROR_STOP=1','-h',socket,'-U','amountly_test','-d','postgres','-c',text],{encoding:'utf8',stdio:'pipe'}).trim()}
function json(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value))}
function validBrowser(req){const requestOrigin=req.headers.origin;return !requestOrigin||requestOrigin===origin||requestOrigin==='http://localhost:4174'}
async function bytes(req,limit=11*1024*1024){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw Error('Input too large');chunks.push(chunk)}return Buffer.concat(chunks)}
function rowsFor(table,url){let rows=tables[table]||[];for(const [key,value]of url.searchParams){if(['select','order','offset','limit'].includes(key))continue;const [op,...parts]=value.split('.'),operand=parts.join('.');if(op==='eq')rows=rows.filter(r=>String(r[key])===operand);if(op==='neq')rows=rows.filter(r=>String(r[key])!==operand);if(op==='is'&&operand==='null')rows=rows.filter(r=>r[key]==null);if(op==='gte')rows=rows.filter(r=>String(r[key])>=operand);if(op==='lte')rows=rows.filter(r=>String(r[key])<=operand);if(op==='lt')rows=rows.filter(r=>String(r[key])<operand);if(op==='in'){const allowed=operand.slice(1,-1).split(',');rows=rows.filter(r=>allowed.includes(String(r[key])))}}
 return rows.slice(Number(url.searchParams.get('offset')||0),Number(url.searchParams.get('offset')||0)+Number(url.searchParams.get('limit')||200))}
function pdfReceipt(){const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',null,null,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];for(let i=0;i<2;i++){const stream=`BT /F1 20 Tf 60 700 Td (HARBOR PRINT - SAMPLE RECEIPT) Tj 0 -50 Td (Page ${i+1} of 2) Tj 0 -50 Td (${i?'Paid total USD 26.75':'Date 2026-10-05 - Office supplies'}) Tj ET`;objects[4+i]=`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`}
 let text='%PDF-1.7\n',offsets=[0];objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${obj}\nendobj\n`});const start=Buffer.byteLength(text);text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;return Buffer.from(text)}
async function main(){
 execFileSync(path.join(bin,'initdb'),['-D',data,'-A','trust','-U','amountly_test','--no-locale'],{stdio:'pipe'})
 execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-l',path.join(root,'postgres.log'),'-o',`-k ${socket} -h ''`,'-w','start'],{stdio:'pipe'});started=true
 sql(`create role authenticated;create role amountly_data_runtime login noinherit;grant authenticated to amountly_data_runtime;create schema auth;create table auth.users(id uuid primary key);create table public.users(id uuid primary key,is_active boolean);create function auth.uid() returns uuid language sql stable as $$select (coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'sub')::uuid$$;grant usage on schema auth,public to authenticated;grant select on public.users to authenticated;insert into auth.users values('${owner}');insert into public.users values('${owner}',true);`)
 sql(fs.readFileSync('ops/render/capture-drafts.sql','utf8'))
 // Match the production storage boundary in this isolated sample backend.
 sql('create table amountly_files.receipts(path text primary key,owner_id uuid not null,content_type text not null,contents bytea not null,created_at timestamptz default now())')
 sql('grant select,insert on amountly_files.receipts to authenticated;alter table amountly_files.receipts enable row level security;create policy own_receipt on amountly_files.receipts to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid())')
 sql(fs.readFileSync('ops/render/receipt-storage-quota.sql','utf8'))
 class OwnedPool extends Pool{constructor(){super({host:socket,user:'amountly_data_runtime',database:'postgres',max:2});pool=this}}
 const {AiHttpError}=appLoader()('src/lib/ai/server.ts')
 const validator=appLoader({'./server':{AiHttpError}})('src/lib/ai/receipt-file.ts')
 const route=appLoader({'pg':{Pool:OwnedPool},'@/lib/ai/receipt-file':validator,'@/lib/ai/server':{AiHttpError},'@/lib/platform/server':{requireIdentity:async()=>({id:owner,email:profile.email}),validateOrigin:headers=>{const o=headers.get('origin');if(o&&![origin,'http://localhost:4174'].includes(o))throw new AiHttpError(403,'Denied')} }},{NEXT_PUBLIC_BACKEND:'render',DATA_DATABASE_URL:'local-only-fixture'})('src/app/api/capture-drafts/route.ts')
 const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="680" height="860"><rect width="680" height="860" fill="#fffaf0"/><g fill="#182d27" font-family="Arial"><text x="70" y="100" font-size="34">PAPER STUDIO</text><text x="70" y="160" font-size="20">SAMPLE RECEIPT - NOT REAL FINANCIAL DATA</text><text x="70" y="220" font-size="22">2026-10-01</text><text x="70" y="320" font-size="24">Notebooks and postage</text><text x="70" y="410" font-size="24">Subtotal USD 54.00</text><text x="70" y="460" font-size="24">Tax USD 4.20</text><text x="70" y="560" font-size="36">PAID TOTAL USD 58.20</text><text x="70" y="720" font-size="22">Keep this original for your records.</text></g></svg>`)
 const png=await sharp(svg).png().toBuffer();const pdf=pdfReceipt()
 originals.set(`${owner}/${id(80)}.png`,{bytes:png,type:'image/png'});originals.set(`${owner}/${id(81)}.png`,{bytes:png,type:'image/png'});originals.set(`${owner}/${id(82)}.pdf`,{bytes:pdf,type:'application/pdf'})
 fs.mkdirSync(path.join(root,'samples'));fs.writeFileSync(path.join(root,'samples','sample-receipt.png'),png);fs.writeFileSync(path.join(root,'samples','sample-receipt.pdf'),pdf)
 // Seed one genuinely persisted unfinished capture through the production handler.
 const form=new FormData();form.set('metadata',JSON.stringify({id:id(90),revision:0,payload:{method:'file',fields:{amount:'58.20',currency:'USD',category:'OFFICE_SUPPLIES',description:'Notebooks and postage',merchant:'Paper Studio',expense_date:'2026-10-01',project_id:'',notes:''},text:'',extraction:{document_type:'receipt',amount:'58.20',currency:'USD',merchant:'Paper Studio',description:'Notebooks and postage',expense_date:'2026-10-01',category:'OFFICE_SUPPLIES',confidence:'high',reason:'Synthetic extraction for local preview.',summary:'Check this sample original.'},extracted:true}}));form.set('file',new File([png],'sample-receipt.png',{type:'image/png'}));const kept=await route.PUT(new Request(origin+'/api/capture-drafts',{method:'PUT',headers:{Origin:origin},body:form}));if(!kept.ok)throw Error('Preview draft seed failed')
 app=next({dev:true,webpack:true,hostname:'127.0.0.1',port:4174,dir:process.cwd()});await app.prepare();const handle=app.getRequestHandler()
 const {summarizeRecord}=appLoader()('src/lib/financial-review/service.ts')
 server=createServer(async(req,res)=>{try{
  if(!['127.0.0.1:4174','localhost:4174'].includes(req.headers.host)||!validBrowser(req))return json(res,{error:'Local preview only'},403)
  const url=new URL(req.url,origin),pathname=url.pathname
  if(pathname==='/api/auth/get-session')return json(res,{user:{id:owner,email:profile.email,name:profile.name,emailVerified:true,createdAt:stamp}})
  if(pathname==='/api/capture-drafts'){
    const headers=new Headers();for(const[name,value]of Object.entries(req.headers))if(typeof value==='string')headers.set(name,value)
    const body=['GET','HEAD'].includes(req.method)?undefined:new Uint8Array(await bytes(req))
    if(!route[req.method])return json(res,{error:'Method not allowed'},405)
    const response=await route[req.method](new Request(url,{method:req.method,headers,body}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return
  }
  if(pathname==='/api/ai/receipt')return json(res,{document_type:'receipt',amount:'58.20',currency:'USD',merchant:'Paper Studio',description:'Notebooks and postage',expense_date:'2026-10-01',category:'OFFICE_SUPPLIES',confidence:'high',reason:'Simulated extraction; no provider was called.',summary:'Sample proposal. Verify it against the original.'})
  if(pathname==='/api/ai')return json(res,{error:'AI is disabled in this sample preview.'},503)
  if(pathname==='/api/receipts/upload'&&req.method==='PUT'){const file=await bytes(req,10*1024*1024);const mime=req.headers['content-type'];await validator.validateReceiptFile(file,mime);const objectPath=`${owner}/${require('node:crypto').randomUUID()}.${mime==='application/pdf'?'pdf':'png'}`;originals.set(objectPath,{bytes:file,type:mime});return json(res,{path:objectPath},201)}
  if(pathname.startsWith('/api/receipts/')){const object=originals.get(decodeURIComponent(pathname.slice('/api/receipts/'.length)));if(!object)return json(res,{error:'Unavailable'},404);res.writeHead(200,{'Content-Type':object.type,'Cache-Control':'private, no-store'});res.end(object.bytes);return}
  if(pathname==='/api/financial-review/record'){const input=JSON.parse(await bytes(req,2048)),row=(tables[input.kind]||[]).find(r=>r.id===input.id);if(!row)return json(res,{error:'Unavailable'},404);const normalized=input.kind==='vendor_bills'?{...row,amount:row.total,name:row.bill_number,kind:input.kind}:input.kind==='expenses'?{...row,organization_id:null}:row;return json(res,summarizeRecord(input.kind,normalized))}
  if(pathname==='/api/financial-review'){const period=JSON.parse(await bytes(req,2048));const {calculateReview}=appLoader()('src/lib/financial-review/calculate.ts');return json(res,calculateReview({invoices:tables.invoices,payments:[],bills:tables.vendor_bills.map(r=>({...r,amount:r.total,name:r.bill_number,kind:'vendor_bills'})),expenses:tables.expenses.map(r=>({...r,organization_id:null}))},period,'2026-10-12'))}
  if(pathname.startsWith('/api/data/rpc/')){const command=pathname.split('/').pop(),input=JSON.parse(await bytes(req,262144))
    if(command==='create_money_record'&&input.p_kind==='expenses'){
      const old=financialRequests.get(input.p_id),serialized=JSON.stringify(input.p_data)
      if(old&&old!==serialized)return json(res,{code:'PT409'},409)
      if(!old){financialRequests.set(input.p_id,serialized);tables.expenses.unshift({...input.p_data,id:input.p_id,updated_at:new Date().toISOString(),created_at:new Date().toISOString(),reviewed_at:null,archived_at:null,receipt_url:null,notes:input.p_data.notes??'',project:null});tables.record_events.unshift({id:require('node:crypto').randomUUID(),record_type:'expenses',record_id:input.p_id,action:'created',next_values:input.p_data,changed_fields:[],created_at:new Date().toISOString()})}
      return json(res,input.p_id)
    }
    if(command==='set_expense_review'){const row=tables.expenses.find(r=>r.id===input.p_id);if(!row||row.updated_at!==input.p_expected_updated_at)return json(res,{code:'PT409'},409);row.reviewed_at=input.p_reviewed?new Date().toISOString():null;row.updated_at=new Date().toISOString();return json(res,null)}
    return json(res,{error:'This sample action is not implemented.'},400)
  }
  if(pathname.startsWith('/api/data/')){const table=pathname.split('/').pop();if(!Object.hasOwn(tables,table))return json(res,{error:'Unavailable'},404)
    if(req.method==='PATCH'&&table==='expenses'){const rows=rowsFor(table,url),patch=JSON.parse(await bytes(req,262144));for(const row of rows)Object.assign(row,patch,{reviewed_at:null,updated_at:new Date().toISOString()});return json(res,rows[0]||null)}
    if(req.method!=='GET')return json(res,{error:'This sample action is not implemented.'},405)
    const rows=rowsFor(table,url);return json(res,String(req.headers.accept||'').includes('application/vnd.pgrst.object+json')?(rows[0]||null):rows)
  }
  if(pathname.startsWith('/api/')&&pathname!=='/api/receipt-viewer-worker')return json(res,{error:'Only sample operations are available.'},404)
  await handle(req,res)
 }catch(error){if(!res.headersSent)json(res,{error:'Sample request could not complete.'},500);else res.end();console.error('Sample request failed:',error instanceof Error?error.message:'unknown')}})
 server.on('upgrade',(req,sock,head)=>app.getUpgradeHandler()(req,sock,head))
 await new Promise(resolve=>server.listen(4174,'127.0.0.1',resolve))
 console.log('Preview ready:',origin+'/expenses')
 console.log('Synthetic receipt files:',path.join(root,'samples'))
}
async function close(){server?.close();await app?.close();if(pool)await pool.end();if(started)execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-m','fast','-w','stop'],{stdio:'pipe'});process.exit()}
process.on('SIGTERM',close);process.on('SIGINT',close)
main().catch(error=>{console.error(error.message);void close()})
