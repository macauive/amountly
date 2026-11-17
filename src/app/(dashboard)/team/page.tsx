'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { getTeamMembers, updateMemberRole, removeMember } from '@/services/team.service'
import type { User } from '@/types/models'
import { Role, roleLabels, AccountType } from '@/types/enums'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Plus, UserCog, Loader2, Mail, MoreHorizontal, Shield, UserMinus, Crown } from 'lucide-react'
import { toast } from 'sonner'
import { DeferredModuleNotice } from '@/components/DeferredModuleNotice'
import { showAdvancedModules } from '@/lib/product-scope'

function getRoleBadgeVariant(role: Role): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (role) {
    case Role.owner:
      return 'default'
    case Role.admin:
      return 'secondary'
    case Role.member:
      return 'outline'
    case Role.contractor:
      return 'outline'
    default:
      return 'outline'
  }
}

function getInitials(name: string | null | undefined, email: string | null | undefined): string {
  if (name) {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }
  if (email) {
    return email[0].toUpperCase()
  }
  return '?'
}

export default function TeamPage() {
  if (!showAdvancedModules) {
    return <DeferredModuleNotice moduleKey="team" />
  }

  return <TeamWorkspace />
}

function TeamWorkspace() {
  const { user } = useAuth()
  const [members, setMembers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false)
  const [roleDialogOpen, setRoleDialogOpen] = useState(false)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const [selectedMember, setSelectedMember] = useState<User | null>(null)
  const [saving, setSaving] = useState(false)

  const [inviteData, setInviteData] = useState({
    email: '',
    role: Role.member,
  })

  const [selectedRole, setSelectedRole] = useState<Role>(Role.member)

  const isOwner = user?.role === Role.owner
  const isAdmin = user?.role === Role.admin || isOwner

  useEffect(() => {
    loadMembers()
  }, [user?.organization_id])

  const loadMembers = async () => {
    if (!user?.organization_id) {
      setLoading(false)
      return
    }

    try {
      const data = await getTeamMembers(user.organization_id)
      setMembers(data)
    } catch (error) {
      toast.error('Failed to load team members')
    } finally {
      setLoading(false)
    }
  }

  const openInviteDialog = () => {
    setInviteData({
      email: '',
      role: Role.member,
    })
    setInviteDialogOpen(true)
  }

  const openRoleDialog = (member: User) => {
    setSelectedMember(member)
    setSelectedRole(member.role)
    setRoleDialogOpen(true)
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      // Note: In production, this would send an email invitation
      // For now, we'll show a success message explaining the limitation
      toast.info('Invitation feature requires email service setup. Share an invite link instead.')
      setInviteDialogOpen(false)
    } catch (error) {
      toast.error('Failed to send invitation')
    } finally {
      setSaving(false)
    }
  }

  const handleRoleUpdate = async () => {
    if (!selectedMember) return

    setSaving(true)
    try {
      await updateMemberRole(selectedMember.id, selectedRole)
      toast.success('Role updated')
      setRoleDialogOpen(false)
      setSelectedMember(null)
      loadMembers()
    } catch (error) {
      toast.error('Failed to update role')
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async () => {
    if (!selectedMember) return

    try {
      await removeMember(selectedMember.id)
      toast.success('Team member removed')
      setRemoveDialogOpen(false)
      setSelectedMember(null)
      loadMembers()
    } catch (error) {
      toast.error('Failed to remove team member')
    }
  }

  // Check if this is a business account
  if (user?.account_type !== AccountType.business) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">Team</h1>
            <p className="text-muted-foreground">Manage your team members and roles</p>
          </div>
        </div>

        <Card>
          <CardContent className="text-center py-12">
            <UserCog className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground">Team management is only available for Business accounts</p>
            <p className="text-sm text-muted-foreground mt-2">
              Upgrade to a Business account to invite team members and collaborate
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Team</h1>
          <p className="text-muted-foreground">Manage your team members and roles</p>
        </div>
        {isAdmin && (
          <Button onClick={openInviteDialog} className="gap-2">
            <Plus className="w-4 h-4" />
            Invite Member
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Members</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{members.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Admins</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {members.filter(m => m.role === Role.admin || m.role === Role.owner).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Members</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {members.filter(m => m.role === Role.member).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Contractors</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {members.filter(m => m.role === Role.contractor).length}
            </div>
          </CardContent>
        </Card>
      </div>

      {members.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <UserCog className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground">No team members yet</p>
            <p className="text-sm text-muted-foreground">Invite team members to collaborate</p>
            {isAdmin && (
              <Button onClick={openInviteDialog} className="mt-4 gap-2">
                <Plus className="w-4 h-4" />
                Invite Member
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCog className="w-5 h-5" />
              Team Members ({members.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={member.avatar_url || undefined} />
                          <AvatarFallback>
                            {getInitials(member.name, member.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">
                            {member.name || 'Unnamed'}
                            {member.id === user?.id && (
                              <span className="text-muted-foreground ml-2">(You)</span>
                            )}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Mail className="w-3 h-3" />
                        {member.email}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getRoleBadgeVariant(member.role)} className="gap-1">
                        {member.role === Role.owner && <Crown className="w-3 h-3" />}
                        {member.role === Role.admin && <Shield className="w-3 h-3" />}
                        {roleLabels[member.role]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">Active</Badge>
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        {member.role !== Role.owner && member.id !== user?.id && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openRoleDialog(member)}>
                                <Shield className="w-4 h-4 mr-2" />
                                Change Role
                              </DropdownMenuItem>
                              {isOwner && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedMember(member)
                                    setRemoveDialogOpen(true)
                                  }}
                                  className="text-destructive"
                                >
                                  <UserMinus className="w-4 h-4 mr-2" />
                                  Remove from Team
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Invite Dialog */}
      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
            <DialogDescription>
              Send an invitation to join your team
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleInvite}>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address *</Label>
                <Input
                  id="email"
                  type="email"
                  value={inviteData.email}
                  onChange={(e) => setInviteData({ ...inviteData, email: e.target.value })}
                  placeholder="colleague@example.com"
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="role">Role</Label>
                <Select
                  value={inviteData.role}
                  onValueChange={(value) => setInviteData({ ...inviteData, role: value as Role })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {isOwner && (
                      <SelectItem value={Role.admin}>
                        Admin - Full access except ownership
                      </SelectItem>
                    )}
                    <SelectItem value={Role.member}>
                      Member - Standard team access
                    </SelectItem>
                    <SelectItem value={Role.contractor}>
                      Contractor - Limited access for external collaborators
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInviteDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send Invitation
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Change Role Dialog */}
      <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Role</DialogTitle>
            <DialogDescription>
              Update the role for {selectedMember?.name || selectedMember?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="flex flex-col gap-2">
              <Label>Select Role</Label>
              <Select
                value={selectedRole}
                onValueChange={(value) => setSelectedRole(value as Role)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {isOwner && (
                    <SelectItem value={Role.admin}>
                      Admin - Full access except ownership
                    </SelectItem>
                  )}
                  <SelectItem value={Role.member}>
                    Member - Standard team access
                  </SelectItem>
                  <SelectItem value={Role.contractor}>
                    Contractor - Limited access for external collaborators
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRoleUpdate} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Confirmation */}
      <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Team Member</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {selectedMember?.name || selectedMember?.email} from the team?
              They will lose access to all team resources.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemove} className="bg-destructive text-destructive-foreground">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
