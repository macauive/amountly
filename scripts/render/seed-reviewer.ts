import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { Pool } from 'pg'
import { hashPassword } from 'better-auth/crypto'
import { z } from 'zod/v3'

async function main() {
  if (process.env.AMOUNTLY_REVIEWER_TARGET !== 'approved-review-fixture') throw new Error('Explicit review-fixture target required')
  const file=process.env.AMOUNTLY_REVIEWER_CREDENTIALS_FILE, connectionString=process.env.AMOUNTLY_MIGRATION_DATABASE_URL
  if (!file || !connectionString) throw new Error('Protected configuration required')
  let fixture: {email:string;password:string;userId:string;organizationId:string;invoiceId:string;vendorId:string;billId:string;expenseIds:string[]}
  try {
    if (((await stat(file)).mode & 0o077)!==0) throw new Error('Reviewer file must be owner-only')
    fixture=JSON.parse(await readFile(file,'utf8'))
  } catch(error) {
    if ((error as NodeJS.ErrnoException).code!=='ENOENT') throw error
    fixture={email:'chatgpt-reviewer@amountly.app',password:randomBytes(32).toString('base64url'),userId:randomUUID(),organizationId:randomUUID(),invoiceId:randomUUID(),vendorId:randomUUID(),billId:randomUUID(),expenseIds:Array.from({length:5},()=>randomUUID())}
    await writeFile(file,JSON.stringify(fixture,null,2)+'\n',{mode:0o600,flag:'wx'})
  }
  fixture=z.object({email:z.literal('chatgpt-reviewer@amountly.app'),password:z.string().min(32).max(128),
    userId:z.string().uuid(),organizationId:z.string().uuid(),invoiceId:z.string().uuid(),vendorId:z.string().uuid(),billId:z.string().uuid(),
    expenseIds:z.array(z.string().uuid()).length(5)}).strict().parse(fixture)
  // The entire fixture is synthetic and isolated in a dedicated organization.
  // Refuse an existing email/ID rather than changing any existing account.
  const db=new Pool({connectionString,max:1}), tx=await db.connect()
  try {
    await tx.query('begin')
    const existing=await tx.query('select 1 from amountly_auth."user" where id=$1 or email=$2',[fixture.userId,fixture.email])
    if (existing.rowCount) throw new Error('Review account already exists; do not overwrite')
    await tx.query("set local request.jwt.claims='{\"role\":\"service_role\"}'")
    await tx.query('insert into amountly_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt",disabled) values($1,\'Amountly review account\',$2,true,now(),now(),false)',[fixture.userId,fixture.email])
    await tx.query('insert into amountly_auth.account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") values($1,$2::text,\'credential\',$2::uuid,$3,now(),now())',[randomUUID(),fixture.userId,await hashPassword(fixture.password)])
    await tx.query("insert into organizations(id,name,owner_id) values($1,'Amountly synthetic review workspace',$2)",[fixture.organizationId,fixture.userId])
    await tx.query("insert into public.users(id,organization_id,email,name,role,account_type,is_active) values($1,$2,$3,'Amountly review account','OWNER','business',true)",[fixture.userId,fixture.organizationId,fixture.email])
    await tx.query("insert into invoices(id,organization_id,invoice_number,issue_date,due_date,subtotal,total,currency,status) values($1,$2,'REVIEW-001','2026-09-01','2026-09-20',500,500,'USD','SENT')",[fixture.invoiceId,fixture.organizationId])
    await tx.query("insert into vendors(id,user_id,organization_id,name) values($1,$2,$3,'Synthetic vendor')",[fixture.vendorId,fixture.userId,fixture.organizationId])
    await tx.query("insert into vendor_bills(id,user_id,organization_id,vendor_id,bill_number,date,due_date,subtotal,total,currency,status) values($1,$2,$3,$4,'REVIEW-BILL-001','2026-09-01','2026-09-30',75,75,'USD','overdue')",[fixture.billId,fixture.userId,fixture.organizationId,fixture.vendorId])
    const dates=['2026-08-01','2026-08-10','2026-09-05','2026-10-02','2026-10-03'],amounts=[40,50,60,23.5,180]
    for(let i=0;i<5;i++) await tx.query("insert into expenses(id,user_id,description,expense_date,amount,currency,status,category) values($1,$2,'Synthetic review expense',$3,$4,'USD','DRAFT',$5)",[fixture.expenseIds[i],fixture.userId,dates[i],amounts[i],i===3?'OFFICE_SUPPLIES':'SOFTWARE'])
    await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:'authenticated',sub:fixture.userId})])
    await tx.query("select public.record_invoice_payment($1,$2,100,'2026-09-15','bank_transfer','Synthetic review payment')",[randomUUID(),fixture.invoiceId])
    await tx.query('commit')
    console.log('Synthetic reviewer account and expected financial cases created; credentials kept in the owner-only file')
  } catch(error) { await tx.query('rollback');throw error }
  finally {tx.release();await db.end()}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Reviewer fixture failed');process.exitCode=1})
