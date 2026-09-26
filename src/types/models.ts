import {
  AccountType,
  Role,
  TimeEntryStatus,
  TimeEntrySource,
  InvoiceStatus,
  ExpenseStatus,
  ExpenseCategory,
  BillingModel,
  BillStatus,
  BillCategory,
  BillRecurrence,
  AccountCategory,
  JournalEntryStatus,
  VendorStatus,
  PurchaseOrderStatus,
  PayrollStatus,
  PayFrequency,
  StockStatus,
  TaxFilingStatus,
} from './enums'

// ============================================================
// User
// ============================================================

export interface User {
  id: string
  email: string
  name: string
  role: Role
  account_type: AccountType
  hourly_rate?: number
  is_active: boolean
  avatar_url?: string
  phone?: string
  timezone?: string
  preferences?: Record<string, unknown>
  organization_id?: string
  created_at: string
  updated_at: string
}

// ============================================================
// Organization
// ============================================================

export interface Organization {
  id: string
  name: string
  email?: string
  phone?: string
  address?: string
  city?: string
  state?: string
  zip_code?: string
  country?: string
  tax_id?: string
  settings?: Record<string, unknown>
  created_at: string
  updated_at: string
}

// ============================================================
// Client
// ============================================================

export interface Client {
  id: string
  organization_id?: string
  user_id?: string
  name: string
  email?: string
  phone?: string
  address?: string
  city?: string
  state?: string
  zip_code?: string
  country?: string
  contact_name?: string
  notes?: string
  is_active: boolean
  created_at: string
  updated_at: string
}

// ============================================================
// Project
// ============================================================

export interface Project {
  id: string
  organization_id?: string
  user_id?: string
  client_id?: string
  name: string
  description?: string
  billing_model: BillingModel
  rate?: number
  budget?: number
  start_date?: string
  end_date?: string
  is_active: boolean
  color?: string
  created_at: string
  updated_at: string
  // Relations
  client?: Client
  tasks?: Task[]
}

// ============================================================
// Task (ProjectTask)
// ============================================================

export interface Task {
  id: string
  project_id: string
  name: string
  description?: string
  rate?: number
  estimated_hours?: number
  is_active: boolean
  created_at: string
  updated_at: string
  // Relations
  project?: Project
}

// ============================================================
// Time Entry
// ============================================================

export interface TimeEntry {
  id: string
  user_id: string
  project_id?: string
  task_id?: string
  start_at: string
  end_at?: string
  duration_minutes?: number
  notes?: string
  status: TimeEntryStatus
  source: TimeEntrySource
  billable_rate?: number
  invoice_id?: string
  created_at: string
  updated_at: string
  // Relations
  project?: Project
  task?: Task
  user?: User
  billing_links?: { invoice_id: string; released_at?: string | null }[]
}

// ============================================================
// Invoice
// ============================================================

export interface Invoice {
  id: string
  organization_id?: string
  user_id?: string
  client_id?: string
  project_id?: string
  invoice_number: string
  issue_date: string
  due_date: string
  subtotal: number
  tax_rate: number
  tax_amount: number
  total: number
  currency: string
  status: InvoiceStatus
  notes?: string
  paid_at?: string
  created_at: string
  updated_at: string
  // Relations
  client?: Client
  project?: Project
  line_items?: InvoiceLineItem[]
  payments?: InvoicePayment[]
  events?: InvoiceEvent[]
  amount_paid?: number
  balance_due?: number
  workflow_version?: number
  issued_snapshot?: { client?: Partial<Client> }
  time_links?: { time_entry_id: string; released_at?: string | null }[]
}

export interface InvoicePayment {
  id: string
  invoice_id: string
  amount: number
  paid_on: string
  method: 'bank_transfer' | 'card' | 'cash' | 'check' | 'other'
  reference: string
  created_at: string
  reversal?: { id: string; reason: string; created_at: string } | null
}

export interface InvoiceEvent {
  id: string
  action: 'created' | 'updated' | 'issued' | 'payment_recorded' | 'payment_reversed' | 'time_reserved' | 'cancelled'
  created_at: string
}

export interface InvoiceLineItem {
  id: string
  invoice_id: string
  description: string
  quantity: number
  rate: number
  amount: number
  order: number
  created_at: string
  updated_at: string
}

// ============================================================
// Expense
// ============================================================

export interface Expense {
  id: string
  user_id: string
  project_id?: string
  task_id?: string
  amount: number
  currency: string
  category: ExpenseCategory
  description?: string
  merchant?: string
  expense_date: string
  receipt_url?: string
  receipt_path?: string
  status: ExpenseStatus
  notes?: string
  invoice_id?: string
  created_at: string
  updated_at: string
  // Relations
  project?: Project
  task?: Task
  user?: User
}

// ============================================================
// Bill (Personal bills/payments)
// ============================================================

