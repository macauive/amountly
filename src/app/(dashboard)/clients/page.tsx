'use client'

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { getClients, createClient, updateClient, archiveClient } from '@/services/clients.service'
import type { Client } from '@/types/models'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Plus, Users, Pencil, Trash2, Loader2, Mail, Phone, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { AccountType } from '@/types/enums'
import { captureContactFromText } from '@/lib/contact-ai'

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return fallback
}

export default function ClientsPage() {
  const { user } = useAuth()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [saving, setSaving] = useState(false)
  const [smartContactText, setSmartContactText] = useState('')
  const [smartContactSummary, setSmartContactSummary] = useState<string | null>(null)
  const smartContactTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    contact_name: '',
    address: '',
    city: '',
    state: '',
    zip_code: '',
    notes: '',
  })

  useEffect(() => {
    if (user) loadClients()
  }, [user?.id, user?.organization_id])

  const loadClients = async () => {
    try {
      setError(null)
      const data = await getClients({
        userId: user?.id,
        organizationId: user?.organization_id,
      })
      setClients(data)
    } catch (err) {
      console.error('Failed to load clients:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to load clients'
      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const openCreateDialog = () => {
    setSelectedClient(null)
    setFormData({
      name: '',
      email: '',
      phone: '',
      contact_name: '',
      address: '',
      city: '',
      state: '',
      zip_code: '',
      notes: '',
    })
    setSmartContactText('')
    setSmartContactSummary(null)
    setDialogOpen(true)
  }

  const openEditDialog = (client: Client) => {
    setSelectedClient(client)
    setFormData({
      name: client.name,
      email: client.email || '',
      phone: client.phone || '',
      contact_name: client.contact_name || '',
      address: client.address || '',
      city: client.city || '',
      state: client.state || '',
      zip_code: client.zip_code || '',
      notes: client.notes || '',
    })
    setSmartContactText('')
    setSmartContactSummary(null)
    setDialogOpen(true)
  }

  const handleSmartContactCapture = async () => {
    try {
      setSmartContactSummary('Asking Amountly AI...')
      const result = await captureContactFromText(smartContactTextareaRef.current?.value ?? smartContactText)
      setFormData({
        ...formData,
        name: result.name ?? formData.name,
        contact_name: result.contact_name ?? formData.contact_name,
        email: result.email ?? formData.email,
        phone: result.phone ?? formData.phone,
        address: result.address ?? formData.address,
        city: result.city ?? formData.city,
        state: result.state ?? formData.state,
        zip_code: result.zip_code ?? formData.zip_code,
        notes: formData.notes || result.notes || '',
      })
      setSmartContactSummary(result.reason)
    } catch (error) {
      const message = getErrorMessage(error, 'AI contact capture failed')
      setSmartContactSummary(message)
      toast.error(message)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      if (selectedClient) {
        await updateClient(selectedClient.id, formData)
        toast.success('Client updated')
      } else {
        await createClient({
          ...formData,
          user_id: user?.account_type === AccountType.business ? undefined : user?.id,
          organization_id: user?.organization_id,
          is_active: true,
        } as any)
        toast.success('Client created')
      }
      setDialogOpen(false)
      loadClients()
    } catch (error) {
      console.error('Failed to save client:', error)
      toast.error(getErrorMessage(error, 'Failed to save client'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedClient) return

    try {
      await archiveClient(selectedClient.id)
      toast.success('Client archived')
      setDeleteDialogOpen(false)
      setSelectedClient(null)
      loadClients()
    } catch (error) {
      toast.error('Failed to archive client')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="text-center py-12">
            <Users className="w-12 h-12 mx-auto mb-4 text-destructive opacity-50" />
            <p className="text-destructive font-medium">Error loading data</p>
            <p className="text-sm text-muted-foreground mt-2">{error}</p>
            <Button onClick={loadClients} className="mt-4">
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Clients</h1>
          <p className="text-muted-foreground">Manage your clients and contacts</p>
        </div>
        <Button onClick={openCreateDialog} className="gap-2">
          <Plus className="w-4 h-4" />
          Add Client
        </Button>
      </div>

      {clients.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <Users className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground">No clients yet</p>
            <p className="text-sm text-muted-foreground">Add your first client to get started</p>
            <Button onClick={openCreateDialog} className="mt-4 gap-2">
              <Plus className="w-4 h-4" />
              Add Client
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              All Clients ({clients.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((client) => (
                  <TableRow key={client.id}>
                    <TableCell className="font-medium">{client.name}</TableCell>
                    <TableCell>{client.contact_name || '-'}</TableCell>
                    <TableCell>
                      {client.email ? (
                        <span className="flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          {client.email}
                        </span>
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      {client.phone ? (
                        <span className="flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          {client.phone}
                        </span>
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={client.is_active ? 'default' : 'secondary'}>
                        {client.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(client)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setSelectedClient(client)
                          setDeleteDialogOpen(true)
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedClient ? 'Edit Client' : 'Add Client'}
            </DialogTitle>
            <DialogDescription>
              {selectedClient ? 'Update client information' : 'Add a new client to your list'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
              {!selectedClient && (
                <div className="rounded-lg border bg-primary/5 p-3">
                  <div className="mb-3 flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Wand2 className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Smart contact capture</p>
                      <p className="text-sm text-muted-foreground">
                        Paste a client signature or contact block and Amountly will fill what it can.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <Textarea
                      ref={smartContactTextareaRef}
                      value={smartContactText}
                      onChange={(e) => {
                        setSmartContactText(e.target.value)
                        setSmartContactSummary(null)
                      }}
                      placeholder={'Example:\nAcme Studio\nContact: Jane Lee\njane@acme.test\n(555) 123-4567\n123 Market St, Austin, TX 78701'}
                      rows={4}
                    />
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-muted-foreground">
                        {smartContactSummary || 'Amountly looks for company, contact, email, phone, and address.'}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleSmartContactCapture}
                        disabled={!smartContactText.trim()}
                        className="shrink-0 gap-2"
                      >
                        <Wand2 className="h-4 w-4" />
                        Fill client
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Company/Client Name *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contact_name">Contact Person</Label>
                  <Input
                    id="contact_name"
                    value={formData.contact_name}
                    onChange={(e) => setFormData({ ...formData, contact_name: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">State</Label>
                  <Input
                    id="state"
                    value={formData.state}
                    onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="zip_code">ZIP Code</Label>
                  <Input
                    id="zip_code"
                    value={formData.zip_code}
                    onChange={(e) => setFormData({ ...formData, zip_code: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {selectedClient ? 'Save Changes' : 'Add Client'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Client</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to archive &quot;{selectedClient?.name}&quot;? Existing invoices and history will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
