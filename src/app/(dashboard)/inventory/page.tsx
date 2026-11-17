'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  Package,
  AlertTriangle,
  XCircle,
  DollarSign,
  Save,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAppState } from '@/contexts/AppStateContext'
import { Capability, StockStatus, stockStatusLabels } from '@/types/enums'
import { DeferredModuleNotice } from '@/components/DeferredModuleNotice'
import { showAdvancedModules } from '@/lib/product-scope'
import type { InventoryItem } from '@/types/models'
import type { Vendor } from '@/types/models'
import {
  getInventoryItems,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  updateStockLevel,
  computeStockStatus,
} from '@/services/inventory.service'
import { getVendors } from '@/services/accounts-payable.service'

// ─── Helpers ─────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

function stockBadge(status: StockStatus) {
  const styles: Record<StockStatus, string> = {
    [StockStatus.inStock]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    [StockStatus.lowStock]: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    [StockStatus.outOfStock]: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  }
  return <Badge className={styles[status]}>{stockStatusLabels[status]}</Badge>
}

// ─── Item Dialog ──────────────────────────────────────────────

interface ItemDialogProps {
  open: boolean
  item: InventoryItem | null
  vendors: Vendor[]
  orgId: string
  userId: string
  onClose: () => void
  onSave: (item: InventoryItem) => void
}

const emptyForm = {
  sku: '',
  name: '',
  description: '',
  category: '',
  unit_price: '',
  cost_price: '',
  quantity_on_hand: '0',
  reorder_point: '0',
  reorder_quantity: '0',
  supplier_id: '',
  is_active: true,
}

