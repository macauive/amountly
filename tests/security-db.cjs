const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, execFile } = require('node:child_process')
const { promisify } = require('node:util')

// No DATABASE_URL or existing server is accepted. Always create a disposable
// PostgreSQL cluster and connect exclusively to its private Unix socket.
const bin = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim()
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amountly-security-'))
const data = path.join(root, 'data')
const socketRoot = process.platform === 'darwin' ? '/private/tmp' : os.tmpdir()
const socket = fs.mkdtempSync(path.join(socketRoot, 'amt-socket-'))
const psqlArgs = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-h', socket, '-U', 'amountly_test', '-d', 'postgres']
const sql = text => execFileSync(path.join(bin, 'psql'), [...psqlArgs, '-c', text], { encoding: 'utf8', stdio: 'pipe' }).trim()
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const asUserSql = (n, statement, commit = false) => `begin; set local role authenticated; set local "request.jwt.claims" = '${JSON.stringify({ sub: id(n), role: 'authenticated' })}'; ${statement}; ${commit ? 'commit' : 'rollback'};`
const asUser = (n, statement, commit) => sql(asUserSql(n, statement, commit))
const denied = (fn, code = '42501') => assert.throws(fn, error => String(error.stderr).includes(code))
const upgrade = process.argv.includes('--upgrade')
let started = false

