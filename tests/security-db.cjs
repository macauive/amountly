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
    for (const name of migrations) {
      if (name.startsWith('011_')) {
        // Legacy migration 011 assumes an out-of-band owner_id column. Migration
        // 019 later explicitly adds it; supply that historical prerequisite here.
        sql('alter table public.organizations add column owner_id uuid references auth.users(id)')
      }
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
    for (const actor of [1, 2]) {
      assert.equal(asUser(actor, `with changed as (update invoices set notes='Changed' where id='${id(400)}' returning id) select count(*) from changed`), '1')
    }
    assert.equal(asUser(3, `with changed as (update invoices set status='PAID' where id='${id(400)}' returning id) select count(*) from changed`), '0')
    denied(() => asUser(4, `update invoices set status='SENT', notes='Smuggled change' where id='${id(400)}'`))
    denied(() => asUser(4, `update invoices set status='PAID' where id='${id(400)}'`))
    assert.equal(asUser(4, `with changed as (update invoices set status='SENT' where id='${id(400)}' returning id) select count(*) from changed`), '1')
    assert.equal(asUser(4, `with changed as (delete from invoices where id='${id(400)}' returning id) select count(*) from changed`), '0')
    assert.equal(asUser(4, `with changed as (update invoice_line_items set rate=10 where id='${id(450)}' returning id) select count(*) from changed`), '0')
    denied(() => asUser(1, `update invoices set client_id='${id(201)}' where id='${id(400)}'`))
    denied(() => asUser(1, `update invoices set project_id='${id(301)}' where id='${id(400)}'`))
    denied(() => asUser(1, `update invoices set organization_id='${id(101)}' where id='${id(400)}'`))
    assert.equal(asUser(3, `select (get_business_metrics('${id(3)}')->>'outstanding_revenue')::numeric`), '0')
    denied(() => asUser(1, `select get_business_metrics('${id(5)}')`), 'P0001')
    console.log('PASS: owner/admin/member/contractor roles, cross-tenant reads/writes, parent lines, send-only transitions, aggregate RPC boundary')

    // Contractor can still create a draft and its lines, but cannot append after sending.
    const draft = `insert into invoices (id,organization_id,invoice_number,issue_date,due_date,subtotal,total) values ('${id(410)}','${id(100)}','TEST-C',now(),now(),1,1)`
    const line = `insert into invoice_line_items (invoice_id,description,quantity,rate,amount) values ('${id(410)}','Synthetic',1,1,1)`
    asUser(4, `${draft}; ${line}`)
    denied(() => asUser(4, `${draft}; update invoices set status='SENT' where id='${id(410)}'; ${line}`))
    denied(() => asUser(3, draft))
    console.log('PASS: contractor draft creation and line insertion, post-send line protection')

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
