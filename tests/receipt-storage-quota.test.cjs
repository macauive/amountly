const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
const {execFileSync}=require('node:child_process'),{randomUUID,createHash}=require('node:crypto'),{Pool}=require('pg')
const loadApp=require('./load-app.cjs')
const bin=execFileSync('pg_config',['--bindir'],{encoding:'utf8'}).trim()

test('real receipt/draft storage budgets are atomic, unavoidable, replayable and preserve reads',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'amt-storage-')),socket=fs.mkdtempSync('/private/tmp/amt-storage-sock-')
  const data=path.join(root,'data'),owners=Array.from({length:6},()=>randomUUID())
  let started=false,admin,runtime
  const runtimes=[]
  try {
    execFileSync(path.join(bin,'initdb'),['-D',data,'-A','trust','-U','amountly_test','--no-locale'],{stdio:'pipe'})
    execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-l',path.join(root,'postgres.log'),'-o',`-k ${socket} -h ''`,'-w','start'],{stdio:'pipe'});started=true
    admin=new Pool({host:socket,user:'amountly_test',database:'postgres',max:2})
    await admin.query(fs.readFileSync('ops/render/bootstrap.sql','utf8'))
    await admin.query('create table amountly_auth."user"(id text primary key);create table public.users(id uuid primary key,is_active boolean);grant select on public.users to authenticated;')
    for(const id of owners) {
      await admin.query('insert into auth.users values($1)',[id]);await admin.query('insert into public.users values($1,true)',[id])
    }
    await admin.query(fs.readFileSync('ops/render/platform.sql','utf8'))
    await admin.query(fs.readFileSync('ops/render/capture-drafts.sql','utf8'))
    const migration=fs.readFileSync('ops/render/receipt-storage-quota.sql','utf8')
    let identity=owners[0]
    const {AiHttpError}=loadApp()('src/lib/ai/server.ts')
    const validator=loadApp({'./server':{AiHttpError}})('src/lib/ai/receipt-file.ts')
    class OwnedPool extends Pool {constructor(){super({host:socket,user:'amountly_data_runtime',database:'postgres',max:2});runtime=this;runtimes.push(this)}}
    const load=loadApp({'pg':{Pool:OwnedPool},'@/lib/ai/server':{AiHttpError},'@/lib/ai/receipt-file':validator,'@/lib/platform/server':{
      requireIdentity:async headers=>{if(!headers.get('authorization'))throw new AiHttpError(401,'Denied');return {id:identity,email:'synthetic@example.invalid'}},
      validateOrigin:()=>{},
    }},{NEXT_PUBLIC_BACKEND:'render',DATA_DATABASE_URL:'local-only-test'})
    const route=load('src/app/api/receipts/[...path]/route.ts')
    const captures=load('src/app/api/capture-drafts/route.ts')
    async function upload(bytes=Buffer.from('%PDF-test'),extra={}) {
      return route.PUT(new Request('http://127.0.0.1:4174/api/receipts/upload',{method:'PUT',headers:{authorization:'synthetic-session','content-type':'application/pdf',...extra},body:bytes}),{params:Promise.resolve({path:['upload']})})
    }
    assert.equal((await upload()).status,503,'missing migration rejects uploads before allocation')
    assert.equal((await upload(undefined,{authorization:''})).status,401)
    const legacyPath=owners[0]+'/'+randomUUID()+'.pdf'
    await admin.query('insert into amountly_files.receipts(path,owner_id,content_type,contents) values($1,$2,\'application/pdf\',$3)',[legacyPath,owners[0],Buffer.from('%PDF-preserved')])
    await admin.query(migration);await admin.query(migration)
    const textDraft=randomUUID()
    await admin.query('insert into amountly_files.capture_drafts(id,owner_id,payload) values($1,$2,$3)',[textDraft,owners[5],{}])
    await admin.query(migration)
    await admin.query('update amountly_files.capture_drafts set payload=$1 where id=$2',[{text:'preserved metadata'},textDraft])
    await admin.query('delete from amountly_files.capture_drafts where id=$1',[textDraft])
    const original=await route.GET(new Request('http://127.0.0.1:4174/api/receipts/'+legacyPath,{headers:{authorization:'fixture'}}),{params:Promise.resolve({path:legacyPath.split('/')})})
    assert.equal(original.status,200);assert.equal(Buffer.from(await original.arrayBuffer()).toString(),'%PDF-preserved')
    identity=owners[1]
    assert.equal((await route.GET(new Request('http://127.0.0.1:4174/api/receipts/'+legacyPath,{headers:{authorization:'fixture'}}),{params:Promise.resolve({path:legacyPath.split('/')})})).status,404)
    identity=owners[0]
    await admin.query('alter table amountly_files.receipts disable trigger storage_budget')
    assert.equal((await upload()).status,503);await admin.query('alter table amountly_files.receipts enable trigger storage_budget')
    await admin.query('delete from amountly_files.receipts')

    const seed=(owner,n,size)=>admin.query(`insert into amountly_files.receipts(path,owner_id,content_type,contents)
      select $1::text||'/'||gen_random_uuid()::text||'.pdf',$1::uuid,'application/pdf',decode(repeat('aa',$3),'hex') from generate_series(1,$2)`,[owner,n,size])
    async function beginOwner(owner,isolation='') {
      const connection=await runtime.connect();await connection.query('begin '+isolation)
      await connection.query('set local role authenticated')
      await connection.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:owner,role:'authenticated'})]);return connection
    }
    async function rawInsert(owner,bytes) {
      const connection=await beginOwner(owner)
      try {await connection.query('insert into amountly_files.receipts values($1,$2,\'application/pdf\',$3,now())',[owner+'/'+randomUUID()+'.pdf',owner,bytes]);await connection.query('commit')}
      catch(error){await connection.query('rollback');throw error}finally{connection.release()}
    }
    const max=10*1024*1024
    const payload={method:'file',fields:{amount:'',currency:'USD',category:'OTHER',description:'',merchant:'',expense_date:'',project_id:'',notes:''},text:'',extraction:null,extracted:false}
    const seedCapture=(id,owner,bytes,type='application/pdf')=>admin.query('insert into amountly_files.capture_drafts(id,owner_id,payload,file_name,content_type,contents,file_sha256) values($1,$2,$3,\'sample\',$4,$5,$6)',[id,owner,payload,type,bytes,createHash('sha256').update(bytes).digest('hex')])
    const captureHeaders=id=>({'x-capture-id':id,'x-capture-revision':'1'})
    const readCapture=(id,revision=1)=>captures.GET(new Request('http://127.0.0.1:4174/api/capture-drafts?id='+id+'&file=1&revision='+revision,{headers:{authorization:'fixture'}}))
    await seed(owners[0],24,max)
    const body=Buffer.alloc(max);body.write('%PDF-')
    const concurrent=await Promise.all([upload(body),upload(body)])
    assert.deepEqual(concurrent.map(x=>x.status).sort(),[201,413])
    assert.equal((await admin.query('select bytes from amountly_files.storage_owners where owner_id=$1',[owners[0]])).rows[0].bytes,String(25*max))
    await assert.rejects(rawInsert(owners[0],Buffer.from('%PDF-over')),error=>error.code==='PT413','direct INSERT cannot bypass route limits')
    identity=owners[1];assert.equal((await upload()).status,201,'another owner still has capacity')
    const connection=await beginOwner(owners[0])
    await assert.rejects(connection.query('update amountly_files.storage_total set bytes=0'),error=>error.code==='42501')
    await connection.query('rollback');connection.release()
    await admin.query('delete from amountly_files.receipts')

    // At a full budget, promote the exact original atomically. A failed insert
    // rolls back both counters and the capture; response loss never duplicates it.
    await seed(owners[0],24,max);identity=owners[0]
    const kept=randomUUID();await seedCapture(kept,owners[0],body)
    const full=(await admin.query('select * from amountly_files.storage_total')).rows
    await admin.query(`create function amountly_files.test_reject_receipt() returns trigger language plpgsql as $$begin raise exception 'synthetic failure';end$$;
      create trigger test_reject before insert on amountly_files.receipts for each row execute function amountly_files.test_reject_receipt()`)
    assert.equal((await upload(body,captureHeaders(kept))).status,503)
    assert.deepEqual(Buffer.from(await (await readCapture(kept)).arrayBuffer()),body,'failed financial attachment preserves kept original')
    assert.deepEqual((await admin.query('select * from amountly_files.storage_total')).rows,full)
    await admin.query('drop trigger test_reject on amountly_files.receipts;drop function amountly_files.test_reject_receipt()')
    const promoted=await upload(body,captureHeaders(kept));assert.equal(promoted.status,201)
    const promotedPath=(await promoted.json()).path
    const retries=await Promise.all([upload(body,captureHeaders(kept)),upload(body,captureHeaders(kept))])
    for(const retry of retries){assert.equal(retry.status,201);assert.equal((await retry.json()).path,promotedPath)}
    assert.deepEqual((await admin.query('select * from amountly_files.storage_total')).rows,full)
    assert.deepEqual(Buffer.from(await (await readCapture(kept)).arrayBuffer()),body,'reopening an unconfirmed expense keeps exact original')
    assert.equal((await upload(body,{...captureHeaders(kept),'x-capture-revision':'2'})).status,409)
    assert.equal((await upload(Buffer.from('%PDF-replaced'),captureHeaders(kept))).status,413,'changed bytes cannot claim a promotion refund')
    identity=owners[1];assert.equal((await upload(body,captureHeaders(kept))).status,409);assert.equal((await readCapture(kept)).status,404);identity=owners[0]
    await admin.query(migration)
    assert.deepEqual((await admin.query('select * from amountly_files.storage_total')).rows,full,'replay counts linked originals only once')
    await admin.query('delete from amountly_files.capture_drafts where id=$1',[kept])
    assert.equal((await admin.query('select count(*)::int as count from amountly_files.receipts where path=$1',[promotedPath])).rows[0].count,1,'confirmed cleanup keeps attached original')
    await admin.query('delete from amountly_files.receipts')

    // Full object quota also permits promotion and keeping the same linked file
    // after an unsuccessful expense save, without allocating another original.
    await seed(owners[0],999,5)
    const png=await require('sharp')({create:{width:2,height:2,channels:3,background:'white'}}).png().toBuffer()
    const counted=randomUUID();await seedCapture(counted,owners[0],png,'image/png')
    assert.equal((await upload(png,{...captureHeaders(counted),'content-type':'image/png'})).status,201)
    const form=new FormData();form.set('metadata',JSON.stringify({id:counted,revision:1,payload:{...payload,text:'Retry later'}}));form.set('file',new File([png],'sample',{type:'image/png'}))
    const retained=await captures.PUT(new Request('http://127.0.0.1:4174/api/capture-drafts',{method:'PUT',headers:{authorization:'fixture'},body:form}))
    assert.equal(retained.status,200);assert.equal((await retained.json()).revision,2)
    assert.deepEqual(Buffer.from(await (await readCapture(counted,2)).arrayBuffer()),png)
    assert.equal((await admin.query('select objects from amountly_files.storage_owners where owner_id=$1',[owners[0]])).rows[0].objects,'1000')
    await admin.query('delete from amountly_files.capture_drafts');await admin.query('delete from amountly_files.receipts')

    // The count budget catches tiny files even when bytes are far below quota.
    await seed(owners[0],999,5);identity=owners[0]
    const countRace=await Promise.all([upload(),upload()]);assert.deepEqual(countRace.map(x=>x.status).sort(),[201,413])
    const before=(await admin.query('select * from amountly_files.storage_total')).rows
    await assert.rejects(rawInsert(owners[0],Buffer.from('%PDF-denied')),error=>error.code==='PT413')
    assert.deepEqual((await admin.query('select * from amountly_files.storage_total')).rows,before,'failed writes roll back accounting')
    await admin.query(migration)
    assert.deepEqual((await admin.query('select * from amountly_files.storage_total')).rows,before,'replay reconstructs exact counters')
    await admin.query('delete from amountly_files.receipts')

    // Capture bytes share the same budget; replacing or removing files refunds it.
    await seed(owners[0],25,max)
    const draft=randomUUID()
    await assert.rejects(admin.query('insert into amountly_files.capture_drafts(id,owner_id,payload,file_name,content_type,contents,file_sha256) values($1,$2,$3,\'sample.pdf\',\'application/pdf\',$4,$5)',[draft,owners[0],payload,Buffer.from('%PDF-original'),'a'.repeat(64)]),error=>error.code==='PT413')
    await admin.query('delete from amountly_files.receipts where path=(select path from amountly_files.receipts where owner_id=$1 limit 1)',[owners[0]])
    await admin.query('insert into amountly_files.capture_drafts(id,owner_id,payload,file_name,content_type,contents,file_sha256) values($1,$2,$3,\'sample.pdf\',\'application/pdf\',$4,$5)',[draft,owners[0],payload,Buffer.from('%PDF-original'),'a'.repeat(64)])
    await admin.query('delete from amountly_files.capture_drafts where id=$1',[draft])
    assert.equal((await admin.query('select bytes from amountly_files.storage_owners where owner_id=$1',[owners[0]])).rows[0].bytes,String(24*max))
    await admin.query('delete from amountly_files.receipts')

    // Globally bounded retained bytes, even across multiple genuine accounts.
    for(const owner of owners.slice(0,4))await seed(owner,25,max)
    await seed(owners[4],2,max);identity=owners[4]
    assert.equal((await upload(body)).status,413)
    assert.ok(Number((await admin.query('select bytes from amountly_files.storage_total')).rows[0].bytes)<=1073741824)
    await admin.query('delete from amountly_files.receipts')
    for(const owner of owners.slice(0,4))await seed(owner,25,max)
    await seed(owners[4],1,max);await seed(owners[4],1,4*1024*1024)
    const globalCapture=randomUUID();await seedCapture(globalCapture,owners[5],body);identity=owners[5]
    assert.equal((await admin.query('select bytes from amountly_files.storage_total')).rows[0].bytes,'1073741824')
    assert.equal((await upload(body,captureHeaders(globalCapture))).status,201,'promotion succeeds at exact global byte ceiling')
    assert.equal((await admin.query('select bytes from amountly_files.storage_total')).rows[0].bytes,'1073741824')
    await admin.query('delete from amountly_files.capture_drafts');await admin.query('delete from amountly_files.receipts')
    // Atomic counter updates reject stale REPEATABLE READ writers rather than
    // approving both under a stale SUM snapshot.
    await seed(owners[0],24,max)
    const first=await beginOwner(owners[0],'isolation level repeatable read'),second=await beginOwner(owners[0],'isolation level repeatable read')
    await first.query('select count(*) from amountly_files.receipts');await second.query('select count(*) from amountly_files.receipts')
    const insert=conn=>conn.query('insert into amountly_files.receipts values($1,$2,\'application/pdf\',$3,now())',[owners[0]+'/'+randomUUID()+'.pdf',owners[0],body])
    await insert(first);await first.query('commit');first.release()
    await assert.rejects(insert(second),error=>error.code==='40001');await second.query('rollback');second.release()
  } finally {
    for(const pool of runtimes)await pool.end();if(admin)await admin.end()
    if(started)execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-m','fast','-w','stop'],{stdio:'pipe'})
    fs.rmSync(root,{recursive:true,force:true});fs.rmSync(socket,{recursive:true,force:true})
  }
})
