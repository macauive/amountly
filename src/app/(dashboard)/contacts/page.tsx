'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getWorkspaceContacts, type WorkspaceContact } from '@/services/contacts.service'
import { useAuth } from '@/contexts/AuthContext'
import { useAppState } from '@/contexts/AppStateContext'
import { Capability } from '@/types/enums'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export default function ContactsPage() {
  const { user } = useAuth()
  const { hasCapability } = useAppState()
  const [rows, setRows] = useState<WorkspaceContact[]>([])
  const [query, setQuery] = useState('')
  const [state, setState] = useState('Loading contacts…')
  const [archived, setArchived] = useState(false)

  useEffect(() => {
    let active = true
    getWorkspaceContacts().then(data => {
      if (active) { setRows(data); setState('') }
    }).catch(() => {
      if (active) setState('Could not load contacts. Refresh to try again.')
    })
    return () => { active = false }
  }, [user?.id, user?.organization_id])

  const visible = rows.filter(row => (archived || !row.archived_at) &&
    `${row.name} ${row.email ?? ''} ${row.kind}`.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">Contacts</h1>
        <p className="text-muted-foreground">Customers and vendors in one directory. Their roles and historical records stay distinct.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        {hasCapability(Capability.viewClients) && <Button asChild><Link href="/clients">Manage clients</Link></Button>}
        {hasCapability(Capability.manageVendors) && <Button variant="outline" asChild><Link href="/bills?tab=vendors">Manage vendors</Link></Button>}
      </div>
      <Input aria-label="Search contacts" placeholder="Search name, email, or role" value={query} onChange={event => setQuery(event.target.value)} />
      <label className="flex gap-2 text-sm">
        <input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />Include archived contacts
      </label>
      {state ? <p role="status">{state}</p> : (
        <Card><CardContent className="pt-6">
          <ul className="divide-y">
            {visible.map(row => (
              <li className="flex flex-wrap justify-between gap-3 py-3" key={row.contact_key}>
                <div className="min-w-0 break-words">
                  <p className="font-medium">{row.name}</p>
                  <p className="text-sm text-muted-foreground">{row.email || row.phone || 'No contact details'}</p>
                </div>
                <span className="text-sm">{row.kind === 'client' ? 'Client' : 'Vendor'}{row.archived_at ? ' · Archived' : ''}</span>
              </li>
            ))}
          </ul>
          {!visible.length && <p>No matching contacts.</p>}
        </CardContent></Card>
      )}
    </div>
  )
}