async function main() {
  try {
    execFileSync(path.join(bin, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'amountly_test', '--no-locale'], { stdio: 'pipe' })
    execFileSync(path.join(bin, 'pg_ctl'), ['-D', data, '-l', path.join(root, 'postgres.log'), '-o', `-k ${socket} -h ''`, '-w', 'start'], { stdio: 'pipe' })
    started = true
    sql(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage; create schema extensions;
      create table auth.users (id uuid primary key);
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb$$;
      create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
      create function auth.role() returns text language sql stable as $$select auth.jwt()->>'role'$$;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid primary key, bucket_id text, name text);
      alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1, '/')$$;
      grant usage on schema public, auth, storage to anon, authenticated, service_role;
    `)
    const migrations = fs.readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).sort()
    const workflowMigrations = migrations.filter(name => name.startsWith('20260926'))
    for (const name of migrations.filter(name => !upgrade || !workflowMigrations.includes(name))) {
      if (name.startsWith('020_')) {
        sql('grant select, insert, update, delete on all tables in schema public to authenticated; grant usage, select on all sequences in schema public to authenticated')
      }
      try { sql(fs.readFileSync(path.join('supabase/migrations', name), 'utf8')) }
      catch (error) { throw new Error(`Migration ${name} failed: ${error.stderr}`) }
    }
    sql(`
      set "request.jwt.claims" = '{"role":"service_role"}';
      insert into auth.users values ${Array.from({ length: 9 }, (_, i) => `('${id(i + 1)}')`).join(',')};
      insert into organizations (id, name, owner_id) values ('${id(100)}', 'Synthetic A', '${id(1)}'), ('${id(101)}', 'Synthetic B', '${id(5)}');
      insert into public.users (id, organization_id, email, name, role, account_type, is_active) values
        ('${id(1)}','${id(100)}','owner@example.invalid','Synthetic owner','OWNER','business',true),
        ('${id(2)}','${id(100)}','admin@example.invalid','Synthetic admin','ADMIN','business',true),
        ('${id(3)}','${id(100)}','member@example.invalid','Synthetic member','MEMBER','business',true),
        ('${id(4)}','${id(100)}','contractor@example.invalid','Synthetic contractor','CONTRACTOR','business',true),
        ('${id(5)}','${id(101)}','other@example.invalid','Synthetic other','OWNER','business',true),
        ('${id(6)}',null,'freelancer@example.invalid','Synthetic freelancer','MEMBER','freelancer',true),
        ('${id(7)}','${id(100)}','inactive@example.invalid','Synthetic inactive','OWNER','business',false),
        ('${id(8)}',null,'personal@example.invalid','Synthetic personal','MEMBER','personal',true),
        ('${id(9)}',null,'freelancer2@example.invalid','Synthetic freelancer 2','MEMBER','freelancer',true);
      insert into clients (id,organization_id,user_id,name) values
        ('${id(200)}','${id(100)}',null,'Synthetic A'), ('${id(201)}','${id(101)}',null,'Synthetic B'), ('${id(202)}',null,'${id(6)}','Synthetic F');
      insert into projects (id,organization_id,user_id,name,billing_model) values
        ('${id(300)}','${id(100)}',null,'Synthetic A','HOURLY'), ('${id(301)}','${id(101)}',null,'Synthetic B','HOURLY'), ('${id(302)}',null,'${id(6)}','Synthetic F','HOURLY');
      insert into tasks (id,project_id,name) values ('${id(350)}','${id(300)}','Synthetic task');
      insert into invoices (id,organization_id,user_id,client_id,invoice_number,issue_date,due_date,subtotal,total,status) values
        ('${id(400)}','${id(100)}',null,'${id(200)}','TEST-A',now(),now(),5,5,'DRAFT'),
        ('${id(401)}','${id(101)}',null,'${id(201)}','TEST-B',now(),now(),7,7,'SENT'),
        ('${id(402)}',null,'${id(6)}','${id(202)}','TEST-F',now(),now(),9,9,'DRAFT');
      insert into invoice_line_items (id,invoice_id,description,quantity,rate,amount) values ('${id(450)}','${id(400)}','Synthetic line',1,5,5);
    `)


    if (upgrade) {
      // Rehearse installing the release over records written by the old schema.
      // Keep legacy PAID status and anomalies; never fabricate cash receipts.
      sql(`
        insert into invoices(id,organization_id,client_id,invoice_number,issue_date,due_date,subtotal,total,status,paid_at)
          values ('${id(410)}','${id(100)}','${id(200)}','INV-0042','2025-01-01','2025-02-01',50,50,'PAID','2025-01-15');
        insert into invoice_line_items(invoice_id,description,quantity,rate,amount)
          values ('${id(410)}','Legacy paid work',1,50,50);
        insert into expenses(id,user_id,expense_date,amount,status)
          values ('${id(710)}','${id(3)}','2025-01-01',-5,'DRAFT');
        insert into time_entries(id,user_id,project_id,start_at,end_at,duration_minutes,billable_rate,status)
          values ('${id(711)}','${id(3)}','${id(300)}','2025-01-01','2025-01-01',0,-1,'DRAFT');
      `)
      sql(`
        insert into vendors(id,user_id,organization_id,name,status) values('${id(980)}','${id(1)}','${id(100)}','Legacy inactive vendor','inactive');
        insert into bills(id,user_id,name,payee,amount,currency,category,due_date,status,paid_at)
          values('${id(981)}','${id(8)}','Legacy bill','Synthetic payee',75,'EUR','other','2025-01-01','paid','2025-01-01');
        insert into vendor_bills(id,user_id,organization_id,vendor_id,bill_number,date,due_date,status,subtotal,total,paid_at)
          values('${id(982)}','${id(1)}','${id(100)}','${id(980)}','LEGACY-1','2025-01-01','2025-02-01','paid',25,25,'2025-02-01');
        insert into vendor_bill_line_items(vendor_bill_id,description,quantity,rate,amount) values('${id(982)}','Legacy line',1,25,25);
      `)
      const snapshots = ['organizations','users','clients','projects','invoices','invoice_line_items','expenses','time_entries','vendors','bills','vendor_bills','vendor_bill_line_items'].map(table => {
        const columns = sql(`select string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='${table}'`)
        const query = `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (select ${columns} from public.${table} order by id) t`
        return { table, query, before: sql(query) }
      })
      const backup = path.join(root, 'before-upgrade.dump')
      execFileSync(path.join(bin, 'pg_dump'), ['-h', socket, '-U', 'amountly_test', '-d', 'postgres', '-Fc', '-f', backup], { stdio: 'pipe' })
      for (const name of workflowMigrations) sql(fs.readFileSync(path.join('supabase/migrations', name), 'utf8'))
      for (const snapshot of snapshots) assert.equal(sql(snapshot.query), snapshot.before, `${snapshot.table}: upgrade changed historical values`)
      assert.equal(sql('select count(*) from invoice_payments'), '0')
      assert.equal(sql('select count(*) from invoice_events'), '0')
      assert.equal(asUser(1, `select status from invoices where id='${id(410)}'`), 'PAID')
      assert.equal(asUser(5, `select count(*) from invoices where id='${id(410)}'`), '0')
      denied(() => asUser(3, `update expenses set amount=-6 where id='${id(710)}'`), '23514')
      sql('create database recovery')
      execFileSync(path.join(bin, 'pg_restore'), ['-h', socket, '-U', 'amountly_test', '-d', 'recovery', '--exit-on-error', backup], { stdio: 'pipe' })
      for (const snapshot of snapshots) {
        const restored = execFileSync(path.join(bin, 'psql'), [...psqlArgs.slice(0,-1), 'recovery', '-c', snapshot.query], { encoding: 'utf8', stdio: 'pipe' }).trim()
        assert.equal(restored, snapshot.before, `${snapshot.table}: recovery changed historical values`)
      }
      console.log('PASS: pre-upgrade dump restores schema and all fixture values into a separate recovery database')
      console.log('PASS: upgrade preserves historical rows, paid invoices and anomalies without inventing payments; new constraints and isolation apply')
    }

    for (const [actor, expected] of [[1, 1], [2, 1], [3, 0], [4, 1], [5, 0], [6, 0], [7, 0], [8, 0]]) {
      assert.equal(asUser(actor, `select count(*) from invoices where id='${id(400)}'`), String(expected))
    }
    assert.equal(asUser(6, `select count(*) from invoices where id='${id(402)}'`), '1')
    assert.equal(asUser(9, `select count(*) from invoices where id='${id(402)}'`), '0')
    assert.equal(asUser(3, 'select count(*) from invoice_line_items'), '0')
    for (const actor of [1, 2, 3, 4]) assert.equal(asUser(actor, `select count(*) from clients where id='${id(200)}'`), '1')
    for (const actor of [3, 4, 5, 7]) {
      for (const [table, record] of [['clients', 200], ['projects', 300], ['tasks', 350]]) {
        assert.equal(asUser(actor, `with changed as (update ${table} set name='Changed' where id='${id(record)}' returning id) select count(*) from changed`), '0')
        assert.equal(asUser(actor, `with changed as (delete from ${table} where id='${id(record)}' returning id) select count(*) from changed`), '0')
      }
    }
    // Direct financial writes are blocked even for owners; commands own state.
    for (const actor of [1,2,4]) denied(() => asUser(actor, `update invoices set status='PAID' where id='${id(400)}'`))
    assert.equal(asUser(3, `with changed as (update invoices set status='PAID' where id='${id(400)}' returning id) select count(*) from changed`), '0')
    denied(() => asUser(1, `update invoice_line_items set rate=10 where id='${id(450)}'`))
    denied(() => asUser(1, `select get_business_metrics('${id(5)}')`), 'P0001')
    denied(() => asUser(2, `update organizations set owner_id='${id(5)}' where id='${id(100)}'`))
    denied(() => asUser(1, `update projects set client_id='${id(201)}' where id='${id(300)}'`))
    assert.equal(asUser(1, `with changed as (update clients set archived_at=now() where id='${id(200)}' returning id) select count(*) from changed`),'1')
    denied(() => asUser(1, `delete from clients where id='${id(200)}'`), '23503')
    const expense = (actor, status='DRAFT', amount=10, project='null') => `insert into expenses(user_id,expense_date,amount,status,project_id) values ('${id(actor)}',now(),${amount},'${status}',${project})`
    denied(() => asUser(7,expense(7)))
    denied(() => asUser(3,expense(3,'APPROVED')))
    denied(() => asUser(3,expense(3,'DRAFT',-1)), '23514')
    denied(() => asUser(3,expense(3,'DRAFT',10,`'${id(301)}'`)))
    asUser(3,expense(3))
    const time = `insert into time_entries(user_id,project_id,start_at,end_at,duration_minutes,status) values ('${id(3)}','${id(300)}',now(),now()+interval '1 hour',60,'DRAFT')`
    asUser(3,time)
    denied(() => asUser(3,time.replace("'DRAFT'", "'APPROVED'")))
    denied(() => asUser(3,time.replace(id(300),id(301))))
    asUser(3,time,true)
    denied(() => asUser(1,`delete from projects where id='${id(300)}'`), '23503')
    sql(`insert into expenses(id,user_id,expense_date,amount,status) values ('${id(700)}','${id(3)}',now(),10,'SUBMITTED')`)
    denied(() => asUser(3,`update expenses set status='APPROVED' where id='${id(700)}'`))
    asUser(1,`update expenses set status='APPROVED' where id='${id(700)}'`)
    denied(() => asUser(7,`select set_own_account_type('personal')`), 'P0001')
    denied(() => asUser(3,`delete from expenses where id='${id(700)}'`))
    denied(() => asUser(3,`insert into expense_line_items(expense_id,description,amount,category) values ('${id(700)}','Changed after submission',1,'OTHER')`))
    sql(`insert into expenses(id,user_id,expense_date,amount) values ('${id(701)}','${id(7)}',now(),10)`)
    assert.equal(asUser(7,`select count(*) from expenses where id='${id(701)}'`),'0')
    denied(() => asUser(3,expense(3).replace('project_id)', 'project_id,receipt_path)').replace("10,'DRAFT',null)",`10,'DRAFT',null,'${id(5)}/fake.pdf')`)))
    console.log('PASS: disabled-account access, protected ownership, independent approval, parent boundaries, archive and deletion preservation')

    const payload = { client_id:id(200),issue_date:'2026-01-01',due_date:'2026-02-01',tax_rate:10,currency:'USD',notes:'Synthetic' }
    const lines = [{description:'Synthetic work',quantity:2,rate:100}]
    const save = (record, data=payload, items=lines, expected='null') => `select save_invoice('${id(record)}','${JSON.stringify(data)}'::jsonb,'${JSON.stringify(items)}'::jsonb,${expected})`
    const version = record => `(select updated_at from invoices where id='${id(record)}')`
    const action = (record, name) => `select invoice_action('${id(record)}','${name}',${version(record)})`
    const payment = (record,pid,amount=100) => `select record_invoice_payment('${id(pid)}','${id(record)}',${amount},'2026-01-15','bank_transfer','Synthetic')`
    denied(() => asUser(3,save(500)))
    denied(() => asUser(7,save(500)))
    denied(() => asUser(1,save(500,{...payload,client_id:id(201)})))
    denied(() => asUser(1,save(500,{...payload,unexpected:'field'})), '22023')
    denied(() => asUser(1,save(500,payload,[{description:'Invalid',quantity:1,rate:-1}])), '22023')
    assert.equal(sql(`select count(*) from invoices where id='${id(500)}'`),'0')
    asUser(1,save(500),true)
    assert.equal(asUser(1,`select total from invoices where id='${id(500)}'`),'220.00')
    asUser(1,save(500,payload,[{description:'Updated',quantity:1,rate:200}],version(500)),true)
    assert.equal(asUser(1,`select count(*) from invoice_line_items where invoice_id='${id(500)}'`),'1')
    denied(() => asUser(1,save(500,payload,lines,"'2000-01-01'::timestamptz")), 'PT409')
    denied(() => asUser(5,save(500)), '42501')
    asUser(4,action(500,'issue'),true)
    denied(() => asUser(1,save(500,payload,lines,version(500))), '22023')
    denied(() => asUser(1,action(500,'delete')), '22023')
    denied(() => asUser(5,payment(500,600)))
    denied(() => asUser(4,payment(500,600)))
    denied(() => asUser(7,payment(500,600)))
    denied(() => asUser(1,payment(500,600,221)), '22023')
    asUser(1,payment(500,600,100),true)
    asUser(1,payment(500,600,100),true)
    assert.equal(asUser(1,`select count(*) from invoice_payments where invoice_id='${id(500)}'`),'1')
    assert.equal(asUser(5,`select count(*) from invoice_payments where invoice_id='${id(500)}'`),'0')
    assert.equal(asUser(7,`select count(*) from invoice_payments where invoice_id='${id(500)}'`),'0')
    assert.equal(asUser(1,`select status from invoices where id='${id(500)}'`),'SENT')
    denied(() => asUser(1,action(500,'cancel')), '22023')
    denied(() => asUser(1,`delete from invoice_payments where id='${id(600)}'`))
    const concurrent = promisify(execFile)
    const attempts = await Promise.allSettled([601,602].map(pid => concurrent(path.join(bin,'psql'), [...psqlArgs,'-c',asUserSql(1,payment(500,pid,120),true)])))
    assert.equal(attempts.filter(r => r.status === 'fulfilled').length,1)
    assert.equal(asUser(1,`select sum(amount) from invoice_payments where invoice_id='${id(500)}'`),'220.00')
    assert.equal(asUser(1,`select status || ':' || paid_at::date from invoices where id='${id(500)}'`),'PAID:2026-01-15')
    assert.equal(asUser(1,`select count(*) from invoice_events where invoice_id='${id(500)}' and action='payment_recorded'`),'2')
    asUser(6,save(501,{...payload,client_id:id(202)}),true)
    asUser(6,action(501,'issue'),true)
    asUser(6,payment(501,603,220),true)
    assert.equal(asUser(6,`select status from invoices where id='${id(501)}'`),'PAID')
    asUser(1,save(502),true)
    denied(() => asUser(1,save(502,payload,[{description:'Valid',quantity:1,rate:20},{description:'Invalid',quantity:1,rate:-1}],version(502))), '22023')
    assert.equal(asUser(1,`select total from invoices where id='${id(502)}'`),'220.00')
    denied(() => asUser(1,payment(502,604)), '22023')
    asUser(1,action(502,'issue'),true)
    asUser(1,action(502,'cancel'),true)
    assert.equal(asUser(1,`select status from invoices where id='${id(502)}'`),'CANCELLED')
    denied(() => asUser(1,payment(502,604)), '22023')
    const creates = await Promise.all([503,504].map(record => concurrent(path.join(bin,'psql'),[...psqlArgs,'-c',asUserSql(1,save(record),true)])))
    assert.equal(creates.length,2)
    assert.equal(asUser(1,`select count(distinct invoice_number) from invoices where id in ('${id(503)}','${id(504)}')`),'2')
    console.log('PASS: atomic invoice save, optimistic concurrency, issuance locks, role/tenant checks, partial payments, idempotent retries, concurrent overpayment prevention, freelancer workflow')

    const reverse = (rid,pid,reason='Recorded against the wrong receipt') => `select reverse_invoice_payment('${id(rid)}','${id(pid)}','${reason}')`
    for (const actor of [3,4,5,7]) denied(() => asUser(actor,reverse(800,600)))
    denied(() => sql(`set role anon; ${reverse(800,600)}`))
    denied(() => asUser(1,reverse(800,600,'bad')), '22023')
    asUser(1,reverse(800,600),true)
    asUser(1,reverse(800,600),true)
    denied(() => asUser(1,reverse(800,600,'A different reason')), '22023')
    denied(() => asUser(1,reverse(801,600)), 'PT409')
    assert.equal(asUser(1,`select count(*) from invoice_payment_reversals`),'1')
    assert.equal(asUser(5,`select count(*) from invoice_payment_reversals`),'0')
    assert.equal(asUser(7,`select count(*) from invoice_payment_reversals`),'0')
    denied(() => asUser(1,`update invoice_payment_reversals set reason='Overwrite history'`))
    denied(() => asUser(1,`delete from invoice_payment_reversals`))
    assert.equal(asUser(1,`select status || ':' || (paid_at is null) from invoices where id='${id(500)}'`),'SENT:true')
    assert.equal(asUser(1,`select count(*) from invoice_payments where id='${id(600)}'`),'1')
    asUser(1,payment(500,605,100),true)
    assert.equal(asUser(1,`select status from invoices where id='${id(500)}'`),'PAID')
    const corrections = await Promise.allSettled([802,803].map(rid => concurrent(path.join(bin,'psql'),[...psqlArgs,'-c',asUserSql(1,reverse(rid,605),true)])))
    assert.equal(corrections.filter(r => r.status==='fulfilled').length,1)
    assert.equal(asUser(1,`select count(*) from invoice_events where invoice_id='${id(500)}' and action='payment_reversed'`),'2')
    asUser(6,reverse(804,603),true)
    assert.equal(asUser(6,`select status from invoices where id='${id(501)}'`),'SENT')

    sql(`set "request.jwt.claims" = '{"role":"service_role"}';
      update projects set client_id='${id(200)}' where id='${id(300)}';
      update projects set client_id='${id(202)}' where id='${id(302)}';
      insert into time_entries(id,user_id,project_id,start_at,end_at,duration_minutes,billable_rate,status) values
        ('${id(850)}','${id(3)}','${id(300)}','2026-01-01 09:00Z','2026-01-01 10:01Z',61,100,'APPROVED'),
        ('${id(851)}','${id(3)}','${id(300)}','2026-01-01 11:00Z','2026-01-01 12:00Z',60,100,'APPROVED'),
        ('${id(852)}','${id(3)}','${id(300)}','2026-01-01 13:00Z','2026-01-01 14:00Z',60,100,'DRAFT'),
        ('${id(853)}','${id(6)}','${id(302)}','2026-01-01 09:00Z','2026-01-01 09:01Z',1,100,'DRAFT');`)
    const timedata={...payload,project_id:id(300)}
    const fromTime=(inv,ids=[850],data=timedata)=>`select create_invoice_from_time('${id(inv)}',array[${ids.map(n=>`'${id(n)}'::uuid`).join(',')}],'${JSON.stringify(data)}')`
    for (const actor of [3,4,5,7,8,9]) denied(() => asUser(actor,fromTime(860)))
    denied(() => asUser(1,fromTime(860,[850,850])), '22023')
    denied(() => asUser(1,fromTime(860,[850,852])), '22023')
    assert.equal(sql(`select count(*) from invoice_time_links`),'0')
    assert.equal(sql(`select count(*) from invoices where id='${id(860)}'`),'0')
    asUser(1,fromTime(860),true)
    asUser(1,fromTime(860),true)
    assert.equal(asUser(1,`select subtotal from invoices where id='${id(860)}'`),'101.67')
    assert.equal(asUser(1,`select count(*) from invoice_time_links where invoice_id='${id(860)}'`),'1')
    denied(() => asUser(1,fromTime(860,[851])), '22023')
    denied(() => asUser(1,fromTime(861)), 'PT409')
    denied(() => asUser(1,save(860,timedata,lines,version(860))), '22023')
    denied(() => asUser(3,`update time_entries set duration_minutes=60 where id='${id(850)}'`))
    denied(() => asUser(1,`delete from invoice_time_links where invoice_id='${id(860)}'`))
    assert.equal(asUser(5,`select count(*) from invoice_time_links`),'0')
    assert.equal(asUser(7,`select count(*) from invoice_time_links`),'0')
    asUser(1,action(860,'delete'),true)
    assert.equal(sql(`select count(*) from invoice_time_links`),'0')
    const reservations=await Promise.allSettled([861,862].map(inv=>concurrent(path.join(bin,'psql'),[...psqlArgs,'-c',asUserSql(1,fromTime(inv),true)])))
    assert.equal(reservations.filter(r=>r.status==='fulfilled').length,1)
    const winner=Number(sql(`select right(invoice_id::text,3)::integer from invoice_time_links where time_entry_id='${id(850)}'`))
    asUser(1,action(winner,'issue'),true)
    asUser(1,action(winner,'cancel'),true)
    assert.equal(sql(`select count(*) from invoice_time_links where time_entry_id='${id(850)}' and released_at is not null`),'1')
    asUser(1,fromTime(863),true)
    assert.equal(sql(`select count(*) from invoice_time_links where time_entry_id='${id(850)}'`),'2')
    asUser(6,fromTime(864,[853],{...payload,client_id:id(202),project_id:id(302)}),true)
    assert.equal(asUser(6,`select subtotal from invoices where id='${id(864)}'`),'1.67')
    denied(() => asUser(6,`update time_entries set billable_rate=200 where id='${id(853)}'`))
    denied(() => asUser(6,`delete from time_entries where id='${id(853)}'`))
    console.log('PASS: append-only payment corrections, safe retries/replacement payments, scoped access, exact-minute billing, atomic time reservations, concurrent duplicate prevention, release and rebilling')

    asUser(3,`insert into expenses(id,user_id,expense_date,amount,currency,status,merchant) values('${id(900)}','${id(3)}','2026-01-01',25,'USD','DRAFT','Synthetic merchant')`,true)
    const review=(actorAction,expected=`(select updated_at from expenses where id='${id(900)}')`)=>`select review_work_record('expenses','${id(900)}','${actorAction}',${expected})`
    asUser(3,review('submit'),true)
    denied(()=>asUser(3,review('approve')))
    denied(()=>asUser(3,review('reject')))
    denied(()=>asUser(5,review('approve')))
    denied(()=>asUser(2,review('approve',"'2000-01-01'::timestamptz")),'PT409')
    asUser(2,review('reject'),true)
    asUser(3,review('submit'),true)
    asUser(2,review('approve'),true)
    assert.equal(asUser(3,`select count(*) from record_events where record_id='${id(900)}'`),'5')
    assert.equal(asUser(5,`select count(*) from record_events where record_id='${id(900)}'`),'0')
    assert.equal(asUser(7,`select count(*) from record_events where record_id='${id(900)}'`),'0')
    denied(()=>asUser(3,`delete from record_events`))
    denied(()=>asUser(3,`update expenses set amount=5 where id='${id(900)}'`))
    denied(()=>asUser(3,`update expenses set archived_at=now() where id='${id(900)}'`))
    const billInsert=n=>`insert into bills(id,user_id,name,payee,amount,currency,category,due_date) values('${id(n)}','${id(8)}','Synthetic bill','Synthetic payee',30,'USD','other','2026-01-01')`
    asUser(8,billInsert(901),true)
    denied(()=>asUser(8,billInsert(902)),'PT409')
    const billAction=(action,version=`(select updated_at from bills where id='${id(901)}')`)=>`select bill_action('${id(901)}','${action}',${version},'2026-01-02')`
    denied(()=>asUser(5,billAction('pay')))
    denied(()=>asUser(8,billAction('pay',"'2000-01-01'::timestamptz")),'PT409')
    asUser(8,billAction('pay'),true)
    assert.equal(asUser(8,`select status||':'||paid_at::date from bills where id='${id(901)}'`),'paid:2026-01-02')
    denied(()=>asUser(8,`update bills set amount=5 where id='${id(901)}'`))
    denied(()=>asUser(8,`delete from bills where id='${id(901)}'`))
    assert.equal(asUser(8,`select count(*) from record_events where record_id='${id(901)}'`),'2')
    sql(`insert into vendors(id,user_id,organization_id,name) values('${id(910)}','${id(1)}','${id(100)}','Synthetic vendor')`)
    const vendorData={vendor_id:id(910),bill_number:'QA-1',issue_date:'2026-01-01',due_date:'2026-02-01',tax_rate:10,currency:'USD'}
    const vendorSave=(n,data=vendorData,items=lines)=>`select save_vendor_bill('${id(n)}','${JSON.stringify(data)}','${JSON.stringify(items)}')`
    for(const actor of [3,4,5,7,8,9]) denied(()=>asUser(actor,vendorSave(911)))
    denied(()=>asUser(1,vendorSave(911,vendorData,[...lines,{description:'Bad',quantity:1,rate:-1}])),'22023')
    assert.equal(sql(`select count(*) from vendor_bills where id='${id(911)}'`),'0')
    asUser(1,vendorSave(911),true)
    assert.equal(asUser(1,`select total from vendor_bills where id='${id(911)}'`),'220.00')
    denied(()=>asUser(1,vendorSave(912)),'PT409')
    denied(()=>asUser(1,`update vendor_bill_line_items set amount=1 where vendor_bill_id='${id(911)}'`))
    asUser(1,`select vendor_bill_action('${id(911)}','pay',(select updated_at from vendor_bills where id='${id(911)}'),'2026-01-10')`,true)
    assert.equal(asUser(1,`select status from vendor_bills where id='${id(911)}'`),'paid')
    denied(()=>asUser(1,`delete from vendor_bills where id='${id(911)}'`))
    // Competing sessions share the same observed version: exactly one transition wins.
    asUser(3,`insert into expenses(id,user_id,expense_date,amount,currency,status) values('${id(920)}','${id(3)}','2026-01-01',10,'USD','SUBMITTED')`,true)
    const reviewVersion=asUser(2,`select updated_at from expenses where id='${id(920)}'`)
    const reviewRace=await Promise.allSettled(['approve','reject'].map(action=>concurrent(path.join(bin,'psql'),[...psqlArgs,'-c',asUserSql(2,`select review_work_record('expenses','${id(920)}','${action}','${reviewVersion}')`,true)])))
    assert.equal(reviewRace.filter(r=>r.status==='fulfilled').length,1)
    assert.equal(asUser(2,`select count(*) from record_events where record_id='${id(920)}' and action='status_changed'`),'1')
    asUser(8,billInsert(921).replace('Synthetic bill','Concurrent bill'),true)
    const billVersion=asUser(8,`select updated_at from bills where id='${id(921)}'`)
    const billRace=await Promise.allSettled(['pay','cancel'].map(action=>concurrent(path.join(bin,'psql'),[...psqlArgs,'-c',asUserSql(8,`select bill_action('${id(921)}','${action}','${billVersion}','2026-01-02')`,true)])))
    assert.equal(billRace.filter(r=>r.status==='fulfilled').length,1)
    assert.equal(asUser(8,`select count(*) from record_events where record_id='${id(921)}' and action='status_changed'`),'1')
    const duplicateRace=await Promise.allSettled([922,923].map(n=>concurrent(path.join(bin,'psql'),[...psqlArgs,'-c',asUserSql(1,vendorSave(n,{...vendorData,bill_number:'RACE-1'}),true)])))
    assert.equal(duplicateRace.filter(r=>r.status==='fulfilled').length,1)
    const unpaidVendorBill=sql(`select id from vendor_bills where bill_number='RACE-1'`)
    asUser(1,`update vendors set archived_at=now() where id='${id(910)}'`,true)
    denied(()=>asUser(1,vendorSave(924,{...vendorData,bill_number:'ARCHIVED-NEW'})),'22023')
    asUser(1,`select vendor_bill_action('${unpaidVendorBill}','pay',(select updated_at from vendor_bills where id='${unpaidVendorBill}'),'2026-01-10')`,true)
    assert.equal(asUser(1,`select status from vendor_bills where id='${unpaidVendorBill}'`),'paid')
    console.log('PASS: competing review/payment/cancellation writes and duplicate bill creates serialize; archived vendors reject new bills and preserve existing payments')
    console.log('PASS: independent review, reject/resubmit, immutable scoped history, bill duplicate/version checks, paid preservation, atomic vendor bills and protected line totals')

    // Canonical single-workspace registry cannot be forged by browser clients.
    assert.equal(asUser(1,`select workspace_id from workspace_memberships`),id(100))
    assert.equal(asUser(6,`select workspace_id from workspace_memberships`),id(6))
    assert.equal(asUser(7,`select count(*) from workspaces`),'0')
    denied(()=>asUser(3,`update workspace_memberships set role='OWNER'`))
    denied(()=>asUser(1,`insert into workspaces(id,owner_id,kind) values('${id(999)}','${id(1)}','individual')`))
    denied(()=>sql(`set "request.jwt.claims" = '{"role":"service_role"}'; update users set organization_id='${id(101)}' where id='${id(2)}'`))
    sql(`set "request.jwt.claims" = '{"role":"service_role"}'; update users set is_active=false where id='${id(2)}'`)
    assert.equal(sql(`select is_active from workspace_memberships where user_id='${id(2)}'`),'f')
    sql(`set "request.jwt.claims" = '{"role":"service_role"}'; update users set is_active=true where id='${id(2)}'`)
    asUser(1,`update vendors set city='Synthetic city',payment_terms=0 where id='${id(910)}'`,true)
    assert.equal(asUser(1,`select city from workspace_contacts where id='${id(910)}'`),'Synthetic city')
    assert.equal(asUser(5,`select count(*) from workspace_contacts where id='${id(910)}'`),'0')
    denied(()=>asUser(1,`delete from vendors where id='${id(910)}'`))
    asUser(1,`update vendors set archived_at=now() where id='${id(910)}'`,true)
    assert.equal(asUser(1,`select count(*) from workspace_contacts where id='${id(910)}' and archived_at is not null`),'1')
    assert.equal(asUser(1,`select count(*) from vendor_bills where id='${id(911)}'`),'1')
    for (const patch of [{admin:true},{default_tax_rate:101},{payment_terms:-1},{payment_terms:1.5},{default_currency:'INVALID'},{notifications:{unknown:true}},{date_format:null}]) {
      denied(()=>asUser(1,`select set_own_preferences('${JSON.stringify(patch)}')`),'22023')
    }
    await Promise.all([{payment_terms:0},{default_currency:'EUR'}].map(patch=>concurrent(path.join(bin,'psql'),[...psqlArgs,'-c',asUserSql(1,`select set_own_preferences('${JSON.stringify(patch)}')`,true)])))
    assert.equal(asUser(1,`select preferences->>'payment_terms' from users where id='${id(1)}'`),'0')
    assert.equal(asUser(1,`select preferences->>'default_currency' from users where id='${id(1)}'`),'EUR')
    assert.equal(sql(`select preferences::text from users where id='${id(5)}'`),'{}')
    denied(()=>asUser(7,`select set_own_preferences('{}')`))
    denied(()=>sql(`set role anon; select set_own_preferences('{}')`))
    assert.equal(asUser(8,`select next_values->>'amount' from record_events where record_id='${id(901)}' and action='created'`),'30.00')
    assert.equal(sql(`select count(*) from record_events where next_values ?| array['receipt_path','receipt_url','notes','merchant']`),'0')
    await Promise.all([1,2].map(()=>concurrent(path.join(bin,'psql'),[...psqlArgs,'-c',asUserSql(6,'select seed_quarterly_estimates(2026)',true)])))
    assert.equal(asUser(6,"select count(*) from tax_filings where form_type='1040-ES'"),'4')
    assert.equal(asUser(9,"select count(*) from tax_filings where form_type='1040-ES'"),'0')
    denied(()=>asUser(7,'select seed_quarterly_estimates(2026)'))
    denied(()=>asUser(6,'select seed_quarterly_estimates(2027)'),'22023')
    for(const actor of [3,4,7,8]) denied(()=>asUser(actor,`insert into vendors(user_id,name) values('${id(actor)}','Unauthorized supplier')`))
    console.log('PASS: one-workspace memberships, forgery/switch denial, active-status sync, scoped archived contacts, persisted fields, validated concurrent preferences and safe audit values')

    sql(`insert into accounts(id,user_id,organization_id,code,name,category) values
      ('${id(950)}','${id(1)}','${id(100)}','100','Synthetic cash','asset'),
      ('${id(951)}','${id(5)}','${id(101)}','100','Foreign cash','asset');
      insert into journal_entries(id,user_id,organization_id,entry_number,date,description)
        values('${id(952)}','${id(1)}','${id(100)}','QA','2026-01-01','Synthetic journal');
      insert into journal_entry_lines(id,journal_entry_id,account_id,debit) values
        ('${id(953)}','${id(952)}','${id(950)}',10),('${id(954)}','${id(952)}','${id(951)}',10);
      insert into employees(id,user_id,organization_id,name,email,hire_date,salary) values
        ('${id(955)}','${id(1)}','${id(100)}','Synthetic employee','qa@example.invalid','2026-01-01',100),
        ('${id(956)}','${id(5)}','${id(101)}','Foreign employee','other@example.invalid','2026-01-01',100);
      insert into payroll_runs(id,user_id,organization_id,pay_period_start,pay_period_end,pay_date)
        values('${id(957)}','${id(1)}','${id(100)}','2026-01-01','2026-01-15','2026-01-16');
      insert into pay_stubs(id,payroll_run_id,employee_id) values
        ('${id(958)}','${id(957)}','${id(955)}'),('${id(959)}','${id(957)}','${id(956)}');`)
    assert.equal(asUser(1,'select count(*) from journal_entry_lines'),'1')
    assert.equal(asUser(1,'select count(*) from pay_stubs'),'1')
    for(const actor of [3,4,5,7,8,9]) {
      assert.equal(asUser(actor,`select count(*) from payroll_runs where id='${id(957)}'`),'0')
      assert.equal(asUser(actor,'select count(*) from journal_entry_lines'),'0')
    }
    for (const table of ['accounts','journal_entries','journal_entry_lines','employees','payroll_runs','pay_stubs','inventory_items']) {
      for(const actor of [1,2,3,4,5,6,7,8,9]) {
        denied(()=>asUser(actor,`delete from ${table}`))
        assert.equal(sql(`select has_table_privilege('authenticated','${table}','INSERT') or has_table_privilege('authenticated','${table}','UPDATE')`),'f')
      }
    }
    console.log('PASS: deferred module writes denied for every role; historical reads require manager and matching parent workspace')

    denied(() => asUser(7, 'select consume_ai_quota()'))
    denied(() => sql('set role anon; select consume_ai_quota()'))
    denied(() => asUser(1, 'select * from ai_usage'))
    denied(() => asUser(1, 'delete from ai_usage'))
    // Real concurrent database connections compete for the same user's quota.
    const run = promisify(execFile)
    const results = await Promise.all(Array.from({ length: 24 }, () => run(path.join(bin, 'psql'), [...psqlArgs, '-c', asUserSql(1, 'select consume_ai_quota()', true)])))
    assert.equal(results.filter(result => result.stdout.trim() === 't').length, 10)
    assert.equal(asUser(2, 'select consume_ai_quota()', true), 't')
    sql(`update ai_usage set minute_start=now()-interval '2 minutes',day_count=100 where user_id='${id(1)}'`)
    assert.equal(asUser(1, 'select consume_ai_quota()', true), 'f')
    sql(`update ai_usage set day_start=now()-interval '2 days' where user_id='${id(1)}'`)
    assert.equal(asUser(1, 'select consume_ai_quota()', true), 't')
    console.log('PASS: quota permissions, 24 concurrent requests allow exactly 10, per-user isolation, daily limit and rollover')
  } finally {
    if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' })
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(socket, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
