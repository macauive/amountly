'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { getProjects, createProject, updateProject, archiveProject } from '@/services/projects.service'
import { getClients } from '@/services/clients.service'
import type { Project, Client } from '@/types/models'
import { BillingModel, billingModelLabels } from '@/types/enums'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
import { Badge } from '@/components/ui/badge'
import { Plus, FolderKanban, Pencil, Trash2, Loader2, DollarSign } from 'lucide-react'
import { toast } from 'sonner'

const PROJECT_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
]

export default function ProjectsPage() {
  const { user } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [saving, setSaving] = useState(false)

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    client_id: '',
    billing_model: BillingModel.hourly,
    rate: '',
    budget: '',
    color: PROJECT_COLORS[0],
  })

  useEffect(() => {
    if (user) loadData()
  }, [user?.id, user?.organization_id])

  const loadData = async () => {
    try {
      setError(null)
      const [projectsData, clientsData] = await Promise.all([
        getProjects({
          userId: user?.id,
          organizationId: user?.organization_id,
        }),
        getClients({
          userId: user?.id,
          organizationId: user?.organization_id,
        }),
      ])
      setProjects(projectsData)
      setClients(clientsData)
    } catch (err) {
      console.error('Failed to load projects:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to load data'
      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const openCreateDialog = () => {
    setSelectedProject(null)
    setFormData({
      name: '',
      description: '',
      client_id: '',
      billing_model: BillingModel.hourly,
      rate: '',
      budget: '',
      color: PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)],
    })
    setDialogOpen(true)
  }

  const openEditDialog = (project: Project) => {
    setSelectedProject(project)
    setFormData({
      name: project.name,
      description: project.description || '',
      client_id: project.client_id || '',
      billing_model: project.billing_model,
      rate: project.rate?.toString() || '',
      budget: project.budget?.toString() || '',
      color: project.color || PROJECT_COLORS[0],
    })
    setDialogOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      const projectData = {
        name: formData.name,
        description: formData.description || undefined,
        client_id: formData.client_id || undefined,
        billing_model: formData.billing_model,
        rate: formData.rate ? parseFloat(formData.rate) : undefined,
        budget: formData.budget ? parseFloat(formData.budget) : undefined,
        color: formData.color,
        user_id: user?.id,
        organization_id: user?.organization_id,
        is_active: true,
      }

      if (selectedProject) {
        await updateProject(selectedProject.id, projectData)
        toast.success('Project updated')
      } else {
        await createProject(projectData as any)
        toast.success('Project created')
      }
      setDialogOpen(false)
      loadData()
    } catch (error) {
      toast.error('Failed to save project')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedProject) return

    try {
      await archiveProject(selectedProject.id)
      toast.success('Project archived')
      setDeleteDialogOpen(false)
      setSelectedProject(null)
      loadData()
    } catch (error) {
      toast.error('Failed to archive project')
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
            <FolderKanban className="w-12 h-12 mx-auto mb-4 text-destructive opacity-50" />
            <p className="text-destructive font-medium">Error loading data</p>
            <p className="text-sm text-muted-foreground mt-2">{error}</p>
            <Button onClick={loadData} className="mt-4">
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
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-muted-foreground">Manage your projects and tasks</p>
        </div>
        <Button onClick={openCreateDialog} className="gap-2">
          <Plus className="w-4 h-4" />
          New Project
        </Button>
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <FolderKanban className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground">No projects yet</p>
            <p className="text-sm text-muted-foreground">Create your first project to organize your work</p>
            <Button onClick={openCreateDialog} className="mt-4 gap-2">
              <Plus className="w-4 h-4" />
              New Project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <Card key={project.id} className="relative overflow-hidden">
              <div
                className="absolute top-0 left-0 w-full h-1"
                style={{ backgroundColor: project.color || PROJECT_COLORS[0] }}
              />
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg">{project.name}</CardTitle>
                    {project.client && (
                      <CardDescription>{project.client.name}</CardDescription>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEditDialog(project)}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => {
                        setSelectedProject(project)
                        setDeleteDialogOpen(true)
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {project.description && (
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                    {project.description}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">
                    {billingModelLabels[project.billing_model]}
                  </Badge>
                  {project.rate && (
                    <Badge variant="secondary" className="gap-1">
                      <DollarSign className="w-3 h-3" />
                      {project.rate}/hr
                    </Badge>
                  )}
                  <Badge variant={project.is_active ? 'default' : 'secondary'}>
                    {project.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                {project.budget && (
                  <p className="text-sm text-muted-foreground mt-3">
                    Budget: ${project.budget.toLocaleString()}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedProject ? 'Edit Project' : 'New Project'}
            </DialogTitle>
            <DialogDescription>
              {selectedProject ? 'Update project details' : 'Create a new project'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Project Name *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="client">Client</Label>
                  <Select
                    value={formData.client_id}
                    onValueChange={(value) => setFormData({ ...formData, client_id: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a client" />
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="billing_model">Billing Model</Label>
                  <Select
                    value={formData.billing_model}
                    onValueChange={(value) => setFormData({ ...formData, billing_model: value as BillingModel })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(billingModelLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rate">Hourly Rate ($)</Label>
                  <Input
                    id="rate"
                    type="number"
                    step="0.01"
                    value={formData.rate}
                    onChange={(e) => setFormData({ ...formData, rate: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="budget">Budget ($)</Label>
                  <Input
                    id="budget"
                    type="number"
                    step="0.01"
                    value={formData.budget}
                    onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Color</Label>
                <div className="flex gap-2">
                  {PROJECT_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`w-8 h-8 rounded-full border-2 ${
                        formData.color === color ? 'border-foreground' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: color }}
                      onClick={() => setFormData({ ...formData, color })}
                    />
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {selectedProject ? 'Save Changes' : 'Create Project'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Project</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to archive &quot;{selectedProject?.name}&quot;? Existing tasks, time entries, and invoices will be preserved.
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
