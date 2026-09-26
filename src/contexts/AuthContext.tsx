'use client'

import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { Session, User as SupabaseUser } from '@supabase/supabase-js'
import { getSupabaseClient } from '@/lib/supabase'
import { ensureOwnProfile } from '@/services/profile.service'
import type { User, Organization } from '@/types/models'
import { AccountType, Role } from '@/types/enums'

interface AuthState {
  session: Session | null
  supabaseUser: SupabaseUser | null
  user: User | null
  organization: Organization | null
  isLoading: boolean
  isAuthenticated: boolean
  isProfileReady: boolean
  recoveryPath: string | null
  error: string | null
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string, name: string) => Promise<{ error: string | null; needsVerification: boolean }>
  verifyEmailOtp: (params: { email?: string; token?: string; tokenHash?: string; type?: VerificationType }) => Promise<{ error: string | null; nextPath: string }>
  resendVerification: (email: string) => Promise<{ error: string | null }>
  logout: () => Promise<void>
  setAccountType: (accountType: AccountType) => Promise<{ error: string | null }>
  createOrganization: (name: string) => Promise<{ error: string | null }>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

type VerificationType = 'signup' | 'email' | 'magiclink' | 'recovery' | 'invite' | 'email_change'

function mapUser(data: Record<string, unknown>): User {
  return {
    ...data,
    role: data.role as Role,
    account_type: data.account_type as AccountType,
  } as User
}

