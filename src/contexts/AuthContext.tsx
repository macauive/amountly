'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { Session, User as SupabaseUser } from '@supabase/supabase-js'
import { getSupabaseClient } from '@/lib/supabase'
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

function getAccountTypeFromMetadata(supabaseUser: SupabaseUser): AccountType | undefined {
  const candidates = [
    supabaseUser.user_metadata?.account_type,
    supabaseUser.app_metadata?.account_type,
  ]

  for (const candidate of candidates) {
    if (candidate === AccountType.personal || candidate === AccountType.freelancer || candidate === AccountType.business) {
      return candidate
    }
  }

  return undefined
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

  const fetchUserProfile = async (userId: string): Promise<User | null> => {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      console.error('Error fetching user profile:', error)
      return null
    }

    return data ? mapUser(data as Record<string, unknown>) : null
  }

  const repairUserProfile = async (supabaseUser: SupabaseUser): Promise<User | null> => {
    const existingUser = await fetchUserProfile(supabaseUser.id)
    const accountTypeFromMetadata = getAccountTypeFromMetadata(supabaseUser)

    if (existingUser?.account_type || !accountTypeFromMetadata) {
      return existingUser
    }

    const repairPayload = {
      id: supabaseUser.id,
      email: supabaseUser.email ?? '',
      name:
        (typeof supabaseUser.user_metadata?.name === 'string' && supabaseUser.user_metadata.name.trim()) ||
        (typeof supabaseUser.user_metadata?.full_name === 'string' && supabaseUser.user_metadata.full_name.trim()) ||
        (supabaseUser.email?.split('@')[0] ?? 'New User'),
      role: existingUser?.role ?? Role.owner,
      account_type: accountTypeFromMetadata,
      organization_id:
        typeof supabaseUser.user_metadata?.organization_id === 'string'
          ? supabaseUser.user_metadata.organization_id
          : existingUser?.organization_id,
    }

    const { data, error } = await supabase
      .from('users')
      .upsert(repairPayload, { onConflict: 'id' })
      .select('*')
      .single()

    if (error) {
      console.error('Error repairing user profile:', error)
      return existingUser
    }

    return mapUser(data as Record<string, unknown>)
  }

  const fetchOrganization = async (organizationId: string): Promise<Organization | null> => {
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', organizationId)
      .single()

    if (error || !data) {
      console.error('Error fetching organization:', error)
      return null
    }

    return data as Organization
  }

  const bootstrapAuthState = async (session: Session | null) => {
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

      const user = await repairUserProfile(session.user)
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
      console.error('Error bootstrapping auth state:', error)
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
    void supabase.auth.getSession().then(({ data: { session } }) => {
      void bootstrapAuthState(session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED') {
          void bootstrapAuthState(session)
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
          void bootstrapAuthState(session)
        }
      }
    )

    return () => subscription.unsubscribe()
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
