const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
const {execFileSync}=require('node:child_process')
const {randomUUID}=require('node:crypto')
const {Pool}=require('pg')
const appLoader=require('./load-app.cjs')
const bin=execFileSync('pg_config',['--bindir'],{encoding:'utf8'}).trim()
const id=randomUUID(),foreign=randomUUID(),inactive=randomUUID()
const fields={amount:'',currency:'USD',category:'OTHER',description:'',merchant:'',expense_date:'',project_id:'',notes:''}
const payload={method:'manual',fields,text:'',extraction:null,extracted:false}
function sqlFile(){return fs.readFileSync('ops/render/capture-drafts.sql','utf8')}

test('private draft HTTP lifecycle, RLS, stale writers, response-loss recovery and bounded storage',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'amt-capture-')),socket=fs.mkdtempSync('/private/tmp/amt-sock-'),data=path.join(root,'data')
  let started=false,pool
  const psql=['-X','-qAt','-v','ON_ERROR_STOP=1','-h',socket,'-U','amountly_test','-d','postgres']
  const sql=text=>execFileSync(path.join(bin,'psql'),[...psql,'-c',text],{encoding:'utf8',stdio:'pipe'}).trim()
  try {
    execFileSync(path.join(bin,'initdb'),['-D',data,'-A','trust','-U','amountly_test','--no-locale'],{stdio:'pipe'})
    execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-l',path.join(root,'postgres.log'),'-o',`-k ${socket} -h ''`,'-w','start'],{stdio:'pipe'});started=true
    sql(`create role authenticated;create role amountly_data_runtime login noinherit;grant authenticated to amountly_data_runtime;create schema auth;create table auth.users(id uuid primary key);create table public.users(id uuid primary key,is_active boolean);create function auth.uid() returns uuid language sql stable as $$select (coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'sub')::uuid$$;grant usage on schema auth,public to authenticated;grant select on public.users to authenticated;insert into auth.users values('${id}'),('${foreign}'),('${inactive}');insert into public.users values('${id}',true),('${foreign}',true),('${inactive}',false);`)
    sql(sqlFile());sql(sqlFile())
    sql('create table amountly_files.receipts(path text primary key,owner_id uuid not null,content_type text not null,contents bytea not null,created_at timestamptz default now())')
    sql('grant select,insert on amountly_files.receipts to authenticated;alter table amountly_files.receipts enable row level security;create policy own_receipt on amountly_files.receipts to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid())')
    sql(fs.readFileSync('ops/render/receipt-storage-quota.sql','utf8'))
    let identity=id
    class OwnedPool extends Pool {constructor(){super({host:socket,user:'amountly_data_runtime',database:'postgres',max:2});pool=this}}
    const {AiHttpError}=appLoader()('src/lib/ai/server.ts')
    const validator=appLoader({'./server':{AiHttpError}})('src/lib/ai/receipt-file.ts')
    const load=appLoader({'@/lib/ai/receipt-file':validator,'pg':{Pool:OwnedPool},'@/lib/platform/server':{
      requireIdentity:async headers=>{if(!headers.get('authorization'))throw new AiHttpError(401,'Denied');return{id:identity,email:'sample@example.invalid'}},
      validateOrigin:headers=>{if(headers.get('origin')!=='http://127.0.0.1:4174')throw new AiHttpError(403,'Denied')},
    },'@/lib/ai/server':{AiHttpError}},{NEXT_PUBLIC_BACKEND:'render',DATA_DATABASE_URL:'local-test-only'})
    const route=load('src/app/api/capture-drafts/route.ts')
    async function request(method,input,extra={}) {
      const headers={origin:'http://127.0.0.1:4174',authorization:'fixture',...extra}
      let body
      if(method==='PUT'){body=new FormData();body.set('metadata',JSON.stringify(input))}
      if(method==='DELETE'){headers['content-type']='application/json';body=JSON.stringify(input)}
      return route[method](new Request('http://127.0.0.1:4174/api/capture-drafts',{method,headers,body}))
    }
    assert.equal((await request('GET',null,{authorization:''})).status,401)
    assert.equal((await request('GET',null,{origin:'https://foreign.invalid'})).status,403)
    const draftId=randomUUID(),input={id:draftId,revision:0,payload}
    const created=await request('PUT',input);assert.equal(created.status,200)
    const first=await created.json();assert.equal(first.revision,1);assert.equal(first.payload.fields.amount,'')
    const recovery=await request('PUT',input);assert.equal(recovery.status,200);assert.equal((await recovery.json()).revision,1)
    const updatedInput={id:draftId,revision:1,payload:{...payload,fields:{...fields,merchant:'Synthetic cafe'}}}
    assert.equal((await request('PUT',updatedInput)).status,200)
    assert.equal((await request('PUT',{...input,payload:{...payload,text:'Different'}})).status,409)
    assert.equal((await request('DELETE',{id:draftId,revision:1})).status,409)
    identity=foreign
    assert.deepEqual(await (await request('GET')).json(),[])
    assert.equal((await request('DELETE',{id:draftId,revision:2})).status,409)
    assert.equal((await request('PUT',{...updatedInput,revision:2})).status,409)
    identity=inactive
    assert.deepEqual(await (await request('GET')).json(),[])
    assert.notEqual((await request('PUT',{id:randomUUID(),revision:0,payload})).status,200)
    identity=id
    const malformed=await request('PUT',{...input,owner_id:foreign});assert.equal(malformed.status,400)
    const duplicate=new FormData();duplicate.append('metadata',JSON.stringify(input));duplicate.append('metadata',JSON.stringify(input))
    assert.equal((await route.PUT(new Request('http://127.0.0.1:4174/api/capture-drafts',{method:'PUT',headers:{origin:'http://127.0.0.1:4174',authorization:'fixture'},body:duplicate}))).status,400)
    for(let n=1;n<9;n++)assert.equal((await request('PUT',{id:randomUUID(),revision:0,payload})).status,200)
    const concurrent=await Promise.all([request('PUT',{id:randomUUID(),revision:0,payload}),request('PUT',{id:randomUUID(),revision:0,payload})])
    assert.deepEqual(concurrent.map(response=>response.status).sort(),[200,413])
    assert.equal(sql('select count(*) from amountly_files.capture_drafts where owner_id=\''+id+'\''),'10')
    assert.equal((await request('DELETE',{id:draftId,revision:2})).status,204)
    const sharp=require('sharp'),bytes=await sharp({create:{width:40,height:40,channels:3,background:'white'}}).png().toBuffer()
    const fileInput={id:randomUUID(),revision:0,payload:{...payload,method:'file'}}
    const form=new FormData();form.set('metadata',JSON.stringify(fileInput));form.set('file',new File([bytes],'receipt.png',{type:'image/png'}))
    const saved=await route.PUT(new Request('http://127.0.0.1:4174/api/capture-drafts',{method:'PUT',headers:{origin:'http://127.0.0.1:4174',authorization:'fixture'},body:form}));assert.equal(saved.status,200)
    const original=await route.GET(new Request('http://127.0.0.1:4174/api/capture-drafts?id='+fileInput.id+'&file=1&revision=1',{headers:{origin:'http://127.0.0.1:4174',authorization:'fixture'}}))
    assert.equal(original.status,200);assert.deepEqual(Buffer.from(await original.arrayBuffer()),bytes)
    identity=foreign
    assert.equal((await route.GET(new Request('http://127.0.0.1:4174/api/capture-drafts?id='+fileInput.id+'&file=1&revision=1',{headers:{origin:'http://127.0.0.1:4174',authorization:'fixture'}}))).status,404)
    identity=id
    form.set('metadata',JSON.stringify({...fileInput,revision:1,payload:{...fileInput.payload,text:'Newer capture'}}))
    assert.equal((await route.PUT(new Request('http://127.0.0.1:4174/api/capture-drafts',{method:'PUT',headers:{origin:'http://127.0.0.1:4174',authorization:'fixture'},body:form}))).status,200)
    assert.equal((await route.GET(new Request('http://127.0.0.1:4174/api/capture-drafts?id='+fileInput.id+'&file=1&revision=1',{headers:{origin:'http://127.0.0.1:4174',authorization:'fixture'}}))).status,404,'old draft metadata cannot retrieve a changed original')
    assert.equal((await request('PUT',{...input,payload:{...payload,fields:{...fields,user_id:foreign}}})).status,400)
    const oversize=new Request('http://127.0.0.1:4174/api/capture-drafts',{method:'PUT',headers:{origin:'http://127.0.0.1:4174',authorization:'fixture','content-type':'multipart/form-data; boundary=x','content-length':'999999999'},body:'x'})
    assert.equal((await route.PUT(oversize)).status,413)
    const controller=new AbortController();controller.abort()
    assert.equal((await route.PUT(new Request('http://127.0.0.1:4174/api/capture-drafts',{method:'PUT',headers:{origin:'http://127.0.0.1:4174',authorization:'fixture','content-type':'multipart/form-data; boundary=x'},body:'x',signal:controller.signal}))).status,408)
    const bad=new FormData();bad.set('metadata',JSON.stringify(fileInput));bad.set('file',new File(['<svg/>'],'receipt.png',{type:'image/png'}))
    assert.equal((await route.PUT(new Request('http://127.0.0.1:4174/api/capture-drafts',{method:'PUT',headers:{origin:'http://127.0.0.1:4174',authorization:'fixture'},body:bad}))).status,400)
    assert.equal(sql("select count(*) from pg_tables where schemaname='public' and tablename in ('expenses','invoices','bills','vendor_bills')"),'0','draft endpoint does not require/write financial tables')
  }finally{if(pool)await pool.end();if(started)execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-m','fast','-w','stop'],{stdio:'pipe'});fs.rmSync(root,{recursive:true,force:true});fs.rmSync(socket,{recursive:true,force:true})}
})
