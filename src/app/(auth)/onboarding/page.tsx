'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod/v3'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Building2, Loader2 } from 'lucide-react'

const organizationSchema = z.object({
  name: z.string().min(2, 'Organization name must be at least 2 characters'),
})

type OrganizationFormData = z.infer<typeof organizationSchema>

export default function OnboardingPage() {
  const router = useRouter()
  const { createOrganization, isAuthenticated, isLoading, recoveryPath, session } = useAuth()

  useEffect(() => {
    if (isLoading) return

    if (!session) {
      router.replace('/login')
      return
    }

    if (isAuthenticated) {
      router.replace('/dashboard')
      return
    }

    if (recoveryPath && recoveryPath !== '/onboarding') {
      router.replace(recoveryPath)
    }
  }, [isAuthenticated, isLoading, recoveryPath, router, session])
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<OrganizationFormData>({
    resolver: zodResolver(organizationSchema),
  })

  const onSubmit = async (data: OrganizationFormData) => {
    setError(null)
    const result = await createOrganization(data.name)
    if (result.error) {
      setError(result.error)
    } else {
      router.push('/')
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-1 text-center">
        <div className="flex justify-center mb-4">
          <div className="p-3 rounded-lg bg-primary/10">
            <Building2 className="h-8 w-8 text-primary" />
          </div>
        </div>
        <CardTitle className="text-2xl font-bold">Set up your organization</CardTitle>
        <CardDescription>
          Create your organization to get started with team collaboration
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-4">
          {error && (
            <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="name">Organization Name</Label>
            <Input
              id="name"
              type="text"
              placeholder="Acme Inc."
              {...register('name')}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Organization
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