export interface Bill {
  id: string
  user_id: string
  name: string
  payee: string
  amount: number
  currency: string
  category: BillCategory
  due_date: string
  status: BillStatus
  recurrence: BillRecurrence
  notes?: string
  paid_at?: string
  auto_pay: boolean
  created_at: string
  updated_at: string
}

// ============================================================
// Chart of Accounts
// ============================================================

export interface Account {
  id: string
  organization_id?: string
  user_id?: string
  code: string
  name: string
  category: AccountCategory
  parent_id?: string
  description?: string
  is_active: boolean
  balance: number
  created_at: string
  updated_at: string
  // Relations
  children?: Account[]
}

// ============================================================
// Journal Entry
// ============================================================

export interface JournalEntry {
  id: string
  organization_id?: string
  user_id?: string
  entry_number: string
  date: string
  description: string
  status: JournalEntryStatus
  reference?: string
  notes?: string
  created_at: string
  updated_at: string
  // Relations
  lines?: JournalEntryLine[]
}

export interface JournalEntryLine {
  id: string
  journal_entry_id: string
  account_id: string
  description?: string
  debit: number
  credit: number
  order: number
  created_at: string
  updated_at: string
  // Relations
  account?: Account
}

// ============================================================
// Vendor
// ============================================================

export interface Vendor {
  id: string
  organization_id?: string
  user_id?: string
  name: string
  email?: string
  phone?: string
  address?: string
  city?: string
  state?: string
  zip_code?: string
  country?: string
  contact_name?: string
  tax_id?: string
  payment_terms?: number
  notes?: string
  status: VendorStatus
  created_at: string
  updated_at: string
}

// ============================================================
// Vendor Bill (Accounts Payable)
// ============================================================

export interface VendorBill {
  id: string
  organization_id?: string
  user_id?: string
  vendor_id: string
  bill_number: string
  issue_date: string
  due_date: string
  subtotal: number
  tax_rate: number
  tax_amount: number
  total: number
  currency: string
  status: BillStatus
  notes?: string
  paid_at?: string
  created_at: string
  updated_at: string
  // Relations
  vendor?: Vendor
  line_items?: VendorBillLineItem[]
}

export interface VendorBillLineItem {
  id: string
  vendor_bill_id: string
  description: string
  quantity: number
  rate: number
  amount: number
  account_id?: string
  order: number
  created_at: string
  updated_at: string
}

// ============================================================
// Purchase Order
// ============================================================

export interface PurchaseOrder {
  id: string
  organization_id?: string
  user_id?: string
  vendor_id: string
  po_number: string
  date: string
  expected_date?: string
  subtotal: number
  tax_rate: number
  tax_amount: number
  total: number
  currency: string
  status: PurchaseOrderStatus
  notes?: string
  created_at: string
  updated_at: string
  // Relations
  vendor?: Vendor
  line_items?: PurchaseOrderLineItem[]
}

export interface PurchaseOrderLineItem {
  id: string
  purchase_order_id: string
  description: string
  quantity: number
  rate: number
  amount: number
  order: number
  created_at: string
  updated_at: string
}

// ============================================================
// Employee (Payroll)
// ============================================================

export interface Employee {
  id: string
  organization_id: string
  user_id?: string
  name: string
  email: string
  department?: string
  title?: string
  hire_date: string
  salary: number
  pay_frequency: PayFrequency
  tax_filing_status?: string
  federal_allowances: number
  state_allowances: number
  is_active: boolean
  created_at: string
  updated_at: string
}

// ============================================================
// Payroll Run
// ============================================================

export interface PayrollRun {
  id: string
  organization_id: string
  pay_period_start: string
  pay_period_end: string
  pay_date: string
  status: PayrollStatus
  total_gross: number
  total_deductions: number
  total_net: number
  total_employer_taxes: number
  notes?: string
  created_at: string
  updated_at: string
  // Relations
  pay_stubs?: PayStub[]
}

export interface PayStub {
  id: string
  payroll_run_id: string
  employee_id: string
  gross_pay: number
  federal_tax: number
  state_tax: number
  social_security: number
  medicare: number
  other_deductions: number
  net_pay: number
  hours_worked?: number
  created_at: string
  updated_at: string
  // Relations
  employee?: Employee
}

// ============================================================
// Inventory
// ============================================================

export interface InventoryItem {
  id: string
  organization_id: string
  sku: string
  name: string
  description?: string
  category?: string
  unit_price: number
  cost_price: number
  quantity_on_hand: number
  reorder_point: number
  reorder_quantity: number
  supplier_id?: string
  stock_status: StockStatus
  is_active: boolean
  created_at: string
  updated_at: string
  // Relations
  supplier?: Vendor
}

// ============================================================
// Tax Filing
// ============================================================

