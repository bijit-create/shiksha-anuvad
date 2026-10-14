import { supabase, ALLOWED_DOMAIN, isAllowedEmail } from '../lib/supabase';

/** Access token of the signed-in user, refreshed by the Supabase client when needed. */
export async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || '';
}

export async function sendEmailLink(email: string): Promise<void> {
  if (!isAllowedEmail(email)) throw new Error(`Use your ${ALLOWED_DOMAIN} email address.`);
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