function getRecoveryPath(user: User | null): string | null {
  if (!user?.account_type) {
    return '/account-type'
  }

  if (user.account_type === AccountType.business && !user.organization_id) {
    return '/onboarding'
  }

  return null
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    session: null,
    supabaseUser: null,
    user: null,
    organization: null,
    isLoading: true,
    isAuthenticated: false,
    isProfileReady: false,
    recoveryPath: null,
    error: null,
  })

  const supabase = getSupabaseClient()
  const authRevision = useRef(0)

  const fetchUserProfile = async (userId: string): Promise<User | null> => {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      throw new Error('Could not load your profile. Please try again.')
    }

    return data ? mapUser(data as Record<string, unknown>) : null
  }

  const fetchOrganization = async (organizationId: string): Promise<Organization | null> => {
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', organizationId)
      .single()

    if (error || !data) {
      // Organization access can change while a session is open.
      return null
    }

    return data as Organization
  }

  const bootstrapAuthState = async (session: Session | null) => {
    const revision = ++authRevision.current
    try {
      if (!session?.user) {
        setState({
          session: null,
          supabaseUser: null,
          user: null,
          organization: null,
          isLoading: false,
          isAuthenticated: false,
          isProfileReady: false,
          recoveryPath: null,
          error: null,
        })
        return
      }

      const user = await fetchUserProfile(session.user.id)
      if (revision !== authRevision.current) return
      if (user && !user.is_active) {
        await supabase.auth.signOut({ scope: 'local' })
        setState({ session: null, supabaseUser: null, user: null, organization: null,
          isLoading: false, isAuthenticated: false, isProfileReady: false,
          recoveryPath: null, error: 'This account is inactive. Contact your workspace owner.' })
        return
      }
      let organization: Organization | null = null

      if (user?.organization_id) {
        organization = await fetchOrganization(user.organization_id)
      }

      if (revision !== authRevision.current) return
      const recoveryPath = getRecoveryPath(user)

      setState({
        session,
        supabaseUser: session.user,
        user,
        organization,
        isLoading: false,
        isAuthenticated: Boolean(user) && !recoveryPath,
        isProfileReady: Boolean(user) && !recoveryPath,
        recoveryPath,
        error: user ? null : 'We could not finish loading your profile.',
      })
    } catch (error) {
      if (revision !== authRevision.current) return
      // Show a safe recovery message without logging profile or provider details.
      setState({
        session,
        supabaseUser: session?.user ?? null,
        user: null,
        organization: null,
        isLoading: false,
        isAuthenticated: false,
        isProfileReady: false,
        recoveryPath: null,
        error: 'We could not finish loading your profile.',
      })
    }
  }

  useEffect(() => {
    let active = true
    let pending: ReturnType<typeof setTimeout> | undefined
    const initialRevision = authRevision.current
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (active && authRevision.current === initialRevision) void bootstrapAuthState(session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        authRevision.current++
        if (pending) clearTimeout(pending)
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED' || event === 'PASSWORD_RECOVERY' || event === 'MFA_CHALLENGE_VERIFIED') {
          pending = setTimeout(() => { if (active) void bootstrapAuthState(session) }, 0)
        } else if (event === 'SIGNED_OUT') {
          setState({
            session: null,
            supabaseUser: null,
            user: null,
            organization: null,
            isLoading: false,
            isAuthenticated: false,
            isProfileReady: false,
            recoveryPath: null,
            error: null,
          })
        } else if (event === 'TOKEN_REFRESHED' && session) {
          pending = setTimeout(() => { if (active) void bootstrapAuthState(session) }, 0)
        }
      }
    )

    return () => { active = false; authRevision.current++; if (pending) clearTimeout(pending); subscription.unsubscribe() }
  }, [])

  const getPostAuthPath = (user: User | null) => getRecoveryPath(user) ?? '/dashboard'

  const login = async (email: string, password: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }))

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setState(prev => ({ ...prev, isLoading: false, error: error.message }))
      return { error: error.message }
    }

    return { error: null }
  }

  const signUp = async (email: string, password: string, name: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }))

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
      },
    })

    if (error) {
      setState(prev => ({ ...prev, isLoading: false, error: error.message }))
      return { error: error.message, needsVerification: false }
    }

    if (data.user && !data.session) {
      setState(prev => ({ ...prev, isLoading: false }))
      return { error: null, needsVerification: true }
    }

    return { error: null, needsVerification: false }
  }

  const verifyEmailOtp = async ({
    email,
    token,
    tokenHash,
    type = 'signup',
  }: {
    email?: string
    token?: string
    tokenHash?: string
    type?: VerificationType
  }) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }))

    if (!tokenHash && (!email || !token)) {
      const message = 'Missing verification code.'
      setState(prev => ({ ...prev, isLoading: false, error: message }))
      return { error: message, nextPath: '/verify' }
    }

    const response = tokenHash
      ? await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type,
        })
      : await supabase.auth.verifyOtp({
          email: email as string,
          token: token as string,
          type,
        })

    if (response.error) {
      setState(prev => ({ ...prev, isLoading: false, error: response.error.message }))
      return { error: response.error.message, nextPath: '/verify' }
    }

    await bootstrapAuthState(response.data.session ?? null)
    const user = response.data.session?.user?.id
      ? await fetchUserProfile(response.data.session.user.id)
      : null

    return { error: null, nextPath: getPostAuthPath(user) }
  }

  const resendVerification = async (email: string) => {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
    })

    if (error) {
      return { error: error.message }
    }

    return { error: null }
  }

  const logout = async () => {
    authRevision.current++
    setState(prev => ({ ...prev, isLoading: true }))
    await supabase.auth.signOut()
    setState({
      session: null,
      supabaseUser: null,
      user: null,
      organization: null,
      isLoading: false,
      isAuthenticated: false,
      isProfileReady: false,
      recoveryPath: null,
      error: null,
    })
  }

  const setAccountType = async (accountType: AccountType) => {
    if (!state.supabaseUser) {
      return { error: 'Not authenticated' }
    }

    try {
      await ensureOwnProfile(state.supabaseUser, accountType)
    } catch {
      return { error: 'Could not finish setting up your profile. Please try again.' }
    }

    const { error } = await supabase.rpc('set_own_account_type', {
      account_type_param: accountType,
    })

    if (error) {
      return { error: error.message }
    }

    await refreshUser()
    return { error: null }
  }

  const createOrganization = async (name: string) => {
    if (!state.supabaseUser) {
      return { error: 'Not authenticated' }
    }

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({ name })
      .select()
      .single()

    if (orgError || !org) {
      return { error: orgError?.message || 'Failed to create organization' }
    }

    const { error: userError } = await supabase
      .from('users')
      .update({
        organization_id: org.id,
        role: Role.owner,
      })
      .eq('id', state.supabaseUser.id)

    if (userError) {
      return { error: userError.message }
    }

    await refreshUser()
    return { error: null }
  }

  const refreshUser = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    await bootstrapAuthState(session)
  }

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        signUp,
        verifyEmailOtp,
        resendVerification,
        logout,
        setAccountType,
        createOrganization,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
