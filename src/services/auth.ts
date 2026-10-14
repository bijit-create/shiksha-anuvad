import { supabase, ALLOWED_DOMAIN, isAllowedEmail } from '../lib/supabase';

/** Access token of the signed-in user, refreshed by the Supabase client when needed. */
export async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || '';
}

export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      // Offers only accounts on the organisation's Google Workspace; the server and the database enforce it too.
      queryParams: { hd: ALLOWED_DOMAIN, prompt: 'select_account' },
    },
  });
  if (error) throw error;
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
