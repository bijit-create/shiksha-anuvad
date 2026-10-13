import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Supabase holds the glossary (R2), the conventions (R1/R3) and the sign-in.
// The publishable key is safe to expose; every read runs as the signed-in user under row-level security.

export function supabaseUrl(): string {
  return (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
}

function publishableKey(): string {
  return (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
}

export function isSupabaseConfigured(): boolean {
  return !!supabaseUrl() && !!publishableKey();
}

let _anon: SupabaseClient | null = null;

/** Client without a user, used only to validate access tokens. */
export function anonClient(): SupabaseClient {
  if (!_anon) {
    _anon = createClient(supabaseUrl(), publishableKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _anon;
}

/** Client that acts as the signed-in user, so row-level security applies. */
export function userClient(accessToken: string): SupabaseClient {
  return createClient(supabaseUrl(), publishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
