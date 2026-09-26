'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, MailCheck, RotateCw } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { Label } from '@/components/ui/label'

const OTP_LENGTH = 8
const VERIFICATION_TYPES = ['signup', 'email', 'magiclink', 'recovery', 'invite', 'email_change'] as const

type VerificationType = (typeof VERIFICATION_TYPES)[number]

function getVerificationType(type: string | null): VerificationType {
  return VERIFICATION_TYPES.find((verificationType) => verificationType === type) ?? 'signup'
}

function VerifyPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { verifyEmailOtp, resendVerification, isLoading } = useAuth()
  const [code, setCode] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isResending, setIsResending] = useState(false)
  const [isAutoVerifying, setIsAutoVerifying] = useState(false)

  const tokenHash = searchParams?.get('token_hash')
  const verificationType = useMemo(() => getVerificationType(searchParams?.get('type') ?? null), [searchParams])

  useEffect(() => {
    const emailFromQuery = searchParams?.get('email')
    const storedEmail = typeof window !== 'undefined'
      ? window.sessionStorage.getItem('pendingVerificationEmail')
      : null

    setEmail(emailFromQuery ?? storedEmail ?? '')
  }, [searchParams])

  useEffect(() => {
    if (!tokenHash || isAutoVerifying) return

    const run = async () => {
      setIsAutoVerifying(true)
      setError(null)
      const result = await verifyEmailOtp({ tokenHash, type: verificationType })

      if (result.error) {
        setError(result.error)
        setIsAutoVerifying(false)
        return
      }

      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem('pendingVerificationEmail')
      }

      router.replace(result.nextPath)
    }

    void run()
  }, [isAutoVerifying, router, tokenHash, verificationType, verifyEmailOtp])

  const handleVerify = async () => {
    if (!email) {
      setError('Add the email address you signed up with to verify your code.')
      return
    }

    if (code.length !== OTP_LENGTH) {
      setError(`Enter the ${OTP_LENGTH}-digit verification code.`)
      return
    }

    setError(null)
    setNotice(null)
    const result = await verifyEmailOtp({ email, token: code, type: 'signup' })

    if (result.error) {
      setError(result.error)
      return
    }

    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem('pendingVerificationEmail')
    }

    router.replace(result.nextPath)
  }

  const handleResend = async () => {
    if (!email) {
      setError('Enter your email first so we know where to resend the code.')
      return
    }

    setIsResending(true)
    setError(null)
    setNotice(null)
    const result = await resendVerification(email)
    setIsResending(false)

    if (result.error) {
      setError(result.error)
      return
    }

    setNotice('We sent a fresh verification email. Use the latest code or link.')
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-2 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          {isAutoVerifying ? <Loader2 className="h-6 w-6 animate-spin" /> : <MailCheck className="h-6 w-6" />}
        </div>
        <CardTitle className="text-2xl font-bold">Verify your email</CardTitle>
        <CardDescription>
          Enter the {OTP_LENGTH}-digit code from your email, or open the link we sent and we&apos;ll finish verification automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-md bg-primary/10 p-3 text-sm text-primary">
            {notice}
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="verification-email">Email</Label>
          <Input
            id="verification-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="verification-code">Verification code</Label>
          <div className="flex justify-center">
            <InputOTP
              id="verification-code"
              maxLength={OTP_LENGTH}
              value={code}
              onChange={(value) => {
                setCode(value)
                if (error) setError(null)
              }}
              pattern="^[0-9]+$"
              inputMode="numeric"
            >
              <InputOTPGroup>
                {Array.from({ length: OTP_LENGTH }, (_, index) => (
                  <InputOTPSlot key={index} index={index} />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>
          <p className="text-center text-sm text-muted-foreground">
            Wrong or expired code? Ask for a fresh one below.
          </p>
        </div>
      </CardContent>
      <CardFooter className="flex flex-col gap-3">
        <Button className="w-full" disabled={isLoading || isAutoVerifying} onClick={handleVerify}>
          {(isLoading || isAutoVerifying) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Verify code
        </Button>
        <Button variant="outline" className="w-full" disabled={isResending || isLoading} onClick={handleResend}>
          {isResending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCw className="mr-2 h-4 w-4" />}
          Resend verification
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Already verified? <Link href="/login" className="text-primary hover:underline">Back to sign in</Link>
        </p>
      </CardFooter>
    </Card>
  )
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<Card className="h-72 w-full max-w-md animate-pulse" />}>
      <VerifyPageContent />
    </Suspense>
  )
}
