import { createClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string) || '';
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) || '';

export const ALLOWED_DOMAIN = ((import.meta.env.VITE_ALLOWED_EMAIL_DOMAIN as string) || 'convegenius.ai').toLowerCase();
export const supabaseConfigured = !!url && !!key;

export const supabase = createClient(url || 'http://localhost', key || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});

export function isAllowedEmail(email?: string | null): boolean {
  return !!email && email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN);
}
