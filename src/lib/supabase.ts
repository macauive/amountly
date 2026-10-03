import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { usesRenderBackend } from '@/lib/platform/config'
import { createRenderBrowserClient } from '@/lib/platform/browser'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Singleton instance for client-side usage
let browserClient: SupabaseClient | null = null

export function getSupabaseClient() {
  if (!browserClient) {
    browserClient = usesRenderBackend ? createRenderBrowserClient() : createBrowserClient(supabaseUrl, supabaseAnonKey)
  }
  return browserClient
}

// Alias for compatibility
export const createClient = getSupabaseClient