function ItemDialog({ open, item, vendors, orgId, userId, onClose, onSave }: ItemDialogProps) {
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (item) {
      setForm({
        sku: item.sku,
        name: item.name,
        description: item.description || '',
        category: item.category || '',
        unit_price: item.unit_price.toString(),
        cost_price: item.cost_price.toString(),
        quantity_on_hand: item.quantity_on_hand.toString(),
        reorder_point: item.reorder_point.toString(),
        reorder_quantity: item.reorder_quantity.toString(),
        supplier_id: item.supplier_id || '',
        is_active: item.is_active,
      })
    } else {
      setForm(emptyForm)
    }
  }, [item, open])

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.sku || !form.name || !form.unit_price) {
      toast.error('SKU, name, and unit price are required')
      return
    }
    setSaving(true)
    try {
      const qty = parseInt(form.quantity_on_hand) || 0
      const rp = parseInt(form.reorder_point) || 0
      const input = {
        organization_id: orgId,
        user_id: userId,
        sku: form.sku.trim().toUpperCase(),
        name: form.name,
        description: form.description || undefined,
        category: form.category || undefined,
        unit_price: parseFloat(form.unit_price) || 0,
        cost_price: parseFloat(form.cost_price) || 0,
        quantity_on_hand: qty,
        reorder_point: rp,
        reorder_quantity: parseInt(form.reorder_quantity) || 0,
        supplier_id: form.supplier_id || undefined,
        stock_status: computeStockStatus(qty, rp),
        is_active: form.is_active,
      }
      let saved: InventoryItem
      if (item) {
        saved = await updateInventoryItem(item.id, input)
        toast.success('Item updated')
      } else {
        saved = await createInventoryItem(input)
        toast.success('Item added')
      }
      onSave(saved)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save item')
    } finally {
      setSaving(false)
    }
  }

  const margin =
    form.unit_price && form.cost_price
      ? ((parseFloat(form.unit_price) - parseFloat(form.cost_price)) / parseFloat(form.unit_price)) * 100
      : null

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? 'Edit Item' : 'Add Inventory Item'}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>SKU *</Label>
            <Input
              value={form.sku}
              onChange={(e) => set('sku', e.target.value)}
              placeholder="PROD-001"
            />
          </div>
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Product name" />
          </div>
          <div className="space-y-2 col-span-2">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Optional product description"
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <Input value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Electronics" />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Supplier</Label>
            <Select
              value={form.supplier_id || 'none'}
              onValueChange={(v) => set('supplier_id', v === 'none' ? '' : v)}
            >
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {vendors.filter((v) => v.status === 'active').map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Unit Price (sell) *</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.unit_price}
              onChange={(e) => set('unit_price', e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-2">
            <Label>Cost Price (buy)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.cost_price}
              onChange={(e) => set('cost_price', e.target.value)}
              placeholder="0.00"
            />
          </div>

          {margin !== null && !isNaN(margin) && (
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground">
                Gross margin: <span className={margin >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>{margin.toFixed(1)}%</span>
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label>Quantity on Hand</Label>
            <Input
              type="number"
              min="0"
              value={form.quantity_on_hand}
              onChange={(e) => set('quantity_on_hand', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Reorder Point</Label>
            <Input
              type="number"
              min="0"
              value={form.reorder_point}
              onChange={(e) => set('reorder_point', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Reorder Quantity</Label>
            <Input
              type="number"
              min="0"
              value={form.reorder_quantity}
              onChange={(e) => set('reorder_quantity', e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Status</Label>
            <Select value={form.is_active ? 'active' : 'inactive'} onValueChange={(v) => set('is_active', v === 'active')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : item ? 'Save Changes' : 'Add Item'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Page ───────────────────────────────────────────────

export default function InventoryPage() {
  if (!showAdvancedModules) {
    return <DeferredModuleNotice moduleKey="inventory" />
  }

  return <InventoryWorkspace />
}

function InventoryWorkspace() {
  const { currentUser, organization, hasCapability } = useAppState()
  const canManage = hasCapability(Capability.manageInventory)
  const canStockCount = hasCapability(Capability.performStockCounts)

  const [items, setItems] = useState<InventoryItem[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Dialogs
  const [itemDialog, setItemDialog] = useState(false)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [deleteItemId, setDeleteItemId] = useState<string | null>(null)

  // Stock count state: { [itemId]: newQty }
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [savingCounts, setSavingCounts] = useState(false)

  const orgId = organization?.id || currentUser?.id || ''
  const userId = currentUser?.id || ''

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [inv, ven] = await Promise.all([getInventoryItems(), getVendors()])
      setItems(inv)
      setVendors(ven)
      // Initialize stock count inputs
      const init: Record<string, string> = {}
      inv.forEach((item) => { init[item.id] = item.quantity_on_hand.toString() })
      setCounts(init)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load inventory')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Filtered items
  const filtered = useMemo(() => {
    return items.filter((item) => {
      const q = search.toLowerCase()
      const matchSearch =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        (item.category?.toLowerCase().includes(q) ?? false)
      const matchStatus = statusFilter === 'all' || item.stock_status === statusFilter
      return matchSearch && matchStatus
    })
  }, [items, search, statusFilter])

  // Summary stats
  const activeItems = items.filter((i) => i.is_active)
  const inStock = activeItems.filter((i) => i.stock_status === StockStatus.inStock).length
  const lowStock = activeItems.filter((i) => i.stock_status === StockStatus.lowStock).length
  const outOfStock = activeItems.filter((i) => i.stock_status === StockStatus.outOfStock).length
  const totalValue = activeItems.reduce((s, i) => s + i.cost_price * i.quantity_on_hand, 0)

  // Item handlers
  const handleItemSaved = (saved: InventoryItem) => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === saved.id)
      return idx >= 0 ? prev.map((i) => (i.id === saved.id ? saved : i)) : [...prev, saved]
    })
    setCounts((prev) => ({ ...prev, [saved.id]: saved.quantity_on_hand.toString() }))
    setItemDialog(false)
    setEditingItem(null)
  }

  const handleDelete = async () => {
    if (!deleteItemId) return
    try {
      await deleteInventoryItem(deleteItemId)
      setItems((prev) => prev.filter((i) => i.id !== deleteItemId))
      toast.success('Item deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete item')
    } finally {
      setDeleteItemId(null)
    }
  }

  // Stock count handler
  const handleSaveCounts = async () => {
    setSavingCounts(true)
    let updated = 0
    try {
      for (const item of activeItems) {
        const newQty = parseInt(counts[item.id] ?? item.quantity_on_hand.toString())
        if (isNaN(newQty) || newQty === item.quantity_on_hand) continue
        const savedItem = await updateStockLevel(item.id, newQty, item.reorder_point)
        setItems((prev) => prev.map((i) => (i.id === item.id ? savedItem : i)))
        updated++
      }
      toast.success(updated > 0 ? `${updated} item${updated !== 1 ? 's' : ''} updated` : 'No changes to save')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save stock counts')
    } finally {
      setSavingCounts(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-center text-muted-foreground">Loading inventory…</div>
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Inventory</h1>
        <p className="text-muted-foreground text-sm">Track products, stock levels, and suppliers</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Package className="h-4 w-4" /> Total SKUs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{activeItems.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-green-600 flex items-center gap-2">
              <Package className="h-4 w-4" /> In Stock
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600">{inStock}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-yellow-600 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Low Stock
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-yellow-600">{lowStock}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-red-600 flex items-center gap-2">
              <XCircle className="h-4 w-4" /> Out of Stock
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-600">{outOfStock}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" /> Inventory Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{fmt(totalValue)}</p>
            <p className="text-xs text-muted-foreground">at cost</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">Products</TabsTrigger>
          {canStockCount && <TabsTrigger value="stock-count">Stock Count</TabsTrigger>}
        </TabsList>

        {/* ── Products Tab ── */}
        <TabsContent value="products" className="mt-4">
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, SKU, or category…"
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value={StockStatus.inStock}>In Stock</SelectItem>
                <SelectItem value={StockStatus.lowStock}>Low Stock</SelectItem>
                <SelectItem value={StockStatus.outOfStock}>Out of Stock</SelectItem>
              </SelectContent>
            </Select>
            {canManage && (
              <Button size="sm" onClick={() => { setEditingItem(null); setItemDialog(true) }}>
                <Plus className="h-4 w-4 mr-1" /> Add Item
              </Button>
            )}
          </div>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Reorder At</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((item) => (
                  <TableRow key={item.id} className={!item.is_active ? 'opacity-50' : undefined}>
                    <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                    <TableCell>
                      <p className="font-medium">{item.name}</p>
                      {item.description && (
                        <p className="text-xs text-muted-foreground truncate max-w-[180px]">
                          {item.description}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>{item.category || '—'}</TableCell>
                    <TableCell>{(item.supplier as Vendor | undefined)?.name || '—'}</TableCell>
                    <TableCell className="text-right">{fmt(item.unit_price)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmt(item.cost_price)}</TableCell>
                    <TableCell className="text-right font-medium">{item.quantity_on_hand}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{item.reorder_point}</TableCell>
                    <TableCell>{stockBadge(item.stock_status)}</TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => { setEditingItem(item); setItemDialog(true) }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive"
                            onClick={() => setDeleteItemId(item.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canManage ? 10 : 9} className="text-center text-muted-foreground py-12">
                      {items.length === 0
                        ? 'No inventory items yet. Add your first product to get started.'
                        : 'No items match the current filters.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {filtered.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              Showing {filtered.length} of {items.length} item{items.length !== 1 ? 's' : ''}
            </p>
          )}
        </TabsContent>

        {/* ── Stock Count Tab ── */}
        {canStockCount && (
          <TabsContent value="stock-count" className="mt-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-medium">Physical Stock Count</p>
                <p className="text-xs text-muted-foreground">
                  Enter physical counts below. Only changed quantities will be saved.
                </p>
              </div>
              <Button size="sm" onClick={handleSaveCounts} disabled={savingCounts}>
                <Save className="h-4 w-4 mr-1" />
                {savingCounts ? 'Saving…' : 'Save Counts'}
              </Button>
            </div>

            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">System Qty</TableHead>
                    <TableHead className="text-right w-36">Physical Count</TableHead>
                    <TableHead className="text-right">Difference</TableHead>
                    <TableHead>New Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeItems.map((item) => {
                    const physicalQty = parseInt(counts[item.id] ?? item.quantity_on_hand.toString())
                    const diff = isNaN(physicalQty) ? 0 : physicalQty - item.quantity_on_hand
                    const newStatus = isNaN(physicalQty)
                      ? item.stock_status
                      : computeStockStatus(physicalQty, item.reorder_point)
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell className="text-right">{item.quantity_on_hand}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min="0"
                            className="w-24 text-right ml-auto"
                            value={counts[item.id] ?? item.quantity_on_hand.toString()}
                            onChange={(e) =>
                              setCounts((prev) => ({ ...prev, [item.id]: e.target.value }))
                            }
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          {!isNaN(physicalQty) && diff !== 0 ? (
                            <span className={diff > 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                              {diff > 0 ? '+' : ''}{diff}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>{stockBadge(newStatus)}</TableCell>
                      </TableRow>
                    )
                  })}
                  {activeItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-12">
                        No active items to count
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        )}
      </Tabs>

      {/* Dialogs */}
      <ItemDialog
        open={itemDialog}
        item={editingItem}
        vendors={vendors}
        orgId={orgId}
        userId={userId}
        onClose={() => { setItemDialog(false); setEditingItem(null) }}
        onSave={handleItemSaved}
      />

      <AlertDialog open={!!deleteItemId} onOpenChange={() => setDeleteItemId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Item?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the inventory item. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