export interface TaxFiling {
  id: string
  organization_id?: string
  user_id?: string
  name: string
  form_type: string
  tax_period_start: string
  tax_period_end: string
  due_date: string
  filed_date?: string
  status: TaxFilingStatus
  amount_due?: number
  amount_paid?: number
  notes?: string
  created_at: string
  updated_at: string
}

// ============================================================
// Form Types (for creating/updating)
// ============================================================

export type CreateUserInput = Omit<User, 'id' | 'created_at' | 'updated_at'>
export type UpdateUserInput = Partial<CreateUserInput>

export type CreateOrganizationInput = Omit<Organization, 'id' | 'created_at' | 'updated_at'>
export type UpdateOrganizationInput = Partial<CreateOrganizationInput>

export type CreateClientInput = Omit<Client, 'id' | 'created_at' | 'updated_at'>
export type UpdateClientInput = Partial<CreateClientInput>

export type CreateProjectInput = Omit<Project, 'id' | 'created_at' | 'updated_at' | 'client' | 'tasks'>
export type UpdateProjectInput = Partial<CreateProjectInput>

export type CreateTaskInput = Omit<Task, 'id' | 'created_at' | 'updated_at' | 'project'>
export type UpdateTaskInput = Partial<CreateTaskInput>

export type CreateTimeEntryInput = Omit<TimeEntry, 'id' | 'created_at' | 'updated_at' | 'project' | 'task' | 'user'>
export type UpdateTimeEntryInput = Partial<CreateTimeEntryInput>

export type CreateInvoiceInput = Pick<Invoice, 'organization_id' | 'user_id' | 'client_id' | 'project_id' | 'issue_date' | 'due_date' | 'subtotal' | 'tax_rate' | 'tax_amount' | 'total' | 'currency' | 'notes' | 'status'> & {
  invoice_number?: string
}

export type UpdateInvoiceInput = Partial<
  Pick<Invoice, 'client_id' | 'project_id' | 'invoice_number' | 'issue_date' | 'due_date' | 'tax_rate' | 'currency' | 'notes' | 'paid_at'>
> & {
  status?: InvoiceStatus | string
}

export type CreateInvoiceLineItemInput = Pick<InvoiceLineItem, 'invoice_id' | 'description' | 'quantity' | 'rate'> & {
  amount?: number
  order?: number
}
export type UpdateInvoiceLineItemInput = Partial<CreateInvoiceLineItemInput>

export type CreateExpenseInput = Omit<Expense, 'id' | 'created_at' | 'updated_at' | 'project' | 'task' | 'user'>
export type UpdateExpenseInput = Partial<CreateExpenseInput>

export type CreateBillInput = Omit<Bill, 'id' | 'created_at' | 'updated_at'>
export type UpdateBillInput = Partial<CreateBillInput>

export type CreateAccountInput = Omit<Account, 'id' | 'created_at' | 'updated_at' | 'children' | 'balance'>
export type UpdateAccountInput = Partial<CreateAccountInput>

export type CreateJournalEntryInput = Omit<JournalEntry, 'id' | 'created_at' | 'updated_at' | 'lines'>
export type UpdateJournalEntryInput = Partial<CreateJournalEntryInput>

export type CreateJournalEntryLineInput = Omit<JournalEntryLine, 'id' | 'created_at' | 'updated_at' | 'account'>
export type UpdateJournalEntryLineInput = Partial<CreateJournalEntryLineInput>

export type CreateVendorInput = Omit<Vendor, 'id' | 'created_at' | 'updated_at'>
export type UpdateVendorInput = Partial<CreateVendorInput>

export type CreateVendorBillInput = Omit<VendorBill, 'id' | 'created_at' | 'updated_at' | 'vendor' | 'line_items'>
export type UpdateVendorBillInput = Partial<CreateVendorBillInput>

export type CreatePurchaseOrderInput = Omit<PurchaseOrder, 'id' | 'created_at' | 'updated_at' | 'vendor' | 'line_items'>
export type UpdatePurchaseOrderInput = Partial<CreatePurchaseOrderInput>

export type CreateEmployeeInput = Omit<Employee, 'id' | 'created_at' | 'updated_at'>
export type UpdateEmployeeInput = Partial<CreateEmployeeInput>

export type CreatePayrollRunInput = Omit<PayrollRun, 'id' | 'created_at' | 'updated_at' | 'pay_stubs'>
export type UpdatePayrollRunInput = Partial<CreatePayrollRunInput>

export type CreateInventoryItemInput = Omit<InventoryItem, 'id' | 'created_at' | 'updated_at' | 'supplier'>
export type UpdateInventoryItemInput = Partial<CreateInventoryItemInput>

export type CreateTaxFilingInput = Omit<TaxFiling, 'id' | 'created_at' | 'updated_at'>
export type UpdateTaxFilingInput = Partial<CreateTaxFilingInput>
