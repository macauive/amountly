import { effectiveBillStatus } from '@/lib/bill-status'
import type { Expense, Invoice, Bill, VendorBill } from '@/types/models'
import { searchRecordSchema, type SearchRecord } from '@/lib/record-search'
export const expenseSearchRecord=(row:Expense):SearchRecord=>searchRecordSchema.parse({id:row.id,kind:'expenses',label:row.merchant||row.description||'Expense',detail:row.description||'',amount:row.amount,currency:row.currency,date:row.expense_date,status:row.status,receipt:!!(row.receipt_path||row.receipt_url)})
export const invoiceSearchRecord=(row:Invoice):SearchRecord=>searchRecordSchema.parse({id:row.id,kind:'invoices',label:row.invoice_number,detail:row.client?.name||row.notes||'',amount:row.total,currency:row.currency,date:row.issue_date,status:row.status,receipt:false})
export const billSearchRecord=(row:Bill):SearchRecord=>searchRecordSchema.parse({id:row.id,kind:'bills',label:row.name,detail:row.notes||'',amount:row.amount,currency:row.currency,date:row.due_date,status:effectiveBillStatus(row),receipt:false})
export const vendorBillSearchRecord=(row:VendorBill):SearchRecord=>searchRecordSchema.parse({id:row.id,kind:'vendor_bills',label:row.bill_number,detail:row.vendor?.name||row.notes||'',amount:row.total,currency:row.currency,date:row.due_date,status:effectiveBillStatus(row),receipt:false})
