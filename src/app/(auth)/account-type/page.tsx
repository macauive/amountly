'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { AccountType } from '@/types/enums'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Briefcase, Loader2, Check } from 'lucide-react'

const setupError = 'Could not finish setting up your account. Please try again.'

export default function AccountTypeSelectionPage() {
  const router = useRouter()
  const { setAccountType, isAuthenticated, isLoading, recoveryPath, session, user } = useAuth()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitted = useRef(false)
  const existingAccountType = user?.account_type
  const needsBusinessRecovery = existingAccountType === AccountType.business && !user?.organization_id
  const canSetUp = !isLoading && Boolean(session) && !isAuthenticated && !existingAccountType
    && recoveryPath === '/account-type'

  useEffect(() => {
    if (isLoading) return
    if (!session) {
      router.replace('/login')
    } else if (needsBusinessRecovery || recoveryPath === '/onboarding') {
      router.replace('/onboarding')
    } else if (isAuthenticated || existingAccountType) {
      router.replace('/dashboard')
    }
  }, [existingAccountType, isAuthenticated, isLoading, needsBusinessRecovery, recoveryPath, router, session])

  const handleContinue = async () => {
    if (!canSetUp || submitted.current) return
    submitted.current = true
    setIsSubmitting(true)
    setError(null)

    try {
      const result = await setAccountType(AccountType.freelancer)
      if (!result.error) {
        router.replace('/dashboard')
        return
      }
    } catch {
      // Provider and database details must not reach the setup screen.
    }

    setError(setupError)
    submitted.current = false
    setIsSubmitting(false)
  }

  if (!canSetUp) {
    return (
      <div className="w-full max-w-xl text-center" role="status">
        {isLoading || !session || isAuthenticated || existingAccountType || recoveryPath === '/onboarding' ? (
          <Loader2 className="mx-auto h-6 w-6 animate-spin" aria-label="Loading account setup" />
        ) : (
          <p className="text-muted-foreground">Could not load your account setup. Refresh this page and try again.</p>
        )}
      </div>
    )
  }

  return (
    <div className="w-full max-w-xl">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold">Set up your solo business</h1>
        <p className="text-muted-foreground mt-2">
          Keep client invoices and expenses together in Amountly.
        </p>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <div className="w-fit p-2 rounded-lg bg-primary text-primary-foreground">
            <Briefcase className="h-6 w-6" aria-hidden="true" />
          </div>
          <CardTitle className="text-lg">For freelancers and solo service businesses</CardTitle>
          <CardDescription>Start with the essentials for managing your own business.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {[
              'Capture receipts and review suggested expenses',
              'Create invoices for client work',
              'Track billable work and see your business finances',
            ].map((feature) => (
              <li key={feature} className="flex items-center text-sm">
                <Check className="h-4 w-4 mr-2 shrink-0 text-green-500" aria-hidden="true" />
                {feature}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {error && (
        <p role="alert" className="p-3 text-sm text-destructive bg-destructive/10 rounded-md mb-6 text-center">
          {error}
        </p>
      )}

      <div className="flex justify-center">
        <Button size="lg" onClick={handleContinue} disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {isSubmitting ? 'Setting up…' : 'Set up my solo business'}
        </Button>
      </div>
    </div>
  )
}
