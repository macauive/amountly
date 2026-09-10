'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { User, Building2, Bell, Download, Lock } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/contexts/AuthContext'
import { useAppState } from '@/contexts/AppStateContext'
import { getSupabaseClient } from '@/lib/supabase'
import { Capability } from '@/types/enums'

import { escapeCsvValue } from '@/lib/csv'

// ─── CSV Export Utility ──────────────────────────────────────

function downloadCSV(rows: Record<string, unknown>[], filename: string) {
  if (rows.length === 0) {
    toast.error('No data to export')
    return
  }
  const headers = Object.keys(rows[0])
  const csv = [
    headers.map(escapeCsvValue).join(','),
    ...rows.map((row) => headers.map((h) => escapeCsvValue(row[h])).join(',')),
  ].join('\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── Constants ───────────────────────────────────────────────

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'MXN']

const INTEGRATIONS = [
  {
    title: 'Bank Accounts',
    icon: '🏦',
    description: 'Connect your bank accounts for automatic transaction import and reconciliation.',
  },
  {
    title: 'Stripe',
    icon: '💳',
    description: 'Accept credit card payments and automatically mark invoices as paid.',
  },
  {
    title: 'PayPal',
    icon: '🅿️',
    description: 'Accept PayPal payments from clients.',
  },
  {
    title: 'QuickBooks',
    icon: '📊',
    description: 'Sync your accounting data with QuickBooks Online.',
  },
  {
    title: 'Xero',
    icon: '🔄',
    description: 'Two-way sync with Xero accounting software.',
  },
  {
    title: 'Developer API',
    icon: '⚡',
    description: 'Access your data programmatically via a REST API.',
  },
]

// ─── Settings Page ────────────────────────────────────────────

export default function SettingsPage() {
  const { user, organization, refreshUser } = useAuth()
  const { hasCapability } = useAppState()
  const supabase = getSupabaseClient()

  // ── Profile ──
  const [profile, setProfile] = useState({ name: '', phone: '', timezone: '' })
  const [savingProfile, setSavingProfile] = useState(false)

  // ── Password ──
  const [pwd, setPwd] = useState({ newPassword: '', confirm: '' })
  const [savingPwd, setSavingPwd] = useState(false)

  // ── Organization ──
  const [org, setOrg] = useState({
    name: '', email: '', phone: '',
    address: '', city: '', state: '', zip_code: '', country: 'US', tax_id: '',
  })
  const [savingOrg, setSavingOrg] = useState(false)

  // ── Tax & Billing Preferences ──
  const [taxPrefs, setTaxPrefs] = useState({
    default_tax_rate: '0',
    fiscal_year_start: '1',
    default_currency: 'USD',
    payment_terms: '30',
    date_format: 'MM/DD/YYYY',
  })
  const [savingTax, setSavingTax] = useState(false)

  // ── Notification Preferences ──
  const [notifPrefs, setNotifPrefs] = useState({
    overdue_invoices: true,
    bill_due_reminders: true,
    payroll_confirmation: true,
    low_stock_alerts: false,
    weekly_summary: false,
  })
  const [savingNotif, setSavingNotif] = useState(false)

  // ── Export ──
  const [exporting, setExporting] = useState<string | null>(null)

  // Populate forms from loaded user/org
  useEffect(() => {
    if (user) {
      setProfile({ name: user.name || '', phone: user.phone || '', timezone: user.timezone || '' })
      const prefs = (user.preferences || {}) as Record<string, unknown>
      setTaxPrefs({
        default_tax_rate: String(prefs.default_tax_rate ?? '0'),
        fiscal_year_start: String(prefs.fiscal_year_start ?? '1'),
        default_currency: String(prefs.default_currency ?? 'USD'),
        payment_terms: String(prefs.payment_terms ?? '30'),
        date_format: String(prefs.date_format ?? 'MM/DD/YYYY'),
      })
      const np = ((prefs.notifications || {}) as Record<string, boolean>)
      setNotifPrefs({
        overdue_invoices: np.overdue_invoices ?? true,
        bill_due_reminders: np.bill_due_reminders ?? true,
        payroll_confirmation: np.payroll_confirmation ?? true,
        low_stock_alerts: np.low_stock_alerts ?? false,
        weekly_summary: np.weekly_summary ?? false,
      })
    }
  }, [user])

  useEffect(() => {
    if (organization) {
      setOrg({
        name: organization.name || '',
        email: organization.email || '',
        phone: organization.phone || '',
        address: organization.address || '',
        city: organization.city || '',
        state: organization.state || '',
        zip_code: organization.zip_code || '',
        country: organization.country || 'US',
        tax_id: organization.tax_id || '',
      })
    }
  }, [organization])

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : '?'

  // ── Handlers ──

  const handleSaveProfile = async () => {
    if (!user) return
    setSavingProfile(true)
    try {
      const { error } = await supabase
        .from('users')
        .update({ name: profile.name, phone: profile.phone || null, timezone: profile.timezone || null })
        .eq('id', user.id)
      if (error) throw new Error(error.message)
      await refreshUser()
      toast.success('Profile saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save profile')
    } finally {
      setSavingProfile(false)
    }
  }

  const handleChangePassword = async () => {
    if (pwd.newPassword !== pwd.confirm) { toast.error('Passwords do not match'); return }
    if (pwd.newPassword.length < 8) { toast.error('Password must be at least 8 characters'); return }
    setSavingPwd(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: pwd.newPassword })
      if (error) throw new Error(error.message)
      setPwd({ newPassword: '', confirm: '' })
      toast.success('Password updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update password')
    } finally {
      setSavingPwd(false)
    }
  }

  const handleSaveOrg = async () => {
    if (!organization) return
    setSavingOrg(true)
    try {
      const { error } = await supabase
        .from('organizations')
        .update({
          name: org.name,
          email: org.email || null,
          phone: org.phone || null,
          address: org.address || null,
          city: org.city || null,
          state: org.state || null,
          zip_code: org.zip_code || null,
          country: org.country || null,
          tax_id: org.tax_id || null,
        })
        .eq('id', organization.id)
      if (error) throw new Error(error.message)
      await refreshUser()
      toast.success('Organization saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save organization')
    } finally {
      setSavingOrg(false)
    }
  }

  const handleSaveTaxPrefs = async () => {
    if (!user) return
    setSavingTax(true)
    try {
      const current = (user.preferences || {}) as Record<string, unknown>
      const { error } = await supabase
        .from('users')
        .update({
          preferences: {
            ...current,
            default_tax_rate: parseFloat(taxPrefs.default_tax_rate) || 0,
            fiscal_year_start: parseInt(taxPrefs.fiscal_year_start) || 1,
            default_currency: taxPrefs.default_currency,
            payment_terms: parseInt(taxPrefs.payment_terms) || 30,
            date_format: taxPrefs.date_format,
          },
        })
        .eq('id', user.id)
      if (error) throw new Error(error.message)
      await refreshUser()
      toast.success('Tax & billing preferences saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save preferences')
    } finally {
      setSavingTax(false)
    }
  }

  const handleSaveNotifPrefs = async () => {
    if (!user) return
    setSavingNotif(true)
    try {
      const current = (user.preferences || {}) as Record<string, unknown>
      const { error } = await supabase
        .from('users')
        .update({ preferences: { ...current, notifications: notifPrefs } })
        .eq('id', user.id)
      if (error) throw new Error(error.message)
      await refreshUser()
      toast.success('Notification preferences saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save preferences')
    } finally {
      setSavingNotif(false)
    }
  }

  const handleExport = async (table: string, filename: string) => {
    setExporting(table)
    try {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      const rows = (data || []) as Record<string, unknown>[]
      downloadCSV(rows, filename)
      toast.success(`Exported ${rows.length} record${rows.length !== 1 ? 's' : ''}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to export ${table}`)
    } finally {
      setExporting(null)
    }
  }

  // Export items gated by capability
  const exportItems = [
    { key: 'invoices', label: 'Invoices', file: 'amountly-invoices.csv', cap: Capability.viewInvoices },
    { key: 'invoice_line_items', label: 'Invoice Line Items', file: 'amountly-invoice-lines.csv', cap: Capability.viewInvoices },
    { key: 'expenses', label: 'Expenses', file: 'amountly-expenses.csv', cap: Capability.viewOwnExpenses },
    { key: 'bills', label: 'Bills', file: 'amountly-bills.csv', cap: Capability.viewBills },
    { key: 'clients', label: 'Clients', file: 'amountly-clients.csv', cap: Capability.viewClients },
    { key: 'projects', label: 'Projects', file: 'amountly-projects.csv', cap: Capability.viewProjects },
    { key: 'time_entries', label: 'Time Entries', file: 'amountly-time-entries.csv', cap: Capability.viewOwnTimeEntries },
    { key: 'tax_filings', label: 'Tax Filings', file: 'amountly-tax-filings.csv', cap: Capability.viewTaxDashboard },
    { key: 'vendors', label: 'Vendors', file: 'amountly-vendors.csv', cap: Capability.manageVendors },
    { key: 'vendor_bills', label: 'Vendor Bills', file: 'amountly-vendor-bills.csv', cap: Capability.viewAccountsPayable },
    { key: 'purchase_orders', label: 'Purchase Orders', file: 'amountly-purchase-orders.csv', cap: Capability.createPurchaseOrders },
    { key: 'employees', label: 'Employees', file: 'amountly-employees.csv', cap: Capability.viewPayroll },
    { key: 'inventory_items', label: 'Inventory Items', file: 'amountly-inventory.csv', cap: Capability.viewInventory },
  ].filter((item) => hasCapability(item.cap))

  const notifOptions: {
    key: keyof typeof notifPrefs
    label: string
    description: string
    cap: Capability | null
  }[] = [
    { key: 'overdue_invoices', label: 'Overdue Invoices', description: 'Alert when an invoice becomes overdue', cap: Capability.viewInvoices },
    { key: 'bill_due_reminders', label: 'Bill Due Reminders', description: 'Remind me 3 days before a bill is due', cap: Capability.viewBills },
    { key: 'payroll_confirmation', label: 'Payroll Confirmation', description: 'Confirm when a payroll run completes', cap: Capability.viewPayroll },
    { key: 'low_stock_alerts', label: 'Low Stock Alerts', description: 'Alert when inventory drops to low stock', cap: Capability.viewInventory },
    { key: 'weekly_summary', label: 'Weekly Summary', description: 'Email a weekly summary of activity', cap: null },
  ]

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your account and preferences</p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          {organization && <TabsTrigger value="organization">Organization</TabsTrigger>}
          <TabsTrigger value="billing">Tax & Billing</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="export">Data & Export</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        {/* ── Profile ── */}
        <TabsContent value="profile" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5" /> Profile
              </CardTitle>
              <CardDescription>Your personal information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-4">
                <Avatar className="h-20 w-20">
                  <AvatarImage src={user?.avatar_url} />
                  <AvatarFallback className="text-lg">{initials}</AvatarFallback>
                </Avatar>
                <div className="space-y-1">
                  <Button variant="outline" size="sm" disabled>Change Photo</Button>
                  <p className="text-xs text-muted-foreground">JPG, PNG or GIF · max 2 MB</p>
                </div>
              </div>
              <Separator />
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={profile.name}
                    onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Your name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={user?.email || ''} disabled />
                  <p className="text-xs text-muted-foreground">Email cannot be changed here</p>
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input
                    value={profile.phone}
                    onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                    placeholder="+1 (555) 000-0000"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Timezone</Label>
                  <Input
                    value={profile.timezone}
                    onChange={(e) => setProfile((p) => ({ ...p, timezone: e.target.value }))}
                    placeholder="America/New_York"
                  />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <Button onClick={handleSaveProfile} disabled={savingProfile}>
                  {savingProfile ? 'Saving…' : 'Save Profile'}
                </Button>
                <p className="text-sm text-muted-foreground">
                  Account type: <span className="font-medium capitalize">{user?.account_type}</span>
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="w-5 h-5" /> Change Password
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>New Password</Label>
                  <Input
                    type="password"
                    value={pwd.newPassword}
                    onChange={(e) => setPwd((p) => ({ ...p, newPassword: e.target.value }))}
                    placeholder="Minimum 8 characters"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Confirm New Password</Label>
                  <Input
                    type="password"
                    value={pwd.confirm}
                    onChange={(e) => setPwd((p) => ({ ...p, confirm: e.target.value }))}
                    placeholder="Repeat new password"
                  />
                </div>
              </div>
              <Button
                variant="outline"
                onClick={handleChangePassword}
                disabled={savingPwd || !pwd.newPassword}
              >
                {savingPwd ? 'Updating…' : 'Update Password'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Organization ── */}
        {organization && (
          <TabsContent value="organization" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="w-5 h-5" /> Organization Details
                </CardTitle>
                <CardDescription>Business information shown on invoices and documents</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Organization Name *</Label>
                    <Input value={org.name} onChange={(e) => setOrg((o) => ({ ...o, name: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Business Email</Label>
                    <Input
                      type="email"
                      value={org.email}
                      onChange={(e) => setOrg((o) => ({ ...o, email: e.target.value }))}
                      placeholder="billing@company.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Phone</Label>
                    <Input value={org.phone} onChange={(e) => setOrg((o) => ({ ...o, phone: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Tax ID / EIN</Label>
                    <Input
                      value={org.tax_id}
                      onChange={(e) => setOrg((o) => ({ ...o, tax_id: e.target.value }))}
                      placeholder="XX-XXXXXXX"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Street Address</Label>
                    <Input
                      value={org.address}
                      onChange={(e) => setOrg((o) => ({ ...o, address: e.target.value }))}
                      placeholder="123 Main St"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>City</Label>
                    <Input value={org.city} onChange={(e) => setOrg((o) => ({ ...o, city: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>State</Label>
                    <Input value={org.state} onChange={(e) => setOrg((o) => ({ ...o, state: e.target.value }))} placeholder="CA" />
                  </div>
                  <div className="space-y-2">
                    <Label>ZIP / Postal Code</Label>
                    <Input value={org.zip_code} onChange={(e) => setOrg((o) => ({ ...o, zip_code: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Country</Label>
                    <Input value={org.country} onChange={(e) => setOrg((o) => ({ ...o, country: e.target.value }))} placeholder="US" />
                  </div>
                </div>
                <Button onClick={handleSaveOrg} disabled={savingOrg}>
                  {savingOrg ? 'Saving…' : 'Save Organization'}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ── Tax & Billing ── */}
        <TabsContent value="billing" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Tax & Billing Defaults</CardTitle>
              <CardDescription>Defaults applied when creating invoices, bills, and reports</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Default Tax Rate (%)</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={taxPrefs.default_tax_rate}
                    onChange={(e) => setTaxPrefs((t) => ({ ...t, default_tax_rate: e.target.value }))}
                    placeholder="e.g. 8.5"
                  />
                  <p className="text-xs text-muted-foreground">Pre-filled when creating new invoices</p>
                </div>
                <div className="space-y-2">
                  <Label>Default Currency</Label>
                  <Select
                    value={taxPrefs.default_currency}
                    onValueChange={(v) => setTaxPrefs((t) => ({ ...t, default_currency: v }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Fiscal Year Start</Label>
                  <Select
                    value={taxPrefs.fiscal_year_start}
                    onValueChange={(v) => setTaxPrefs((t) => ({ ...t, fiscal_year_start: v }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((m, i) => (
                        <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Default Payment Terms</Label>
                  <Select
                    value={taxPrefs.payment_terms}
                    onValueChange={(v) => setTaxPrefs((t) => ({ ...t, payment_terms: v }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Due on Receipt</SelectItem>
                      <SelectItem value="7">Net 7</SelectItem>
                      <SelectItem value="15">Net 15</SelectItem>
                      <SelectItem value="30">Net 30</SelectItem>
                      <SelectItem value="45">Net 45</SelectItem>
                      <SelectItem value="60">Net 60</SelectItem>
                      <SelectItem value="90">Net 90</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Date Format</Label>
                  <Select
                    value={taxPrefs.date_format}
                    onValueChange={(v) => setTaxPrefs((t) => ({ ...t, date_format: v }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MM/DD/YYYY">MM/DD/YYYY (US)</SelectItem>
                      <SelectItem value="DD/MM/YYYY">DD/MM/YYYY (International)</SelectItem>
                      <SelectItem value="YYYY-MM-DD">YYYY-MM-DD (ISO 8601)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={handleSaveTaxPrefs} disabled={savingTax}>
                {savingTax ? 'Saving…' : 'Save Preferences'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Integrations ── */}
        <TabsContent value="integrations" className="mt-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {INTEGRATIONS.map((integration) => (
              <Card key={integration.title}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span className="flex items-center gap-2">
                      <span>{integration.icon}</span>
                      {integration.title}
                    </span>
                    <Badge variant="secondary">Coming Soon</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{integration.description}</p>
                  <Button variant="outline" size="sm" className="mt-3" disabled>
                    Connect
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ── Data & Export ── */}
        <TabsContent value="export" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="w-5 h-5" /> Export Data
              </CardTitle>
              <CardDescription>
                Download your data as CSV files. Exports include all records visible to your account.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {exportItems.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.file}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={exporting === item.key}
                      onClick={() => handleExport(item.key, item.file)}
                    >
                      {exporting === item.key ? 'Exporting…' : 'CSV'}
                    </Button>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                💡 Your full dataset lives in Supabase. For a complete database backup, use{' '}
                <span className="font-medium">Supabase Dashboard → Project Settings → Backups</span>.
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Notifications ── */}
        <TabsContent value="notifications" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="w-5 h-5" /> Notification Preferences
              </CardTitle>
              <CardDescription>Choose what updates you want to be notified about</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {notifOptions
                .filter((n) => n.cap === null || hasCapability(n.cap))
                .map((n) => (
                  <div key={n.key} className="flex items-start gap-3">
                    <Checkbox
                      id={`notif-${n.key}`}
                      checked={notifPrefs[n.key]}
                      onCheckedChange={(checked) =>
                        setNotifPrefs((prev) => ({ ...prev, [n.key]: !!checked }))
                      }
                      className="mt-0.5"
                    />
                    <div>
                      <label
                        htmlFor={`notif-${n.key}`}
                        className="text-sm font-medium cursor-pointer"
                      >
                        {n.label}
                      </label>
                      <p className="text-xs text-muted-foreground">{n.description}</p>
                    </div>
                  </div>
                ))}
              <Separator />
              <Button onClick={handleSaveNotifPrefs} disabled={savingNotif}>
                {savingNotif ? 'Saving…' : 'Save Preferences'}
              </Button>
              <p className="text-xs text-muted-foreground">
                In-app toast notifications are always on. Email delivery coming with the Integrations update.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
