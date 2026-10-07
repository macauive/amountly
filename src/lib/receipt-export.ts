// Server-only receipt reads. No service key or caller-supplied URL is used.
import { Pool } from 'pg'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requiredSecret } from '@/lib/platform/config'
import { packetLimits, PacketLimitError, type ReceiptReader } from '@/lib/accountant-packet'

let pool:Pool|undefined
export async function withReceiptReader<T>(identity:{id:string;email:string},client:SupabaseClient,deadline:number,work:(reader:ReceiptReader)=>Promise<T>) {
  const checkTime = () => { if (Date.now() > deadline) throw new Error('Receipt export timed out') }
  if (process.env.NEXT_PUBLIC_BACKEND !== 'render') {
    return work(async path=>{
      checkTime()
      const {data,error} = await client.storage.from('receipts').download(path)
      checkTime()
      if (error) {
        // Only a confirmed missing object is an index entry. Denial or a storage
        // outage must not silently produce a seemingly complete export.
        const status = 'statusCode' in error ? String(error.statusCode) : ''
        if (status === '404') return null
        throw new Error('Receipt storage unavailable')
      }
      if (!data) throw new Error('Receipt storage unavailable')
      if (data.size > packetLimits.fileBytes) throw new PacketLimitError()
      return {bytes:new Uint8Array(await data.arrayBuffer()),mime:data.type}
    })
  }
  checkTime()
  pool ??= new Pool({connectionString:requiredSecret('DATA_DATABASE_URL'),max:1,connectionTimeoutMillis:10000})
  const connection = await pool.connect()
  try {
    await connection.query('begin read only')
    await connection.query('set local role authenticated')
    await connection.query("select set_config('request.jwt.claims',$1,true),set_config('statement_timeout','10000',true)",
      [JSON.stringify({sub:identity.id,email:identity.email,role:'authenticated'})])
    const result = await work(async path=>{
      checkTime()
      const receipt = await connection.query('select content_type,contents from amountly_files.receipts where path=$1',[path])
      checkTime()
      if (!receipt.rows[0]) return null
      return {mime:receipt.rows[0].content_type,bytes:receipt.rows[0].contents as Uint8Array}
    })
    await connection.query('commit')
    return result
  } catch (error) {
    await connection.query('rollback').catch(()=>{})
    throw error
  } finally { connection.release() }
}
