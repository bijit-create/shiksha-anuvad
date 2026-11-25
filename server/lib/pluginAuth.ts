import { isAllowedEmail, allowedDomain } from './auth.js';

// Callers without a Supabase session: the textbook-lesson-builder plugin running inside Claude.
// It sends the shared plugin code (the same one its Gemini gateway uses) and the Claude account it
// runs under. The code keeps strangers out; the account says who used it and must be on the team domain.

export interface PluginUser {
  email: string;
  name: string;
  orgId: string;
  orgName: string;
  source: string;
}

const clean = (v: any, n = 80) => String(v ?? '').replace(/[^\w .@\-()/]/g, '').slice(0, n);

export function pluginUser(body: any): PluginUser {
  const u = body?.user || {};
  const email = String(u.email || '').trim().toLowerCase().slice(0, 120);
  return {
    email: /^[^@\s]+@[^@\s]+$/.test(email) ? email : '',
    name: clean(u.name),
    orgId: String(u.org_id || '').replace(/[^\w-]/g, '').slice(0, 64),
    orgName: clean(u.org_name),
    source: clean(u.source),
  };
}

/** Null when the caller may use the API, else the HTTP status and message to send. */
export function pluginRefusal(body: any, user: PluginUser): { status: number; error: string } | null {
  const code = (process.env.PLUGIN_CODE || '').trim();
  if (!code) return { status: 500, error: 'Server misconfigured: PLUGIN_CODE not set.' };
  if (String(body?.code || '') !== code) {
    return { status: 401, error: 'This copy of the plugin has a missing or old code. Update the plugin.' };
  }
  if (!user.email) return { status: 403, error: 'No Claude account was found on this computer. Sign in to Claude, then try again.' };
  if (!isAllowedEmail(user.email)) return { status: 403, error: `Only ${allowedDomain()} Claude accounts may use this.` };
  return null;
}
