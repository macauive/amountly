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
      const snapshots = ['organizations','users','clients','projects','invoices','invoice_line_items','expenses','time_entries'].map(table => {
        const columns = sql(`select string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='${table}'`)
        const query = `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (select ${columns} from public.${table} order by id) t`
        return { table, query, before: sql(query) }
      })
      for (const name of workflowMigrations) sql(fs.readFileSync(path.join('supabase/migrations', name), 'utf8'))
      for (const snapshot of snapshots) assert.equal(sql(snapshot.query), snapshot.before, `${snapshot.table}: upgrade changed historical values`)
      assert.equal(sql('select count(*) from invoice_payments'), '0')
      assert.equal(sql('select count(*) from invoice_events'), '0')
      assert.equal(asUser(1, `select status from invoices where id='${id(410)}'`), 'PAID')
      assert.equal(asUser(5, `select count(*) from invoices where id='${id(410)}'`), '0')
      denied(() => asUser(3, `update expenses set amount=-6 where id='${id(710)}'`), '23514')
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
    denied(() => asUser(1,save(500,payload,lines,"'2000-01-01'::timestamptz")), '40001')
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
