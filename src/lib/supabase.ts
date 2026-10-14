import { createClient } from '@supabase/supabase-js';

// Defaults are the ConveGenius project "cg-glossary". Both values are public by design (row-level security
// protects the data); env vars override them for another project.
const url = (import.meta.env.VITE_SUPABASE_URL as string) || 'https://grimpkecuvybjkpicaoo.supabase.co';
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) || 'sb_publishable_HWj40vykmAqhPwa4Gdvs2w_0_dZPRCP';

export const ALLOWED_DOMAIN = ((import.meta.env.VITE_ALLOWED_EMAIL_DOMAIN as string) || 'convegenius.ai').toLowerCase();
export const supabaseConfigured = !!url && !!key;

export const supabase = createClient(url || 'http://localhost', key || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});

export function isAllowedEmail(email?: string | null): boolean {
  return !!email && email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN);
}
